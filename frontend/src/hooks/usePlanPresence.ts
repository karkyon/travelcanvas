/**
 * [Gate C1] FR-020 共同編集(準リアルタイム)。旅行を開いている間、数秒ごとに backend へ知らせ
 * (POST /plans/{id}/presence)、同じ旅行を開いている人・編集中の予定・他の人の変更を受け取る。
 *
 * - 間隔は backend が決める(他の人がいれば5秒、ひとりなら15秒)。編集する予定が変わった時はすぐ知らせる
 * - 画面が隠れている間(別のタブ)は止め、戻ったらすぐ知らせる。画面を閉じたら知らせを消す
 * - 通信に失敗しても画面の操作は止めない(次の間隔でやり直す。失敗が続く間は「確認できません」と示す)
 * - knownRevision(画面が持っている版)より後の変更を受け取る。読み直して版が追いつくと消える
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { leavePresence, postPresence } from '@/services/api';
import type { PresenceChange, PresenceViewer } from '@/services/api';
import { presenceClientId } from '@/utils/presence';

export interface PlanPresence {
  viewers: PresenceViewer[];
  changes: PresenceChange[];
  remoteRevision: number | null;
  /** 直近の知らせが失敗した */
  offline: boolean;
  /** すぐ知らせ直す(読み直しの後など) */
  refresh: () => void;
}

const RETRY_SECONDS = 15;

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
      wait = Math.max(2, state.poll_seconds);
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

  useEffect(() => {
    if (!planId || !enabled) return undefined;
    alive.current = true;
    void send();
    const onVisible = () => {
      if (!document.hidden) void send();
      else if (timer.current) clearTimeout(timer.current);
    };
    const onLeave = () => {
      void leavePresence(planId, clientId.current).catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pagehide', onLeave);
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pagehide', onLeave);
      onLeave();
      setViewers([]);
      setChanges([]);
      setRemoteRevision(null);
    };
  }, [planId, enabled, send]);

  // 編集する予定が変わったら・画面の版が変わったら(読み直し・自分の保存)すぐ知らせる
  useEffect(() => {
    if (!planId || !enabled || !alive.current) return;
    const last = sent.current;
    if (last && last.known === knownRevision && last.editing === editingEventId) return;
    void send();
  }, [editingEventId, knownRevision, planId, enabled, send]);

  return { viewers, changes, remoteRevision, offline, refresh: () => void send() };
}
