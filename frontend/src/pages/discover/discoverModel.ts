/** [Gate G11] 発見の表示の決まり(カテゴリ・距離の言い方・探す基点)。docs/ux/G11_UIUX全範囲_実装仕様.md §3.3 */
import type { DiscoverCategory, NearbyResult } from '@/services/api/types/g11discover';

export const CATEGORIES: Array<{ id: DiscoverCategory; label: string }> = [
  { id: 'all', label: 'すべて' }, { id: 'food', label: '食べ物' }, { id: 'market', label: '市場' },
  { id: 'shopping', label: '買い物' }, { id: 'viewpoint', label: '絶景' },
];
export interface BasePoint {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
}

export function distanceLabel(r: NearbyResult): string {
  if (r.distance_m === null) return '距離不明';
  const d = r.distance_m >= 1000 ? `${(r.distance_m / 1000).toFixed(1)}km` : `${r.distance_m}m`;
  if (r.radius_guaranteed && r.within_radius) return `半径内 · ${d}`;
  if (r.within_radius === false) return `半径の外 · ${d}`;
  return `周辺優先 · ${d}`;
}


/** [Gate DiscoverUX] 2 点の直線距離(km)。地図の「直線距離の目安」に使う(道の距離ではない) */
export function straightKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const r = 6371.0088;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function kmLabel(km: number): string {
  return km < 1 ? `約${Math.round(km * 100) * 10}m` : `約${km < 10 ? km.toFixed(1) : Math.round(km)}km`;
}

/** [Gate DiscoverUX] 地図の印 */
export interface DiscoverPin {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  /** result = 未保存の検索結果、saved = この旅行の候補、scheduled = 日程に配置済み */
  kind: 'result' | 'saved' | 'scheduled';
  sub?: string;
}
