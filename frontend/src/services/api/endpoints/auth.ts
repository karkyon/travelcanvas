/**
 * 認証(/auth/*)
 *
 * [Gate M9-FE-C2a] 旧services/api.ts(約92KB・単一ファイル)を責務別に分割したもの。
 *
 * [Gate A1] 認証処理をこのAPIクライアントへ一本化した(B-002)。
 * - 以前の register/login は backend に存在しない `{success, data: {token}}` 形状を
 *   前提にした死んだ実装で、authStore は独自の fetch() で /auth/* を呼んでいた
 *   (decoder・interceptor・共通のbaseURL解決を一切通っていなかった)。
 * - login/register/startGuestSession/upgradeGuest は実backendの応答
 *   (TokenResponse / GuestSessionResponse)を decoder で検証して返す。
 * - トークンの保持(setAccessToken/setGuestMode)は呼び出し元の authStore が一元的に行う。
 *   ここでは副作用を持たない(二重管理によるトークン不一致を避けるため)。
 * - 認証系は呼び出し元が自分でエラーを表示するため、共通エラー処理(toast・/loginへの
 *   強制遷移)を通さず、失敗は AuthApiError(画面表示用メッセージとHTTPステータスのみ)で投げる。
 *   axiosのエラーには送信したパスワードを含むリクエスト設定が入っているため、
 *   それを画面側のconsole出力へ渡さないという意味もある。
 */
import axios, { type AxiosRequestConfig } from 'axios';
import type { User } from '@/types';
import { ApiCore, extractApiErrorDetailMessage } from '../core';
import type {
  ApiResponse, AuthResponse, GuestSessionResponse, GuestUpgradeData, LoginCredentials, RegisterData,
} from '../types';
import { apiOk, apiOkVoid } from '../response';
import { ApiDecodeError, decodeResponse } from '../decode';
import { authResponse, guestSessionResponse, user } from '../decoders';

/** 認証APIの失敗。messageはそのまま画面に表示してよい文言、statusはHTTPステータス(通信失敗時はnull)。 */
export class AuthApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = 'AuthApiError';
    this.status = status;
  }
}

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };

/**
 * 認証APIの例外を、画面表示用の文言を持つ AuthApiError へ変換する。
 * backendの detail は文字列(400/401/429)または FastAPI標準の検証エラー配列(422)のどちらも取り得る。
 * 以前のauthStoreは `new Error(errorData.detail)` としていたため、422では画面に
 * "[object Object]" と表示されていた。
 */
export function toAuthApiError(error: unknown, fallback: string): Error {
  if (error instanceof AuthApiError || error instanceof ApiDecodeError) return error;
  if (axios.isAxiosError(error)) {
    const status = error.response?.status ?? null;
    if (status === null) {
      if (error.code === 'ECONNABORTED') return new AuthApiError('リクエストがタイムアウトしました。', null);
      return new AuthApiError('ネットワークエラーが発生しました。接続を確認してください。', null);
    }
    const body = error.response?.data as { detail?: unknown; message?: unknown } | undefined;
    const detail = extractApiErrorDetailMessage(body?.detail);
    const message = detail ?? (typeof body?.message === 'string' ? body.message : null);
    return new AuthApiError(message ?? `${fallback}(HTTP ${status})`, status);
  }
  return new AuthApiError(fallback, null);
}

export class AuthApi extends ApiCore {
  async register(data: RegisterData): Promise<AuthResponse> {
    try {
      const response = await this.client.post('/auth/register', data, SILENT);
      return decodeResponse(response.data, authResponse, 'POST /auth/register');
    } catch (error) {
      throw toAuthApiError(error, '登録に失敗しました');
    }
  }

  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    try {
      const response = await this.client.post('/auth/login', credentials, SILENT);
      return decodeResponse(response.data, authResponse, 'POST /auth/login');
    } catch (error) {
      throw toAuthApiError(error, 'ログインに失敗しました');
    }
  }

  /** [Gate A1] POST /auth/guest。ログイン不要のゲストセッションを発行する。 */
  async startGuestSession(): Promise<GuestSessionResponse> {
    try {
      const response = await this.client.post('/auth/guest', undefined, SILENT);
      return decodeResponse(response.data, guestSessionResponse, 'POST /auth/guest');
    } catch (error) {
      throw toAuthApiError(error, 'ゲストセッションの開始に失敗しました');
    }
  }

  /**
   * [Gate A1] POST /auth/guest/upgrade。ゲストを正式アカウントへその場で昇格する。
   * backendはAuthorizationのゲストトークンで昇格対象を特定するため、明示的に付与する
   * (共通interceptorが保持中のトークンで上書きするが、同じゲストトークンである)。
   */
  async upgradeGuest(data: GuestUpgradeData, guestToken: string): Promise<AuthResponse> {
    try {
      const response = await this.client.post('/auth/guest/upgrade', data, {
        ...SILENT,
        headers: { Authorization: `Bearer ${guestToken}` },
      });
      return decodeResponse(response.data, authResponse, 'POST /auth/guest/upgrade');
    } catch (error) {
      throw toAuthApiError(error, 'アカウント登録に失敗しました');
    }
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
  // [Gate A1] silent指定時は共通エラー処理(toast・/loginへの強制遷移)を行わない
  // (authStore.checkAuthがセッション確認に使い、失敗時の扱いを自分で決めるため)。
  async getCurrentUser(options?: { silent?: boolean }): Promise<ApiResponse<User>> {
    const response = await this.client.get('/auth/me', options?.silent ? SILENT : undefined);
    return apiOk<User>(decodeResponse(response.data, user, 'GET /auth/me'));
  }

  async updateProfile(data: Partial<User>): Promise<ApiResponse<User>> {
    const response = await this.client.put('/auth/me', data);
    return apiOk<User>(decodeResponse(response.data, user, 'PUT /auth/me'));
  }

  async changePassword(data: {
    current_password: string;
    new_password: string;
  }): Promise<ApiResponse<void>> {
    // [Gate #21] 実バックエンド(/auth/change-password、今回新規実装)は
    // ApiResponseラッパー無しで {message: string} を直接返す。
    await this.client.post<{ message: string }>('/auth/change-password', data);
    return apiOkVoid();
  }
}
