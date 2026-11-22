/**
 * [FR-062] 近くに来たら知らせる(詳細設計 §7.2)。
 * - 端末の中だけで比べる。サーバーには位置を送らない
 * - 当日の画面・スポットモードを開いている間だけ。位置の許可が既にある時だけ見る(ここで許可を求めない)
 * - 半径 300m(エリアは radius_m)に入ったら 1 回だけ。同じ場所は 1 日 1 回まで。スイッチを切った場所は出さない
 * - 開いた時に remind_nearby の場所(名前・位置だけ)を端末へ暗号化して保存し、圏外でも比べられるようにする
 */
import { useEffect, useState } from 'react';
import { listWishSpots } from '@/services/api/spotIntake';
import { loadSnapshot, saveSnapshot } from '@/utils/offlineVault';

export const REMIND_RADIUS_M = 300;
const SNAP = 'remind_wishes';
const SHOWN_KEY = 'tc_wish_reminded';

export interface RemindSpot { id: string; name: string; lat: number; lng: number; radius_m: number }
export interface NearbyHit { spot: RemindSpot; distance_m: number }

const rad = (d: number) => (d * Math.PI) / 180;
export function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const h = Math.sin(rad(bLat - aLat) / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLng - aLng) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(Math.min(1, h)));
}

const today = (now = new Date()) => `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
function shownToday(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(SHOWN_KEY) ?? '{}') as Record<string, string>; } catch { return {}; }
}
export function markShown(id: string, now = new Date()): void {
  try {
    const d = today(now);
    const cur = Object.fromEntries(Object.entries(shownToday()).filter(([, v]) => v === d));
    localStorage.setItem(SHOWN_KEY, JSON.stringify({ ...cur, [id]: d }));
  } catch { /* 覚えられなくても動く(その時は同じ画面の間だけ 1 回) */ }
}

/** 入った場所のうち、今日まだ知らせていない一番近いもの */
export function pickHit(spots: RemindSpot[], lat: number, lng: number, now = new Date(), seen: Set<string> = new Set()): NearbyHit | null {
  const shown = shownToday();
  const d = today(now);
  let best: NearbyHit | null = null;
  for (const s of spots) {
    if (shown[s.id] === d || seen.has(s.id)) continue;
    const m = distanceM(lat, lng, s.lat, s.lng);
    if (m <= s.radius_m && (!best || m < best.distance_m)) best = { spot: s, distance_m: Math.round(m) };
  }
  return best;
}

async function session() {
  return (await import('@/utils/offlineSession')).currentOfflineSession();
}

async function loadRemindSpots(): Promise<RemindSpot[]> {
  try {
    const list = (await listWishSpots('all')).filter((s) => s.remind_nearby && s.latitude != null && s.longitude != null)
      .map((s) => ({ id: s.id, name: s.name, lat: s.latitude as number, lng: s.longitude as number,
        radius_m: s.wish_scope === 'area' && s.radius_m ? s.radius_m : REMIND_RADIUS_M }));
    void saveSnapshot(await session(), SNAP, list).catch(() => false);
    return list;
  } catch {
    const got = await loadSnapshot<RemindSpot[]>(await session(), SNAP).catch(() => null);
    return Array.isArray(got?.data) ? got!.data : [];
  }
}

async function granted(): Promise<boolean> {
  try {
    const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
    return !!perms?.query && (await perms.query({ name: 'geolocation' as PermissionName })).state === 'granted';
  } catch {
    return false;
  }
}

export function useNearbyWishReminder(active: boolean): { hit: NearbyHit | null; dismiss: () => void } {
  const [hit, setHit] = useState<NearbyHit | null>(null);
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !navigator.geolocation) return undefined;
    let alive = true;
    let watch: number | null = null;
    const seen = new Set<string>();
    void (async () => {
      const spots = await loadRemindSpots();
      if (!alive || spots.length === 0 || !(await granted()) || !alive) return;
      watch = navigator.geolocation.watchPosition((p) => {
        if (p.coords.accuracy > 100) return;
        const h = pickHit(spots, p.coords.latitude, p.coords.longitude, new Date(), seen);
        if (h) { seen.add(h.spot.id); markShown(h.spot.id); setHit(h); }
      }, () => undefined, { enableHighAccuracy: true, maximumAge: 60_000, timeout: 20_000 });
    })();
    return () => { alive = false; if (watch !== null) navigator.geolocation.clearWatch(watch); };
  }, [active]);
  return { hit, dismiss: () => setHit(null) };
}
