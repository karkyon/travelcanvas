/**
 * [Gate G8] FR-019 案の中の区間・予約の変更と選んで採用・FR-021 所有者の移譲・FR-039 出典つきの訂正・
 * FR-004 定期の処理の記録 の API。
 *
 * 最初に読む JS を小さく保つため(scripts/ci/check_bundle_budget.py)、CompleteTravelAPI には足さず、使う画面
 * (どれも後から読む塊)がここを直接 import する(g4〜g7 と同じ形)。画面の中で失敗を案内するため、共通のエラーの toast は
 * 出さない(SILENT)。
 */
import type { AxiosRequestConfig } from 'axios';
import { api } from './index';
import { decodeG8, type BranchG8Extras } from './decodersG8';
import type {
  AdoptionPreview, AdoptResultG8, CorrectionRequest, CorrectionSource, CorrectionsOverview, KeepRole, OpsJobs,
  OwnershipInfo, OwnershipTransfer, ResourcesInput, SelfCorrection,
} from './types/g8';
import type { BranchContentInput } from './types';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };
const ifMatch = (revision: number): AxiosRequestConfig => ({ ...SILENT, headers: { 'If-Match': String(revision) } });

// ===== FR-019
/** 分岐案の詳細(GET /branches/{id} などの応答)から、区間・予約の変更を読む(以前の応答は空) */
export function branchExtras(detail: unknown): BranchG8Extras {
  return decodeG8('branchExtras', detail);
}

/** 予定と区間・予約の変更を一緒に保存する。応答は分岐案の詳細(BranchDetail と同じ形) */
export async function saveBranchWithResources(
  planId: string, branchId: string, events: BranchContentInput[], resources: ResourcesInput, revision: number,
): Promise<unknown> {
  const r = await api.put(`/plans/${planId}/branches/${branchId}/content`, { events, resources }, ifMatch(revision));
  return r.data;
}

export async function getAdoptionPreview(planId: string, branchId: string, only?: string[] | null): Promise<AdoptionPreview> {
  const r = await api.get(`/plans/${planId}/branches/${branchId}/adoption-preview`,
    { ...SILENT, params: only ? { only: only.join(',') } : undefined });
  return decodeG8('preview', r.data);
}

export async function adoptBranchG8(
  planId: string, branchId: string, revision: number, only?: string[] | null,
): Promise<AdoptResultG8 & { raw: unknown }> {
  const r = await api.post(`/plans/${planId}/branches/${branchId}/adopt`, only ? { only } : undefined, ifMatch(revision));
  const data = r.data as { branch?: unknown };
  return { ...decodeG8('adopt', r.data), raw: data?.branch };
}

// ===== FR-021
export async function getOwnership(planId: string): Promise<OwnershipInfo> {
  return decodeG8('ownershipInfo', (await api.get(`/plans/${planId}/ownership-transfer`, SILENT)).data);
}

export async function requestOwnershipTransfer(
  planId: string, collaboratorId: string, password: string, keepRole: KeepRole, message?: string,
): Promise<OwnershipTransfer> {
  const r = await api.post(`/plans/${planId}/ownership-transfer`, {
    collaborator_id: collaboratorId, password, keep_role: keepRole, ...(message ? { message } : {}),
  }, SILENT);
  return decodeG8('transfer', r.data);
}

export async function cancelOwnershipTransfer(planId: string): Promise<OwnershipTransfer> {
  return decodeG8('transfer', (await api.post(`/plans/${planId}/ownership-transfer/cancel`, null, SILENT)).data);
}

export async function getIncomingTransfers(): Promise<OwnershipTransfer[]> {
  return decodeG8('transfers', (await api.get('/ownership-transfers/incoming', SILENT)).data);
}

export async function acceptOwnershipTransfer(transferId: string, password: string): Promise<OwnershipTransfer> {
  const r = await api.post(`/ownership-transfers/${transferId}/accept`, { password }, SILENT);
  return decodeG8('transfer', r.data);
}

export async function declineOwnershipTransfer(transferId: string): Promise<OwnershipTransfer> {
  return decodeG8('transfer', (await api.post(`/ownership-transfers/${transferId}/decline`, null, SILENT)).data);
}

// ===== FR-039
export async function getCorrections(): Promise<CorrectionsOverview> {
  return decodeG8('corrections', (await api.get('/privacy/corrections', SILENT)).data);
}

export async function createCorrection(input: {
  field: 'username' | 'email'; value: string; source: CorrectionSource; source_note?: string; password?: string;
}): Promise<SelfCorrection> {
  return decodeG8('selfCorrection', (await api.post('/privacy/corrections', input, SILENT)).data);
}

export async function revertCorrection(id: string, password?: string): Promise<SelfCorrection> {
  const r = await api.post(`/privacy/corrections/${id}/revert`, password ? { password } : {}, SILENT);
  return decodeG8('selfCorrection', r.data);
}

export async function listCorrectionRequests(planId: string): Promise<CorrectionRequest[]> {
  return decodeG8('correctionRequests', (await api.get(`/plans/${planId}/correction-requests`, SILENT)).data);
}

export async function createCorrectionRequest(planId: string, input: {
  field_label: string; current_value?: string; proposed_value: string; source: CorrectionSource; source_note?: string;
}): Promise<CorrectionRequest> {
  return decodeG8('correctionRequest', (await api.post(`/plans/${planId}/correction-requests`, input, SILENT)).data);
}

export async function resolveCorrectionRequest(
  planId: string, requestId: string, status: 'resolved' | 'declined', note?: string,
): Promise<CorrectionRequest> {
  const r = await api.post(`/plans/${planId}/correction-requests/${requestId}/resolve`,
    { status, ...(note ? { note } : {}) }, SILENT);
  return decodeG8('correctionRequest', r.data);
}

// ===== FR-004
export async function getOpsJobs(): Promise<OpsJobs> {
  return decodeG8('opsJobs', (await api.get('/admin/ops/jobs', SILENT)).data);
}
