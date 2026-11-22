/** [FR-062] 旅の記録の「また行きたい」(backend/app/api/v1/again.py)。本人の記録だけから作る候補と、行きたい場所へ残す */
import { api } from './index';

const SILENT = { skipGlobalErrorHandler: true };

export interface AgainArea { key: string; title: string; lat: number; lng: number; radius_m: number; walked_min: number | null;
  visited_count: number; saved_spot_id: string | null }
export interface AgainPlace { key: string; name: string; genre: string | null; lat: number | null; lng: number | null;
  visited_at: string | null; photo_count: number; thumb_memory_id: string | null; saved_spot_id: string | null;
  saved_kind: 'next' | 'again' | null; sources: string[] }
export interface AgainMissed { key: string; candidate_id: string; title: string; lat: number | null; lng: number | null }
export interface AgainCandidates { areas: AgainArea[]; places: AgainPlace[]; missed: AgainMissed[] }
export interface AgainItem { key: string; kind: 'place' | 'area' | 'missed'; wish_kind?: 'next' | 'again' }
export interface AgainResult { saved: { key: string; spot_id: string }[]; merged: { key: string; spot_id: string; again_count: number }[] }

export const getAgainCandidates = async (planId: string): Promise<AgainCandidates> =>
  (await api.get(`/plans/${planId}/again-candidates`, SILENT)).data as AgainCandidates;
export const saveAgain = async (planId: string, items: AgainItem[]): Promise<AgainResult> =>
  (await api.post(`/plans/${planId}/again`, { items: items.slice(0, 50) }, SILENT)).data as AgainResult;
