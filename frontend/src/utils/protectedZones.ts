/**
 * [Gate V2] FR-051 保護エリア(自宅・職場など。DOC-15 CA-009「保護エリアを端末側で設定できる」)。
 *
 * - 保護エリアはこの端末の中(localStorage)だけに置き、サーバーへ送らない。
 * - 位置の記録は、保護エリアの中で取れた点を保存・送信しない(記録の画面 LocationTrackPage)。
 * - ストレージが使えない環境(プライベートブラウズ等)でも画面を止めない(保存できなかったことを返す)。
 */
import { distanceM } from './trackRecorder';

export interface ProtectedZone {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  radius_m: number;
}

export const ZONE_RADII = [200, 500, 1000] as const;
export const MAX_ZONES = 10;
const KEY = 'tc.protectedZones.v1';

const isZone = (v: unknown): v is ProtectedZone => {
  if (typeof v !== 'object' || v === null) return false;
  const z = v as Record<string, unknown>;
  return typeof z.id === 'string' && typeof z.label === 'string' && typeof z.latitude === 'number'
    && typeof z.longitude === 'number' && typeof z.radius_m === 'number'
    && Math.abs(z.latitude) <= 90 && Math.abs(z.longitude) <= 180 && z.radius_m > 0 && z.radius_m <= 5000;
};

export function loadZones(): ProtectedZone[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const data: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(data) ? data.filter(isZone).slice(0, MAX_ZONES) : [];
  } catch {
    return [];
  }
}

function save(zones: ProtectedZone[]): boolean {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(zones));
    return true;
  } catch {
    return false;
  }
}

export function addZone(zone: Omit<ProtectedZone, 'id'>): { ok: boolean; zones: ProtectedZone[]; reason?: string } {
  const zones = loadZones();
  if (zones.length >= MAX_ZONES) return { ok: false, zones, reason: `保護エリアは${MAX_ZONES}件までです` };
  const label = zone.label.trim().slice(0, 40) || '保護エリア';
  const next = [...zones, { ...zone, label, id: `z-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` }];
  if (!isZone(next[next.length - 1])) return { ok: false, zones, reason: '保護エリアの値が不正です' };
  return save(next) ? { ok: true, zones: next } : { ok: false, zones, reason: 'この端末に保存できませんでした' };
}

export function removeZone(id: string): ProtectedZone[] {
  const next = loadZones().filter((z) => z.id !== id);
  save(next);
  return next;
}

export function inProtectedZone(p: { latitude: number; longitude: number }, zones: ProtectedZone[]): boolean {
  return zones.some((z) => distanceM(z, p) <= z.radius_m);
}
