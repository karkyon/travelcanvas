/**
 * [Gate② FC-027] 住所と地図の印が離れている時に確かめる(DOC-02 FC-027「検索住所と地図ピンが離れている場合に確定を求める」)。
 * 距離は大円距離(直線)。500 m を越えたら確かめる(同じ施設の入口違い程度は許し、別の場所の取り違えを拾う)。
 */
export const GEO_CONFIRM_M = 500;

export interface LatLng { latitude: number; longitude: number }

export function distanceM(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const isFar = (a: LatLng, b: LatLng): boolean => distanceM(a, b) > GEO_CONFIRM_M;

/** 「約 1.2 km」「約 800 m」 */
export function distanceLabel(m: number): string {
  return m >= 1000 ? `約 ${(m / 1000).toFixed(1)} km` : `約 ${Math.round(m / 10) * 10} m`;
}
