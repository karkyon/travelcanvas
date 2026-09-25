/**
 * 当日モード NOW/NEXT(FR-029)
 *
 * [Gate M9-FE-C2a] 旧services/api.ts(約92KB・単一ファイル)を責務別に分割したもの。定義本体は分割前から変更していない。
 */
import { ImportsApi } from './imports';
import type { TodayResponse } from '../types';

export class TodayApi extends ImportsApi {
  // [Gate R3-10] FR-013文書ウォレット(documents/document_links)
  // backend/app/api/v1/plans.py の GET /plans/{planId}/today。

  async getToday(planId: string): Promise<TodayResponse> {
    const response = await this.client.get<TodayResponse>(`/plans/${planId}/today`);
    return response.data;
  }
}
