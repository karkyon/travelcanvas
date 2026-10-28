/**
 * [Gate G11] 旅行の表紙の写真の API(backend/app/api/v1/plan_cover.py、docs/ux/G11_UIUX全範囲_実装仕様.md §2.1)。
 * 画面の中で失敗を案内するため、共通のエラーの toast は出さない(SILENT)。写真は Blob で受け取り、画面で一時の URL にする
 * (写真の URL を共有・保存させない。サーバーはキャッシュさせない)。
 */
import type { AxiosRequestConfig } from 'axios';
import { api } from './index';
import { bool, decodeResponse, nullable, object, type Decoder } from './decode';
import { planCover } from './g11cover';
import type { CoverPosition, PlanCoverState } from './types/g11';

export { optionalPlanCover, planCover } from './g11cover';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };

const coverState: Decoder<PlanCoverState> = object<PlanCoverState>({ cover: nullable(planCover), can_edit: bool });

export async function getPlanCover(planId: string): Promise<PlanCoverState> {
  return decodeResponse((await api.get(`/plans/${planId}/cover`, SILENT)).data, coverState, 'GET /plans/{id}/cover');
}

export async function setPlanCover(planId: string, memoryId: string, pos: Partial<CoverPosition> = {}): Promise<PlanCoverState> {
  const r = await api.put(`/plans/${planId}/cover`, { memory_id: memoryId, ...pos }, SILENT);
  return decodeResponse(r.data, coverState, 'PUT /plans/{id}/cover');
}

export async function movePlanCover(planId: string, pos: Partial<CoverPosition>): Promise<PlanCoverState> {
  return decodeResponse((await api.patch(`/plans/${planId}/cover`, pos, SILENT)).data, coverState,
    'PATCH /plans/{id}/cover');
}

export async function clearPlanCover(planId: string): Promise<PlanCoverState> {
  return decodeResponse((await api.delete(`/plans/${planId}/cover`, SILENT)).data, coverState,
    'DELETE /plans/{id}/cover');
}

export async function getPlanCoverMedia(planId: string): Promise<Blob> {
  const r = await api.get(`/plans/${planId}/cover/media`, { ...SILENT, responseType: 'blob' });
  return r.data as Blob;
}
