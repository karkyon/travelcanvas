/**
 * オフライン編集・同期(FR-033)
 *
 * [Gate P11] backend/app/api/v1/sync.py。/plans/{planId}/sync配下。
 * 同期は端末が通信を回復した時に裏で行うため、失敗は呼び出し側(planStore)が案内する
 * (共通エラー処理のtoastを重ねない)。「自分の変更を使う」は本案のrevision(If-Match)を送る。
 */
import type { AxiosRequestConfig } from 'axios';
import { OptimizationApi } from './optimization';
import type { SyncConflictList, SyncOperationInput, SyncResolveResult, SyncResponse } from '../types';
import { decodeResponse } from '../decode';
import { syncConflictList, syncResolveResult, syncResponse } from '../decoders';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };

export class SyncApi extends OptimizationApi {
  async syncOperations(planId: string, operations: SyncOperationInput[], deviceId?: string): Promise<SyncResponse> {
    const response = await this.client.post(`/plans/${planId}/sync`, { device_id: deviceId, operations }, SILENT);
    return decodeResponse(response.data, syncResponse, 'POST /plans/{plan_id}/sync');
  }

  async getSyncConflicts(planId: string): Promise<SyncConflictList> {
    const response = await this.client.get(`/plans/${planId}/sync/conflicts`, SILENT);
    return decodeResponse(response.data, syncConflictList, 'GET /plans/{plan_id}/sync/conflicts');
  }

  async resolveSyncConflict(
    planId: string, operationId: string, resolution: 'keep_server' | 'use_mine', planRevision?: number,
  ): Promise<SyncResolveResult> {
    const config: AxiosRequestConfig = planRevision === undefined
      ? SILENT
      : { ...SILENT, headers: { 'If-Match': String(planRevision) } };
    const response = await this.client.post(
      `/plans/${planId}/sync/conflicts/${operationId}/resolve`, { resolution }, config,
    );
    return decodeResponse(response.data, syncResolveResult, 'POST /plans/{plan_id}/sync/conflicts/{operation_id}/resolve');
  }
}
