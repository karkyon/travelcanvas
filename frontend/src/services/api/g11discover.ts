/**
 * [Gate G11] 発見・外部の画像・SNS の投稿・予定の写真の API(docs/ux/G11_UIUX全範囲_実装仕様.md §2.2・§2.4・§5)。
 * backend/app/api/v1/search.py・media_providers.py・plan_cover.py。画面の中で失敗を案内するため、共通のエラーの toast は出さない。
 * 外部の画像は Blob で受け取り、画面で一時の URL にする(ブラウザから外部へ直接読みに行かない)。
 */
import type { AxiosRequestConfig } from 'axios';
import { api } from './index';
import {
  arrayOf, bool, decodeResponse, int, nullable, num, object, oneOf, record, str, type Decoder,
} from './decode';
import type {
  DiscoverCategory, EventImage, ExternalImage, MediaProviderStatus, NearbyResult, NearbySearch, SocialPreview,
} from './types/g11discover';
import type { TravelMemory } from './types/memories';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };
const DL = () => import('./decoders');

const nearby: Decoder<NearbyResult> = object<NearbyResult>({
  id: str, provider: str, name: str, category: nullable(str),
  location: object<NearbyResult['location']>({ latitude: nullable(num), longitude: nullable(num), address: nullable(str) }),
  retrieved_at: nullable(str), distance_m: nullable(int), within_radius: nullable(bool), radius_guaranteed: bool,
});

const nearbySearch: Decoder<NearbySearch> = object<NearbySearch>({
  query: str, category: str, radius_km: num,
  base: nullable(object<{ latitude: number; longitude: number }>({ latitude: num, longitude: num })),
  total: int, candidates: arrayOf(nearby),
});

export async function searchNearby(input: { query: string; category: DiscoverCategory; latitude: number | null;
  longitude: number | null; radius_km: number }): Promise<NearbySearch> {
  const r = await api.post('/search/spots', { ...input, max_results: 30 }, SILENT);
  return decodeResponse(r.data, nearbySearch, 'POST /search/spots');
}

const status: Decoder<MediaProviderStatus> = object<MediaProviderStatus>({
  image_providers: arrayOf(str), social_providers: arrayOf(str),
});

export async function getMediaProviderStatus(): Promise<MediaProviderStatus> {
  return decodeResponse((await api.get('/media-providers/status', SILENT)).data, status, 'GET /media-providers/status');
}

const externalImage: Decoder<ExternalImage> = object<ExternalImage>({
  provider: str, provider_id: str, title: nullable(str), author: nullable(str), license: nullable(str),
  license_url: nullable(str), attribution: nullable(str), source_page_url: nullable(str), width: nullable(int),
  height: nullable(int), mime: nullable(str), retrieved_at: str, importable: bool,
});

const imageSearch: Decoder<{ images: ExternalImage[]; unavailable: Array<{ provider: string; reason: string }>;
  retrieved_at: string }> = object({
  images: arrayOf(externalImage),
  unavailable: arrayOf(object<{ provider: string; reason: string }>({ provider: str, reason: str })),
  retrieved_at: str,
});

export async function searchExternalImages(q: string | null, lat: number | null, lng: number | null) {
  const params: Record<string, string | number> = {};
  if (q) params.q = q;
  if (lat !== null && lng !== null) { params.lat = lat; params.lng = lng; }
  return decodeResponse((await api.get('/media-providers/images', { ...SILENT, params })).data, imageSearch,
    'GET /media-providers/images');
}

export async function getExternalThumb(provider: string, id: string): Promise<Blob> {
  const r = await api.get('/media-providers/images/thumb', { ...SILENT, params: { provider, id }, responseType: 'blob' });
  return r.data as Blob;
}

export async function importExternalImage(planId: string, provider: string, providerId: string,
  eventId?: string | null): Promise<TravelMemory> {
  const r = await api.post(`/plans/${planId}/memories/import-external`,
    { provider, provider_id: providerId, ...(eventId ? { event_id: eventId } : {}) }, SILENT);
  return decodeResponse(r.data, (await DL()).travelMemory, 'POST /plans/{id}/memories/import-external');
}

const socialPreview: Decoder<SocialPreview> = object<SocialPreview>({
  platform: nullable(oneOf('youtube', 'tiktok', 'instagram')), status: oneOf('ok', 'unsupported', 'unavailable', 'disabled'),
  url: nullable(str), title: nullable(str), author: nullable(str), retrieved_at: nullable(str), reason: nullable(str),
  fallback: nullable(str),
  place_suggestions: arrayOf(object<SocialPreview['place_suggestions'][number]>({
    word: str, name: str, address: nullable(str), latitude: nullable(num), longitude: nullable(num), provider: nullable(str),
    confidence: oneOf('low', 'medium'),
  })),
});

export async function previewSocialUrl(planId: string, url: string): Promise<SocialPreview> {
  const r = await api.post(`/plans/${planId}/candidates/social-preview`, { url }, SILENT);
  return decodeResponse(r.data, socialPreview, 'POST /plans/{id}/candidates/social-preview');
}

const eventImage: Decoder<EventImage> = object<EventImage>({
  memory_id: str, visibility: oneOf('private', 'members'), source: nullable(record),
});

export async function getEventImages(planId: string): Promise<Record<string, EventImage>> {
  const r = await api.get(`/plans/${planId}/event-images`, SILENT);
  const raw = decodeResponse(r.data, object<{ images: Record<string, unknown> }>({ images: record }),
    'GET /plans/{id}/event-images');
  return Object.fromEntries(Object.entries(raw.images).map(([k, v]) => [k, eventImage(v, `$.images.${k}`)]));
}

const eventImageOut: Decoder<{ event_id: string; image: EventImage | null }> = object({
  event_id: str, image: nullable(eventImage),
});

export async function setEventImage(planId: string, eventId: string, memoryId: string) {
  return decodeResponse((await api.put(`/plans/${planId}/events/${eventId}/image`, { memory_id: memoryId }, SILENT)).data,
    eventImageOut, 'PUT /plans/{id}/events/{event_id}/image');
}

export async function clearEventImage(planId: string, eventId: string) {
  return decodeResponse((await api.delete(`/plans/${planId}/events/${eventId}/image`, SILENT)).data, eventImageOut,
    'DELETE /plans/{id}/events/{event_id}/image');
}

export async function getEventImageMedia(planId: string, eventId: string): Promise<Blob> {
  const r = await api.get(`/plans/${planId}/events/${eventId}/image/media`, { ...SILENT, responseType: 'blob' });
  return r.data as Blob;
}

