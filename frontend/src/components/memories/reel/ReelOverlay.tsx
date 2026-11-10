/**
 * [Gate MemoryReel] S2 全画面の思い出リール(画面いっぱいの暗い面に重ねる。道すじ・終わりの画面つき)。
 *
 * 新しい画面(URL)にはせず、開いている画面の上に重ねる(最初に読む JS を増やさないため)。
 * Esc・閉じるで閉じ、開く前のボタンへフォーカスを戻す。開いている間は後ろの画面を動かさない。
 * 最後のコマの後は終わりの画面(S4)。次の思い出は trips の並び(S5 の順)で次の旅。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { getMemoryReel, type MemoryReelData } from '@/services/api/memoryReel';
import MemoryReel from './MemoryReel';
import ReelEndCard, { type ReelNext } from './ReelEndCard';
import ReelRouteMap from './ReelRouteMap';
import type { ReelFrame } from './reelModel';

export interface ReelTrip { planId: string; title: string; badge: string | null }

const ReelOverlay: React.FC<{
  start: ReelTrip;
  /** 次の思い出の並び(start の次から) */
  trips?: ReelTrip[];
  /** 読み込み済みの材料(ホームの段から開く時) */
  initial?: MemoryReelData | null;
  onClose: () => void;
}> = ({ start, trips = [], initial = null, onClose }) => {
  const [trip, setTrip] = useState(start);
  const [data, setData] = useState<MemoryReelData | null>(initial && initial.plan_id === start.planId ? initial : null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'play' | 'end'>('play');
  const [round, setRound] = useState(0);
  const [frame, setFrame] = useState<ReelFrame | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLElement | null>(null);

  useEffect(() => {
    back.current = document.activeElement as HTMLElement | null;
    const prev = document.body.style.overflow;
    const prevRoot = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    window.setTimeout(() => box.current?.querySelector<HTMLElement>('[data-testid="memory-reel"]')?.focus(), 0);
    return () => {
      document.body.style.overflow = prev;
      document.documentElement.style.overflow = prevRoot;
      back.current?.focus?.();
    };
  }, []);

  useEffect(() => {
    if (data && data.plan_id === trip.planId) return undefined;
    let alive = true;
    setError(null);
    getMemoryReel(trip.planId)
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setError('思い出を読み込めませんでした。時間をおいてもう一度開いてください。'); });
    return () => { alive = false; };
  }, [trip.planId, data]);

  const at = trips.findIndex((t) => t.planId === trip.planId);
  const nextTrip: ReelNext | null = trips.length > 0 && at < trips.length - 1 ? trips[at + 1]! : null;
  const toNext = useCallback((n: ReelNext) => {
    setData(null); setFrame(null); setPhase('play'); setRound((r) => r + 1);
    setTrip({ planId: n.planId, title: n.title, badge: n.badge });
  }, []);
  const finished = useCallback(() => setPhase('end'), []);
  const onFrame = useCallback((_i: number, f: ReelFrame) => setFrame(f), []);

  // Esc で閉じる。Tab は重ねた面の中だけを回る
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab' || !box.current) return;
    const items = Array.from(box.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex="0"]'));
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  return createPortal(
    <div ref={box} className="tc-reel-overlay" role="dialog" aria-modal="true" aria-label={`${trip.title}の思い出`} onKeyDown={onKey}
      data-testid="memory-reel-overlay">
      {error ? (
        <div className="tc-reel-overlay-msg" role="alert">
          <p>{error}</p>
          <button type="button" className="tc-focus-ring tc-reel-end-sub" onClick={onClose}>閉じる</button>
        </div>
      ) : !data ? (
        <div className="tc-reel-overlay-msg" role="status">{`「${trip.title}」の思い出を読み込んでいます…`}</div>
      ) : phase === 'end' ? (
        <div className="tc-reel-overlay-end">
          <button type="button" className="tc-focus-ring tc-reel-btn tc-reel-overlay-x" onClick={onClose} aria-label="閉じる">×</button>
          <ReelEndCard key={trip.planId} data={data} next={nextTrip} onNext={toNext}
            onReplay={() => { setPhase('play'); setRound((r) => r + 1); }} />
        </div>
      ) : (
        <>
          <div className="tc-reel-overlay-stage">
            <MemoryReel key={`${trip.planId}-${round}`} planId={trip.planId} data={data} variant="full" badge={trip.badge}
              onClose={onClose} onFinished={finished} onFrameChange={onFrame} />
          </div>
          <div className="tc-reel-overlay-bar">
            <ReelRouteMap data={data} frame={frame} tone="dark" />
            <div className="tc-reel-overlay-place">
              <small>旅の道すじ</small>
              <b>{frame?.title ?? data.title}</b>
            </div>
            <div className="tc-reel-overlay-actions">
              <Link to={`/planner/${data.plan_id}/memories`} className="tc-focus-ring tc-reel-end-sub">旅の記録を開く</Link>
              <button type="button" className="tc-focus-ring tc-reel-end-go" onClick={finished} data-testid="memory-reel-to-end">
                旅のおわりへ
              </button>
            </div>
          </div>
        </>
      )}
    </div>,
    document.body,
  );
};

export default ReelOverlay;
