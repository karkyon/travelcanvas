/**
 * [Gate MemoryReel] 旅の思い出リール(S1 ホームの段・S2 全画面)。
 *
 * 参考: Apple 写真の「メモリー」(写真がゆっくり寄る・引く)、Google フォトの「思い出」(上の進みの線・左右を押して前後)。
 * - 1 コマ 4.5 秒で自動で進む。止める・進めるボタン、左右の端を押して前後、← → キー、スペースで止める
 * - 「動きを減らす」設定では寄り・引きをやめ、自動でも進めない(押せば進む)。タブを隠している間は止まる
 * - 写真は今と次のコマの分だけ読む。写真が無いコマ・読めない写真は行き先の色の絵
 * - inline(ホーム)は最後まで行くと最初に戻る。full(全画面)は最後のコマの後に onFinished
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import TripCover from '@/components/trip/TripCover';
import type { MemoryReelData } from '@/services/api/memoryReel';
import { FRAME_MS, framesOf, reelDateRange, type ReelFrame } from './reelModel';
import { useReelPhotos } from './useReelPhotos';

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** 進みの線を 1 本ずつ出す上限(多い時は 1 本の線) */
const MAX_SEGMENTS = 24;

export interface MemoryReelProps {
  planId: string;
  data: MemoryReelData;
  variant: 'inline' | 'full';
  /** 左上の札(1年前の今日 など) */
  badge?: string | null;
  onExpand?: () => void;
  onClose?: () => void;
  onFinished?: () => void;
  onFrameChange?: (index: number, frame: ReelFrame) => void;
}

const MemoryReel: React.FC<MemoryReelProps> = ({ planId, data, variant, badge, onExpand, onClose, onFinished, onFrameChange }) => {
  const frames = useMemo(() => framesOf(data), [data]);
  const n = frames.length;
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(() => !reducedMotion() && n > 1);
  const [hidden, setHidden] = useState(false);
  const [announce, setAnnounce] = useState('');
  const photo = useReelPhotos(planId, frames.map((f) => f.memoryId), idx);
  const remaining = useRef(FRAME_MS);

  useEffect(() => {
    const on = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  const frame = frames[Math.min(idx, n - 1)]!;
  useEffect(() => { onFrameChange?.(idx, frame); }, [idx, frame, onFrameChange]);

  const go = (to: number, manual: boolean) => {
    const next = ((to % n) + n) % n;
    setIdx(next);
    if (manual) setAnnounce(`${next + 1}枚目 / ${n}枚: ${frames[next]!.title}`);
  };

  // 自動で進む。止めた時は残りの時間を覚えて、続きから数える(コマが変わったら最初から)
  const running = playing && !hidden && n > 0;
  useEffect(() => { remaining.current = FRAME_MS; }, [idx]);
  useEffect(() => {
    if (!running) return undefined;
    const started = Date.now();
    const t = window.setTimeout(() => {
      if (idx >= n - 1) {
        if (variant === 'full' && onFinished) { setPlaying(false); onFinished(); return; }
        if (n <= 1) { setPlaying(false); return; }
        setIdx(0);
      } else {
        setIdx(idx + 1);
      }
    }, remaining.current);
    return () => {
      window.clearTimeout(t);
      remaining.current = Math.max(300, remaining.current - (Date.now() - started));
    };
  }, [running, idx, n, variant, onFinished]);

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); go(idx + 1, true); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(idx - 1, true); }
    else if (e.key === ' ' || e.key === 'k') { e.preventDefault(); setPlaying((p) => !p); }
  };

  // 前・今・次のコマだけ描く(切り替えの時に前のコマが薄れていく)
  const shown = new Set([idx, (idx - 1 + n) % n, (idx + 1) % n]);
  const dates = reelDateRange(data.start_date, data.end_date);
  const label = playing ? '自動で流すのを止める' : '自動で流す';

  return (
    <div className={`tc-reel${running ? '' : ' is-paused'}`} data-variant={variant} role="region"
      aria-roledescription="スライドショー" aria-label={`${data.title}の思い出`} tabIndex={0} onKeyDown={onKey}
      data-testid="memory-reel">
      {frames.map((f, i) => {
        if (!shown.has(i)) return null;
        const p = photo(f.memoryId);
        const on = i === idx;
        return (
          <div key={f.key} className={`tc-reel-slide tc-reel-k${i % 4}${on ? ' is-on' : ''}`} aria-hidden={!on}>
            <div className="tc-reel-art">
              {p && p !== 'loading' && p !== 'failed' ? <img src={p} alt="" draggable={false} /> : (
                <TripCover size="card" destination={data.destination} tripTitle={data.title} startDate={data.start_date}
                  className="tc-cover--fixed tc-reel-cover">{null}</TripCover>
              )}
            </div>
            <div className="tc-reel-cap">
              {f.sub && <small>{f.sub}</small>}
              <b>{f.title}</b>
              {f.body && <p>{f.body}</p>}
            </div>
          </div>
        );
      })}

      <div className="tc-reel-top">
        {n > 1 && (n <= MAX_SEGMENTS ? (
          <div className="tc-reel-segs" aria-hidden="true">
            {frames.map((f, i) => <span key={f.key} className={i < idx ? 'is-done' : i === idx ? 'is-cur' : ''}><i /></span>)}
          </div>
        ) : (
          <div className="tc-reel-bar" aria-hidden="true"><i style={{ width: `${((idx + 1) / n) * 100}%` }} /></div>
        ))}
        <div className="tc-reel-head">
          <div className="tc-reel-title">
            {badge && <span className="tc-reel-badge">{badge}</span>}
            <span>
              <b>{data.title}</b>
              {variant === 'full' && dates && <small>{dates}</small>}
            </span>
          </div>
          <div className="tc-reel-tools">
            {n > 1 && (
              <button type="button" className="tc-focus-ring tc-reel-btn" onClick={() => setPlaying((p) => !p)} aria-label={label}
                title={label} data-testid="memory-reel-play">
                {playing ? <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z" fill="currentColor" /></svg> : <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5 13.5 8 4 13.5Z" fill="currentColor" /></svg>}
              </button>
            )}
            {onExpand && (
              <button type="button" className="tc-focus-ring tc-reel-btn" onClick={onExpand} aria-label="大きく見る" title="大きく見る"
                data-testid="memory-reel-expand">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
              </button>
            )}
            {onClose && (
              <button type="button" className="tc-focus-ring tc-reel-btn" onClick={onClose} aria-label="閉じる" title="閉じる"
                data-testid="memory-reel-close">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {n > 1 && (
        <>
          <button type="button" className="tc-reel-zone tc-reel-zone--prev" onClick={() => go(idx - 1, true)} aria-label="前の写真"
            data-testid="memory-reel-prev" />
          <button type="button" className="tc-reel-zone tc-reel-zone--next" onClick={() => go(idx + 1, true)} aria-label="次の写真"
            data-testid="memory-reel-next" />
        </>
      )}
      <p className="sr-only" aria-live="polite">{announce}</p>
      <span className="tc-reel-count" aria-hidden="true">{`${idx + 1} / ${n}`}</span>
    </div>
  );
};

export default MemoryReel;
