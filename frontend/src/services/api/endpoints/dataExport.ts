/**
 * データポータビリティ(FR-039)
 *
 * [Gate P6] backend/app/api/v1/data_export.py。
 * 旅行単位(所有者だけ)・アカウント単位のエクスポート(JSONファイル)と、保持期間の説明。
 */
import { ItineraryExportApi } from './itineraryExport';
import type { DataExportFile, RetentionInfo } from '../types';
import { decodeResponse } from '../decode';
import { retentionInfo } from '../decoders';

function toFile(response: { data: unknown }, fallbackName: string, endpoint: string): DataExportFile {
  if (!(response.data instanceof Blob)) throw new Error(`エクスポートの応答がファイルではありません: ${endpoint}`);
  const headers = (response as { headers?: Record<string, unknown> }).headers ?? {};
  const disposition = String(headers['content-disposition'] ?? headers['Content-Disposition'] ?? '');
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
  const sha = String(headers['x-content-sha256'] ?? headers['X-Content-SHA256'] ?? '');
  return { blob: response.data, filename: name, sha256: /^[0-9a-f]{64}$/.test(sha) ? sha : null };
}

export class DataExportApi extends ItineraryExportApi {
  async getRetentionInfo(): Promise<RetentionInfo> {
    const response = await this.client.get('/privacy/retention');
    return decodeResponse(response.data, retentionInfo, 'GET /privacy/retention');
  }

  async downloadPlanDataExport(planId: string): Promise<DataExportFile> {
    const response = await this.client.get(`/plans/${planId}/data-export`, { responseType: 'blob' });
    return toFile(response, 'travelcanvas-plan.json', 'GET /plans/{plan_id}/data-export');
  }

  async downloadAccountDataExport(): Promise<DataExportFile> {
    const response = await this.client.get('/privacy/data-export', { responseType: 'blob' });
    return toFile(response, 'travelcanvas-account.json', 'GET /privacy/data-export');
  }
}
