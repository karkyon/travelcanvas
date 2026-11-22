/** [FR-063] SNS の下書きとリール(backend/app/api/v1/social.py)。アプリは投稿しない。動画は端末で作る */
import { api } from './index';
import type { Style } from '@/pages/social/socialModel';

const SILENT = { skipGlobalErrorHandler: true };
const idem = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().replace(/-/g, '') : `s${Date.now()}`);

export type SocialScope = 'trip' | 'day' | 'area';
export interface SocialPhoto { memory_id: string; taken_at: string | null; owner_is_me: boolean; allowed: boolean; place_name: string | null }
export interface SocialDraft {
  text: string; hashtags: string[]; excluded: { home_near: number; names: number }; photos: SocialPhoto[];
  audios: { memory_id: string; taken_at: string | null }[]; route_shape: number[][]; title: string;
  period: { start: string; end: string } | null; char_limit: number; photo_range: [number, number];
}

export const getSocialDraft = async (planId: string, q: { scope: SocialScope; style: Style; scope_ref?: string | null; include_time?: boolean }) =>
  (await api.get(`/plans/${planId}/social/draft?scope=${q.scope}&style=${q.style}${q.scope_ref ? `&scope_ref=${encodeURIComponent(q.scope_ref)}` : ''}${
    q.include_time ? '&include_time=true' : ''}`, SILENT)).data as SocialDraft;
export const polishSocialText = async (planId: string, text: string, style: Style): Promise<string> =>
  ((await api.post(`/plans/${planId}/social/polish`, { text, style }, { ...SILENT, headers: { 'Idempotency-Key': idem() } })).data as
    { text: string }).text;
export const getFaceBoxes = async (planId: string, memoryIds: string[]) =>
  (await api.post(`/plans/${planId}/social/face-boxes`, { memory_ids: memoryIds.slice(0, 10) }, SILENT)).data as
    { configured: boolean; boxes: Record<string, number[][]> };
export const recordReelExport = async (planId: string, body: { style: Style; scope: SocialScope; scope_ref?: string | null;
  duration_s: number; frame_count: number; status: 'ready' | 'failed'; bytes?: number | null }) =>
  (await api.post(`/plans/${planId}/reel-exports`, { ...body, renderer: 'device' }, SILENT)).data as { id: string };
export const getMemoryBlob = async (planId: string, memoryId: string): Promise<Blob> =>
  (await api.get(`/plans/${planId}/memories/${memoryId}/media`, { ...SILENT, responseType: 'blob' })).data as Blob;
