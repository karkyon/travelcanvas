/**
 * APIクライアントの基盤(axiosインスタンス・認証トークン・インターセプター・共通エラー処理)。
 *
 * [Gate M9-FE-C2a] 旧services/api.ts(約92KB・単一ファイル)を責務別に分割したもの。定義本体は分割前から変更していない。
 * 各エンドポイント群は endpoints/*.ts で本クラスを継承して追加する
 * (mixinは`new (...args: any[])`が必須でno-explicit-anyに抵触するため、単純な継承チェーンとした)。
 * ドメイン側から使う client / setTokens / clearTokens は private→protected に変更したのみ。
 */
import axios, { AxiosInstance, AxiosResponse, AxiosError, AxiosRequestConfig } from 'axios';
import { toast } from 'react-hot-toast';
import type { MinimalHttpClient } from './types';

// [Gate M9-FE-A2] handleApiError()のdefault caseが読む可能性のある
// エラーレスポンス本文の形状。backendは複数の形式(自前のApiResponse形式・
// FastAPI標準のRequestValidationError形式)を返し得るため、いずれの
// フィールドも省略可能として扱う。
interface ApiErrorResponseBody {
  message?: string;
  error?: { message?: string };
  detail?: unknown;
}

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

export const API_BASE_URL = resolveApiBaseUrl();

// [Gate M10-R2 P1] handleApiError()のdefault caseは以前
// `apiError.detail`が存在すればそのままmessageへ代入していた。しかし
// FastAPIが標準のRequestValidationError(422)を返した場合、`detail`は
// 文字列ではなく`{type, loc, msg, input, ctx, url}`形状のオブジェクトの
// 配列になる(アプリ独自のエラーレスポンス形式ではなくFastAPI標準形式)。
// この非文字列値がそのままtoast.error()へ渡され、react-hot-toastが
// それを直接childとしてレンダーしようとして
// 「Objects are not valid as a React child」(React最小化エラー#31)で
// アプリ全体がクラッシュしていた(Gate M10-R2 backend route shadowing
// バグの発見時に実機で確認)。detailの形状を判定し、必ず文字列を返す
// ようにする。
export function extractApiErrorDetailMessage(detail: unknown): string | null {
  if (detail == null) return null;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'msg' in item) {
          const msg = (item as { msg?: unknown }).msg;
          return typeof msg === 'string' ? msg : null;
        }
        return null;
      })
      .filter((s): s is string => !!s);
    return parts.length > 0 ? parts.join(' / ') : null;
  }
  if (typeof detail === 'object' && 'msg' in (detail as Record<string, unknown>)) {
    const msg = (detail as { msg?: unknown }).msg;
    return typeof msg === 'string' ? msg : null;
  }
  return null;
}

export class ApiCore {
  protected client: AxiosInstance;
  private accessToken: string | null = null;
  // [Gate R2-8] ゲストセッション判定。authStore.tsのisGuestと同期して
  // 保持し、会員限定APIへの401時に「実質的な403」として静かに失敗させる
  // (トークンrefresh試行・強制ログアウトリダイレクトを行わない)ために使う。
  // 個々のコンポーネント側のisGuestガード漏れがあっても、この層で
  // 強制リロードループを起こさないための多層防御。
  private isGuestSession: boolean = false;

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

  // [Gate #7j] AdminUsers.tsx/AdminDashboard.tsxがapi.get/post等を直接呼び出していたが
  // CompleteTravelAPIには存在しなかった(コンパイルエラーの原因)。this.clientはprivateのため、
  // 個別の名前付きメソッドが用意されていないエンドポイント向けの薄い汎用ラッパーを公開する。
  // 注意: /admin/* 系エンドポイントはバックエンド未実装(2026-09-02時点で backend/app/api/ に
  // admin関連ルーターが存在しないことを確認済み)。呼び出し自体はコンパイル可能になるが、
  // 実行時は404になる。管理画面機能を実際に動作させるにはバックエンドAPI実装が別途必要。
  async get<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.client.get<T>(url, config);
  }

  async post<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.client.post<T>(url, data, config);
  }

  async put<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.client.put<T>(url, data, config);
  }

  async delete<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.client.delete<T>(url, config);
  }

  // [Gate M9-FE-A2] テスト専用の型付きシーム。以前は単体テストが
  // `(api as any).client = {...}` でprivate clientを直接`any`キャストして
  // 丸ごと差し替えており、モック関数の引数型が一切検査されていなかった。
  // MinimalHttpClient(の部分集合)という明示的な型を受け取るこの
  // メソッドを経由させることで、テストダブルの形状をコンパイル時に検証
  // できるようにする。本番コードから呼ばれることはない。
  setHttpClientForTesting(client: Partial<MinimalHttpClient>): void {
    this.client = client as AxiosInstance;
  }

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
          this.accessToken && // トークンを一度も持ったことが無ければログイン画面へ委ねる
          !this.isGuestSession // [Gate R2-8] guestはrefresh cookieを持たないため
          // refreshは常に失敗する。無駄なリクエストと、その失敗が結局
          // handleApiErrorの強制リダイレクトへ繋がることを避けるため
          // refresh自体を試みない。
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

  protected setTokens(accessToken: string): void {
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

  // [Gate R2-8] authStore.tsのisGuest変更(guestログイン成功/member昇格/
  // 通常ログイン/ログアウト)と同期して呼び出す。会員限定APIへの401を
  // 「実質403」として扱うかどうかの判定に使う。
  setGuestMode(isGuest: boolean): void {
    this.isGuestSession = isGuest;
  }

  protected clearTokens(): void {
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
          // [Gate R2-8] ゲストセッション中の401は「会員限定機能への
          // アクセス」である可能性が高く、資格情報が実際に無効という
          // ケースとは区別する。従来はゲストでも一律にclearTokens()+
          // 強制`/login`リダイレクトを行っており、ゲストが会員限定APIを
          // (isGuestガード漏れ等で)呼んだ場合に強制ログアウトループが
          // 発生する実害バグがあった(Gate R2-6で発見、個別effect側は
          // 是正済みだが、本ハンドラ自体はその場しのぎの対症療法だった)。
          // ゲストの場合はトークンを消さず、リダイレクトもせず、通常の
          // エラーとして呼び出し元へ返すだけに留める(呼び出し元が
          // catchしなければコンソールにエラーが出るのみで、UIの強制遷移
          // は起きない)。
          if (this.isGuestSession) {
            message = 'この操作にはログインが必要です。';
            break;
          }
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
            const apiError = error.response.data as ApiErrorResponseBody;
            if (typeof apiError.message === 'string') message = apiError.message;
            else {
              const detailMessage = extractApiErrorDetailMessage(apiError.detail);
              if (detailMessage) message = detailMessage;
              else if (typeof apiError.error?.message === 'string') message = apiError.error.message;
            }
          }
      }
    } else if (error.code === 'NETWORK_ERROR' || error.code === 'ERR_NETWORK') {
      message = 'ネットワークエラーが発生しました。接続を確認してください。';
    } else if (error.code === 'ECONNABORTED') {
      message = 'リクエストがタイムアウトしました。';
    }

    toast.error(message);
  }
}
