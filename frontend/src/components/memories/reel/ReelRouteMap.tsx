/**
 * [Gate MemoryReel] S3 旅の道すじ。位置のある写真を撮った順に点線で結び、今のコマの場所に印を動かす。
 * 参考: Polarsteps の Trip Reel(経路をたどりながら写真)。地図の絵は使わず、緯度・経度だけで形を描く(外へ要求しない)。
 */
import React, { useMemo } from 'react';
import type { MemoryReelData } from '@/services/api/memoryReel';
import { currentPoint, routeOf, type ReelFrame } from './reelModel';

const ReelRouteMap: React.FC<{ data: MemoryReelData; frame: ReelFrame | null; tone?: 'light' | 'dark' }> = ({ data, frame, tone = 'light' }) => {
  const route = useMemo(() => routeOf(data.slides), [data.slides]);
  if (!route) {
    return (
      <div className="tc-reel-map is-empty" data-tone={tone} data-testid="memory-reel-map">
        <p>位置のある写真が 2 か所以上あると、ここに旅の道すじが出ます</p>
      </div>
    );
  }
  const here = currentPoint(route, frame?.photoIndex ?? null);
  const place = frame?.title ?? '';
  return (
    <div className="tc-reel-map" data-tone={tone} data-testid="memory-reel-map">
      <svg viewBox={`0 0 ${route.width} ${route.height}`} role="img"
        aria-label={`写真を撮った場所の順の道すじ(${route.points.length} か所)。今は「${place}」`}>
        <polyline points={route.points.map((p) => `${p.x},${p.y}`).join(' ')} className="tc-reel-map-line" />
        {route.points.map((p) => <circle key={p.photoIndex} cx={p.x} cy={p.y} r={1.6} className="tc-reel-map-pin" />)}
        <circle cx={here.x} cy={here.y} r={3.2} className="tc-reel-map-here" data-testid="memory-reel-map-here" />
      </svg>
    </div>
  );
};

export default ReelRouteMap;
