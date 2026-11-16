/**
 * [Gate WishMap] 行きたい場所の地図の材料(純粋な関数。React・Leaflet に依存しない)。
 */
import { safeExternalUrl } from '@/utils/safeNavigation';

export interface WishMapSpot { id: string; name: string; latitude: number | null; longitude: number | null }

export interface WishPoint<T extends WishMapSpot> { spot: T; no: number; at: [number, number] }

/** 有効な緯度・経度か(0,0 や範囲外は地図に出さない) */
export function validLatLng(lat: number | null | undefined, lng: number | null | undefined): lat is number {
  return typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

/**
 * 絞り込んだ一覧から、地図に出す場所と番号を作る。番号は一覧に出ている順(位置のある場所だけを 1 から数える)。
 * カードにも同じ番号を出すので、地図と一覧を見比べられる。
 */
export function wishPoints<T extends WishMapSpot>(shown: T[]): { points: WishPoint<T>[]; noLocation: number; numberOf: Map<string, number> } {
  const points: WishPoint<T>[] = [];
  const numberOf = new Map<string, number>();
  let noLocation = 0;
  for (const s of shown) {
    if (validLatLng(s.latitude, s.longitude)) {
      const no = points.length + 1;
      points.push({ spot: s, no, at: [s.latitude, s.longitude as number] });
      numberOf.set(s.id, no);
    } else noLocation += 1;
  }
  return { points, noLocation, numberOf };
}

/** Google マップで開く URL(位置で開く。鍵は要らない) */
export function googleMapsUrl(lat: number, lng: number): string | null {
  return safeExternalUrl(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`);
}

/** OpenStreetMap で開く URL */
export function osmUrl(lat: number, lng: number): string | null {
  return safeExternalUrl(`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`);
}

/** メモの最初の数行(地図の上の小窓に出す長さ) */
export function shortMemo(memo: string, max = 120): string {
  const t = memo.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}
