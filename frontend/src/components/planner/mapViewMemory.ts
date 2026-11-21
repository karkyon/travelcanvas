/**
 * [Gate② UX P0] 旅程の地図の表示範囲(中心・拡大)を、旅行と日ごとに覚える。
 * 他の画面へ移って戻った時・地図を大きくした時に、利用者が動かした範囲のまま出す。
 * - 画面のメモリだけに持つ(端末には書かない。再読み込みで消える)。ログアウトで消す
 * - 地図の印(予定・候補の位置)が変わった時は覚えた範囲を使わない(足した予定が範囲の外に隠れないように)
 */
export interface MapView { center: [number, number]; zoom: number }

const views = new Map<string, { sig: string; view: MapView }>();

export const markerSignature = (positions: [number, number][]): string =>
  positions.map(([a, b]) => `${a.toFixed(5)},${b.toFixed(5)}`).join(';');

export function rememberMapView(key: string, sig: string, view: MapView): void {
  views.set(key, { sig, view });
}

export function recallMapView(key: string, sig: string): MapView | null {
  const r = views.get(key);
  return r && r.sig === sig ? r.view : null;
}

export function forgetMapViews(): void {
  views.clear();
}
