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

