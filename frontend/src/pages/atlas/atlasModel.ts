/**
 * [Gate P15] Personal Travel Atlas(FR-052)の表示用の整形。
 *
 * - 状態は色だけで示さず、文字(滞在・訪問・通過・予定)と記号を併記する(DOC-04 §7)
 * - 区画を緯度・経度の範囲に合わせて略図(SVG)へ配置する(地図タイルは使わない)
 */
import type { AtlasCell, AtlasState } from '@/services/api';

export const STATE_INFO: Record<AtlasState, { label: string; mark: string; fill: string; description: string }> = {
  STAYED: { label: '滞在', mark: '◆', fill: '#1e3a8a', description: '30分以上滞在した記録がある' },
  VISITED: { label: '訪問', mark: '●', fill: '#2563eb', description: '行った記録・位置付きの記録がある' },
  PASS_THROUGH: { label: '通過', mark: '○', fill: '#93c5fd', description: '位置の軌跡だけがある' },
  PLANNED: { label: '予定', mark: '△', fill: '#e5e7eb', description: 'これからの旅行の予定' },
};

/** 区画は0度をまたがない(南西の角で切り捨てるため)。南緯・西経は絶対値の小さい順に書く */
function range(min: number, max: number, pos: string, neg: string): string {
  return min >= 0 ? `${pos}${min}〜${max}°` : `${neg}${Math.abs(max)}〜${Math.abs(min)}°`;
}

export function cellLabel(c: AtlasCell): string {
  return `${range(c.lat_min, c.lat_max, '北緯', '南緯')}・${range(c.lng_min, c.lng_max, '東経', '西経')}`;
}

export interface SketchRect {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  title: string;
}

/** 区画をSVGの座標へ。北が上、余白10、縦横比を保つ */
export function layout(cells: AtlasCell[], size = 300): { rects: SketchRect[]; width: number; height: number } {
  if (cells.length === 0) return { rects: [], width: size, height: size };
  const minLat = Math.min(...cells.map((c) => c.lat_min));
  const maxLat = Math.max(...cells.map((c) => c.lat_max));
  const minLng = Math.min(...cells.map((c) => c.lng_min));
  const maxLng = Math.max(...cells.map((c) => c.lng_max));
  const span = Math.max(maxLat - minLat, maxLng - minLng);
  const scale = (size - 20) / span;
  const width = Math.round((maxLng - minLng) * scale + 20);
  const height = Math.round((maxLat - minLat) * scale + 20);
  const rects = cells.map((c) => ({
    key: c.key,
    x: Math.round(((c.lng_min - minLng) * scale + 10) * 10) / 10,
    y: Math.round(((maxLat - c.lat_max) * scale + 10) * 10) / 10,
    w: Math.round((c.lng_max - c.lng_min) * scale * 10) / 10,
    h: Math.round((c.lat_max - c.lat_min) * scale * 10) / 10,
    fill: STATE_INFO[c.state].fill,
    title: `${STATE_INFO[c.state].label}: ${cellLabel(c)}`,
  }));
  return { rects, width, height };
}

export function percent(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}
