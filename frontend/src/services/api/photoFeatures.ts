/**
 * [Gate MyMaps・PhotoMap・PhotoQR・BookingImport] マイマップ・写真の地図・QR の投稿・予約の読み取りの API。
 * 最初に読む JS を小さく保つため、CompleteTravelAPI には足さず、後から読む画面がここを直接 import する(g6.ts と同じ形)。
 */
import type { AxiosRequestConfig } from 'axios';
import { api } from './index';
import type { ImportJobDetail } from './types';
import type { TravelMemory } from './types';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };

// ===== マイマップ
export interface MyMapsPreview {
  precision: 'exact' | 'approx';
  exclude_accommodation: boolean;
  count: number;
  excluded: number;
  days: { date: string; route_urls: string[]; points: { label: string; time: string | null; event_type: string }[] }[];
  no_location: { title: string; date: string }[];
  over_limit: boolean;
  many_days: boolean;
}
export interface ExternalMap { url: string; visibility: 'private' | 'members'; by_me: boolean; updated_at: string | null }

export async function getMyMapsPreview(planId: string, precision: string, excludeAccommodation: boolean): Promise<MyMapsPreview> {
  const r = await api.get(`/plans/${planId}/exports/mymaps/preview`, {
    ...SILENT, params: { precision, exclude_accommodation: excludeAccommodation },
  });
  return r.data as MyMapsPreview;
}
export async function downloadMyMapsKml(planId: string, precision: string, excludeAccommodation: boolean): Promise<Blob> {
  const r = await api.get(`/plans/${planId}/exports/places.kml`, {
    ...SILENT, responseType: 'blob', params: { profile: 'mymaps', precision, exclude_accommodation: excludeAccommodation },
  });
  return r.data as Blob;
}
export async function getExternalMaps(planId: string): Promise<ExternalMap[]> {
  return ((await api.get(`/plans/${planId}/external-map`, SILENT)).data as { maps: ExternalMap[] }).maps;
}
export async function saveExternalMap(planId: string, url: string, visibility: string): Promise<ExternalMap> {
  return (await api.put(`/plans/${planId}/external-map`, { url, visibility }, SILENT)).data as ExternalMap;
}
export async function deleteExternalMap(planId: string): Promise<void> {
  await api.delete(`/plans/${planId}/external-map`, SILENT);
}

// ===== 写真の地図
export type LocationSource = 'exif' | 'track' | 'event' | 'manual';
export interface MapPhoto extends TravelMemory {
  location_source?: LocationSource | null;
  location_status?: 'proposed' | 'confirmed' | null;
  location_confidence?: number | null;
  location_visibility?: 'private' | 'members' | null;
}
export interface MemoryMap { photos: MapPhoto[]; unplaced: MapPhoto[]; can_create: boolean }
export type LocationChange =
  | { action: 'confirm' } | { action: 'clear' }
  | { action: 'set'; latitude: number; longitude: number; place_name?: string | null; event_id?: string | null }
  | { action: 'visibility'; location_visibility: 'private' | 'members' };

export async function getMemoryMap(planId: string): Promise<MemoryMap> {
  return (await api.get(`/plans/${planId}/memory-map`, SILENT)).data as MemoryMap;
}
export async function getMemoryThumbnail(planId: string, memoryId: string): Promise<Blob> {
  return (await api.get(`/plans/${planId}/memories/${memoryId}/thumbnail`, { ...SILENT, responseType: 'blob' })).data as Blob;
}
export async function changeMemoryLocation(planId: string, memoryId: string, change: LocationChange, revision: number): Promise<MapPhoto> {
  return (await api.post(`/plans/${planId}/memories/${memoryId}/location`, change, {
    ...SILENT, headers: { 'If-Match': String(revision) },
  })).data as MapPhoto;
}

// ===== QR の投稿
export interface UploadLink {
  id: string; plan_id: string; expires_at: string; active: boolean; upload_count: number; last_used_at: string | null;
  token?: string; code?: string;
}
export interface PublicUploadLink { plan_title: string; active: boolean; expires_at: string; max_upload_bytes: number }
export interface UploadResult { id: string; location_status: 'proposed' | 'confirmed' | null; location_source: LocationSource | null; place_name?: string | null }
export interface PhotoFields { occurred_at?: string | null; latitude?: number | null; longitude?: number | null; location_source?: string | null; visibility?: string; client_upload_id?: string }

const photoForm = (file: File, fields: PhotoFields): FormData => {
  const form = new FormData();
  form.append('file', file);
  for (const [k, v] of Object.entries(fields)) {
    if (v !== null && v !== undefined && v !== '') form.append(k, String(v));
  }
  return form;
};

export async function createUploadLink(planId: string): Promise<UploadLink> {
  return (await api.post(`/plans/${planId}/upload-links`, {}, SILENT)).data as UploadLink;
}
export async function getUploadLinks(planId: string): Promise<UploadLink[]> {
  return ((await api.get(`/plans/${planId}/upload-links`, SILENT)).data as { links: UploadLink[] }).links;
}
export async function revokeUploadLink(planId: string, linkId: string): Promise<void> {
  await api.delete(`/plans/${planId}/upload-links/${linkId}`, SILENT);
}
export async function viewUploadLink(token: string): Promise<PublicUploadLink> {
  return (await api.get(`/public/upload-links/${token}`, SILENT)).data as PublicUploadLink;
}
export async function joinUploadLink(token: string): Promise<{ plan_id: string; plan_title: string; role: string }> {
  return (await api.post(`/public/upload-links/${token}/join`, {}, SILENT)).data as { plan_id: string; plan_title: string; role: string };
}
export async function openUploadSession(token: string, code: string): Promise<{ session_token: string; expires_at: string }> {
  return (await api.post(`/public/upload-links/${token}/session`, { code }, SILENT)).data as { session_token: string; expires_at: string };
}
export async function uploadWithSession(token: string, session: string, file: File, fields: PhotoFields): Promise<UploadResult> {
  return (await api.post(`/public/upload-links/${token}/upload`, photoForm(file, fields), {
    ...SILENT, headers: { 'Content-Type': undefined, 'X-Upload-Session': session },
  })).data as UploadResult;
}
export async function uploadAsMember(planId: string, file: File, fields: PhotoFields): Promise<UploadResult> {
  const form = photoForm(file, fields);
  form.append('kind', 'photo');
  return (await api.post(`/plans/${planId}/memories/upload`, form, {
    ...SILENT, headers: { 'Content-Type': undefined },
  })).data as UploadResult;
}

// ===== 旅行の基本情報
export interface PlanBasics {
  title: string; destination: string | null; description: string | null; budget: number | null; start_date: string | null; end_date: string | null;
  preferences: Record<string, unknown> | null;
  /** [Gate JourneyEnds] 旅の出発・到着(任意) */
  journey_enabled?: boolean; journey_start_place?: string | null; journey_start_time?: string | null;
  journey_end_place?: string | null; journey_end_time?: string | null;
  /** [Gate JourneyMove] 出発地・帰着地との移動手段と所要時間(分) */
  journey_start_mode?: string | null; journey_start_minutes?: number | null;
  journey_end_mode?: string | null; journey_end_minutes?: number | null;
}
export async function getPlanBasics(planId: string): Promise<PlanBasics> {
  return (await api.get(`/travel-plans/${planId}`, SILENT)).data as PlanBasics;
}
export async function savePlanBasics(planId: string, body: Partial<PlanBasics>): Promise<void> {
  await api.put(`/travel-plans/${planId}`, body, SILENT);
}
export interface RescheduleResult { revision: number; days: number; reservations_not_moved: number }
export async function reschedulePlan(planId: string, revision: number, startDate: string, endDate: string, removeDaysWithEvents: boolean): Promise<RescheduleResult> {
  return (await api.post(`/plans/${planId}/reschedule`, { start_date: startDate, end_date: endDate, remove_days_with_events: removeDaysWithEvents }, {
    ...SILENT, headers: { 'If-Match': String(revision) },
  })).data as RescheduleResult;
}

// ===== 予約の読み取り
export interface ApplyResult { reservation_id: string; event_id: string | null; itinerary_note: string | null }
export async function applyExtraction(planId: string, jobId: string, fields: Record<string, string | null>, addToItinerary: boolean): Promise<ApplyResult> {
  return (await api.post(`/plans/${planId}/imports/${jobId}/apply`, { fields, add_to_itinerary: addToItinerary }, SILENT)).data as ApplyResult;
}
/** [Gate BookingImportYahoo] 取込ジョブを一覧から消す(読み取った候補も消える。登録済みの予約は残る) */
export async function deleteImportJob(planId: string, jobId: string): Promise<void> {
  await api.delete(`/plans/${planId}/imports/${jobId}`, SILENT);
}
export interface ExtractedJob extends ImportJobDetail {
  ai_status: 'off' | 'used' | 'denied' | 'not_needed';
  ai_message: string | null;
  warnings: string[];
}
export async function extractReservationText(planId: string, text: string, useAi: boolean): Promise<ExtractedJob> {
  return (await api.post(`/plans/${planId}/imports/extract/text`, { text, use_ai: useAi }, SILENT)).data as ExtractedJob;
}
export async function extractReservationFile(planId: string, file: File, useAi: boolean, aiConsent: boolean): Promise<ExtractedJob> {
  const form = new FormData();
  form.append('file', file);
  form.append('use_ai', String(useAi));
  form.append('ai_consent', String(aiConsent));
  return (await api.post(`/plans/${planId}/imports/extract/file`, form, {
    ...SILENT, headers: { 'Content-Type': undefined },
  })).data as ExtractedJob;
}
