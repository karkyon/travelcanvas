/**
 * [Gate G7] MOVE-03 移動・滞在の既定・MOVE-04 目的の内訳と部分の採用・FR-019 比較・FR-005 影響のプレビュー・
 * MEM-03 思い出からの提案(v2)・FR-039 猶予つきの削除 の API。
 *
 * 最初に読む JS を小さく保つため(scripts/ci/check_bundle_budget.py)、CompleteTravelAPI には足さず、使う画面
 * (どれも後から読む塊)がここを直接 import する(g4〜g6 と同じ形)。画面の中で失敗を案内するため、共通のエラーの toast は
 * 出さない(SILENT)。
 */
import type { AxiosRequestConfig } from 'axios';
import { api } from './index';
import { decodeG7 } from './decodersG7';
import type {
  BranchComparison, DeletionExtras, DeletionScheduleResult, G7Candidates, G7MemoryReplan, ImpactInput, ImpactPreview,
  MovementSettings, MovementSettingsValue, PartialPreview, RunMovement, Weights,
} from './types/g7';
import type { OptimizationTravelMode } from './types';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };

// ===== MOVE-03
export async function getMovementSettings(planId: string): Promise<MovementSettings> {
  return decodeG7('movementSettings', (await api.get(`/plans/${planId}/movement-settings`, SILENT)).data);
}

export async function saveMovementSettings(
  planId: string, settings: Partial<MovementSettingsValue>, revision: number,
): Promise<MovementSettings> {
  const r = await api.put(`/plans/${planId}/movement-settings`, { settings },
    { ...SILENT, headers: { 'If-Match': String(revision) } });
  return decodeG7('movementSettings', r.data);
}

/** 検証の結果(ValidationRunDetail)に付いた日ごとの疲れの目安と、使った既定(無い時は空) */
export function runMovement(run: unknown): RunMovement {
  return decodeG7('runMovement', run);
}

// ===== FR-005
export async function previewEventImpact(planId: string, eventId: string, input: ImpactInput): Promise<ImpactPreview> {
  const r = await api.post(`/plans/${planId}/events/${eventId}/impact-preview`, input, SILENT);
  return decodeG7('impact', r.data);
}

// ===== MOVE-04
export async function getCandidatesG7(
  planId: string, dayId: string, travelMode: OptimizationTravelMode = 'walking', weights?: Weights | null,
): Promise<G7Candidates> {
  const body = weights ? { travel_mode: travelMode, weights } : { travel_mode: travelMode };
  const r = await api.post(`/plans/${planId}/days/${dayId}/optimization-candidates`, body, SILENT);
  return decodeG7('candidates', r.data);
}

export async function previewPartial(
  planId: string, dayId: string, candidateId: string, eventIds: string[], inputFingerprint: string,
  travelMode: OptimizationTravelMode, weights?: Weights | null,
): Promise<PartialPreview> {
  const r = await api.post(`/plans/${planId}/days/${dayId}/optimization-candidates/partial-preview`, {
    candidate_id: candidateId, event_ids: eventIds, input_fingerprint: inputFingerprint, travel_mode: travelMode,
    ...(weights ? { weights } : {}),
  }, SILENT);
  return decodeG7('partial', r.data);
}

export async function applyCandidateG7(
  planId: string, dayId: string, candidateId: string, inputFingerprint: string, planRevision: number,
  travelMode: OptimizationTravelMode, weights?: Weights | null, eventIds?: string[] | null,
) {
  const r = await api.post(`/plans/${planId}/days/${dayId}/optimization-candidates/apply`, {
    candidate_id: candidateId, input_fingerprint: inputFingerprint, travel_mode: travelMode,
    ...(weights ? { weights } : {}), ...(eventIds ? { event_ids: eventIds } : {}),
  }, { ...SILENT, headers: { 'If-Match': String(planRevision) } });
  return decodeG7('apply', r.data);
}

// ===== FR-019
export async function compareBranches(planId: string, branchIds: string[]): Promise<BranchComparison> {
  const r = await api.get(`/plans/${planId}/branches-comparison`, { ...SILENT, params: { ids: branchIds.join(',') } });
  return decodeG7('comparison', r.data);
}

// ===== MEM-03
export async function getMemoryReplanG7(planId: string): Promise<G7MemoryReplan> {
  return decodeG7('memoryReplan', (await api.get(`/plans/${planId}/memory-replan`, SILENT)).data);
}

// ===== FR-039
export function deletionExtras(preview: unknown): DeletionExtras {
  const p = (preview ?? {}) as Partial<DeletionExtras>;
  const scheduled = p.scheduled && typeof p.scheduled.due_at === 'string' ? p.scheduled : null;
  return {
    account_delete_grace_days: typeof p.account_delete_grace_days === 'number' ? p.account_delete_grace_days : 14,
    can_schedule: p.can_schedule === true,
    scheduled,
  };
}

export async function scheduleAccountDeletion(confirmation: string, password?: string): Promise<DeletionScheduleResult> {
  const r = await api.post('/privacy/account-deletion/schedule', { confirmation, ...(password ? { password } : {}) },
    SILENT);
  return decodeG7('schedule', r.data);
}

export async function cancelAccountDeletion(): Promise<DeletionScheduleResult> {
  return decodeG7('schedule', (await api.post('/privacy/account-deletion/cancel', null, SILENT)).data);
}
