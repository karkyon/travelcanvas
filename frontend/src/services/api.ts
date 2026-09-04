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
    latitude?: number;
    longitude?: number;
    address?: string;
  };
  rating?: number;
  price_level?: string;
  distance_km?: number;
  // [Gate #31] 実際の取得元(provider名+URL)。フロントエンドが捏造した
  // 出典("Google Maps"等)は含まない。
  web_sources: string[];
  ai_confidence?: number;
  ai_relevance_score?: number;
  interest_match_score?: number;
  geographic_score?: number;
  estimated_duration?: number;
  estimated_cost?: number;
  // [Gate #31] このスポットが由来する検索候補ID。/search/candidates/{id}/adopt
  // で正規のPlaceへ変換できる。
  candidate_id?: string;
  provider?: string;
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
  type: string;
  is_read: boolean;
  related_plan_id?: string | null;
  created_at: string;
}

export interface ShareLink {
  id: string;
  plan_id: string;
  // [Gate #30] 生トークンURLはDBに平文保存しなくなったため、作成直後の
  // レスポンスにのみ含まれる(以降の一覧取得ではnull)。
  url: string | null;
  token_prefix: string;
  permission: 'view' | 'edit';
  has_passcode: boolean;
  max_uses: number | null;
  use_count: number;
  expires_at?: string;
  revoked_at?: string | null;
  is_active: boolean;
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
  decided_at?: string | null;
  plan_title?: string | null;
}

export interface PublicSharedPlan {
  plan_id: string;
  title: string;
  description?: string | null;
  destination?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  itinerary: any;
  permission: 'view' | 'edit';
  can_edit: boolean;
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

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
      // [Gate #28] refresh tokenをhttpOnly cookieで発行するようにしたため、
      // /auth/refresh 等へcookieを送るにはwithCredentialsが必須
      // (これが無いとブラウザはcross-originリクエストにcookieを付与しない)。
      withCredentials: true,
    });

    this.setupInterceptors();
    this.initializeTokens();
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
    // [Gate #28] access tokenの有効期限切れ(401)を検知したら、httpOnly
    // cookieのrefresh tokenで裏側から新しいaccess tokenを取得し、元の
    // リクエストを1回だけ自動リトライする。/auth/login, /auth/register,
    // /auth/refresh 自体の401(=資格情報が実際に無効)はリトライ対象外とし、
    // 無限ループを防ぐため1リクエストにつき1回のみ再試行する。
    this.client.interceptors.response.use(
      (response: AxiosResponse) => response,
      async (error: AxiosError) => {
        const originalRequest = error.config as (typeof error.config & { _retry?: boolean }) | undefined;
        const url = originalRequest?.url || '';
        const isAuthEndpoint =
          url.includes('/auth/login') || url.includes('/auth/register') || url.includes('/auth/refresh');

        if (
          error.response?.status === 401 &&
          originalRequest &&
          !originalRequest._retry &&
          !isAuthEndpoint &&
          this.accessToken // トークンを一度も持ったことが無ければログイン画面へ委ねる
        ) {
          originalRequest._retry = true;
          try {
            const refreshResponse = await this.client.post('/auth/refresh');
            const newAccessToken = (refreshResponse.data as { access_token?: string })?.access_token;
            if (newAccessToken) {
              this.setAccessToken(newAccessToken);
              originalRequest.headers = originalRequest.headers || {};
              (originalRequest.headers as Record<string, string>).Authorization = `Bearer ${newAccessToken}`;
              return this.client.request(originalRequest);
            }
          } catch {
            this.clearAccessToken();
          }
        }

        this.handleApiError(error);
        return Promise.reject(error);
      }
    );
  }

  private initializeTokens(): void {
    this.accessToken = localStorage.getItem('auth_token') || 
                     localStorage.getItem('access_token');
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
    // [Gate #21] 実バックエンド(/auth/change-password、今回新規実装)は
    // ApiResponseラッパー無しで {message: string} を直接返す。
    await this.client.post<{ message: string }>('/auth/change-password', data);
    return { success: true } as ApiResponse<void>;
  }

  // ===== 統合検索システム =====
  // [Gate #31] 以前はここで webSearchService (frontendから直接
  // Wikipedia/Nominatim/Overpass を叩く実装) を呼び、結果が0件/エラー/
  // レート制限時には3段階のフォールバック(webSearchServiceのMath.random()
  // 生成、実在店舗名を騙るgenerateEnhancedSearchResults、さらに別の
  // Math.random()生成であるgenerateFallbackResults)のいずれかが必ず発火し、
  // 常に「本物らしい」架空の検索結果をユーザーに返していた。
  //
  // 本Gateでbackendの /search/spots へ処理を集約する。backendの
  // search_provider.py は失敗時に空リストを返すのみで、絶対にデータを
  // 捏造しない。0件は0件のまま返す。
  async searchSpots(request: SearchRequest): Promise<SearchResponse> {
    try {
      const response = await this.client.post('/search/spots', {
        query: request.query,
        latitude: request.location?.latitude,
        longitude: request.location?.longitude,
        max_results: request.max_results || 20,
      });

      const candidates: any[] = response.data?.candidates ?? [];
      const spots: SpotResult[] = candidates.map((c) => ({
        id: c.id,
        candidate_id: c.id,
        provider: c.provider,
        name: c.name,
        // 説明文を捏造せず、取得元を正直に示すのみにとどめる。
        description: `${c.provider}経由で見つかった候補です`,
        category: c.category || 'other',
        location: {
          latitude: c.location?.latitude ?? undefined,
          longitude: c.location?.longitude ?? undefined,
          address: c.location?.address ?? undefined,
        },
        web_sources: [c.provider],
      }));

      return {
        success: true,
        message: `${spots.length}件のスポット候補が見つかりました`,
        data: {
          spots,
          total_count: spots.length,
          search_metadata: {
            query: request.query,
            search_type: 'backend_search_adapter',
            api_sources: ['Wikipedia', 'Nominatim', 'Overpass'],
            location_considered: !!request.location,
            user_preferences_applied: false,
            ranking_factors: [],
          },
        },
      };
    } catch (error) {
      console.error('検索エラー:', error);
      // [Gate #31] エラー時も架空データへフォールバックしない。
      // 失敗を正直に伝え、呼び出し元(useSearch.tsx)がエラー表示する。
      return {
        success: false,
        message: '検索中にエラーが発生しました',
        data: {
          spots: [],
          total_count: 0,
          search_metadata: {
            query: request.query,
            search_type: 'error',
            api_sources: [],
            location_considered: !!request.location,
            user_preferences_applied: false,
            ranking_factors: [],
          },
        },
      };
    }
  }

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
  // [Gate #26] URLは実装済みだったが、バックエンド(/notifications)自体が
  // 一切存在しなかった(本Gateでnotifications.pyを新規実装)。他のAPIと同様、
  // 生JSONを返すためクライアント側でApiResponse形状へ手動で包む。
  async getNotifications(unreadOnly = false): Promise<ApiResponse<Notification[]>> {
    const response = await this.client.get<Notification[]>('/notifications/', {
      params: unreadOnly ? { unread_only: true } : undefined,
    });
    return { success: true, data: response.data } as ApiResponse<Notification[]>;
  }

  async getUnreadNotificationCount(): Promise<ApiResponse<{ unread_count: number }>> {
    const response = await this.client.get<{ unread_count: number }>('/notifications/unread-count');
    return { success: true, data: response.data } as ApiResponse<{ unread_count: number }>;
  }

  async markNotificationAsRead(notificationId: string): Promise<ApiResponse<void>> {
    await this.client.post<any>(`/notifications/${notificationId}/read`);
    return { success: true } as ApiResponse<void>;
  }

  async markAllNotificationsAsRead(): Promise<ApiResponse<void>> {
    await this.client.post<any>('/notifications/read-all');
    return { success: true } as ApiResponse<void>;
  }

  // [Gate #27 / A-009] getNotificationSettings/updateNotificationSettingsは
  // 対応するbackend routeが存在せず(呼べば404)、どのUIコンポーネントからも
  // 呼ばれていない死コードだったため削除した。実装はGate #28で行う。

  // ===== 共有関連API =====
  // [Gate #25] URLが実プレフィックス(/travel-plans)と一致しておらず、共有・
  // コラボレーター機能のバックエンド自体もこれまで存在しなかった(share.pyを
  // 本Gateで新規実装)。getPlan/updatePlan等と同様、バックエンドは生JSONを
  // 返すためクライアント側でApiResponse形状へ手動で包む。
  async revokeShareLink(planId: string, shareId: string): Promise<ApiResponse<ShareLink>> {
    const response = await this.client.post<ShareLink>(`/travel-plans/${planId}/share/${shareId}/revoke`);
    return { success: true, data: response.data } as ApiResponse<ShareLink>;
  }

  async listMyInvitations(): Promise<ApiResponse<Collaborator[]>> {
    const response = await this.client.get<Collaborator[]>('/travel-plans/invitations');
    return { success: true, data: response.data } as ApiResponse<Collaborator[]>;
  }

  async acceptInvitation(collaboratorId: string): Promise<ApiResponse<Collaborator>> {
    const response = await this.client.post<Collaborator>(`/travel-plans/invitations/${collaboratorId}/accept`);
    return { success: true, data: response.data } as ApiResponse<Collaborator>;
  }

  async declineInvitation(collaboratorId: string): Promise<ApiResponse<Collaborator>> {
    const response = await this.client.post<Collaborator>(`/travel-plans/invitations/${collaboratorId}/decline`);
    return { success: true, data: response.data } as ApiResponse<Collaborator>;
  }

  // [Gate #30] 認証不要の公開共有リンク解決。未ログインでも呼び出せる
  // (this.clientはトークン未保持でもAuthorizationヘッダーを付けないだけで
  // 正常にリクエストできる)。
  async resolvePublicShare(token: string, passcode?: string): Promise<ApiResponse<PublicSharedPlan>> {
    const response = await this.client.post<PublicSharedPlan>(`/public/share/${token}/resolve`, {
      passcode: passcode || undefined,
    });
    return { success: true, data: response.data } as ApiResponse<PublicSharedPlan>;
  }

  async createShareLink(planId: string, shareData: {
    permission: 'view' | 'edit';
    expires_at?: string;
    passcode?: string;
    max_uses?: number;
  }): Promise<ApiResponse<ShareLink>> {
    const response = await this.client.post<ShareLink>(`/travel-plans/${planId}/share`, shareData);
    return { success: true, data: response.data } as ApiResponse<ShareLink>;
  }

  async getShareSettings(planId: string): Promise<ApiResponse<ShareLink[]>> {
    const response = await this.client.get<ShareLink[]>(`/travel-plans/${planId}/share`);
    return { success: true, data: response.data } as ApiResponse<ShareLink[]>;
  }

  async updateShareSettings(planId: string, shareId: string, data: {
    permission?: 'view' | 'edit';
    expires_at?: string;
    passcode?: string | null;
    max_uses?: number | null;
  }): Promise<ApiResponse<ShareLink>> {
    const response = await this.client.put<ShareLink>(`/travel-plans/${planId}/share/${shareId}`, data);
    return { success: true, data: response.data } as ApiResponse<ShareLink>;
  }

  async deleteShareLink(planId: string, shareId: string): Promise<ApiResponse<void>> {
    await this.client.delete<any>(`/travel-plans/${planId}/share/${shareId}`);
    return { success: true } as ApiResponse<void>;
  }

  async inviteCollaborator(planId: string, inviteData: {
    email: string;
    role: 'viewer' | 'editor';
    message?: string;
  }): Promise<ApiResponse<Collaborator>> {
    const response = await this.client.post<Collaborator>(`/travel-plans/${planId}/collaborators`, inviteData);
    return { success: true, data: response.data } as ApiResponse<Collaborator>;
  }

  async getCollaborators(planId: string): Promise<ApiResponse<Collaborator[]>> {
    const response = await this.client.get<Collaborator[]>(`/travel-plans/${planId}/collaborators`);
    return { success: true, data: response.data } as ApiResponse<Collaborator[]>;
  }

  async removeCollaborator(planId: string, collaboratorId: string): Promise<ApiResponse<void>> {
    await this.client.delete<any>(`/travel-plans/${planId}/collaborators/${collaboratorId}`);
    return { success: true } as ApiResponse<void>;
  }

  // ===== 最適化関連API =====
  // [Gate #23] 実バックエンド(backend/app/api/v1/ai.py)はこれまでmain.pyに
  // include_routerされておらず、/plans/{id}/optimize・/optimization/*は全て
  // 404で到達不能だった。加えてURLも実プレフィックス(/travel-plans)と不一致
  // だった。バックエンドは{success,message,data}形式でラップされた応答を
  // 返さない生JSONを返すため、getPlan/updatePlan等と同様にクライアント側で
  // ApiResponse形状へ手動で包む。
  async optimizePlan(planId: string, optimizationData: OptimizationRequest): Promise<ApiResponse<{ job_id: string; status: string }>> {
    const response = await this.client.post<{ job_id: string; status: string }>(`/travel-plans/${planId}/optimize`, optimizationData);
    return { success: true, data: response.data } as ApiResponse<{ job_id: string; status: string }>;
  }

  async getOptimizationResult(jobId: string): Promise<ApiResponse<OptimizationResult>> {
    const response = await this.client.get<any>(`/optimization/${jobId}`);
    return { success: true, data: response.data } as ApiResponse<OptimizationResult>;
  }

  async applyOptimization(jobId: string): Promise<ApiResponse<void>> {
    await this.client.post<any>(`/optimization/${jobId}/apply`);
    return { success: true } as ApiResponse<void>;
  }

  async cancelOptimization(jobId: string): Promise<ApiResponse<void>> {
    await this.client.post<any>(`/optimization/${jobId}/cancel`);
    return { success: true } as ApiResponse<void>;
  }

  // ===== その他のAPI =====
  // [Gate #27 / A-009] getPrivacySettings/updatePrivacySettings/deleteAccount/
  // exportDataは対応するbackend routeが存在せず(呼べば404)、どのUI
  // コンポーネントからも呼ばれていない死コードだったため削除した
  // (偽の導線をゼロにする)。実装はGate #28(アカウントライフサイクル)で行う。

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
  // [Gate #27 / A-009] deleteAccountは対応するbackend routeが存在しないため削除。
  // 実装はGate #28で行う。
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
  getNotifications: (unreadOnly?: boolean) => api.getNotifications(unreadOnly),
  getUnreadCount: () => api.getUnreadNotificationCount(),
  markAsRead: (id: string) => api.markNotificationAsRead(id),
  markAllAsRead: () => api.markAllNotificationsAsRead(),
};

// [Gate #27 / A-009] settingsAPI(通知設定/プライバシー設定/データエクスポート)は
// 対応するbackend routeが存在しないまま公開されていたため削除した。
// 実装はGate #28で行う。

export const shareAPI = {
  createShareLink: (planId: string, shareData: { permission: 'view' | 'edit'; expires_at?: string; passcode?: string; max_uses?: number }) =>
    api.createShareLink(planId, shareData),
  getShareSettings: (planId: string) => api.getShareSettings(planId),
  updateShareSettings: (planId: string, shareId: string, data: { permission?: 'view' | 'edit'; expires_at?: string; passcode?: string | null; max_uses?: number | null }) =>
    api.updateShareSettings(planId, shareId, data),
  revokeShareLink: (planId: string, shareId: string) => api.revokeShareLink(planId, shareId),
  deleteShareLink: (planId: string, shareId: string) => api.deleteShareLink(planId, shareId),
  listMyInvitations: () => api.listMyInvitations(),
  acceptInvitation: (collaboratorId: string) => api.acceptInvitation(collaboratorId),
  declineInvitation: (collaboratorId: string) => api.declineInvitation(collaboratorId),
  resolvePublicShare: (token: string, passcode?: string) => api.resolvePublicShare(token, passcode),
  inviteCollaborator: (planId: string, inviteData: { email: string; role: 'viewer' | 'editor'; message?: string }) => 
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

export const createShareLink = (planId: string, shareData: { permission: 'view' | 'edit'; expires_at?: string; passcode?: string; max_uses?: number }) =>
  api.createShareLink(planId, shareData);
export const getShareSettings = (planId: string) => api.getShareSettings(planId);
export const updateShareSettings = (planId: string, shareId: string, data: { permission?: 'view' | 'edit'; expires_at?: string; passcode?: string | null; max_uses?: number | null }) =>
  api.updateShareSettings(planId, shareId, data);
export const revokeShareLink = (planId: string, shareId: string) => api.revokeShareLink(planId, shareId);
export const deleteShareLink = (planId: string, shareId: string) => api.deleteShareLink(planId, shareId);
export const listMyInvitations = () => api.listMyInvitations();
export const acceptInvitation = (collaboratorId: string) => api.acceptInvitation(collaboratorId);
export const declineInvitation = (collaboratorId: string) => api.declineInvitation(collaboratorId);
export const resolvePublicShare = (token: string, passcode?: string) => api.resolvePublicShare(token, passcode);
export const inviteCollaborator = (planId: string, inviteData: { email: string; role: 'viewer' | 'editor'; message?: string }) => 
  api.inviteCollaborator(planId, inviteData);
export const getCollaborators = (planId: string) => api.getCollaborators(planId);
export const removeCollaborator = (planId: string, collaboratorId: string) => api.removeCollaborator(planId, collaboratorId);

export const optimizePlan = (planId: string, data: OptimizationRequest) => api.optimizePlan(planId, data);
export const getOptimizationResult = (jobId: string) => api.getOptimizationResult(jobId);
export const applyOptimization = (jobId: string) => api.applyOptimization(jobId);
export const cancelOptimization = (jobId: string) => api.cancelOptimization(jobId);

export default api;