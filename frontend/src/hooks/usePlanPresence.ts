/**
 * [Gate C1] FR-020 共同編集(準リアルタイム)。旅行を開いている間、数秒ごとに backend へ知らせ
 * (POST /plans/{id}/presence)、同じ旅行を開いている人・編集中の予定・他の人の変更を受け取る。
 *
 * - 間隔は backend が決める(他の人がいれば5秒、ひとりなら15秒)。編集する予定が変わった時はすぐ知らせる
 * - 画面が隠れている間(別のタブ)は止め、戻ったらすぐ知らせる。画面を閉じたら知らせを消す
 * - 通信に失敗しても画面の操作は止めない(次の間隔でやり直す。失敗が続く間は「確認できません」と示す)
 * - knownRevision(画面が持っている版)より後の変更を受け取る。読み直して版が追いつくと消える
 * - [Gate G2] 即時の通知(GET /plans/{id}/events/stream)をつなぎ、他の人の保存・開いている人の変化をその場で受けたら
 *   すぐ知らせ直して中身を取る(ポーリングの間隔を待たない)。つながっている間は知らせの間隔を STREAM_POLL_SECONDS に
 *   伸ばす(開いていることを知らせ続けるため、0 にはしない)。接続が閉じられたらつなぎ直し、失敗が続く時は間隔を
 *   伸ばす。断られた(未対応・権限)時はポーリングだけで続ける。画面が隠れている間は切る
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { leavePresence, postPresence, streamPlanEvents } from '@/services/api';
import type { PlanStreamEnd, PresenceChange, PresenceViewer } from '@/services/api';
import { presenceClientId } from '@/utils/presence';

export interface PlanPresence {
  viewers: PresenceViewer[];
  changes: PresenceChange[];
  remoteRevision: number | null;
  /** 直近の知らせが失敗した */
  offline: boolean;
  /** [Gate G2] 即時の通知につながっている */
  live: boolean;
  /** すぐ知らせ直す(読み直しの後など) */
  refresh: () => void;
}

const RETRY_SECONDS = 15;
/** [Gate G2] 即時の通知につながっている間の知らせの間隔(backend の TTL 40秒より短く) */
export const STREAM_POLL_SECONDS = 20;
const STREAM_RETRY_MIN_MS = 1000;
const STREAM_RETRY_MAX_MS = 60000;

export function usePlanPresence(
  planId: string | null | undefined,
  knownRevision: number | undefined,
  editingEventId: string | null,
  enabled = true,
): PlanPresence {
  const [viewers, setViewers] = useState<PresenceViewer[]>([]);
  const [changes, setChanges] = useState<PresenceChange[]>([]);
  const [remoteRevision, setRemoteRevision] = useState<number | null>(null);
  const [offline, setOffline] = useState(false);
  const [live, setLive] = useState(false);
  const liveRef = useRef(false);
  const stream = useRef<AbortController | null>(null);
  const streamTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamFails = useRef(0);
  const streamOff = useRef(false);
  const streamRevision = useRef<number | undefined>(undefined);
  const clientId = useRef(presenceClientId());
  const known = useRef(knownRevision);
  const editing = useRef(editingEventId);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(false);
  const inFlight = useRef(false);
  const again = useRef(false);
  // 最後に送った値(同じ値では送り直さない)
  const sent = useRef<{ known: number | undefined; editing: string | null } | null>(null);

  known.current = knownRevision;
  editing.current = editingEventId;

  const send = useCallback(async () => {
    if (!planId || !alive.current) return;
    if (inFlight.current) {
      again.current = true;
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    inFlight.current = true;
    sent.current = { known: known.current, editing: editing.current };
    let wait = RETRY_SECONDS;
    try {
      const state = await postPresence(planId, {
        client_id: clientId.current,
        known_revision: known.current,
        editing: editing.current ? { kind: 'event', id: editing.current } : null,
      });
      if (!alive.current) return;
      setViewers(state.viewers);
      setChanges(state.changes);
      setRemoteRevision(state.revision);
      setOffline(false);
      wait = liveRef.current ? Math.max(STREAM_POLL_SECONDS, state.poll_seconds) : Math.max(2, state.poll_seconds);
    } catch {
      if (alive.current) setOffline(true);
    } finally {
      inFlight.current = false;
    }
    if (!alive.current) return;
    if (again.current) {
      again.current = false;
      void send();
      return;
    }
    if (typeof document === 'undefined' || !document.hidden) {
      timer.current = setTimeout(() => void send(), wait * 1000);
    }
  }, [planId]);

  const setLiveState = (v: boolean) => {
    liveRef.current = v;
    setLive(v);
  };

  const stopStream = useCallback(() => {
    if (streamTimer.current) clearTimeout(streamTimer.current);
    streamTimer.current = null;
    stream.current?.abort();
    stream.current = null;
    setLiveState(false);
  }, []);

  const startStream = useCallback(() => {
    if (!planId || !alive.current || streamOff.current || stream.current) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    const ctrl = new AbortController();
    stream.current = ctrl;
    const startedAt = Date.now();
    void streamPlanEvents(planId, streamRevision.current ?? known.current, (ev) => {
      if (ctrl.signal.aborted) return;
      if (ev.type === 'ready') {
        streamFails.current = 0;
        setLiveState(true);
      }
      const rev = typeof ev.data.revision === 'number' ? ev.data.revision : undefined;
      if (rev !== undefined) streamRevision.current = rev;
      if (ev.type === 'revision' || ev.type === 'presence' || ev.type === 'access_lost') void send();
      if (ev.type === 'access_lost') streamOff.current = true;
    }, ctrl.signal).then((end: PlanStreamEnd) => {
      if (stream.current === ctrl) stream.current = null;
      setLiveState(false);
      if (!alive.current || end === 'aborted') return;
      if (end === 'refused' || end === 'unsupported') {
        streamOff.current = true; // ポーリングだけで続ける
        return;
      }
      // すぐ閉じられた接続(途中の機器が切る等)も失敗として数え、間隔を伸ばす
      if (end === 'failed' || end === 'unauthorized' || Date.now() - startedAt < 5000) streamFails.current += 1;
      const delay = end === 'closed' && streamFails.current === 0
        ? STREAM_RETRY_MIN_MS
        : Math.min(STREAM_RETRY_MAX_MS, STREAM_RETRY_MIN_MS * 5 * 2 ** Math.min(streamFails.current, 6));
      // 失敗が続いた時(トークンの期限切れ等)は、次の知らせ(axios が取り直す)の後につなぎ直す
      streamTimer.current = setTimeout(() => startStream(), delay);
    }).catch(() => {
      if (stream.current === ctrl) stream.current = null;
      setLiveState(false);
    });
  }, [planId, send]);

  useEffect(() => {
    if (!planId || !enabled) return undefined;
    alive.current = true;
    streamOff.current = false;
    streamFails.current = 0;
    streamRevision.current = undefined;
    void send().then(() => startStream());
    const onVisible = () => {
      if (!document.hidden) {
        void send();
        startStream();
      } else {
        if (timer.current) clearTimeout(timer.current);
        stopStream();
      }
    };
    const onLeave = () => {
      void leavePresence(planId, clientId.current).catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pagehide', onLeave);
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      stopStream();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pagehide', onLeave);
      onLeave();
      setViewers([]);
      setChanges([]);
      setRemoteRevision(null);
    };
  }, [planId, enabled, send, startStream, stopStream]);

  // 編集する予定が変わったら・画面の版が変わったら(読み直し・自分の保存)すぐ知らせる
  useEffect(() => {
    if (!planId || !enabled || !alive.current) return;
    const last = sent.current;
    if (last && last.known === knownRevision && last.editing === editingEventId) return;
    void send();
  }, [editingEventId, knownRevision, planId, enabled, send]);

  return { viewers, changes, remoteRevision, offline, live, refresh: () => void send() };
}
