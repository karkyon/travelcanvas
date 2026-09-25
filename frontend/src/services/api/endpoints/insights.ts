/**
 * PLAN MAPの移動概算・挿入プレビュー・説明可能な最適化
 *
 * [Gate M9-FE-C2a] 旧services/api.ts(約92KB・単一ファイル)を責務別に分割したもの。定義本体は分割前から変更していない。
 */
import { TicketsApi } from './tickets';
import type { InsertionPreview, NormalizedDay, OptimizationProposal, RoutePreview } from '../types';

export class PlanInsightsApi extends TicketsApi {
  async getRoutePreview(planId: string, dayId: string, mode: string = 'walking'): Promise<RoutePreview> {
    const response = await this.client.get<RoutePreview>(
      `/plans/${planId}/days/${dayId}/route-preview`, { params: { mode } }
    );
    return response.data;
  }

  async getInsertionPreview(
    planId: string, dayId: string,
    data: { place_id?: string; latitude?: number; longitude?: number; after_event_id?: string; mode?: string }
  ): Promise<InsertionPreview> {
    const response = await this.client.post<InsertionPreview>(
      `/plans/${planId}/days/${dayId}/insertion-preview`, data
    );
    return response.data;
  }

  // [Gate #33 監査是正] 旧OptimizationPanelは「AI最適化」と称し天候・混雑・
  // 予算等の設定項目を持っていたが、backend実体は近傍法(座標のみ考慮)の
  // ままでこれらの設定は一切効果を持たなかった(見せかけのUI)。本APIは
  // 実際に行われている処理(近傍法・座標ベース・locked除外)だけを提案する。
  async getOptimizationProposal(planId: string, dayId: string): Promise<OptimizationProposal> {
    const response = await this.client.post<OptimizationProposal>(
      `/plans/${planId}/days/${dayId}/optimization-proposal`
    );
    return response.data;
  }

  async applyOptimizationProposal(
    planId: string, dayId: string, proposedOrder: string[], ifMatch: number
  ): Promise<NormalizedDay> {
    const response = await this.client.post<NormalizedDay>(
      `/plans/${planId}/days/${dayId}/optimization-proposal/apply`,
      { proposed_order: proposedOrder },
      { headers: { 'If-Match': String(ifMatch) } }
    );
    return response.data;
  }
}
