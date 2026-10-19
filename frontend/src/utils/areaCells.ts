/**
 * [Gate L5] FR-055 Local-first Location「訪問地域だけ同期」(DOC-15 CA-013)。
 *
 * 生の座標は端末(trackRecorder.ts の端末内の保存)にだけ置き、サーバーへは 0.1度(約11km)の区画と、
 * 区画ごとの最初・最後の時刻・滞在時間・点の数だけを送る。区画の印は Atlas(backend app/services/atlas.py)と同じ
 * 「0.1:南西の緯度:南西の経度」。滞在時間は、同じ区画の点と次の点の間の時間(15分を超える空きは数えない)の合計。
 */
import type { AreaCellInput, TrackPoint } from '@/services/api';

export const AREA_STEP = 0.1;
export const MAX_GAP_MS = 15 * 60_000;
export const CELLS_PER_REQUEST = 200;

function fmt(v: number): string {
  const r = Math.round(v * 10) / 10;
  return (Object.is(r, -0) ? 0 : r).toFixed(1);
}

export function areaKey(lat: number, lng: number): string {
  // 浮動小数の誤差で境界の点が隣の区画へずれないよう、小さな値を足してから切り捨てる(backend と同じ)
  const lat0 = Math.floor(lat / AREA_STEP + 1e-9) * AREA_STEP;
  const lng0 = Math.floor(lng / AREA_STEP + 1e-9) * AREA_STEP;
  return `0.1:${fmt(lat0)}:${fmt(lng0)}`;
}

/** 端末の点から区画を集計する(時刻順に並べ替える) */
export function aggregateAreaCells(points: TrackPoint[]): AreaCellInput[] {
  const sorted = [...points].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
  const cells = new Map<string, { first: number; last: number; dwellMs: number; samples: number }>();
  for (let i = 0; i < sorted.length; i += 1) {
    const p = sorted[i]!;
    const t = Date.parse(p.recorded_at);
    if (!Number.isFinite(t)) continue;
    const key = areaKey(p.latitude, p.longitude);
    const cell = cells.get(key) ?? { first: t, last: t, dwellMs: 0, samples: 0 };
    cell.first = Math.min(cell.first, t);
    cell.last = Math.max(cell.last, t);
    cell.samples += 1;
    const next = sorted[i + 1];
    if (next) {
      const gap = Date.parse(next.recorded_at) - t;
      if (gap > 0 && gap <= MAX_GAP_MS) {
        cell.dwellMs += gap;
        // 次の点(同じ区画なら滞在の続き、別の区画なら出た時刻)まで、この区画にいたとみなす
        cell.last = Math.max(cell.last, t + gap);
      }
    }
    cells.set(key, cell);
  }
  return [...cells.entries()]
    .map(([key, c]) => ({
      key,
      first_at: new Date(c.first).toISOString(),
      last_at: new Date(c.last).toISOString(),
      dwell_seconds: Math.min(Math.round(c.dwellMs / 1000), Math.round((c.last - c.first) / 1000)),
      samples: c.samples,
    }))
    .sort((a, b) => a.first_at.localeCompare(b.first_at));
}

/** 送る単位(1回 200 区画まで)に分ける */
export function chunkCells(cells: AreaCellInput[], size = CELLS_PER_REQUEST): AreaCellInput[][] {
  const out: AreaCellInput[][] = [];
  for (let i = 0; i < cells.length; i += size) out.push(cells.slice(i, i + size));
  return out;
}
