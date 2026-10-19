/**
 * [Gate L5] FR-056 適応型GPS記録(DOC-15 CA-014)。
 *
 * 移動の速さ・止まっているか・電池の残量・位置の精度に応じて、位置を取る頻度を変える。
 * - moving_fast: 時速約29km以上(乗り物)。距離で間引く(200m ごと)。高精度は使わない
 * - moving: 歩き・ゆっくりの移動。選んだ精度の設定そのまま(trackRecorder.ts の PRECISION)
 * - stationary: 3分以上ほぼ同じ場所(精度の範囲か30m以内)。連続の取得をやめ、数分ごとに1回だけ取る
 * - low_power: 電池が20%以下で充電していない、または利用者が省電力を選んだ。5分以上ごとに1回、低精度で取る
 * ブラウザでは geofence・significant-location-change(OS の大きな移動の通知)は使えないため、連続の取得(watchPosition)
 * と間隔をあけた1回の取得(getCurrentPosition)を切り替えて電池の消費を抑える。
 *
 * 記録の観測値(電池の消費・欠測率・段階ごとの時間)も集め、軌跡の観測値としてサーバーへ送る(座標は含めない)。
 */
import type { SamplingTier, TrackPoint, TrackPrecision, TrackSamplingInput } from '@/services/api';
import { PRECISION, distanceM } from './trackRecorder';

export const FAST_SPEED_MPS = 8;
export const STATIONARY_MS = 3 * 60_000;
export const STATIONARY_RADIUS_M = 30;
export const LOW_BATTERY = 0.2;
const MOTION_WINDOW_MS = 10 * 60_000;

export interface BatteryState {
  level: number;
  charging: boolean;
}

export interface TierSetting {
  tier: SamplingTier;
  label: string;
  minDistanceM: number;
  minIntervalMs: number;
  /** null = 連続で取る(watchPosition)。数値 = その間隔で1回ずつ取る(getCurrentPosition) */
  pollMs: number | null;
  options: PositionOptions;
}

export interface MotionState {
  /** 直近の受け取った位置(間引く前)。古いものから捨てる */
  fixes: TrackPoint[];
}

export const emptyMotion = (): MotionState => ({ fixes: [] });

/** 受け取った位置を足す(間引く前の全て。直近10分だけ持つ) */
export function addFix(state: MotionState, p: TrackPoint): MotionState {
  const t = Date.parse(p.recorded_at);
  const fixes = [...state.fixes, p].filter((f) => t - Date.parse(f.recorded_at) <= MOTION_WINDOW_MS);
  return { fixes };
}

/** 直近の2点からの速さ(m/秒)。端末が速さを返す時はそれを使う */
export function currentSpeed(state: MotionState, reported: number | null = null): number | null {
  if (reported !== null && Number.isFinite(reported) && reported >= 0) return reported;
  const n = state.fixes.length;
  if (n < 2) return null;
  const a = state.fixes[n - 2]!;
  const b = state.fixes[n - 1]!;
  const dt = (Date.parse(b.recorded_at) - Date.parse(a.recorded_at)) / 1000;
  if (dt <= 0) return null;
  return distanceM(a, b) / dt;
}

/** 止まっている時間(ミリ秒)。最新の位置から精度(か30m)の範囲に収まっている期間。止まっていなければ 0 */
export function stationaryForMs(state: MotionState): number {
  const n = state.fixes.length;
  if (n === 0) return 0;
  const last = state.fixes[n - 1]!;
  const radius = Math.max(STATIONARY_RADIUS_M, last.accuracy_m ?? 0);
  let since = Date.parse(last.recorded_at);
  for (let i = n - 2; i >= 0; i -= 1) {
    const f = state.fixes[i]!;
    if (distanceM(f, last) > radius) break;
    since = Date.parse(f.recorded_at);
  }
  return Date.parse(last.recorded_at) - since;
}

export function isLowBattery(battery: BatteryState | null): boolean {
  return !!battery && !battery.charging && battery.level <= LOW_BATTERY;
}

/** いまの状態から、位置を取る頻度の段階を決める(純粋関数) */
export function decideTier(input: {
  precision: TrackPrecision;
  speedMps: number | null;
  stationaryMs: number;
  battery: BatteryState | null;
  lowPowerManual: boolean;
}): TierSetting {
  const base = PRECISION[input.precision];
  if (input.lowPowerManual || isLowBattery(input.battery)) {
    return {
      tier: 'low_power', label: input.lowPowerManual ? '省電力(手動)' : '電池が少ないため省電力',
      minDistanceM: Math.max(base.minDistanceM, 100), minIntervalMs: Math.max(base.minIntervalMs * 4, 300_000),
      pollMs: Math.max(base.minIntervalMs * 4, 300_000),
      options: { enableHighAccuracy: false, maximumAge: 300_000, timeout: 120_000 },
    };
  }
  if (input.stationaryMs >= STATIONARY_MS) {
    return {
      tier: 'stationary', label: '止まっているため間隔を空けています',
      minDistanceM: base.minDistanceM, minIntervalMs: Math.max(base.minIntervalMs * 3, 180_000),
      pollMs: Math.max(base.minIntervalMs * 3, 180_000),
      options: { enableHighAccuracy: false, maximumAge: 120_000, timeout: 60_000 },
    };
  }
  if (input.speedMps !== null && input.speedMps >= FAST_SPEED_MPS) {
    return {
      tier: 'moving_fast', label: '乗り物で移動中(200mごと)',
      minDistanceM: Math.max(base.minDistanceM * 4, 200), minIntervalMs: Math.max(base.minIntervalMs, 30_000),
      pollMs: null, options: { enableHighAccuracy: false, maximumAge: 10_000, timeout: 60_000 },
    };
  }
  return {
    tier: 'moving', label: '移動中', minDistanceM: base.minDistanceM, minIntervalMs: base.minIntervalMs,
    pollMs: null, options: base.options,
  };
}

/** 段階の設定で、受け取った位置を残すか(前に残した点からの距離・時間で間引く) */
export function keepWithTier(prev: TrackPoint | null, next: TrackPoint, setting: TierSetting, maxAccuracyM: number): boolean {
  if (next.accuracy_m !== null && next.accuracy_m > maxAccuracyM) return false;
  if (!prev) return true;
  const elapsed = Date.parse(next.recorded_at) - Date.parse(prev.recorded_at);
  if (elapsed <= 0) return false;
  return distanceM(prev, next) >= setting.minDistanceM || elapsed >= setting.minIntervalMs;
}

// ---------------------------------------------------------------- 記録の観測値

/** 電池の消費・欠測率・段階ごとの時間を数える。座標は持たない */
export class SamplingStats {
  private expected = 0;
  private kept = 0;
  private received = 0;
  private manual = 0;
  private maxGapMs = 0;
  private lastFixAt: number | null = null;
  private tierMs: Partial<Record<SamplingTier, number>> = {};
  private batteryStart: number | undefined;
  private batteryEnd: number | undefined;
  private chargingSeen = false;

  constructor(initial?: Partial<TrackSamplingInput>) {
    if (initial) {
      this.expected = initial.expected_samples ?? 0;
      this.kept = initial.kept_samples ?? 0;
      this.received = Math.max(0, (initial.expected_samples ?? 0) - (initial.missed_samples ?? 0));
      this.manual = initial.manual_points ?? 0;
      this.maxGapMs = (initial.max_gap_seconds ?? 0) * 1000;
      this.batteryStart = initial.battery_start;
      this.chargingSeen = !!initial.charging_seen;
      for (const [k, v] of Object.entries(initial.tier_seconds ?? {})) this.tierMs[k as SamplingTier] = (v ?? 0) * 1000;
    }
  }

  /** 位置を取ろうとした(または取れるはずの時間が過ぎた) */
  expect(n = 1): void {
    this.expected += n;
  }

  /** 位置を受け取った(kept = 間引かずに残した) */
  fix(atMs: number, kept: boolean, manual = false): void {
    this.received += 1;
    if (kept) this.kept += 1;
    if (manual) this.manual += 1;
    if (this.lastFixAt !== null) this.maxGapMs = Math.max(this.maxGapMs, atMs - this.lastFixAt);
    this.lastFixAt = atMs;
    if (this.received > this.expected) this.expected = this.received;
  }

  addTierTime(tier: SamplingTier, ms: number): void {
    if (ms > 0) this.tierMs[tier] = (this.tierMs[tier] ?? 0) + ms;
  }

  battery(state: BatteryState | null): void {
    if (!state) return;
    if (this.batteryStart === undefined) this.batteryStart = state.level;
    this.batteryEnd = state.level;
    if (state.charging) this.chargingSeen = true;
  }

  snapshot(): TrackSamplingInput {
    const tier_seconds: Partial<Record<SamplingTier, number>> = {};
    for (const [k, v] of Object.entries(this.tierMs)) tier_seconds[k as SamplingTier] = Math.round((v ?? 0) / 1000);
    const out: TrackSamplingInput = {
      expected_samples: this.expected,
      kept_samples: this.kept,
      missed_samples: Math.max(0, this.expected - this.received),
      manual_points: this.manual,
      max_gap_seconds: Math.round(this.maxGapMs / 1000),
      tier_seconds,
    };
    if (this.batteryStart !== undefined) out.battery_start = Math.round(this.batteryStart * 1000) / 1000;
    if (this.batteryEnd !== undefined) out.battery_end = Math.round(this.batteryEnd * 1000) / 1000;
    if (this.chargingSeen) out.charging_seen = true;
    return out;
  }
}

// 画面を離れて戻っても数え続けられるよう、観測値を端末に置く(座標は含まない)
const statsKey = (trackId: string) => `tc_track_sampling_${trackId}`;

export function loadStatsSnapshot(trackId: string): TrackSamplingInput | null {
  try {
    const raw = localStorage.getItem(statsKey(trackId));
    if (!raw) return null;
    const v = JSON.parse(raw) as TrackSamplingInput;
    return typeof v.expected_samples === 'number' && typeof v.kept_samples === 'number' ? v : null;
  } catch {
    return null;
  }
}

export function saveStatsSnapshot(trackId: string, snapshot: TrackSamplingInput): void {
  try {
    localStorage.setItem(statsKey(trackId), JSON.stringify(snapshot));
  } catch {
    // 保存できなくても記録は続ける
  }
}

export function clearStatsSnapshot(trackId: string): void {
  try {
    localStorage.removeItem(statsKey(trackId));
  } catch {
    // 何もしない
  }
}

/** 端末の観測値とサーバーの観測値のうち、より多く数えている方から続ける */
export function resumeSnapshot(local: TrackSamplingInput | null, server: TrackSamplingInput | null): TrackSamplingInput | undefined {
  if (local && server) return local.expected_samples >= server.expected_samples ? local : server;
  return local ?? server ?? undefined;
}

/** ブラウザの電池の情報(対応していなければ null。Chrome 系だけが対応) */
export async function readBattery(): Promise<BatteryState | null> {
  const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as
    (Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean }> }) | undefined;
  if (!nav || typeof nav.getBattery !== 'function') return null;
  try {
    const b = await nav.getBattery();
    if (typeof b.level !== 'number' || !Number.isFinite(b.level)) return null;
    return { level: Math.min(1, Math.max(0, b.level)), charging: !!b.charging };
  } catch {
    return null;
  }
}
