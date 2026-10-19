/**
 * [Gate V2] FR-050 訪問判定の数値を端末で計算する(DOC-14「v5.1 訪問判定」visit-v1。backend の
 * app/services/visit_assessment.py visit_metrics() と同じ規則)。
 *
 * 「この端末だけ」「訪問地域だけ同期」の軌跡では座標をサーバーへ送らないため、端末が予定の場所ごとに
 * 距離・滞在時間・件数だけを計算して送る(POST /plans/{id}/visits/device-results)。状態と信頼度はサーバーが
 * 同じ規則で決める。ここで返す値に座標は含めない。
 */
import type { DeviceVisitMetrics, TrackPoint } from '@/services/api';
import { distanceM } from './trackRecorder';

export const VISIT_MAX_ACCURACY_M = 100;
export const VISIT_MAX_GAP_MS = 30 * 60_000;

const round1 = (v: number) => Math.round(v * 10) / 10;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

interface Inside { t: number; latitude: number; longitude: number; acc: number | null; d: number }

export function deviceVisitMetrics(
  place: { latitude: number; longitude: number }, radiusM: number, points: TrackPoint[],
): DeviceVisitMetrics {
  const pts = points
    .map((p) => ({ ...p, t: Date.parse(p.recorded_at) }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
  const valid = pts.filter((p) => p.accuracy_m === null || p.accuracy_m <= VISIT_MAX_ACCURACY_M);
  const runs: Inside[][] = [];
  let current: Inside[] = [];
  for (const p of valid) {
    const d = distanceM(place, p);
    const inside = d <= radiusM;
    const last = current[current.length - 1];
    if (inside && last && p.t - last.t <= VISIT_MAX_GAP_MS) {
      current.push({ t: p.t, latitude: p.latitude, longitude: p.longitude, acc: p.accuracy_m, d });
    } else if (inside) {
      if (current.length) runs.push(current);
      current = [{ t: p.t, latitude: p.latitude, longitude: p.longitude, acc: p.accuracy_m, d }];
    } else {
      if (current.length) runs.push(current);
      current = [];
    }
  }
  if (current.length) runs.push(current);
  const pointsInside = runs.reduce((n, r) => n + r.length, 0);
  if (!runs.length) {
    return {
      points_total: pts.length, points_valid: valid.length, points_inside: 0, dwell_seconds: 0,
      median_distance_m: null, median_accuracy_m: null, speed_kmh: null,
    };
  }
  const span = (r: Inside[]) => r[r.length - 1]!.t - r[0]!.t;
  const best = runs.reduce((a, b) => (span(b) > span(a) || (span(b) === span(a) && b.length > a.length) ? b : a));
  const dwellS = Math.floor(span(best) / 1000);
  let path = 0;
  for (let i = 1; i < best.length; i += 1) path += distanceM(best[i - 1]!, best[i]!);
  const accs = best.map((p) => p.acc).filter((a): a is number => a !== null);
  return {
    points_total: pts.length,
    points_valid: valid.length,
    points_inside: pointsInside,
    dwell_seconds: dwellS,
    median_distance_m: Math.min(round1(median(best.map((p) => p.d))), radiusM),
    median_accuracy_m: accs.length ? round1(median(accs)) : null,
    speed_kmh: dwellS > 0 ? round1((path / (span(best) / 1000)) * 3.6) : null,
  };
}
