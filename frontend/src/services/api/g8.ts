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
import { decodeG8 } from './decodersG8';
import type {
  CorrectionRequest, CorrectionSource, CorrectionsOverview, KeepRole, OpsJobs,
  OwnershipInfo, OwnershipTransfer, SelfCorrection,
} from './types/g8';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };

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
