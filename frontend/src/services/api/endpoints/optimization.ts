/**
 * 説明可能な最適化(FR-018)
 *
 * [Gate L4] backend/app/api/v1/optimization.py。/plans/{planId}/days/{dayId}/optimization-candidates。
 * 候補の計算は旅程を変えない。適用は本案のrevision(If-Match)と、計算時の入力の版(input_fingerprint)を送る。
 * 適用の409は構造化detail(code: optimization_stale / candidate_not_found / no_changes)。
 * 従来の /optimization-proposal(Gate #33、PlanInsightsApi)は互換のため残す。
 */
import { ReplansApi } from './replans';
import type { OptimizationApplyResult, OptimizationCandidates, OptimizationTravelMode } from '../types';
import { decodeResponse } from '../decode';
import { optimizationApplyResult, optimizationCandidates } from '../decoders';

export class OptimizationApi extends ReplansApi {
  async getOptimizationCandidates(planId: string, dayId: string, travelMode: OptimizationTravelMode = 'walking'): Promise<OptimizationCandidates> {
    const response = await this.client.post(`/plans/${planId}/days/${dayId}/optimization-candidates`, { travel_mode: travelMode });
    return decodeResponse(response.data, optimizationCandidates, 'POST /plans/{plan_id}/days/{day_id}/optimization-candidates');
  }

  async applyOptimizationCandidate(
    planId: string, dayId: string, candidateId: string, inputFingerprint: string, planRevision: number,
    travelMode: OptimizationTravelMode = 'walking',
  ): Promise<OptimizationApplyResult> {
    const response = await this.client.post(
      `/plans/${planId}/days/${dayId}/optimization-candidates/apply`,
      { candidate_id: candidateId, input_fingerprint: inputFingerprint, travel_mode: travelMode },
      { headers: { 'If-Match': String(planRevision) } },
    );
    return decodeResponse(response.data, optimizationApplyResult, 'POST /plans/{plan_id}/days/{day_id}/optimization-candidates/apply');
  }
}
