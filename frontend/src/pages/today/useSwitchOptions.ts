/**
 * [Gate PlanB-P6] 控えの案(プランB)への切り替え先の取得・切り替え(端末に溜める時も)。
 * [Gate TDay-Mock] 今日の画面の「プランB に切り替える」と「雨の兆し」の画面が使う。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AxiosRequestConfig } from 'axios';
import type { SwitchOption, SwitchOptions, VariantReason } from '@/services/api/dayVariants';
import { api, type TodayEvent } from '@/services/api';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { enqueue, isNetworkError, loadQueue } from '@/utils/syncQueue';
import { loadSnapshot, saveSnapshot } from '@/utils/offlineVault';
import { currentOfflineSession } from '@/utils/offlineSession';

// 今日の画面(後から読む)だけが使う。旅程の画面の dayVariants を読み込まないよう、ここに置く(最初に読む JS の大きさ)
const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };
async function getSwitchOptions(planId: string, params: { date?: string | null; from_event_id?: string | null }): Promise<SwitchOptions> {
  const q: Record<string, string> = {};
  if (params.date) q.date = params.date;
  if (params.from_event_id) q.from_event_id = params.from_event_id;
  return (await api.get(`/plans/${planId}/today/switch-options`, { ...SILENT, params: q })).data as SwitchOptions;
}
async function switchVariant(planId: string, dayId: string, rev: number, body: {
  reason?: VariantReason | null; phase: 'during'; join_event_id: string; done_event_ids: string[]; place_label: string | null;
}): Promise<{ revision: number }> {
  return (await api.post(`/plans/${planId}/variants/${dayId}/switch`, body,
    { ...SILENT, headers: { 'If-Match': String(rev) } })).data as { revision: number };
}
/** [Gate PlanB-Offline] 切り替え先を端末に保存する名前(暗号化して IndexedDB。ログアウト後は開けない) */
const snapName = (planId: string) => `variant-switch:${planId}`;

/** [Gate TDay-Mock] 切り替え先の取得・切り替え(端末に溜める時も)。今日の画面の「雨の兆し」でも使う */
export function useSwitchOptions(planId: string, date: string | null, events: TodayEvent[], onSwitched: () => void,
  offline = false) {
  const [data, setData] = useState<SwitchOptions | null>(null);
  const [from, setFrom] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const [queued, setQueued] = useState(() => loadQueue(planId).some((o) => o.entity_type === 'variant'));

  const fromSaved = useCallback(async () => {
    const snap = await loadSnapshot<SwitchOptions>(currentOfflineSession(), snapName(planId)).catch(() => null);
    if (snap && snap.data && snap.data.date === date) {
      setData(snap.data);
      setSaved(snap.savedAt);
    } else {
      setData(null);
    }
  }, [planId, date]);

  const load = useCallback(async () => {
    if (offline) {
      await fromSaved();
      return;
    }
    try {
      const r = await getSwitchOptions(planId, { date, from_event_id: from || null });
      setData(r);
      setSaved(null);
      setError(null);
      if (!from) void saveSnapshot(currentOfflineSession(), snapName(planId), r).catch(() => false);
    } catch (e) {
      // 通信できない時は保存した切り替え先を出す。それ以外は欄を出さない(当日の画面の本体は続ける)
      if (isNetworkError(e)) await fromSaved();
      else setData(null);
    }
  }, [planId, date, from, offline, fromSaved]);
  useEffect(() => { void load(); }, [load]);
  const switchedRef = useRef(onSwitched);
  switchedRef.current = onSwitched;
  // [Gate PlanB-Offline] 通信が戻ったら、端末に溜めた切り替えを送る(旅程の画面と同じ同期。同じ操作は二重にしない)
  useEffect(() => {
    const flush = () => {
      if (!loadQueue(planId).some((o) => o.entity_type === 'variant')) return;
      void import('@/store/planStore').then(async ({ usePlanStore }) => {
        await usePlanStore.getState().syncPending(planId);
        const still = loadQueue(planId).some((o) => o.entity_type === 'variant');
        setQueued(still);
        if (!still) { setDone(null); switchedRef.current(); void load(); }
      });
    };
    if (!offline) flush();
    window.addEventListener('online', flush);
    return () => window.removeEventListener('online', flush);
  }, [planId, offline, load]);

  const place = from ? `${events.find((e) => e.id === from)?.title ?? ''}のあたり` : null;

  const queue = (o: SwitchOption, label: string) => {
    if (!data) return;
    const ok = enqueue(planId, {
      entity_type: 'variant', action: 'switch', entity_id: o.variant.day_id, base_revision: data.revision ?? 0,
      label: `${label} に切り替え`,
      fields: { from_day_id: data.active?.day_id, reason: o.variant.reason, phase: 'during', join_event_id: o.join?.event_id ?? null,
        done_event_ids: o.done_ids, place_label: place },
    });
    if (ok) {
      setQueued(true);
      setDone(`通信できないため、${label} への切り替えを端末に保存しました。通信が戻ったら送ります(その間に別の人が切り替えていたら、確かめてから決められます)`);
    } else {
      setError('端末に保存できませんでした(ストレージが使えません)');
    }
  };

  const go = async (o: SwitchOption, ask = true) => {
    if (!o.join || !data) return;
    const label = `${o.variant.label} ${o.variant.name}`;
    if (offline || saved !== null) {
      if (ask && !window.confirm(`通信できないため、${label} への切り替えを端末に保存し、通信が戻ったら送ります。よろしいですか?`)) return;
      queue(o, label);
      return;
    }
    if (ask && !window.confirm(`ここから「${label}」に切り替えます。${o.join.start} の「${o.join.title}」で合流します。済んだ予定はそのまま記録に残ります。`)) return;
    setBusy(o.variant.day_id);
    setError(null);
    try {
      await switchVariant(planId, o.variant.day_id, data.revision ?? 0, {
        reason: o.variant.reason, phase: 'during', join_event_id: o.join.event_id, done_event_ids: o.done_ids,
        place_label: place,
      });
      setDone(`${label} に切り替えました。旅程の「元に戻す」で戻せます。`);
      onSwitched();
      await load();
    } catch (err) {
      if (isNetworkError(err)) queue(o, label);
      else setError(errorDetailMessage(err, '切り替えられませんでした'));
    } finally {
      setBusy(null);
    }
  };

  return { data, from, setFrom, busy, error, done, saved, queued, go };
}

