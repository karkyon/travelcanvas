/** [Gate WishPlaces] 行きたい場所(本人が保存した場所)と、URL・画像の読み取り。後から読む画面だけが使う。 */
import { api } from './index';
import type { EventUrl } from '@/types';
import type { DiningInfo } from '@/components/dining/diningModel';
import type { SpotPhoto } from '@/components/media/SpotPhotoView';

const SILENT = { skipGlobalErrorHandler: true };

export interface WishSpot {
  id: string; name: string; description: string | null; category: string; address: string | null;
  latitude: number | null; longitude: number | null; price_range: string | null; image_url: string | null; created_at: string;
  /** [Gate SpotInfo] 電話・URL(最大 5)・写真の出典(Commons)・食事の情報 */
  phone?: string | null; urls?: EventUrl[] | null; photo?: SpotPhoto | null; dining?: DiningInfo | null;
}
export interface WishInput {
  name: string; description?: string | null; category: string; address?: string | null;
  latitude?: number | null; longitude?: number | null;
  phone?: string | null; urls?: EventUrl[] | null; photo?: SpotPhoto | null; dining?: DiningInfo | null;
}
export interface UrlRead {
  kind: 'sns' | 'page'; ok: boolean; url: string; name: string | null; title: string | null; author: string | null;
  reason: string | null; description: string | null; address: string | null; latitude: number | null; longitude: number | null;
  suggestions: { word: string; name: string; address: string | null; latitude: number | null; longitude: number | null }[];
  /** [Gate SpotFromMedia] 説明欄(目次)から拾った場所の名前・説明欄を読めたか(YouTube の鍵がある時) */
  places?: MediaPlace[]; video_source?: string; description_available?: boolean | null;
}
/** [Gate SpotFromMedia] 動画・投稿・写真から拾った場所の候補 */
export interface MediaPlace {
  name: string; time?: string | null; context?: string; quoted?: boolean; ai?: boolean;
  area?: string; reason?: string; confidence?: number; address?: string | null; latitude?: number | null; longitude?: number | null;
  phone?: string | null; website?: string | null; category?: string | null;
}
export const placesFromText = async (text: string, title?: string | null): Promise<MediaPlace[]> =>
  ((await api.post('/spots/places-from-text', { text: text.slice(0, 20000), title: title ?? null }, SILENT)).data as { places: MediaPlace[] }).places;
export const aiPlacesFromText = async (planId: string, text: string, title?: string | null): Promise<MediaPlace[]> =>
  ((await api.post(`/plans/${planId}/spot-ai/places-text`, { text: text.slice(0, 20000), title: title ?? null, consent: true }, SILENT)).data as
    { places: MediaPlace[] }).places;
export async function aiPlacesFromImage(planId: string, file: File): Promise<MediaPlace[]> {
  const form = new FormData();
  form.append('file', file);
  form.append('consent', 'true');
  return ((await api.post(`/plans/${planId}/spot-ai/places-image`, form, { ...SILENT, headers: { 'Content-Type': undefined } })).data as
    { places: MediaPlace[] }).places;
}

export const listWishSpots = async (category: string): Promise<WishSpot[]> =>
  (await api.get(`/spots/?mine=true&limit=500${category === 'all' ? '' : `&category=${encodeURIComponent(category)}`}`, SILENT)).data as WishSpot[];
export const createWishSpot = async (input: WishInput): Promise<WishSpot> => (await api.post('/spots/', input, SILENT)).data as WishSpot;
export const updateWishSpot = async (id: string, input: WishInput): Promise<WishSpot> =>
  (await api.put(`/spots/${id}`, input, SILENT)).data as WishSpot;
export const deleteWishSpot = async (id: string): Promise<void> => { await api.delete(`/spots/${id}`, SILENT); };

export const readPlaceUrl = async (url: string): Promise<UrlRead> => (await api.post('/spots/read-url', { url }, SILENT)).data as UrlRead;
export async function readPlaceImage(file: File): Promise<{ words: string[]; ocr_available: boolean }> {
  const form = new FormData();
  form.append('file', file);
  return (await api.post('/spots/read-image', form, { ...SILENT, headers: { 'Content-Type': undefined } })).data as { words: string[]; ocr_available: boolean };
}

/** [Gate SpotInfo] 自動取得の結果(空の項目だけを OpenStreetMap の値で埋めた後の場所と、埋めた項目) */
export interface EnrichResult {
  spot: WishSpot; filled: string[]; matched: boolean;
  source: { provider: string; attribution: string; license: string; license_url: string; source_url: string | null };
  /** [Gate PlaceLookupJP] 使った提供元のクレジット */
  sources?: { provider: string; label: string; credit: string; url: string }[];
}
export const enrichWishSpot = async (id: string): Promise<EnrichResult> =>
  (await api.post(`/spots/${id}/enrich`, {}, SILENT)).data as EnrichResult;
