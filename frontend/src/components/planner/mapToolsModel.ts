/**
 * [Gate MapTools] 旅程の地図の「Google マップで表示」のリンク(公式の Maps URLs。API の鍵・費用は要らない)。
 * 1 日の予定を順に経路で検索する。場所(緯度・経度)の分かる予定だけを使い、上限を超える日は続きのリンクに分ける。
 */
import { googleDayRoutes } from '@/pages/booklet/bookletModel';

export interface MapStop { latitude?: number | null; longitude?: number | null }
export interface GoogleMapLinks { urls: string[]; used: number; missing: number }

const known = (s: MapStop): s is { latitude: number; longitude: number } =>
  typeof s.latitude === 'number' && typeof s.longitude === 'number' && Number.isFinite(s.latitude) && Number.isFinite(s.longitude);

/** 予定が 1 か所ならその場所、2 か所以上なら経路(順番どおり)。場所の分かる予定が無ければ urls は空 */
export function googleMapLinks(stops: MapStop[]): GoogleMapLinks {
  const pts = stops.filter(known);
  const missing = stops.length - pts.length;
  if (pts.length === 0) return { urls: [], used: 0, missing };
  const routes = googleDayRoutes(pts);
  if (routes.length > 0) return { urls: routes, used: pts.length, missing };
  const p = pts[0]!;
  return { urls: [`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.latitude},${p.longitude}`)}`], used: pts.length, missing };
}
