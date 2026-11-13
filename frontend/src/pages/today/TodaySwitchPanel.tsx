/**
 * [Gate PlanB-P6] 今日の画面: 「プランB に切り替える」(S6)。今いる所(済んだ最後の予定・選んだ予定)と今の時刻から、
 * 控えの案ごとに間に合う合流点・そこまでの移動・とばす予定・済んだ予定・この後の屋外の予定・つながりを出し、
 * 途中から切り替える(済んだ予定は元の案に残り、記録に合流点と地名が残る)。位置(緯度経度)は送らない。
 */
import React from 'react';
import { GitBranch, CloudRain, CheckCircle2, AlertTriangle } from 'lucide-react';
import Button from '@/components/common/Button';
import type { TodayEvent } from '@/services/api';
import { useSwitchOptions } from './useSwitchOptions';


interface Props {
  planId: string;
  date: string | null;
  events: TodayEvent[];
  onSwitched: () => void;
  /** 通信できない(保存済みの当日情報を見ている)。保存した切り替え先を出し、切り替えは端末に溜めて後で送る */
  offline?: boolean;
}


const MODE_LABEL: Record<string, string> = { driving: '車', train: '電車', bus: 'バス', walking: '徒歩', taxi: 'タクシー' };

const TodaySwitchPanel: React.FC<Props> = ({ planId, date, events, onSwitched, offline = false }) => {
  const { data, from, setFrom, busy, error, done, saved, queued, go } = useSwitchOptions(planId, date, events, onSwitched, offline);
  if (!data || data.options.length === 0) return done ? <p role="status" className="tc-today-switch-done">{done}</p> : null;
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
