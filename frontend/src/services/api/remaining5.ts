/**
 * [Gate Remaining-5] サーバー側の PDF・画像(FR-035・FR-046)、顔の検査の接続口(FR-037)、カレンダーの購読(FR-036)の API。
 * 使う画面(後から読む塊)がここを直接 import する(最初に読む JS に入れない)。
 */
import type { AxiosRequestConfig } from 'axios';
import { api } from './index';
import { arrayOf, bool, decodeResponse, nullable, num, object, optional, str, type Decoder } from './decode';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };

/** 受け取った物を端末に保存する(画面の移動はしない) */
export function saveBlob(blob: Blob, name: string): void {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name.replace(/[\\/:*?"<>|]/g, '_');
  link.click();
  URL.revokeObjectURL(link.href);
}

export async function downloadBookletPdf(planId: string, exportId: string): Promise<Blob> {
  return (await api.get(`/plans/${planId}/booklet-exports/${exportId}/pdf`, { ...SILENT, responseType: 'blob' })).data as Blob;
}

export async function downloadPublicBookletPdf(token: string): Promise<Blob> {
  return (await api.get(`/public/booklets/${encodeURIComponent(token)}/pdf`, { ...SILENT, responseType: 'blob' })).data as Blob;
}

export async function downloadTodayCard(planId: string): Promise<Blob> {
  return (await api.get(`/plans/${planId}/today/card.png`, { ...SILENT, responseType: 'blob' })).data as Blob;
}

export interface FaceCheckResult {
  configured: boolean; results: { memory_id: string; faces: number }[]; source: string; message: string;
}
const faceCheck: Decoder<FaceCheckResult> = object<FaceCheckResult>({
  configured: bool, results: arrayOf(object({ memory_id: str, faces: num })), source: str, message: str,
});

export async function checkFaces(planId: string, photoIds: string[]): Promise<FaceCheckResult> {
  return decodeResponse((await api.post(`/plans/${planId}/memories/publications/face-check`,
    { photo_ids: photoIds.slice(0, 10) }, SILENT)).data, faceCheck, 'POST /plans/{plan_id}/memories/publications/face-check');
}

export interface CalendarFeed {
  enabled: boolean; url: string | null; webcal_url: string | null; created_at?: string | null; by_other?: boolean;
}
const feed: Decoder<CalendarFeed> = object<CalendarFeed>({
  enabled: bool, url: nullable(str), webcal_url: nullable(str), created_at: optional(nullable(str)),
  by_other: optional(bool),
});

export async function getCalendarFeed(planId: string): Promise<CalendarFeed> {
  return decodeResponse((await api.get(`/plans/${planId}/calendar-feed`, SILENT)).data, feed,
    'GET /plans/{plan_id}/calendar-feed');
}

export async function createCalendarFeed(planId: string): Promise<CalendarFeed> {
  return decodeResponse((await api.post(`/plans/${planId}/calendar-feed`, null, SILENT)).data, feed,
    'POST /plans/{plan_id}/calendar-feed');
}

export async function deleteCalendarFeed(planId: string): Promise<CalendarFeed> {
  return decodeResponse((await api.delete(`/plans/${planId}/calendar-feed`, SILENT)).data, feed,
    'DELETE /plans/{plan_id}/calendar-feed');
}
