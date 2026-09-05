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

// [Gate #31.5C] 正規化Plan/Day/Event API (/plans) のレスポンス型
export interface NormalizedEvent {
  id: string;
  day_id: string;
  title: string;
  description?: string | null;
  event_type: string;
  start_at?: string | null;
  end_at?: string | null;
  local_start_time?: string | null;
  is_all_day: boolean;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  locked: boolean;
  sort_order: number;
  place_id?: string | null;
}

export interface NormalizedDay {
  id: string;
  local_date: string;
  timezone_id: string;
  title?: string | null;
  notes?: string | null;
  sort_order: number;
  events?: NormalizedEvent[];
}

export interface NormalizedPlanDetail {
  id: string;
  title: string;
  revision: number;
  days: NormalizedDay[];
}

// [Gate #32] PLAN MAP: route/insertion preview のレスポンス型
export interface LegPreview {
  from_event_id?: string | null;
  to_event_id?: string | null;
  mode: string;
  distance_km?: number | null;
  duration_minutes?: number | null;
  is_estimate: boolean;
  unknown: boolean;
}

export interface RoutePreview {
  day_id: string;
  legs: LegPreview[];
  total_distance_km?: number | null;
  total_duration_minutes?: number | null;
  provider: string;
  algorithm_version: string;
}

export interface InsertionPreview {
  day_id: string;
  before: RoutePreview;
  after: RoutePreview;
  added_distance_km?: number | null;
  added_duration_minutes?: number | null;
  unknown: boolean;
}

// [Gate #33] 説明可能な経路最適化の提案レスポンス型
export interface OptimizationProposal {
  day_id: string;
  base_revision: number;
  algorithm: string;
  algorithm_version: string;
  proposed_order: string[];
  locked_event_ids: string[];
  before_total_distance_km?: number | null;
  after_total_distance_km?: number | null;
  before_total_duration_minutes?: number | null;
  after_total_duration_minutes?: number | null;
  saved_distance_km?: number | null;
  saved_duration_minutes?: number | null;
  warnings: string[];
  has_improvement: boolean;
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

  // [Gate #32] 検索候補(candidate)を正規のPlaceへ採用する(Gate #31
  // /search/candidates/{id}/adopt)。「旅程に追加」フローで、adopt→
  // createEvent(place_id指定)の順に呼ぶ。
  async adoptCandidate(candidateId: string): Promise<{
    id: string; name: string; category?: string;
    location: { latitude?: number; longitude?: number; address?: string };
  }> {
    const response = await this.client.post(`/search/candidates/${candidateId}/adopt`);
    return response.data;
  }

  // [Gate #31.5B] 監査是正: 以前はファイル名の文字列マッチ(「tower」「寺」
  // 等)だけで「AI画像解析により物体を検出した」と称する架空の結果
  // (detected_objects等)を生成していた。実装が存在しないことを正直に
  // 伝え、架空データは一切返さない。実装され次第この関数を差し替える。
  async searchByImage(_file: File, _location?: { latitude: number; longitude: number }): Promise<ApiResponse<any>> {
    return {
      success: false,
      message: 'この機能は現在利用できません(画像からのスポット検索は未実装です)',
      data: { spots: [], total_count: 0, error_code: 'FEATURE_UNAVAILABLE' },
    };
  }

  // [Gate #31.5B] 監査是正: 以前は録音内容を一切解析せず、5つの固定文の
  // 中からMath.random()で1つを選んで「音声認識結果」として返していた
  // (録音内容と無関係な文字起こしがユーザーに表示される実害があった)。
  // 実装が存在しないことを正直に伝え、架空データは一切返さない。
  async searchByVoice(_audioBlob: Blob, _data: {
    location?: { latitude: number; longitude: number };
    language?: string;
    max_results?: number;
  }): Promise<ApiResponse<any>> {
    return {
      success: false,
      message: 'この機能は現在利用できません(音声からのスポット検索は未実装です)',
      data: { spots: [], total_count: 0, error_code: 'FEATURE_UNAVAILABLE' },
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

  // ===== [Gate #31.5C] 正規化Plan/Day/Event API (/plans、Gate #29正本) =====
  // 以前はplanStore.tsが/travel-plans(itinerary JSON一括PUT)のみを使い、
  // Gate #29で実装済みのこのAPI群(day/event単位CRUD・並べ替え・Undo・
  // revision/If-Matchによる楽観的並行制御)には一切接続されていなかった。

  async getPlanDetail(planId: string): Promise<ApiResponse<NormalizedPlanDetail>> {
    const response = await this.client.get<NormalizedPlanDetail>(`/plans/${planId}`);
    return { success: true, data: response.data } as ApiResponse<NormalizedPlanDetail>;
  }

  async createDay(
    planId: string,
    data: { local_date: string; timezone_id?: string; title?: string; notes?: string },
    idempotencyKey: string
  ): Promise<NormalizedDay> {
    const response = await this.client.post<NormalizedDay>(
      `/plans/${planId}/days`, data, { headers: { 'Idempotency-Key': idempotencyKey } }
    );
    return response.data;
  }

  async updateDay(
    planId: string, dayId: string,
    data: { title?: string; notes?: string; sort_order?: number },
    ifMatch: number
  ): Promise<NormalizedDay> {
    const response = await this.client.put<NormalizedDay>(
      `/plans/${planId}/days/${dayId}`, data, { headers: { 'If-Match': String(ifMatch) } }
    );
    return response.data;
  }

  async deleteDay(planId: string, dayId: string, ifMatch: number): Promise<{ revision: number }> {
    const response = await this.client.delete<{ revision: number }>(
      `/plans/${planId}/days/${dayId}`, { headers: { 'If-Match': String(ifMatch) } }
    );
    return response.data;
  }

  async createEvent(
    planId: string,
    data: {
      day_id: string; title: string; description?: string; event_type?: string;
      local_start_time?: string; address?: string; latitude?: number; longitude?: number;
      place_id?: string;
    },
    idempotencyKey: string
  ): Promise<NormalizedEvent> {
    const response = await this.client.post<NormalizedEvent>(
      `/plans/${planId}/events`, data, { headers: { 'Idempotency-Key': idempotencyKey } }
    );
    return response.data;
  }

  async updateEvent(
    planId: string, eventId: string,
    data: Partial<{
      title: string; description: string; event_type: string; local_start_time: string;
      address: string; latitude: number; longitude: number; locked: boolean;
    }>,
    ifMatch: number
  ): Promise<NormalizedEvent> {
    const response = await this.client.put<NormalizedEvent>(
      `/plans/${planId}/events/${eventId}`, data, { headers: { 'If-Match': String(ifMatch) } }
    );
    return response.data;
  }

  async deleteEvent(planId: string, eventId: string, ifMatch: number): Promise<{ revision: number }> {
    const response = await this.client.delete<{ revision: number }>(
      `/plans/${planId}/events/${eventId}`, { headers: { 'If-Match': String(ifMatch) } }
    );
    return response.data;
  }

  async moveEvent(
    planId: string, eventId: string,
    data: { day_id?: string; sort_order: number },
    ifMatch: number, idempotencyKey: string
  ): Promise<NormalizedEvent> {
    const response = await this.client.post<NormalizedEvent>(
      `/plans/${planId}/events/${eventId}/move`, data,
      { headers: { 'If-Match': String(ifMatch), 'Idempotency-Key': idempotencyKey } }
    );
    return response.data;
  }

  async undoLastPlanChange(planId: string, ifMatch: number): Promise<{ revision: number }> {
    const response = await this.client.post<{ revision: number }>(
      `/plans/${planId}/undo`, {}, { headers: { 'If-Match': String(ifMatch) } }
    );
    return response.data;
  }

  // ===== [Gate #32] PLAN MAP: route/insertion preview =====
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

  // ===== [Gate #33] 説明可能な経路最適化(提案・適用) =====
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