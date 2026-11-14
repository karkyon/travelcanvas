/**
 * [Gate Remaining-6] FR-037 写真の地図の印のまとめ(クラスタ)。画面の座標(px)で近い印をまとめる。
 * 外の部品(leaflet.markercluster)を足さずに、表示の縮尺が変わるたびに計算し直す(写真の数は旅行 1 つ分)。
 */
export interface ScreenPoint { id: string; x: number; y: number }
export interface Cluster { ids: string[]; x: number; y: number }

/** 近い順ではなく並びの順に、radius(px)の中の点を 1 つのまとまりにする(簡単な格子なしの貪欲法) */
export function clusterPoints(points: ScreenPoint[], radius = 48): Cluster[] {
  const out: Cluster[] = [];
  const r2 = radius * radius;
  for (const p of points) {
    let hit: Cluster | undefined;
    for (const c of out) {
      const dx = c.x - p.x;
      const dy = c.y - p.y;
      if (dx * dx + dy * dy <= r2) { hit = c; break; }
    }
    if (hit) {
      const n = hit.ids.length;
      hit.x = (hit.x * n + p.x) / (n + 1);
      hit.y = (hit.y * n + p.y) / (n + 1);
      hit.ids.push(p.id);
    } else {
      out.push({ ids: [p.id], x: p.x, y: p.y });
    }
  }
  return out;
}
