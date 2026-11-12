/**
 * [Gate TDay] 旅の当日「旅帖ライブ」の小さな部品: ライブ帯・旅の糸・出発の合図・旅帖の印。
 * 状態は色だけで伝えない(NOW・NEXT・済・雨・段階は必ず文字)。
 */
import React from 'react';
import type { TodayEvent } from '@/services/api';
import type { GuideStamp } from '@/services/api/travelDay';
import { formatTimeInZone } from '../todayModel';
import { STAGE_LABEL, STAGE_ORDER, sealGlyph, sealTilt, type GoNowView } from './todayLive';

export const Seal: React.FC<{ title: string; id: string; eventType?: string | null; size?: number;
  state?: 'done' | 'ready' | 'empty'; press?: boolean; label?: string }> = ({
  title, id, eventType, size = 52, state = 'done', press = false, label,
}) => {
  const glyph = sealGlyph(title, eventType);
  const cls = state === 'done' ? 'tc-seal' : state === 'ready' ? 'tc-seal tc-seal--ready' : 'tc-seal tc-seal--empty';
  return (
    <span className={`${cls}${press ? ' tc-seal--press' : ''}`}
      {...(label === '' ? { 'aria-hidden': true } : { role: 'img',
        'aria-label': label ?? (state === 'done' ? `${title}の印(押した)` : `${title}の印(まだ)`) })}
      style={{ width: size, height: size, fontSize: Math.round(size * (glyph.length > 1 ? 0.3 : 0.42)),
        ['--tilt' as string]: `${state === 'done' ? sealTilt(id) : 0}deg` }}>
      {state === 'empty' ? '' : glyph}
    </span>
  );
};

export const LiveBand: React.FC<{
  nowLocal: string | null; next: TodayEvent | null; timeZone: string | null; go: GoNowView | null;
  rainText: string | null; delayed: boolean; stale: boolean;
}> = ({ nowLocal, next, timeZone, go, rainText, delayed, stale }) => (
  <div className="tc-live-band" role="status" aria-label="ライブ帯" data-testid="today-live-band">
    <span className="tc-live-band__live"><span className="tc-live-dot" aria-hidden="true" />{stale ? '保存済み' : 'LIVE'}</span>
    {nowLocal && <span>現地 <b>{nowLocal}</b></span>}
    {next && <span>次 <b>{`${formatTimeInZone(next.start_at, timeZone)} ${next.title}`}</b></span>}
    {go && (
      <span className="tc-live-band__go" data-stage={go.stage}>
        {go.minutesToLeave > 0 ? `あと${go.minutesToLeave}分で出発` : go.stage === 'now' ? '今出発' : `出発を${-go.minutesToLeave}分過ぎた`}
      </span>
    )}
    {go?.travelMinutes != null && (
      <span className="tc-live-band__muted">{`移動 約${go.travelMinutes}分${go.estimated ? '(概算)' : ''}`}</span>
    )}
    <span className="tc-live-band__muted">{delayed ? '遅延の知らせ あり' : '遅延の知らせ なし'}</span>
    {rainText && <span className="tc-live-band__end">{rainText}</span>}
  </div>
);

export const JourneyThread: React.FC<{
  events: TodayEvent[]; timeZone: string | null; nowId: string | null; nextId: string | null; doneIds: Set<string>;
  stamps: Record<string, GuideStamp>; rainIds: Set<string>;
}> = ({ events, timeZone, nowId, nextId, doneIds, stamps, rainIds }) => (
  <nav className="tc-thread" aria-label="旅の糸(今日の道のり)">
    <ol>
      {events.map((e, i) => {
        const visited = stamps[e.id]?.status === 'visited';
        const state = e.id === nowId ? 'now' : e.id === nextId ? 'next' : visited || doneIds.has(e.id) ? 'done' : rainIds.has(e.id) ? 'rain' : 'todo';
        const text = state === 'now' ? 'NOW' : state === 'next' ? 'NEXT' : state === 'done' ? sealGlyph(e.title, e.event_type) : String(i + 1);
        const word = { now: '今いる場所', next: '次の場所', done: visited ? '印を押した' : '済んだ', rain: '雨の時間', todo: 'この後' }[state];
        return (
          <li key={e.id} aria-label={`${formatTimeInZone(e.start_at, timeZone)} ${e.title}(${word})`}>
            <span className="tc-thread__node" data-state={state} aria-hidden="true">{text}</span>
            <b aria-hidden="true">{formatTimeInZone(e.start_at, timeZone)}</b>
            <span className="tc-thread__title" aria-hidden="true">
              {e.title}{state === 'rain' && <span className="tc-thread__rain"> 雨</span>}
            </span>
          </li>
        );
      })}
    </ol>
  </nav>
);

export const GoNowBlock: React.FC<{ view: GoNowView; title: string; timeZone: string | null }> = ({ view, title, timeZone }) => {
  const dash = Math.round(view.ring * 314);
  const leave = formatTimeInZone(view.leaveBy, timeZone);
  const big = view.minutesToLeave > 0 ? `${view.minutesToLeave}分` : view.stage === 'now' ? '今' : `+${-view.minutesToLeave}分`;
  const expected = view.expectedArrivalMs != null ? formatTimeInZone(new Date(view.expectedArrivalMs).toISOString(), timeZone) : null;
  return (
    <div className="tc-go" data-stage={view.stage} data-testid="today-go">
      <div className="tc-go__row">
        <svg className="tc-go__ring" width="96" height="96" viewBox="0 0 120 120" role="img"
          aria-label={view.minutesToLeave > 0 ? `出発まであと${view.minutesToLeave}分` : `段階: ${STAGE_LABEL[view.stage]}`}>
          <circle className="bg" cx="60" cy="60" r="50" fill="none" strokeWidth="12" />
          <circle className="fg" cx="60" cy="60" r="50" fill="none" strokeWidth="12" strokeLinecap="round"
            strokeDasharray={`${dash} 314`} transform="rotate(-90 60 60)" />
          <text className="sub" x="60" y="52" textAnchor="middle" fontSize="12" fontWeight="700">
            {view.minutesToLeave > 0 ? '出発まで' : '出発'}
          </text>
          <text x="60" y="80" textAnchor="middle" fontSize="26" fontWeight="800">{big}</text>
        </svg>
        <div style={{ minWidth: 0 }}>
          <p className="tc-go__head">
            {view.stage === 'late' && expected ? `${expected}ごろ着く見込み` : `${leave} に出れば、ちょうど`}
          </p>
          <p className="tc-go__sub" aria-label={`${title}へ`}>
            {view.travelMinutes != null ? `移動 約${view.travelMinutes}分` : '登録した移動の出発時刻から'}
          </p>
          {view.estimated && <p className="tc-go__note">移動時間は直線距離からの概算です</p>}
        </div>
      </div>
      <ol className="tc-go__stages" aria-label="出発までの段階">
        {STAGE_ORDER.map((s) => (
          <li key={s} aria-current={s === view.stage ? 'step' : undefined}>{STAGE_LABEL[s]}</li>
        ))}
      </ol>
      <p className="tc-go__advice">{view.advice}</p>
    </div>
  );
};
