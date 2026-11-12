/**
 * [Gate PlanB-P6] 今日の画面: 「プランB に切り替える」(S6)。今いる所(済んだ最後の予定・選んだ予定)と今の時刻から、
 * 控えの案ごとに間に合う合流点・そこまでの移動・とばす予定・済んだ予定・この後の屋外の予定・つながりを出し、
 * 途中から切り替える(済んだ予定は元の案に残り、記録に合流点と地名が残る)。位置(緯度経度)は送らない。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GitBranch, CloudRain, CheckCircle2, AlertTriangle } from 'lucide-react';
import Button from '@/components/common/Button';
import type { AxiosRequestConfig } from 'axios';
import type { SwitchOption, SwitchOptions, VariantReason } from '@/services/api/dayVariants';
import { api, type TodayEvent } from '@/services/api';

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
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { enqueue, isNetworkError, loadQueue } from '@/utils/syncQueue';
import { loadSnapshot, saveSnapshot } from '@/utils/offlineVault';
import { currentOfflineSession } from '@/utils/offlineSession';

interface Props {
  planId: string;
  date: string | null;
  events: TodayEvent[];
  onSwitched: () => void;
  /** 通信できない(保存済みの当日情報を見ている)。保存した切り替え先を出し、切り替えは端末に溜めて後で送る */
  offline?: boolean;
}

/** [Gate PlanB-Offline] 切り替え先を端末に保存する名前(暗号化して IndexedDB。ログアウト後は開けない) */
const snapName = (planId: string) => `variant-switch:${planId}`;

const MODE_LABEL: Record<string, string> = { driving: '車', train: '電車', bus: 'バス', walking: '徒歩', taxi: 'タクシー' };

const TodaySwitchPanel: React.FC<Props> = ({ planId, date, events, onSwitched, offline = false }) => {
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

  if (!data || data.options.length === 0) return done ? <p role="status" className="tc-today-switch-done">{done}</p> : null;
  const place = from ? `${events.find((e) => e.id === from)?.title ?? ''}のあたり` : null;

  const queue = (o: SwitchOption, label: string) => {
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

  const go = async (o: SwitchOption) => {
    if (!o.join) return;
    const label = `${o.variant.label} ${o.variant.name}`;
    if (offline || saved !== null) {
      if (!window.confirm(`通信できないため、${label} への切り替えを端末に保存し、通信が戻ったら送ります。よろしいですか?`)) return;
      queue(o, label);
      return;
    }
    if (!window.confirm(`ここから「${label}」に切り替えます。${o.join.start} の「${o.join.title}」で合流します。済んだ予定はそのまま記録に残ります。`)) return;
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

  return (
    <section className="tc-card tc-today-switch" aria-labelledby="today-switch-title" data-testid="today-switch">
      <h2 id="today-switch-title" className="tc-today-switch-title"><GitBranch size={16} aria-hidden="true" />プランB に切り替える</h2>
      {saved !== null && (
        <p className="tc-today-switch-sub is-warn" role="status" data-testid="today-switch-offline">
          {`通信できないため、${new Date(saved).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })} に保存した切り替え先を出しています(移動の時間はその時の値)`}
        </p>
      )}
      {queued && !done && <p className="tc-today-switch-sub" data-testid="today-switch-queued">端末に保存した切り替えがあります。通信が戻ったら送ります</p>}
      {data.forecast && (
        <p className={`tc-today-switch-sub${data.forecast.rainy ? ' is-warn' : ''}`} data-testid="today-switch-forecast">
          {`予報(${data.forecast.source}): ${data.forecast.label}`}
          {data.forecast.precipitation_probability !== null ? ` · 降水確率 ${data.forecast.precipitation_probability}%` : ''}
          {data.forecast.rain_hours && data.forecast.rain_hours.length > 0 ? ` · 雨 ${data.forecast.rain_hours.join('・')}` : ''}
          {data.forecast.rainy ? ' · 雨の案への切り替えを考えてください' : ''}
        </p>
      )}
      {data.alerts.length > 0 && (
        <p className="tc-today-switch-alert" role="status" data-testid="today-switch-alert">
          {data.alerts.some((a) => a.kind === 'weather') ? <CloudRain size={15} aria-hidden="true" /> : <AlertTriangle size={15} aria-hidden="true" />}
          {data.alerts.map((a) => `${a.label}${a.note ? `: ${a.note}` : ''}`).join('・')}。控えの案に切り替えますか?
        </p>
      )}
      <label className="tc-today-switch-from">
        {`今 ${data.now ?? ''} · 今いる所`}
        <select value={from} onChange={(e) => setFrom(e.target.value)} data-testid="today-switch-from">
          <option value="">{data.here_known ? '済んだ最後の予定のあたり' : '場所が分かりません(移動は30分で見込みます)'}</option>
          {events.map((e) => <option key={e.id} value={e.id}>{`${e.title}のあたり`}</option>)}
        </select>
      </label>
      {done && <p role="status" className="tc-today-switch-done">{done}</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <ul className="tc-today-switch-list">
        {data.options.map((o) => (
          <li key={o.variant.day_id} className={`tc-today-switch-opt${o.recommended ? ' is-rec' : ''}`} data-testid={`today-switch-${o.variant.label}`}>
            <p className="tc-today-switch-name">
              <strong>{`${o.variant.label} ${o.variant.name}`}</strong>
              {o.variant.reason_label && <span className="tc-variant-chip">{o.variant.reason_label}</span>}
              {o.recommended && <span className="tc-today-switch-rec">おすすめ</span>}
            </p>
            {o.join ? (
              <p className="tc-today-switch-join">
                {`合流: ${o.join.start} ${o.join.title}`}
                {` ← ${MODE_LABEL[o.join.mode] ?? o.join.mode} ${o.join.travel_minutes !== null ? `${o.join.travel_minutes}分` : '約30分(見込み)'}`}
                {`(${o.join.arrive} 着)`}
                <span className="is-ok"><CheckCircle2 size={13} aria-hidden="true" />{`間に合う(余裕 ${o.join.margin_minutes}分)`}</span>
              </p>
            ) : <p className="tc-today-switch-join is-none">合流: 今から間に合う予定がありません</p>}
            {o.done.length > 0 && <p className="tc-today-switch-sub">{`済んだ予定(${o.done.join('・')})はそのまま記録に残ります`}</p>}
            {o.skipped.length > 0 && <p className="tc-today-switch-sub">{`とばす予定: ${o.skipped.join('・')}`}</p>}
            {o.outdoor_after_join.length > 0 && (
              <p className="tc-today-switch-sub is-warn">{`この後に屋外の予定: ${o.outdoor_after_join.join('・')}`}</p>
            )}
            {o.check.items.filter((i) => i.level !== 'ok').map((i) => (
              <p key={i.title} className="tc-today-switch-sub is-warn">{i.title}</p>
            ))}
            <Button variant={o.recommended ? 'primary' : 'secondary'} size="sm" disabled={!o.join} loading={busy === o.variant.day_id}
              onClick={() => void go(o)} data-testid={`today-switch-go-${o.variant.label}`}>
              {`ここから ${o.variant.label} に切り替える`}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default TodaySwitchPanel;
