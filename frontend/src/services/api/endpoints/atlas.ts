/**
 * Personal Travel Atlas(FR-052)
 *
 * [Gate P15] backend/app/api/v1/atlas.py。/atlas配下。画面内でエラーを案内するため、共通エラー処理のtoastは出さない。
 */
import type { AxiosRequestConfig } from 'axios';
import { JourneyApi } from './journey';
import type { AtlasPrecision, AtlasResponse } from '../types';
import { decodeResponse } from '../decode';
import { atlasResponse, atlasSettingsResult } from '../decoders';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };

export class AtlasApi extends JourneyApi {
  async getAtlas(precision: AtlasPrecision, year?: number | null): Promise<AtlasResponse> {
    const params: Record<string, string | number> = { precision };
    if (year) params.year = year;
    const response = await this.client.get('/atlas', { ...SILENT, params });
    return decodeResponse(response.data, atlasResponse, 'GET /atlas');
  }

  async updateAtlasSettings(excludedPlanIds: string[]): Promise<{ excluded_plan_ids: string[] }> {
    const response = await this.client.put('/atlas/settings', { excluded_plan_ids: excludedPlanIds }, SILENT);
    return decodeResponse(response.data, atlasSettingsResult, 'PUT /atlas/settings');
  }
}
