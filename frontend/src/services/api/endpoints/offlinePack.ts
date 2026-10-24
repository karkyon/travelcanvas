/**
 * オフラインパックの鍵(B-008 / FR-032・FR-048)
 *
 * [Gate K1] backend/app/api/v1/offline_pack.py。/offline-pack 配下。
 * 鍵は利用者ごと・版ごとに backend が導出して配る。失効(rotate)は If-Match に今の版を送る。
 * 通信できない時に端末内の鍵で開けるよう、失敗は共通エラー処理(トースト・/login 移動)を通さない。
 */
import type { AxiosRequestConfig } from 'axios';
import { MemoryReplanApi } from './memoryReplan';
import type { OfflinePackKey, OfflinePackKeyRotated } from '../types';
import { decodeResponse } from '../decode';
import { offlinePackKey, offlinePackKeyRotated } from '../decoders';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };

export class OfflinePackApi extends MemoryReplanApi {
  async getOfflinePackKey(deviceId?: string): Promise<OfflinePackKey> {
    // [Gate G6] OFF-01 端末ごとの鍵(端末を失効すると、その端末だけ 410)
    const response = await this.client.get('/offline-pack/key', deviceId ? { ...SILENT, params: { device_id: deviceId } } : SILENT);
    return decodeResponse(response.data, offlinePackKey, 'GET /offline-pack/key');
  }

  async rotateOfflinePackKey(currentVersion: number): Promise<OfflinePackKeyRotated> {
    const response = await this.client.post('/offline-pack/key/rotate', undefined, {
      ...SILENT, headers: { 'If-Match': String(currentVersion) },
    });
    return decodeResponse(response.data, offlinePackKeyRotated, 'POST /offline-pack/key/rotate');
  }
}
