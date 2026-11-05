/** [Gate WishPlaces] 行きたい場所(本人が保存した場所)と、URL・画像の読み取り。後から読む画面だけが使う。 */
import { api } from './index';

const SILENT = { skipGlobalErrorHandler: true };

export interface WishSpot {
  id: string; name: string; description: string | null; category: string; address: string | null;
  latitude: number | null; longitude: number | null; price_range: string | null; image_url: string | null; created_at: string;
}
export interface WishInput {
  name: string; description?: string | null; category: string; address?: string | null;
  latitude?: number | null; longitude?: number | null;
}
export interface UrlRead {
  kind: 'sns' | 'page'; ok: boolean; url: string; name: string | null; title: string | null; author: string | null;
  reason: string | null; description: string | null; address: string | null; latitude: number | null; longitude: number | null;
  suggestions: { word: string; name: string; address: string | null; latitude: number | null; longitude: number | null }[];
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
