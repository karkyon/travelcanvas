/**
 * [Gate MemoryReel] S4 リールの終わり。「○○の旅、おしまい。」・最後のひとこと・旅の数・また行きたい?
 * 参考: Spotify Wrapped(数枚の物語の最後に数字をまとめ、次の行動へつなぐ)。
 * - 「同じ場所でもう一度計画する」: 新しい旅行の画面に行き先を入れて開く
 * - 次の思い出: 8 秒後に自動で始まる。「止める」で止まる(動きを減らす設定では自動で始めない)
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { MemoryReelData } from '@/services/api/memoryReel';
import { recapStats, reelDateRange, replanQuery, stayText } from './reelModel';

const WAIT = 8;

function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface ReelNext { planId: string; title: string; badge: string | null }

const ReelEndCard: React.FC<{
  data: MemoryReelData; next: ReelNext | null; onReplay: () => void; onNext: (n: ReelNext) => void;
}> = ({ data, next, onReplay, onNext }) => {
  const [left, setLeft] = useState(WAIT);
  const [auto, setAuto] = useState(() => next !== null && !reducedMotion());
  useEffect(() => {
    if (!auto || !next) return undefined;
    if (left <= 0) { onNext(next); return undefined; }
    const t = window.setTimeout(() => setLeft((v) => v - 1), 1000);
    return () => window.clearTimeout(t);
  }, [auto, left, next, onNext]);

  const dates = reelDateRange(data.start_date, data.end_date);
  const stay = stayText(data.day_count);
  const stats = recapStats(data);
  const short = data.destination?.split(/[、,・\s]/)[0] || data.title;
  return (
    <section className="tc-reel-end" aria-labelledby="reel-end-title" data-testid="memory-reel-end">
      <p className="tc-reel-end-date">{[dates, stay].filter(Boolean).join(' · ')}</p>
      <h2 id="reel-end-title">{`${short}の旅、`}<br />おしまい。</h2>
      {data.quote && (
        <figure className="tc-reel-end-quote">
          <blockquote>{`「${data.quote}」`}</blockquote>
          <figcaption>最後のメモより</figcaption>
        </figure>
      )}
      {stats.length > 0 && (
        <dl className="tc-reel-end-stats">
          {stats.map((s) => <div key={s.label}><dt>{s.label}</dt><dd>{s.value}</dd></div>)}
        </dl>
      )}
      <p className="tc-reel-end-ask">また行きたい?</p>
      <div className="tc-reel-end-actions">
        <Link to={`/planner?new=1${replanQuery(data)}`} className="tc-focus-ring tc-reel-end-primary" data-testid="memory-reel-replan">
          同じ場所でもう一度計画する
        </Link>
        <div>
          <button type="button" className="tc-focus-ring tc-reel-end-sub" onClick={onReplay}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>最初から見る
          </button>
          <Link to={`/planner/${data.plan_id}/memories`} className="tc-focus-ring tc-reel-end-sub">旅の記録を開く</Link>
        </div>
      </div>
      {next && (
        <div className="tc-reel-end-next" data-testid="memory-reel-next-trip">
          <span className="tc-reel-end-ring" aria-hidden="true" style={{ '--p': auto ? (WAIT - left) / WAIT : 0 } as React.CSSProperties}>
            {auto ? left : ''}
          </span>
          <span className="min-w-0">
            <small>{auto ? `次の思い出が ${left} 秒後に始まります` : '次の思い出'}</small>
            <b>{next.title}</b>
          </span>
          {auto
            ? <button type="button" className="tc-focus-ring tc-reel-end-sub" onClick={() => setAuto(false)}>止める</button>
            : <button type="button" className="tc-focus-ring tc-reel-end-go" onClick={() => onNext(next)}>見る</button>}
        </div>
      )}
    </section>
  );
};

export default ReelEndCard;
