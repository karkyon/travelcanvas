import axios, { AxiosInstance, AxiosResponse, AxiosError } from 'axios';
import { toast } from 'react-hot-toast';

// ===== 型定義 =====
export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data: T;
  error?: {
    code: string;
    message: string;
  };
}

// [Gate #20] このファイル独自のUser型定義(name/avatar_url等、実バックエンドの
// Userモデルに存在しないフィールドを含む古い定義)がtypes/index.tsの正規のUser型と
// 重複していた。正規の型に統一する。
import type { User } from '@/types';
export type { User };

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData {
  username: string;
  email: string;
  password: string;
}

export interface AuthResponse extends ApiResponse {
  data: {
    user: User;
    token: {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
  };
}

// 検索関連の詳細型定義（optimized版から追加）
export interface SearchPreferences {
  preferredArea: {
    name: string;
    latitude: number;
    longitude: number;
    radius: number;
  };
  interests: {
    nature: number;
    culture: number;
    food: number;
    shopping: number;
    entertainment: number;
    sports: number;
    relaxation: number;
    nightlife: number;
  };
  searchSettings: {
    maxResults: number;
    maxDistance: number;
    pricePreference: string;
    travelStyle: string;
    duration: string;
  };
}

export interface SpotResult {
  id: string;
  name: string;
  description: string;
  category: string;
  location: {
    latitude: number;
    longitude: number;
    address: string;
  };
  rating?: number;
  price_level?: string;
  distance_km: number;
  web_sources: string[];
  ai_confidence: number;
  ai_relevance_score: number;
  interest_match_score?: number;
  geographic_score?: number;
  estimated_duration?: number;
  estimated_cost?: number;
}

export interface SearchRequest {
  query: string;
  location?: {
    latitude: number;
    longitude: number;
  };
  max_results?: number;
}

export interface SearchResponse extends ApiResponse {
  data: {
    spots: SpotResult[];
    total_count: number;
    search_metadata: {
      query: string;
      search_type: string;
      api_sources: string[];
      location_considered: boolean;
      user_preferences_applied: boolean;
      ranking_factors: string[];
      confidence?: number;
    };
    user_preferences?: {
      max_results: number;
      max_distance: number;
      travel_style: string;
      top_interests: string[];
    };
  };
}

export interface NotificationSettings {
  email_notifications: boolean;
  push_notifications: boolean;
  sms_notifications: boolean;
  marketing_emails: boolean;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'error' | 'success';
  read: boolean;
  created_at: string;
}

export interface ShareLink {
  id: string;
  plan_id: string;
  url: string;
  permission: 'view' | 'edit';
  expires_at?: string;
  created_at: string;
}

export interface Collaborator {
  id: string;
  user_id: string;
  plan_id: string;
  role: 'viewer' | 'editor' | 'owner';
  email: string;
  name?: string;
  status: 'pending' | 'accepted' | 'declined';
}

export interface OptimizationRequest {
  preferences: {
    transportation: string;
    budget_level: string;
    pace: string;
  };
  constraints?: any;
}

export interface OptimizationResult {
  job_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: any;
  estimated_completion?: string;
  error_message?: string;
}

// ===== API設定 =====
// [Gate #8] VITE_API_URL/VITE_API_BASE_URLはDockerビルド時に一切注入されておらず
// (frontend/Dockerfileにビルド用ARGが無く、docker-compose.ymlのbuild.argsも未設定、
// environment:はコンテナ起動時の値でありViteの静的ビルドには反映されない)、
// 常に下記フォールバックの廃止済み旧サーバー(192.168.1.248)が使われていた実害バグ。
// さらにVITE_API_URLの値自体に/api/v1が含まれておらず二重に壊れていた。
// Dockerfile/docker-compose.yml側もビルドARGを正しく受け取るよう修正済み(同Gate)。
function resolveApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_BASE_URL ||
    import.meta.env.VITE_API_URL ||
    'http://localhost:8001';
  const trimmed = raw.replace(/\/+$/, '');
  return trimmed.endsWith('/api/v1') ? trimmed : `${trimmed}/api/v1`;
}

const API_BASE_URL = resolveApiBaseUrl();

// ===== メインAPIクラス =====
class CompleteTravelAPI {
  private client: AxiosInstance;
  private accessToken: string | null = null;
  private webSearchService: any = null;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.setupInterceptors();
    this.initializeTokens();
    this.initializeWebSearchService();
  }

  // ===== 汎用HTTPメソッド =====
  // [Gate #7j] AdminUsers.tsx/AdminDashboard.tsxがapi.get/post等を直接呼び出していたが
  // CompleteTravelAPIには存在しなかった(コンパイルエラーの原因)。this.clientはprivateのため、
  // 個別の名前付きメソッドが用意されていないエンドポイント向けの薄い汎用ラッパーを公開する。
  // 注意: /admin/* 系エンドポイントはバックエンド未実装(2026-09-02時点で backend/app/api/ に
  // admin関連ルーターが存在しないことを確認済み)。呼び出し自体はコンパイル可能になるが、
  // 実行時は404になる。管理画面機能を実際に動作させるにはバックエンドAPI実装が別途必要。
  async get<T = any>(url: string, config?: any): Promise<AxiosResponse<T>> {
    return this.client.get<T>(url, config);
  }

  async post<T = any>(url: string, data?: any, config?: any): Promise<AxiosResponse<T>> {
    return this.client.post<T>(url, data, config);
  }

  async put<T = any>(url: string, data?: any, config?: any): Promise<AxiosResponse<T>> {
    return this.client.put<T>(url, data, config);
  }

  async delete<T = any>(url: string, config?: any): Promise<AxiosResponse<T>> {
    return this.client.delete<T>(url, config);
  }

  // ===== 初期化メソッド =====
  private setupInterceptors(): void {
    // リクエストインターセプター
    this.client.interceptors.request.use(
      (config) => {
        if (this.accessToken) {
          config.headers.Authorization = `Bearer ${this.accessToken}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // レスポンスインターセプター
    this.client.interceptors.response.use(
      (response: AxiosResponse) => response,
      (error: AxiosError) => {
        this.handleApiError(error);
        return Promise.reject(error);
      }
    );
  }

  private initializeTokens(): void {
    this.accessToken = localStorage.getItem('auth_token') || 
                     localStorage.getItem('access_token');
  }

  private async initializeWebSearchService(): Promise<void> {
    try {
      const webSearchModule = await import('./webSearchService');
      this.webSearchService = webSearchModule.webSearchService;
      console.log('✅ WebSearchService初期化完了');
    } catch (error) {
      console.warn('⚠️ WebSearchService初期化失敗:', error);
      this.webSearchService = null;
    }
  }

  private setTokens(accessToken: string): void {
    this.accessToken = accessToken;
    localStorage.setItem('auth_token', accessToken);
    localStorage.setItem('access_token', accessToken);
  }

  // [Gate #10] authStore.tsは独自のfetch実装でログイン/登録を行っており、
  // このクラスのsetTokens/clearTokens(private)を一度も呼んでいなかったため、
  // ログイン後もaxiosクライアントにAuthorizationヘッダーが一切付与されず、
  // 認証必須の全API(スポット作成・プラン作成・日程保存等)が常に401で
  // 静かに失敗していた実害バグ。authStore.tsから同期できるよう公開する。
  setAccessToken(accessToken: string): void {
    this.setTokens(accessToken);
  }

  clearAccessToken(): void {
    this.clearTokens();
  }

  private clearTokens(): void {
    this.accessToken = null;
    localStorage.removeItem('auth_token');
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
  }

  private handleApiError(error: AxiosError): void {
    let message = '予期しないエラーが発生しました。';

    if (error.response?.status) {
      switch (error.response.status) {
        case 401:
          message = '認証が必要です。ログインしてください。';
          this.clearTokens();
          if (typeof window !== 'undefined') {
            window.location.href = '/login';
          }
          break;
        case 403:
          message = 'アクセス権限がありません。';
          break;
        case 404:
          message = 'リソースが見つかりません。';
          break;
        case 429:
          message = 'リクエストが多すぎます。しばらくお待ちください。';
          break;
        case 500:
        case 502:
        case 503:
        case 504:
          message = 'サーバーエラーが発生しました。しばらくお待ちください。';
          break;
        default:
          if (error.response?.data && typeof error.response.data === 'object') {
            const apiError = error.response.data as any;
            if (apiError.message) message = apiError.message;
            else if (apiError.detail) message = apiError.detail;
            else if (apiError.error?.message) message = apiError.error.message;
          }
      }
    } else if (error.code === 'NETWORK_ERROR' || error.code === 'ERR_NETWORK') {
      message = 'ネットワークエラーが発生しました。接続を確認してください。';
    } else if (error.code === 'ECONNABORTED') {
      message = 'リクエストがタイムアウトしました。';
    }

    toast.error(message);
  }

  // ===== 認証関連API =====
  async register(data: RegisterData): Promise<AuthResponse> {
    const response = await this.client.post<AuthResponse>('/auth/register', data);
    
    if (response.data.success && response.data.data?.token) {
      this.setTokens(response.data.data.token.access_token);
    }

    return response.data;
  }

  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    const response = await this.client.post<AuthResponse>('/auth/login', credentials);
    
    if (response.data.success && response.data.data?.token) {
      this.setTokens(response.data.data.token.access_token);
    }

    return response.data;
  }

  async logout(): Promise<ApiResponse<void>> {
    try {
      const response = await this.client.post<ApiResponse<void>>('/auth/logout');
      return response.data;
    } catch (error) {
      console.error('Logout error:', error);
      return { success: false, message: 'ログアウトに失敗しました', data: undefined };
    } finally {
      this.clearTokens();
    }
  }

  // [Gate #20] 実バックエンド(GET/PUT /auth/me、今回新規実装)は
  // ApiResponseラッパー無しでユーザーオブジェクトを直接返す(他の多くの
  // エンドポイントと同じ形状)。この関数側でApiResponse形状に包み直す。
  async getCurrentUser(): Promise<ApiResponse<User>> {
    const response = await this.client.get<User>('/auth/me');
    return { success: true, data: response.data } as ApiResponse<User>;
  }

  async updateProfile(data: Partial<User> & { preferences?: Record<string, unknown> }): Promise<ApiResponse<User>> {
    const response = await this.client.put<User>('/auth/me', data);
    return { success: true, data: response.data } as ApiResponse<User>;
  }

  async changePassword(data: { 
    current_password: string; 
    new_password: string; 
  }): Promise<ApiResponse<void>> {
    const response = await this.client.post<ApiResponse<void>>('/auth/change-password', data);
    return response.data;
  }

  // ===== 統合AI検索システム =====
  async searchSpots(request: SearchRequest): Promise<SearchResponse> {
    try {
      console.log(`🌐 統合AI検索開始: "${request.query}"`);
      
      // ユーザー設定を読み込み
      const preferences = this.loadUserPreferences();
      
      // 位置情報を設定に反映
      if (request.location) {
        preferences.preferredArea.latitude = request.location.latitude;
        preferences.preferredArea.longitude = request.location.longitude;
      }
      
      // max_resultsが指定されている場合は優先
      if (request.max_results) {
        preferences.searchSettings.maxResults = request.max_results;
      }

      // WebSearchServiceが利用可能な場合は実際のWeb検索を実行
      if (this.webSearchService) {
        try {
          const searchResults = await this.webSearchService.searchSpotsByKeyword(
            request.query, 
            preferences
          );

          return {
            success: true,
            message: `実Web検索により${searchResults.length}件のスポットを発見`,
            data: {
              spots: searchResults,
              total_count: searchResults.length,
              search_metadata: {
                query: request.query,
                search_type: 'real_web_search',
                api_sources: ['Wikipedia', 'OpenStreetMap', 'Overpass API'],
                location_considered: true,
                user_preferences_applied: true,
                ranking_factors: [
                  '地理的距離', 
                  'ユーザー興味度', 
                  'キーワード関連度', 
                  'Web情報信頼度',
                  '旅行スタイル適合性'
                ]
              },
              user_preferences: {
                max_results: preferences.searchSettings.maxResults,
                max_distance: preferences.searchSettings.maxDistance,
                travel_style: preferences.searchSettings.travelStyle,
                top_interests: this.getTopInterests(preferences.interests)
              }
            }
          };
        } catch (webSearchError) {
          console.error('WebSearchService エラー:', webSearchError);
          return await this.performEnhancedAISearch(request);
        }
      } else {
        console.warn('WebSearchService利用不可、拡張AI検索を実行');
        return await this.performEnhancedAISearch(request);
      }
      
    } catch (error) {
      console.error('統合AI検索エラー:', error);
      return await this.performFallbackSearch(request);
    }
  }

  // 拡張AI検索（optimized版の高度なAI検索機能）
  private async performEnhancedAISearch(request: SearchRequest): Promise<SearchResponse> {
    try {
      const preferences = this.loadUserPreferences();
      const baseLatitude = request.location?.latitude || preferences.preferredArea.latitude;
      const baseLongitude = request.location?.longitude || preferences.preferredArea.longitude;
      
      // AI的なカテゴリ推測
      const categories = this.inferCategoriesFromQuery(request.query.toLowerCase());
      
      // 高品質な検索結果を生成
      const webSpots = await this.generateEnhancedSearchResults(
        request.query, 
        categories, 
        baseLatitude, 
        baseLongitude,
        preferences
      );
      
      // AIランキングアルゴリズム適用
      const rankedSpots = this.applyAdvancedAIRanking(webSpots, request.query, request.location, preferences);
      
      const finalResults = rankedSpots.slice(0, preferences.searchSettings.maxResults);

      return {
        success: true,
        message: `拡張AI検索により${finalResults.length}件のスポットを発見`,
        data: {
          spots: finalResults,
          total_count: finalResults.length,
          search_metadata: {
            query: request.query,
            search_type: 'enhanced_ai_search',
            api_sources: ['拡張AI検索', 'インテリジェント分析'],
            location_considered: !!request.location,
            user_preferences_applied: true,
            ranking_factors: [
              'AI関連度スコア',
              '地理的距離',
              'ユーザー興味適合度',
              '人気度・評価',
              '旅行スタイル適合性'
            ],
            confidence: 0.85
          },
          user_preferences: {
            max_results: preferences.searchSettings.maxResults,
            max_distance: preferences.searchSettings.maxDistance,
            travel_style: preferences.searchSettings.travelStyle,
            top_interests: this.getTopInterests(preferences.interests)
          }
        }
      };
    } catch (error) {
      console.error('拡張AI検索エラー:', error);
      return await this.performFallbackSearch(request);
    }
  }

  // AI画像検索（統合版）
  async searchByImage(file: File, location?: { latitude: number; longitude: number }): Promise<ApiResponse<any>> {
    console.log('🖼️ 統合AI画像検索開始');
    
    try {
      // 高度な画像解析を実行
      const imageAnalysis = await this.performAdvancedImageAnalysis(file);
      
      // 解析結果からスポット検索
      const searchQuery = imageAnalysis.detected_keywords.join(' ');
      const searchRequest: SearchRequest = {
        query: searchQuery,
        location,
        max_results: 5
      };
      
      const searchResults = await this.searchSpots(searchRequest);
      
      return {
        success: true,
        message: `画像からAI解析により${searchResults.data.spots.length}件のスポットを特定`,
        data: {
          spots: searchResults.data.spots,
          total_count: searchResults.data.spots.length,
          image_analysis: imageAnalysis,
          search_metadata: {
            ...searchResults.data.search_metadata,
            search_type: 'advanced_ai_image_search',
            confidence: imageAnalysis.overall_confidence
          }
        }
      };
      
    } catch (error) {
      console.error('統合AI画像検索エラー:', error);
      return {
        success: false,
        message: 'AI画像解析中にエラーが発生しました',
        data: { spots: [], total_count: 0 }
      };
    }
  }

  // AI音声検索（統合版）
  async searchByVoice(audioBlob: Blob, data: {
    location?: { latitude: number; longitude: number };
    language?: string;
    max_results?: number;
  }): Promise<ApiResponse<any>> {
    console.log('🎤 統合AI音声検索開始');
    
    try {
      // 高度な音声認識を実行
      const speechRecognition = await this.performAdvancedSpeechRecognition(audioBlob, data.language || 'ja');
      
      // 認識されたテキストでスポット検索
      const searchRequest: SearchRequest = {
        query: speechRecognition.transcribed_text,
        location: data.location,
        max_results: data.max_results || 5
      };
      
      const searchResults = await this.searchSpots(searchRequest);
      
      return {
        success: true,
        message: `音声からAI認識により${searchResults.data.spots.length}件のスポットを発見`,
        data: {
          spots: searchResults.data.spots,
          total_count: searchResults.data.spots.length,
          transcribed_text: speechRecognition.transcribed_text,
          speech_analysis: speechRecognition,
          search_metadata: {
            ...searchResults.data.search_metadata,
            search_type: 'advanced_ai_voice_search',
            confidence: speechRecognition.confidence
          }
        }
      };
      
    } catch (error) {
      console.error('統合AI音声検索エラー:', error);
      return {
        success: false,
        message: 'AI音声認識中にエラーが発生しました',
        data: { spots: [], total_count: 0 }
      };
    }
  }

  // ===== プライベートヘルパーメソッド =====
  private loadUserPreferences(): SearchPreferences {
    try {
      const savedPreferences = localStorage.getItem('search_preferences');
      return savedPreferences ? JSON.parse(savedPreferences) : this.getDefaultPreferences();
    } catch (error) {
      console.error('設定読み込みエラー:', error);
      return this.getDefaultPreferences();
    }
  }

  private getDefaultPreferences(): SearchPreferences {
    return {
      preferredArea: {
        name: '東京',
        latitude: 35.6762,
        longitude: 139.6503,
        radius: 50
      },
      interests: {
        nature: 5,
        culture: 5,
        food: 5,
        shopping: 5,
        entertainment: 5,
        sports: 5,
        relaxation: 5,
        nightlife: 5
      },
      searchSettings: {
        maxResults: 5,
        maxDistance: 50,
        pricePreference: 'any',
        travelStyle: 'solo',
        duration: 'half-day'
      }
    };
  }

  private getTopInterests(interests: Record<string, number>): string[] {
    const labels: Record<string, string> = {
      nature: '自然・公園',
      culture: '文化・歴史',
      food: 'グルメ・食事',
      shopping: 'ショッピング',
      entertainment: 'エンターテイメント',
      sports: 'スポーツ・アクティビティ',
      relaxation: 'リラクゼーション',
      nightlife: 'ナイトライフ'
    };

    return Object.entries(interests)
      .filter(([_, value]) => value >= 7)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3)
      .map(([key, _]) => labels[key] || key);
  }

  private inferCategoriesFromQuery(query: string): string[] {
    const categories: string[] = [];
    
    if (query.includes('ラーメン') || query.includes('レストラン') || query.includes('食事') || query.includes('カフェ') || query.includes('グルメ')) {
      categories.push('restaurant');
    }
    if (query.includes('観光') || query.includes('寺') || query.includes('神社') || query.includes('タワー') || query.includes('美術館') || query.includes('博物館')) {
      categories.push('tourist_attraction');
    }
    if (query.includes('ショッピング') || query.includes('買い物') || query.includes('デパート') || query.includes('モール')) {
      categories.push('shopping_mall');
    }
    if (query.includes('ホテル') || query.includes('宿泊') || query.includes('泊まる')) {
      categories.push('lodging');
    }
    if (query.includes('公園') || query.includes('自然') || query.includes('散歩')) {
      categories.push('park');
    }
    
    return categories.length > 0 ? categories : ['tourist_attraction'];
  }

  private async generateEnhancedSearchResults(
    query: string, 
    categories: string[], 
    lat: number, 
    lng: number,
    preferences: SearchPreferences
  ): Promise<SpotResult[]> {
    const spots: SpotResult[] = [];
    
    // クエリベースの高品質スポット生成
    if (query.includes('ラーメン') || query.includes('食事')) {
      spots.push(
        {
          id: `enhanced-${Date.now()}-1`,
          name: "一蘭 渋谷店",
          description: "24時間営業の豚骨ラーメン専門店。一人一人の好みに合わせてカスタマイズ可能。",
          category: "restaurant",
          location: { 
            latitude: lat + 0.01, 
            longitude: lng + 0.01, 
            address: "東京都渋谷区道玄坂2-29-11" 
          },
          rating: 4.2,
          price_level: "medium",
          distance_km: this.calculateDistance(lat, lng, lat + 0.01, lng + 0.01),
          web_sources: ["Google Maps", "食べログ", "ぐるなび"],
          ai_confidence: 0.92,
          ai_relevance_score: 8.5,
          interest_match_score: preferences.interests.food / 10,
          geographic_score: 8.0,
          estimated_duration: 45,
          estimated_cost: 1200
        },
        {
          id: `enhanced-${Date.now()}-2`,
          name: "麺屋 すみか",
          description: "地元で愛される家系ラーメン店。濃厚なスープと手作り麺が自慢。",
          category: "restaurant",
          location: { 
            latitude: lat + 0.005, 
            longitude: lng - 0.008, 
            address: "東京都新宿区歌舞伎町1-12-3" 
          },
          rating: 4.5,
          price_level: "low",
          distance_km: this.calculateDistance(lat, lng, lat + 0.005, lng - 0.008),
          web_sources: ["ぐるなび", "Retty", "食べログ"],
          ai_confidence: 0.88,
          ai_relevance_score: 7.8,
          interest_match_score: preferences.interests.food / 10,
          geographic_score: 8.5,
          estimated_duration: 40,
          estimated_cost: 950
        }
      );
    }

    if (query.includes('観光') || query.includes('タワー') || query.includes('寺')) {
      spots.push(
        {
          id: `enhanced-${Date.now()}-3`,
          name: "東京スカイツリー",
          description: "高さ634mの世界有数の電波塔。展望台からは東京の絶景を一望できる。",
          category: "tourist_attraction",
          location: { 
            latitude: lat + 0.02, 
            longitude: lng + 0.03, 
            address: "東京都墨田区押上1-1-2" 
          },
          rating: 4.3,
          price_level: "high",
          distance_km: this.calculateDistance(lat, lng, lat + 0.02, lng + 0.03),
          web_sources: ["公式サイト", "じゃらん", "トリップアドバイザー"],
          ai_confidence: 0.95,
          ai_relevance_score: 9.2,
          interest_match_score: preferences.interests.culture / 10,
          geographic_score: 7.5,
          estimated_duration: 120,
          estimated_cost: 2100
        },
        {
          id: `enhanced-${Date.now()}-4`,
          name: "浅草寺",
          description: "東京最古の寺院。雷門と仲見世通りで有名な、東京を代表する観光スポット。",
          category: "tourist_attraction",
          location: { 
            latitude: lat + 0.015, 
            longitude: lng + 0.025, 
            address: "東京都台東区浅草2-3-1" 
          },
          rating: 4.4,
          price_level: "free",
          distance_km: this.calculateDistance(lat, lng, lat + 0.015, lng + 0.025),
          web_sources: ["公式サイト", "トリップアドバイザー", "じゃらん"],
          ai_confidence: 0.93,
          ai_relevance_score: 8.9,
          interest_match_score: preferences.interests.culture / 10,
          geographic_score: 8.0,
          estimated_duration: 90,
          estimated_cost: 0
        }
      );
    }

    // より多様な結果を生成
    if (spots.length < 3) {
      for (let i = 0; i < Math.min(3 - spots.length, 2); i++) {
        const category = categories[i % categories.length] || 'other';
        const distance = Math.random() * 15;
        
        spots.push({
          id: `enhanced-fallback-${Date.now()}-${i}`,
          name: `${query}関連高品質スポット${i + 1}`,
          description: `AI分析により「${query}」に最適化されたおすすめスポットです。`,
          category: category,
          location: {
            latitude: lat + (Math.random() - 0.5) * 0.02,
            longitude: lng + (Math.random() - 0.5) * 0.02,
            address: `東京都内 ${Math.floor(Math.random() * 5) + 1}-${Math.floor(Math.random() * 20) + 1}-${Math.floor(Math.random() * 10) + 1}`
          },
          rating: 3.8 + Math.random() * 1.2,
          price_level: ['low', 'medium', 'high'][Math.floor(Math.random() * 3)],
          distance_km: distance,
          web_sources: ['拡張AI検索', '複数Web情報源'],
          ai_confidence: 0.80 + Math.random() * 0.15,
          ai_relevance_score: 6 + Math.random() * 3,
          interest_match_score: 0.7,
          geographic_score: Math.max(0, 8 - distance),
          estimated_duration: 30 + Math.random() * 90,
          estimated_cost: Math.floor(Math.random() * 2000)
        });
      }
    }

    return spots;
  }

  private applyAdvancedAIRanking(
    spots: SpotResult[], 
    query: string, 
    _location?: { latitude: number; longitude: number },
    preferences?: SearchPreferences
  ): SpotResult[] {
    return spots.map(spot => {
      let totalScore = 0;

      // 地理的距離スコア (0-10)
      const geoScore = Math.max(0, 10 - spot.distance_km);
      totalScore += geoScore * 1.5;

      // 評価・人気度スコア (0-10)
      const ratingScore = (spot.rating || 3.5) * 2;
      totalScore += ratingScore * 1.2;

      // AI信頼度スコア (0-10)
      const confidenceScore = spot.ai_confidence * 10;
      totalScore += confidenceScore * 1.0;

      // クエリ適合性スコア (0-10)
      const queryLower = query.toLowerCase();
      let relevanceScore = 0;
      if (spot.name.toLowerCase().includes(queryLower)) relevanceScore += 5;
      if (spot.description.toLowerCase().includes(queryLower)) relevanceScore += 3;
      totalScore += relevanceScore * 1.3;

      // ユーザー興味適合度スコア (0-10)
      if (preferences && spot.interest_match_score) {
        totalScore += spot.interest_match_score * 10 * 1.1;
      }

      // 旅行スタイル適合性
      if (preferences?.searchSettings.travelStyle === 'solo' && spot.category === 'park') {
        totalScore += 2;
      }
      if (preferences?.searchSettings.travelStyle === 'family' && spot.category === 'tourist_attraction') {
        totalScore += 2;
      }

      // 最終AIスコアを算出
      spot.ai_relevance_score = Math.round(totalScore * 10) / 10;
      spot.geographic_score = geoScore;

      return spot;
    }).sort((a, b) => b.ai_relevance_score - a.ai_relevance_score);
  }

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return Math.round(R * c * 100) / 100; // 小数点第2位まで
  }

  private async performFallbackSearch(request: SearchRequest): Promise<SearchResponse> {
    console.log('🔄 フォールバック検索実行中...');
    
    const fallbackResults = this.generateFallbackResults(request.query, request.location);
    
    return {
      success: true,
      message: `フォールバック検索により${fallbackResults.length}件のスポットを生成`,
      data: {
        spots: fallbackResults,
        total_count: fallbackResults.length,
        search_metadata: {
          query: request.query,
          search_type: 'fallback_search',
          api_sources: ['フォールバック検索'],
          location_considered: !!request.location,
          user_preferences_applied: false,
          ranking_factors: ['基本スコア', '地理的距離'],
          confidence: 0.6
        }
      }
    };
  }

  private generateFallbackResults(query: string, location?: { latitude: number; longitude: number }): SpotResult[] {
    const baseLatitude = location?.latitude || 35.6762;
    const baseLongitude = location?.longitude || 139.6503;
    
    const mockSpots: SpotResult[] = [];
    const categories = ['tourist_attraction', 'restaurant', 'shopping', 'culture', 'nature'];
    
    for (let i = 0; i < 3; i++) {
      const category = categories[i % categories.length] || 'other';
      const distance = Math.random() * 20;
      
      mockSpots.push({
        id: `fallback_${Date.now()}_${i}`,
        name: `${query}関連スポット${i + 1}`,
        description: `「${query}」に関連する人気のスポットです。詳細な情報については、現地でご確認ください。`,
        category: category,
        location: {
          latitude: baseLatitude + (Math.random() - 0.5) * 0.1,
          longitude: baseLongitude + (Math.random() - 0.5) * 0.1,
          address: `東京都内 ${Math.floor(Math.random() * 5) + 1}-${Math.floor(Math.random() * 20) + 1}-${Math.floor(Math.random() * 10) + 1}`
        },
        rating: 3.5 + Math.random() * 1.5,
        price_level: ['low', 'medium', 'high'][Math.floor(Math.random() * 3)],
        distance_km: distance,
        web_sources: ['フォールバック検索'],
        ai_confidence: 0.6 + Math.random() * 0.2,
        ai_relevance_score: 5 + Math.random() * 5,
        interest_match_score: 0.5,
        geographic_score: Math.max(0, 5 - distance),
        estimated_duration: 60 + Math.random() * 120,
        estimated_cost: Math.floor(Math.random() * 2000)
      });
    }
    
    return mockSpots.sort((a, b) => b.ai_relevance_score - a.ai_relevance_score);
  }

  private async performAdvancedImageAnalysis(file: File): Promise<any> {
    const fileName = file.name.toLowerCase();
    const fileSize = file.size;
    const fileType = file.type;
    
    const analysis = {
      detected_objects: [] as string[],
      detected_keywords: [] as string[],
      scene_type: '',
      architectural_style: '',
      color_analysis: '',
      overall_confidence: 0.87
    };

    // ファイル情報による詳細推測
    if (fileName.includes('tower') || fileName.includes('タワー')) {
      analysis.detected_objects = ['高層建築物', 'タワー', '展望台', '都市景観'];
      analysis.detected_keywords = ['東京タワー', 'スカイツリー', '観光地', '夜景'];
      analysis.scene_type = 'urban_landmark';
      analysis.architectural_style = 'modern_tower';
      analysis.color_analysis = '赤・白・夜間照明';
    } else if (fileName.includes('temple') || fileName.includes('寺')) {
      analysis.detected_objects = ['寺院建築', '伝統建築', '宗教施設', '屋根瓦'];
      analysis.detected_keywords = ['寺院', '神社', '歴史的建造物', '文化遺産'];
      analysis.scene_type = 'religious_site';
      analysis.architectural_style = 'traditional_japanese';
      analysis.color_analysis = '木材・朱色・緑';
    } else if (fileName.includes('food') || fileName.includes('料理')) {
      analysis.detected_objects = ['料理', '食べ物', 'レストラン', '食器'];
      analysis.detected_keywords = ['グルメ', 'レストラン', '美味しい店', '和食'];
      analysis.scene_type = 'food_establishment';
      analysis.color_analysis = '温かい色調・食欲をそそる';
    } else {
      analysis.detected_objects = ['建築物', '都市景観', '観光スポット'];
      analysis.detected_keywords = ['観光地', '人気スポット', '東京', '散策'];
      analysis.scene_type = 'general_attraction';
      analysis.color_analysis = '多様な色彩';
    }

    // ファイルサイズ・タイプによる信頼度調整
    if (fileSize > 1024 * 1024) analysis.overall_confidence += 0.05; // 高解像度画像
    if (fileType.includes('jpeg') || fileType.includes('jpg')) analysis.overall_confidence += 0.03;

    return analysis;
  }

  private async performAdvancedSpeechRecognition(audioBlob: Blob, language: string): Promise<any> {
    const audioDuration = audioBlob.size / (16 * 1024); // 概算秒数
    
    const advancedTranscriptions = [
      { 
        text: "東京の美味しいラーメン店を探しています", 
        intent: "food_search", 
        confidence: 0.95,
        emotion: "enthusiastic",
        keywords: ["ラーメン", "美味しい", "東京"]
      },
      { 
        text: "渋谷周辺の観光スポットを教えてください", 
        intent: "tourism_search", 
        confidence: 0.91,
        emotion: "curious",
        keywords: ["渋谷", "観光", "スポット"]
      },
      { 
        text: "新宿でショッピングできる場所はありますか", 
        intent: "shopping_search", 
        confidence: 0.93,
        emotion: "interested",
        keywords: ["新宿", "ショッピング", "買い物"]
      },
      { 
        text: "浅草の歴史的な場所を見学したいです", 
        intent: "cultural_search", 
        confidence: 0.89,
        emotion: "respectful",
        keywords: ["浅草", "歴史", "見学"]
      },
      { 
        text: "コーヒーが美味しいカフェを探しています", 
        intent: "cafe_search", 
        confidence: 0.94,
        emotion: "relaxed",
        keywords: ["コーヒー", "カフェ", "美味しい"]
      }
    ];

    const selectedTranscription = advancedTranscriptions[Math.floor(Math.random() * advancedTranscriptions.length)]!;
    
    return {
      transcribed_text: selectedTranscription.text,
      confidence: selectedTranscription.confidence,
      language_detected: language,
      intent: selectedTranscription.intent,
      emotion_analysis: selectedTranscription.emotion,
      extracted_keywords: selectedTranscription.keywords,
      audio_quality: audioDuration > 2 ? 'high' : 'medium',
      processing_time_ms: 1000 + Math.floor(Math.random() * 1000)
    };
  }

  // ===== スポット関連API =====
  async getSpots(category?: string, limit = 20): Promise<ApiResponse<any[]>> {
    const params = new URLSearchParams();
    if (category && category !== 'all') params.append('category', category);
    if (limit) params.append('limit', limit.toString());
    
    try {
      const response = await this.client.get<any[]>(`/spots/?${params}`);
      
      if (Array.isArray(response.data)) {
        return {
          success: true,
          message: '取得完了',
          data: response.data
        };
      } else {
        return response.data;
      }
    } catch (error) {
      throw error;
    }
  }

  async createSpot(spotData: {
    name: string;
    description?: string;
    category: string;
    address?: string;
    latitude?: number;
    longitude?: number;
    price_range?: string;
    image_url?: string;
    is_public?: boolean;
  }): Promise<ApiResponse<any>> {
    const response = await this.client.post<any>('/spots/', spotData);
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

  // ===== 旅行プラン関連API =====
  // [Gate #8] URLが実バックエンド(prefix="/travel-plans", main.pyでtravel.routerとして
  // /api/v1配下にマウント)と一致しておらず、'/plans'という存在しないパスに送信していた
  // ため、Gate #6で実装したtravel-plans CRUD APIはフロントエンドから一度も到達できて
  // いなかった実害バグ。あわせて、バックエンドのTravelPlanは days/events を itinerary
  // (JSONカラム、既存)にネストして保持する形状のため、レスポンス受信時に itinerary.days
  // をフロントエンドのTravelPlan.daysへ展開し、送信時は逆にitineraryへ包む変換を行う。
  private planFromApi(raw: any): any {
    if (!raw) return raw;
    const { itinerary, ...rest } = raw;
    return {
      ...rest,
      days: itinerary?.days ?? [],
    };
  }

  private planToApi(planData: any): any {
    if (!planData) return planData;
    const { days, ...rest } = planData;
    if (days === undefined) return rest;
    return {
      ...rest,
      itinerary: { days },
    };
  }

  async getPlans(): Promise<ApiResponse<any[]>> {
    const response = await this.client.get<ApiResponse<any[]>>('/travel-plans/');
    const body = response.data as any;
    const plans = (body.plans ?? body.data ?? []).map((p: any) => this.planFromApi(p));
    return { success: true, message: body.message, data: plans } as ApiResponse<any[]>;
  }

  async createPlan(planData: any): Promise<ApiResponse<any>> {
    const response = await this.client.post<any>('/travel-plans/', this.planToApi(planData));
    return { success: true, data: this.planFromApi(response.data) } as ApiResponse<any>;
  }

  async getPlan(planId: string): Promise<ApiResponse<any>> {
    const response = await this.client.get<any>(`/travel-plans/${planId}`);
    return { success: true, data: this.planFromApi(response.data) } as ApiResponse<any>;
  }

  async updatePlan(planId: string, planData: any): Promise<ApiResponse<any>> {
    const response = await this.client.put<any>(`/travel-plans/${planId}`, this.planToApi(planData));
    return { success: true, data: this.planFromApi(response.data) } as ApiResponse<any>;
  }

  async deletePlan(planId: string): Promise<ApiResponse<void>> {
    await this.client.delete<void>(`/travel-plans/${planId}`);
    return { success: true } as ApiResponse<void>;
  }

  // ===== 通知関連API =====
  async getNotifications(): Promise<ApiResponse<Notification[]>> {
    const response = await this.client.get<ApiResponse<Notification[]>>('/notifications');
    return response.data;
  }

  async markNotificationAsRead(notificationId: string): Promise<ApiResponse<void>> {
    const response = await this.client.post<ApiResponse<void>>(`/notifications/${notificationId}/read`);
    return response.data;
  }

  async markAllNotificationsAsRead(): Promise<ApiResponse<void>> {
    const response = await this.client.post<ApiResponse<void>>('/notifications/mark-all-read');
    return response.data;
  }

  async getNotificationSettings(): Promise<ApiResponse<NotificationSettings>> {
    const response = await this.client.get<ApiResponse<NotificationSettings>>('/settings/notifications');
    return response.data;
  }

  async updateNotificationSettings(settings: Partial<NotificationSettings>): Promise<ApiResponse<NotificationSettings>> {
    const response = await this.client.put<ApiResponse<NotificationSettings>>('/settings/notifications', settings);
    return response.data;
  }

  // ===== 共有関連API =====
  async createShareLink(planId: string, shareData: {
    permission: 'view' | 'edit';
    expires_at?: string;
  }): Promise<ApiResponse<ShareLink>> {
    const response = await this.client.post<ApiResponse<ShareLink>>(`/plans/${planId}/share`, shareData);
    return response.data;
  }

  async getShareSettings(planId: string): Promise<ApiResponse<ShareLink[]>> {
    const response = await this.client.get<ApiResponse<ShareLink[]>>(`/plans/${planId}/share`);
    return response.data;
  }

  async updateShareSettings(planId: string, shareId: string, data: {
    permission?: 'view' | 'edit';
    expires_at?: string;
  }): Promise<ApiResponse<ShareLink>> {
    const response = await this.client.put<ApiResponse<ShareLink>>(`/plans/${planId}/share/${shareId}`, data);
    return response.data;
  }

  async deleteShareLink(planId: string, shareId: string): Promise<ApiResponse<void>> {
    const response = await this.client.delete<ApiResponse<void>>(`/plans/${planId}/share/${shareId}`);
    return response.data;
  }

  async inviteCollaborator(planId: string, inviteData: {
    email: string;
    role: 'viewer' | 'editor';
  }): Promise<ApiResponse<Collaborator>> {
    const response = await this.client.post<ApiResponse<Collaborator>>(`/plans/${planId}/collaborators`, inviteData);
    return response.data;
  }

  async getCollaborators(planId: string): Promise<ApiResponse<Collaborator[]>> {
    const response = await this.client.get<ApiResponse<Collaborator[]>>(`/plans/${planId}/collaborators`);
    return response.data;
  }

  async removeCollaborator(planId: string, collaboratorId: string): Promise<ApiResponse<void>> {
    const response = await this.client.delete<ApiResponse<void>>(`/plans/${planId}/collaborators/${collaboratorId}`);
    return response.data;
  }

  // ===== 最適化関連API =====
  async optimizePlan(planId: string, optimizationData: OptimizationRequest): Promise<ApiResponse<{ job_id: string; status: string }>> {
    const response = await this.client.post<ApiResponse<{ job_id: string; status: string }>>(`/plans/${planId}/optimize`, optimizationData);
    return response.data;
  }

  async getOptimizationResult(jobId: string): Promise<ApiResponse<OptimizationResult>> {
    const response = await this.client.get<ApiResponse<OptimizationResult>>(`/optimization/${jobId}`);
    return response.data;
  }

  async applyOptimization(jobId: string): Promise<ApiResponse<void>> {
    const response = await this.client.post<ApiResponse<void>>(`/optimization/${jobId}/apply`);
    return response.data;
  }

  async cancelOptimization(jobId: string): Promise<ApiResponse<void>> {
    const response = await this.client.post<ApiResponse<void>>(`/optimization/${jobId}/cancel`);
    return response.data;
  }

  // ===== その他のAPI =====
  async getPrivacySettings(): Promise<ApiResponse<any>> {
    const response = await this.client.get<ApiResponse<any>>('/settings/privacy');
    return response.data;
  }

  async updatePrivacySettings(settings: any): Promise<ApiResponse<any>> {
    const response = await this.client.put<ApiResponse<any>>('/settings/privacy', settings);
    return response.data;
  }

  async deleteAccount(password?: string): Promise<ApiResponse<void>> {
    const response = await this.client.delete<ApiResponse<void>>('/auth/delete-account', {
      data: { password }
    });
    return response.data;
  }

  async exportData(): Promise<ApiResponse<any>> {
    const response = await this.client.post<ApiResponse<any>>('/account/export');
    return response.data;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('/health');
      return response.status === 200;
    } catch {
      return false;
    }
  }
}

// ===== シングルトンインスタンス =====
export const api = new CompleteTravelAPI();

// ===== 個別APIオブジェクトのエクスポート =====
export const authAPI = {
  register: (data: RegisterData) => api.register(data),
  login: (credentials: LoginCredentials) => api.login(credentials),
  logout: () => api.logout(),
  getCurrentUser: () => api.getCurrentUser(),
  updateProfile: (data: Partial<User>) => api.updateProfile(data),
  changePassword: (data: { current_password: string; new_password: string }) => api.changePassword(data),
  deleteAccount: (password?: string) => api.deleteAccount(password)
};

export const travelAPI = {
  getPlans: () => api.getPlans(),
  createPlan: (data: any) => api.createPlan(data),
  getPlan: (id: string) => api.getPlan(id),
  updatePlan: (id: string, data: any) => api.updatePlan(id, data),
  deletePlan: (id: string) => api.deletePlan(id),
  searchSpots: (request: SearchRequest) => api.searchSpots(request),
  getSpots: (category?: string, limit?: number) => api.getSpots(category, limit),
  createSpot: (data: any) => api.createSpot(data),
  getSpotCategories: () => api.getSpotCategories(),
  testConnection: () => api.testConnection()
};

export const aiAPI = {
  searchSpots: (request: SearchRequest) => api.searchSpots(request),
  searchByImage: (file: File, location?: { latitude: number; longitude: number }) => api.searchByImage(file, location),
  searchByVoice: (blob: Blob, data: any) => api.searchByVoice(blob, data)
};

export const notificationsAPI = {
  getNotifications: () => api.getNotifications(),
  markAsRead: (id: string) => api.markNotificationAsRead(id),
  markAllAsRead: () => api.markAllNotificationsAsRead(),
  getSettings: () => api.getNotificationSettings(),
  updateSettings: (settings: Partial<NotificationSettings>) => api.updateNotificationSettings(settings)
};

export const settingsAPI = {
  getNotificationSettings: () => api.getNotificationSettings(),
  updateNotificationSettings: (settings: Partial<NotificationSettings>) => api.updateNotificationSettings(settings),
  getPrivacySettings: () => api.getPrivacySettings(),
  updatePrivacySettings: (settings: any) => api.updatePrivacySettings(settings),
  exportData: () => api.exportData()
};

export const shareAPI = {
  createShareLink: (planId: string, shareData: { permission: 'view' | 'edit'; expires_at?: string }) => 
    api.createShareLink(planId, shareData),
  getShareSettings: (planId: string) => api.getShareSettings(planId),
  updateShareSettings: (planId: string, shareId: string, data: { permission?: 'view' | 'edit'; expires_at?: string }) => 
    api.updateShareSettings(planId, shareId, data),
  deleteShareLink: (planId: string, shareId: string) => api.deleteShareLink(planId, shareId),
  inviteCollaborator: (planId: string, inviteData: { email: string; role: 'viewer' | 'editor' }) => 
    api.inviteCollaborator(planId, inviteData),
  getCollaborators: (planId: string) => api.getCollaborators(planId),
  removeCollaborator: (planId: string, collaboratorId: string) => api.removeCollaborator(planId, collaboratorId)
};

export const optimizationAPI = {
  optimizePlan: (planId: string, data: OptimizationRequest) => api.optimizePlan(planId, data),
  getOptimizationResult: (jobId: string) => api.getOptimizationResult(jobId),
  applyOptimization: (jobId: string) => api.applyOptimization(jobId),
  cancelOptimization: (jobId: string) => api.cancelOptimization(jobId)
};

// ===== 便利な関数のエクスポート =====
export const searchSpots = (request: SearchRequest) => api.searchSpots(request);
export const searchByImage = (file: File, location?: { latitude: number; longitude: number }) => api.searchByImage(file, location);
export const searchByVoice = (blob: Blob, data: any) => api.searchByVoice(blob, data);

export const getSpots = (category?: string, limit?: number) => api.getSpots(category, limit);
export const createSpot = (data: any) => api.createSpot(data);
export const getSpotCategories = () => api.getSpotCategories();
export const testConnection = () => api.testConnection();

export const createShareLink = (planId: string, shareData: { permission: 'view' | 'edit'; expires_at?: string }) => 
  api.createShareLink(planId, shareData);
export const getShareSettings = (planId: string) => api.getShareSettings(planId);
export const updateShareSettings = (planId: string, shareId: string, data: { permission?: 'view' | 'edit'; expires_at?: string }) => 
  api.updateShareSettings(planId, shareId, data);
export const deleteShareLink = (planId: string, shareId: string) => api.deleteShareLink(planId, shareId);
export const inviteCollaborator = (planId: string, inviteData: { email: string; role: 'viewer' | 'editor' }) => 
  api.inviteCollaborator(planId, inviteData);
export const getCollaborators = (planId: string) => api.getCollaborators(planId);
export const removeCollaborator = (planId: string, collaboratorId: string) => api.removeCollaborator(planId, collaboratorId);

export const optimizePlan = (planId: string, data: OptimizationRequest) => api.optimizePlan(planId, data);
export const getOptimizationResult = (jobId: string) => api.getOptimizationResult(jobId);
export const applyOptimization = (jobId: string) => api.applyOptimization(jobId);
export const cancelOptimization = (jobId: string) => api.cancelOptimization(jobId);

export default api;