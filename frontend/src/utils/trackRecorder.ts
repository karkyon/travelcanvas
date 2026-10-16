/**
 * [Gate P13] 位置の軌跡の記録(FR-038、DOC-15 CA-013/014)。
 *
 * - 精度ごとの取得設定と間引き(CA-014 適応型): 前の点から一定の距離を動いたか、一定の時間が過ぎた点だけを残す。
 *   精度(accuracy)が2kmより悪い点は残さない(サーバーでも同じ検査をする)。
 * - 「この端末だけ」の軌跡は座標を端末(localStorage)にだけ保存し、サーバーへは送らない(CA-013 Local-first)。
 * - 「暗号化してサーバーへ」の軌跡は、未送信の点をまとまり(batch_id付き)で端末に溜め、送信に失敗しても
 *   同じ batch_id で送り直す(サーバーは二重に保存しない)。
 * - ストレージが使えない環境でも画面を止めない(保存できなかったことを返す)。
 */
import type { TrackPoint, TrackPrecision } from '@/services/api';

export interface PrecisionSetting {
  label: string;
  description: string;
  options: PositionOptions;
  minDistanceM: number;
  minIntervalMs: number;
}

export const PRECISION: Record<TrackPrecision, PrecisionSetting> = {
  high: {
    label: '高精度', description: '約1m単位。電池の消費が大きくなります',
    options: { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 }, minDistanceM: 5, minIntervalMs: 15_000,
  },
  standard: {
    label: '標準', description: '約10m単位',
    options: { enableHighAccuracy: false, maximumAge: 15_000, timeout: 60_000 }, minDistanceM: 25, minIntervalMs: 60_000,
  },
  low: {
    label: '省電力', description: '約100m単位。電池の消費を抑えます',
    options: { enableHighAccuracy: false, maximumAge: 60_000, timeout: 120_000 }, minDistanceM: 100, minIntervalMs: 300_000,
  },
};

export const MAX_ACCURACY_M = 2000;
export const FLUSH_SIZE = 20;

export function distanceM(a: Pick<TrackPoint, 'latitude' | 'longitude'>, b: Pick<TrackPoint, 'latitude' | 'longitude'>): number {
  const r = 6371008.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function totalDistanceM(points: TrackPoint[]): number {
  const sorted = [...points].sort((x, y) => x.recorded_at.localeCompare(y.recorded_at));
  let sum = 0;
  for (let i = 1; i < sorted.length; i += 1) sum += distanceM(sorted[i - 1]!, sorted[i]!);
  return sum;
}

/** 位置の取得結果を残すか(前の点からの距離・時間で間引く) */
export function shouldKeep(prev: TrackPoint | null, next: TrackPoint, precision: TrackPrecision): boolean {
  if (next.accuracy_m !== null && next.accuracy_m > MAX_ACCURACY_M) return false;
  if (!prev) return true;
  const s = PRECISION[precision];
  const elapsed = Date.parse(next.recorded_at) - Date.parse(prev.recorded_at);
  if (elapsed <= 0) return false;
  return distanceM(prev, next) >= s.minDistanceM || elapsed >= s.minIntervalMs;
}

export function toTrackPoint(pos: GeolocationPosition): TrackPoint {
  return {
    recorded_at: new Date(pos.timestamp).toISOString(),
    latitude: pos.coords.latitude,
    longitude: pos.coords.longitude,
    accuracy_m: Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy * 10) / 10 : null,
  };
}

// ---------------------------------------------------------------- 端末への保存

const localKey = (trackId: string) => `tc_track_points_${trackId}`;
const pendingKey = (trackId: string) => `tc_track_pending_${trackId}`;

export interface PendingBatch {
  batch_id: string;
  points: TrackPoint[];
}

function isPoint(v: unknown): v is TrackPoint {
  const p = v as TrackPoint;
  return !!p && typeof p.recorded_at === 'string' && typeof p.latitude === 'number' && typeof p.longitude === 'number';
}

function read<T>(key: string, guard: (v: unknown) => v is T): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(guard) : [];
  } catch {
    return [];
  }
}

function write(key: string, value: unknown[]): boolean {
  try {
    if (value.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const loadLocalPoints = (trackId: string): TrackPoint[] => read(localKey(trackId), isPoint);

export function appendLocalPoint(trackId: string, point: TrackPoint): boolean {
  return write(localKey(trackId), [...loadLocalPoints(trackId), point]);
}

export function deleteLocalRange(trackId: string, start: string, end: string): number {
  const s = Date.parse(start);
  const e = Date.parse(end);
  const all = loadLocalPoints(trackId);
  const keep = all.filter((p) => {
    const t = Date.parse(p.recorded_at);
    return t < s || t > e;
  });
  write(localKey(trackId), keep);
  return all.length - keep.length;
}

const isBatch = (v: unknown): v is PendingBatch => {
  const b = v as PendingBatch;
  return !!b && typeof b.batch_id === 'string' && Array.isArray(b.points) && b.points.every(isPoint);
};

export const loadPending = (trackId: string): PendingBatch[] => read(pendingKey(trackId), isBatch);

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** 未送信の点を足す。最後のまとまりが満杯なら新しいまとまり(新しいbatch_id)を作る */
export function addPending(trackId: string, point: TrackPoint): boolean {
  const batches = loadPending(trackId);
  const last = batches[batches.length - 1];
  if (last && last.points.length < FLUSH_SIZE) last.points.push(point);
  else batches.push({ batch_id: newId(), points: [point] });
  return write(pendingKey(trackId), batches);
}

export function removePending(trackId: string, batchId: string): void {
  write(pendingKey(trackId), loadPending(trackId).filter((b) => b.batch_id !== batchId));
}

export const pendingCount = (trackId: string): number => loadPending(trackId).reduce((n, b) => n + b.points.length, 0);

/** 軌跡を消した時に、端末に残る座標(保存した点・未送信の点)も消す */
export function clearLocalTrack(trackId: string): void {
  write(localKey(trackId), []);
  write(pendingKey(trackId), []);
}
