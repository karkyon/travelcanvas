/**
 * TravelCanvas スポットAPI サービス
 * バックエンドAPIとの通信を担当
 *
 * [Gate #10] 全面書き換え。旧実装は3つの独立した問題を抱えていた:
 *   1. baseUrl解決が VITE_API_BASE_URL のみを見ており(VITE_API_URLを見ない)、
 *      常にフォールバックの廃止済み旧サーバー(192.168.1.248)に到達していた。
 *   2. 認証トークンを独自に localStorage['access_token'] から読んでいたが、
 *      authStore.ts はzustand永続化(キー名'auth-storage')にしか書き込んでおらず、
 *      このキーには一度も値が入らない状態だった。
 *   3. SpotData/SpotResponseのid/created_byがnumber型のままで、
 *      実バックエンド(backend/app/schemas/spots.py)はUUID(文字列)を返す。
 * 独自のfetch実装を廃止し、既にbaseURL解決とAuthorizationヘッダー同期(Gate #10で
 * authStore.tsと接続済み)が正しい services/api.ts の共有クライアントに委譲する形に統一。
 */
import { api as apiService } from './api';

export interface SpotData {
  id?: string;
  name: string;
  description?: string;
  category: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  price_range?: string;
  image_url?: string;
  is_public?: boolean;
}

export interface SpotResponse extends SpotData {
  id: string;
  created_by: string;
  is_public: boolean;
  visit_count: number;
  created_at: string;
  updated_at?: string;
}

export interface FavoriteData {
  id: string;
  spot_id: string;
  personal_note?: string;
  personal_rating?: number;
  created_at: string;
  spot: SpotResponse;
}

class SpotApiService {
  /**
   * 新しいスポットを作成
   */
  async createSpot(spotData: Omit<SpotData, 'id'>): Promise<SpotResponse> {
    const response = await apiService.createSpot(spotData);
    return response as unknown as SpotResponse;
  }

  /**
   * スポット一覧を取得
   */
  async getSpots(category?: string, limit = 20): Promise<SpotResponse[]> {
    const response = await apiService.getSpots(category, limit);
    return (response.data ?? []) as unknown as SpotResponse[];
  }

  /**
   * 特定のスポットを取得
   */
  async getSpot(spotId: string): Promise<SpotResponse> {
    const response = await apiService.get<SpotResponse>(`/spots/${spotId}`);
    return response.data;
  }

  /**
   * スポットを更新
   */
  async updateSpot(spotId: string, spotData: Partial<SpotData>): Promise<SpotResponse> {
    const response = await apiService.put<SpotResponse>(`/spots/${spotId}`, spotData);
    return response.data;
  }

  /**
   * スポットを削除
   */
  async deleteSpot(spotId: string): Promise<{ message: string }> {
    const response = await apiService.delete<{ message: string }>(`/spots/${spotId}`);
    return response.data;
  }

  /**
   * カテゴリ一覧を取得
   */
  async getCategories(): Promise<{ categories: Array<{ value: string; label: string }> }> {
    const response = await apiService.getSpotCategories();
    return response.data;
  }

  /**
   * API接続テスト
   */
  async testConnection(): Promise<{ message: string; version: string; timestamp: string }> {
    const response = await apiService.testConnection();
    return response.data;
  }

  // ===== お気に入り関連 =====
  // [Gate #15] backend/app/api/v1/spots.pyにお気に入りAPIを実装したのに合わせて追加。

  /**
   * 自分のお気に入りスポット一覧を取得
   */
  async getFavorites(): Promise<FavoriteData[]> {
    const response = await apiService.get<FavoriteData[]>('/spots/favorites');
    return response.data;
  }

  /**
   * スポットをお気に入りに追加
   */
  async addFavorite(spotId: string, note?: string, rating?: number): Promise<FavoriteData> {
    const response = await apiService.post<FavoriteData>(`/spots/${spotId}/favorite`, {
      personal_note: note,
      personal_rating: rating,
    });
    return response.data;
  }

  /**
   * スポットをお気に入りから解除
   */
  async removeFavorite(spotId: string): Promise<{ message: string }> {
    const response = await apiService.delete<{ message: string }>(`/spots/${spotId}/favorite`);
    return response.data;
  }
}

// シングルトンインスタンス
export const spotApiService = new SpotApiService();
