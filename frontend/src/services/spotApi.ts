/**
 * TravelCanvas スポットAPI サービス
 * バックエンドAPIとの通信を担当
 */

interface SpotData {
  id?: number;
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

interface SpotResponse extends SpotData {
  id: number;
  created_by: number;
  visit_count: number;
  created_at: string;
  updated_at?: string;
}

class SpotApiService {
  private baseUrl: string;
  
  constructor() {
    this.baseUrl = import.meta.env.VITE_API_BASE_URL || 'http://192.168.1.248:8000/api/v1';
  }
  
  private async getHeaders(): Promise<HeadersInit> {
    const token = localStorage.getItem('access_token');
    return {
      'Content-Type': 'application/json',
      ...(token && { 'Authorization': `Bearer ${token}` })
    };
  }
  
  private async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
    }
    return response.json();
  }
  
  /**
   * 新しいスポットを作成
   */
  async createSpot(spotData: Omit<SpotData, 'id'>): Promise<SpotResponse> {
    const response = await fetch(`${this.baseUrl}/spots/`, {
      method: 'POST',
      headers: await this.getHeaders(),
      body: JSON.stringify(spotData)
    });
    
    return this.handleResponse<SpotResponse>(response);
  }
  
  /**
   * スポット一覧を取得
   */
  async getSpots(category?: string, limit = 20): Promise<SpotResponse[]> {
    const params = new URLSearchParams();
    if (category && category !== 'all') params.append('category', category);
    if (limit) params.append('limit', limit.toString());
    
    const response = await fetch(`${this.baseUrl}/spots/?${params}`, {
      method: 'GET',
      headers: await this.getHeaders()
    });
    
    return this.handleResponse<SpotResponse[]>(response);
  }
  
  /**
   * 特定のスポットを取得
   */
  async getSpot(spotId: number): Promise<SpotResponse> {
    const response = await fetch(`${this.baseUrl}/spots/${spotId}`, {
      method: 'GET',
      headers: await this.getHeaders()
    });
    
    return this.handleResponse<SpotResponse>(response);
  }
  
  /**
   * スポットを更新
   */
  async updateSpot(spotId: number, spotData: Partial<SpotData>): Promise<SpotResponse> {
    const response = await fetch(`${this.baseUrl}/spots/${spotId}`, {
      method: 'PUT',
      headers: await this.getHeaders(),
      body: JSON.stringify(spotData)
    });
    
    return this.handleResponse<SpotResponse>(response);
  }
  
  /**
   * スポットを削除
   */
  async deleteSpot(spotId: number): Promise<{ message: string }> {
    const response = await fetch(`${this.baseUrl}/spots/${spotId}`, {
      method: 'DELETE',
      headers: await this.getHeaders()
    });
    
    return this.handleResponse<{ message: string }>(response);
  }
  
  /**
   * カテゴリ一覧を取得
   */
  async getCategories(): Promise<{ categories: Array<{ value: string; label: string }> }> {
    const response = await fetch(`${this.baseUrl}/spots/categories/list`, {
      method: 'GET',
      headers: await this.getHeaders()
    });
    
    return this.handleResponse<{ categories: Array<{ value: string; label: string }> }>(response);
  }
  
  /**
   * API接続テスト
   */
  async testConnection(): Promise<{ message: string; version: string; timestamp: string }> {
    const response = await fetch(`${this.baseUrl}/spots/test/ping`, {
      method: 'GET',
      headers: await this.getHeaders()
    });
    
    return this.handleResponse<{ message: string; version: string; timestamp: string }>(response);
  }
}

// シングルトンインスタンス
export const spotApiService = new SpotApiService();
export type { SpotData, SpotResponse };
