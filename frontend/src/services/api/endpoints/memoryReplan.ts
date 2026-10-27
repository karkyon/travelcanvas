/**
 * Memory Replan(FR-057)
 *
 * [Gate P17] backend/app/api/v1/memory_replan.py。/plans/{planId}/memory-replan配下。
 * 適用は本案のrevision(If-Match)と、提案を作った時の入力の版(input_fingerprint)を送る。
 */
import type { AxiosRequestConfig } from 'axios';
import { AtlasApi } from './atlas';
import type { MemoryReplanApplyResult, MemoryReplanResult } from '../types';
import { decodeResponse } from '../decode';
// [Gate G9] Q03 decoder は使う時に読み込む(最初に読む JS を小さく保つ)
const DL = () => import('../decoders');

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };

export class MemoryReplanApi extends AtlasApi {
  async getMemoryReplan(planId: string): Promise<MemoryReplanResult> {
    const response = await this.client.get(`/plans/${planId}/memory-replan`, SILENT);
    return decodeResponse(response.data, (await DL()).memoryReplanResult, 'GET /plans/{plan_id}/memory-replan');
  }

  async applyMemoryReplan(
    planId: string, proposalId: string, inputFingerprint: string, planRevision: number,
  ): Promise<MemoryReplanApplyResult> {
    const response = await this.client.post(`/plans/${planId}/memory-replan/apply`, {
      proposal_id: proposalId, input_fingerprint: inputFingerprint,
    }, { ...SILENT, headers: { 'If-Match': String(planRevision) } });
    return decodeResponse(response.data, (await DL()).memoryReplanApplyResult, 'POST /plans/{plan_id}/memory-replan/apply');
  }
}
