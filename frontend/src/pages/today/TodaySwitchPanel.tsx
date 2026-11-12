/**
 * [Gate PlanB-P6] 今日の画面: 「プランB に切り替える」(S6)。今いる所(済んだ最後の予定・選んだ予定)と今の時刻から、
 * 控えの案ごとに間に合う合流点・そこまでの移動・とばす予定・済んだ予定・この後の屋外の予定・つながりを出し、
 * 途中から切り替える(済んだ予定は元の案に残り、記録に合流点と地名が残る)。位置(緯度経度)は送らない。
 */
import React, { useCallback, useEffect, useState } from 'react';
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

interface Props {
  planId: string;
  date: string | null;
  events: TodayEvent[];
  onSwitched: () => void;
}

const MODE_LABEL: Record<string, string> = { driving: '車', train: '電車', bus: 'バス', walking: '徒歩', taxi: 'タクシー' };

const TodaySwitchPanel: React.FC<Props> = ({ planId, date, events, onSwitched }) => {
  const [data, setData] = useState<SwitchOptions | null>(null);
  const [from, setFrom] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getSwitchOptions(planId, { date, from_event_id: from || null }));
      setError(null);
    } catch {
      setData(null);  // 控えの案の欄は出さない(当日の画面の本体は続ける)
    }
  }, [planId, date, from]);
  useEffect(() => { void load(); }, [load]);

  if (!data || data.options.length === 0) return done ? <p role="status" className="tc-today-switch-done">{done}</p> : null;
  const place = from ? `${events.find((e) => e.id === from)?.title ?? ''}のあたり` : null;

  const go = async (o: SwitchOption) => {
    if (!o.join) return;
    const label = `${o.variant.label} ${o.variant.name}`;
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
      setError(errorDetailMessage(err, '切り替えられませんでした'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="tc-card tc-today-switch" aria-labelledby="today-switch-title" data-testid="today-switch">
      <h2 id="today-switch-title" className="tc-today-switch-title"><GitBranch size={16} aria-hidden="true" />プランB に切り替える</h2>
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
