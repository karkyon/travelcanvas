/**
 * 実行可能性検証(FR-017)
 *
 * [Gate L3] backend/app/api/v1/validation.py。/plans/{planId}/validation-runs配下。
 * 検証は同期実行で、結果(違反・検証不能)はサーバーに保存される(プランごとに最新20件)。
 */
import { ConstraintsApi } from './constraints';
import type { ValidationRunDetail, ValidationRunSummary } from '../types';
import { arrayOf, decodeResponse } from '../decode';
// [Gate G9] Q03 decoder は使う時に読み込む(最初に読む JS を小さく保つ)
const DL = () => import('../decoders');

export class ValidationApi extends ConstraintsApi {
  async runValidation(planId: string): Promise<ValidationRunDetail> {
    const response = await this.client.post(`/plans/${planId}/validation-runs`);
    return decodeResponse(response.data, (await DL()).validationRunDetail, 'POST /plans/{plan_id}/validation-runs');
  }

  async getValidationRuns(planId: string, limit?: number): Promise<ValidationRunSummary[]> {
    const response = await this.client.get(`/plans/${planId}/validation-runs`, {
      params: limit === undefined ? undefined : { limit },
    });
    return decodeResponse(response.data, arrayOf((await DL()).validationRunSummary), 'GET /plans/{plan_id}/validation-runs');
  }

  async getValidationRun(planId: string, runId: string): Promise<ValidationRunDetail> {
    const response = await this.client.get(`/plans/${planId}/validation-runs/${runId}`);
    return decodeResponse(response.data, (await DL()).validationRunDetail, 'GET /plans/{plan_id}/validation-runs/{run_id}');
  }
}
