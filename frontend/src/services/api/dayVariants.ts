/**
 * [Gate PlanB] 日ごとの案(プランB)の API。旅程の画面(後から読む)だけが import する。
 */
import type { AxiosRequestConfig } from 'axios';
import { api } from './index';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };
const ifMatch = (rev: number): AxiosRequestConfig => ({ ...SILENT, headers: { 'If-Match': String(rev) } });

export type VariantReason = 'rain' | 'party' | 'transport' | 'delay' | 'fatigue' | 'budget' | 'closure' | 'other';
/** たたき台で変えた所・印を付けた所(案を作った時に理由に合わせて組み替えた結果) */
export interface ScaffoldNote { kind: 'rain' | 'delay' | 'fatigue' | 'transport'; event_id: string | null; title: string; text: string }
export interface VariantConditions {
  party_size?: number | null; absent_member_ids?: string[]; transport_mode?: string | null; prefer_indoor?: boolean;
  note?: string | null; delay_minutes?: number | null; delay_after?: string | null; max_events?: number | null;
  scaffold?: ScaffoldNote[];
}
/** たたき台を作れる理由 */
export const SCAFFOLD_REASONS: VariantReason[] = ['rain', 'delay', 'fatigue', 'transport'];
export interface VariantSummary {
  day_id: string; local_date: string; label: string; name: string; status: 'active' | 'standby' | 'archived';
  reason: VariantReason | null; reason_label: string | null; conditions: VariantConditions; group_id: string | null;
  copied_from_day_id: string | null; events: number; first_time: string | null; last_time: string | null; titles: string[];
}
export interface VariantList { revision: number; dates: Record<string, VariantSummary[]>; max_per_date: number }
export interface VariantDay {
  revision: number; variant: VariantSummary;
  day: { id: string; local_date: string; timezone_id: string; title: string | null; events: Record<string, unknown>[] };
  segments: Record<string, unknown>[];
}
export interface CheckItem {
  kind: 'prev' | 'next' | 'time' | 'drop' | 'booking' | 'unbooked'; level: 'ok' | 'info' | 'warn' | 'bad';
  title: string; text: string; reservation_id?: string;
}
export interface VariantCheck { variant: VariantSummary; status: 'ok' | 'warn' | 'bad'; items: CheckItem[];
  counts: Record<'ok' | 'info' | 'warn' | 'bad', number> }
export interface SwitchRecord {
  id: string; local_date: string; from_label: string | null; to_label: string | null; from_name: string | null;
  to_name: string | null; switched_at: string | null; reason: VariantReason | null; reason_label: string | null;
  note: string | null; phase: 'planning' | 'during' | 'after'; place_label: string | null; undone: boolean;
}

export const REASONS: [VariantReason, string][] = [
  ['rain', '雨'], ['party', '人数'], ['transport', '移動手段'], ['delay', '遅れ'], ['fatigue', '疲れ'], ['budget', '予算'],
  ['closure', '休業'], ['other', 'その他'],
];

export async function listVariants(planId: string): Promise<VariantList> {
  return (await api.get(`/plans/${planId}/variants`, SILENT)).data as VariantList;
}
export async function getVariant(planId: string, dayId: string): Promise<VariantDay> {
  return (await api.get(`/plans/${planId}/variants/${dayId}`, SILENT)).data as VariantDay;
}
export async function createVariant(planId: string, body: {
  local_date: string; source: 'copy_active' | 'copy_day' | 'blank'; source_day_id?: string | null; name?: string;
  reason?: VariantReason | null; conditions?: VariantConditions; also_dates?: string[]; scaffold?: boolean;
}): Promise<{ revision: number; variants: VariantSummary[] }> {
  return (await api.post(`/plans/${planId}/variants`, body, SILENT)).data as { revision: number; variants: VariantSummary[] };
}
export async function patchVariant(planId: string, dayId: string, rev: number, body: {
  name?: string; reason?: VariantReason | null; conditions?: VariantConditions; status?: 'standby' | 'archived';
}): Promise<{ revision: number }> {
  return (await api.patch(`/plans/${planId}/variants/${dayId}`, body, ifMatch(rev))).data as { revision: number };
}
export async function deleteVariant(planId: string, dayId: string, rev: number): Promise<{ revision: number }> {
  return (await api.delete(`/plans/${planId}/variants/${dayId}`, ifMatch(rev))).data as { revision: number };
}
export async function checkVariant(planId: string, dayId: string): Promise<VariantCheck> {
  return (await api.get(`/plans/${planId}/variants/${dayId}/check`, SILENT)).data as VariantCheck;
}
export async function switchVariant(planId: string, dayId: string, rev: number, body: {
  reason?: VariantReason | null; note?: string; phase?: 'planning' | 'during' | 'after'; group?: boolean;
  join_event_id?: string | null; done_event_ids?: string[]; place_label?: string | null;
}): Promise<{ revision: number }> {
  return (await api.post(`/plans/${planId}/variants/${dayId}/switch`, body, ifMatch(rev))).data as { revision: number };
}
export async function listSwitches(planId: string): Promise<SwitchRecord[]> {
  return ((await api.get(`/plans/${planId}/variant-switches`, SILENT)).data as { switches: SwitchRecord[] }).switches;
}
