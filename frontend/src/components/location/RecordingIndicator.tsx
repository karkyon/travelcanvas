import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTrackingStore } from '@/store/trackingStore';

/**
 * [Gate L5] FR-056 位置の記録中であることを全ての画面の上部に示す(DOC-15 CA-014)。
 * 「位置の記録」の画面では、その画面自体が記録中の表示を持つので出さない。
 */
const RecordingIndicator: React.FC = () => {
  const active = useTrackingStore((s) => s.active);
  const { pathname } = useLocation();
  if (!active) return null;
  const trackPath = `/planner/${active.planId}/track`;
  if (pathname === trackPath) return null;
  const text = active.status === 'paused'
    ? '位置の記録を一時停止しています'
    : '位置の記録中の軌跡があります。この画面では位置を取っていません(記録の画面を開くと続けます)';
  return (
    <div role="status" aria-live="polite" data-testid="recording-indicator"
      className="bg-blue-800 text-white text-sm px-4 py-2 flex flex-wrap items-center gap-3">
      <span aria-hidden="true">●</span>
      <span>{text}</span>
      <Link to={trackPath} className="underline font-medium">記録の画面へ</Link>
    </div>
  );
};

export default RecordingIndicator;
