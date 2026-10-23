/**
 * 情報内検索・コマンドパレット(FR-009)
 *
 * [Gate C3] backend/app/api/v1/plan_search.py。GET /plans/{planId}/search・GET /search/everything。
 * 画面内でエラーを案内するため、共通エラー処理のtoastは出さない(SILENT)。
 */
import { CandidatesApi } from './candidates';
import type { SearchFilter, SearchResults } from '../types';
import { decodeResponse } from '../decode';
import { searchResults } from '../decoders';

const params = (q: string, filter: SearchFilter | null) => ({ q, ...(filter ? { filter } : {}) });

export class PlanSearchApi extends CandidatesApi {
  async searchPlan(planId: string, q: string, filter: SearchFilter | null = null): Promise<SearchResults> {
    const response = await this.client.get(`/plans/${planId}/search`, { params: params(q, filter), skipGlobalErrorHandler: true });
    return decodeResponse(response.data, searchResults, 'GET /plans/{plan_id}/search');
  }

  async searchEverything(q: string, filter: SearchFilter | null = null): Promise<SearchResults> {
    const response = await this.client.get('/search/everything', { params: params(q, filter), skipGlobalErrorHandler: true });
    return decodeResponse(response.data, searchResults, 'GET /search/everything');
  }

}
