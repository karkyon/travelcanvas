/**
 * スポット(/spots/*)
 *
 * [Gate M9-FE-C2a] 旧services/api.ts(約92KB・単一ファイル)を責務別に分割したもの。定義本体は分割前から変更していない。
 */
import { SearchApi } from './search';
import type { ApiResponse, CreateSpotData } from '../types';

export class SpotsApi extends SearchApi {
  async getSpots(category?: string, limit = 20): Promise<ApiResponse<unknown[]>> {
    const params = new URLSearchParams();
    if (category && category !== 'all') params.append('category', category);
    if (limit) params.append('limit', limit.toString());
    
    const response = await this.client.get<unknown>(`/spots/?${params}`);

    if (Array.isArray(response.data)) {
      return {
        success: true,
        message: '取得完了',
        data: response.data
      };
    } else {
      return response.data as ApiResponse<unknown[]>;
    }
  }

  async createSpot(spotData: CreateSpotData): Promise<ApiResponse<unknown>> {
    const response = await this.client.post<ApiResponse<unknown>>('/spots/', spotData);
    return response.data;
  }

  async getSpotCategories(): Promise<ApiResponse<{ categories: Array<{ value: string; label: string }> }>> {
    const response = await this.client.get<ApiResponse<{ categories: Array<{ value: string; label: string }> }>>('/spots/categories/list');
    return response.data;
  }

  async testConnection(): Promise<ApiResponse<{ message: string; version: string; timestamp: string }>> {
    const response = await this.client.get<ApiResponse<{ message: string; version: string; timestamp: string }>>('/spots/test/ping');
    return response.data;
  }
}
