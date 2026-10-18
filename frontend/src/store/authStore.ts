import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api as apiService, AuthApiError } from '@/services/api';
import type { SessionUser } from '@/services/api';
import { forgetOfflineKeys } from '@/utils/offlineVault';

// [Gate A1] 認証処理をAPIクライアント(services/api)へ一本化した(B-002)。
// 以前はこのファイルが独自のfetch()とAPI_BASE_URL解決を持ち、login/register/guest/
// guest-upgrade/meの応答を検証せずに状態へ入れていた(decoder・interceptorを通らない)。
// 通信・応答検証・エラー文言の生成はservices/api/endpoints/auth.tsが担い、
// このstoreは状態とトークン同期(apiService.setAccessToken/setGuestMode)だけを担う。
// あわせて、アクセストークンを含む応答全体やメールアドレスをconsoleへ出力していた
// ログを削除した(ブラウザの開発者ツールや収集されたログからトークンが漏れるため)。

// [Gate #7j] authStore独自のローカルUser型(id: number)がバックエンドの
// UUID移行(Gate #5)に追従できておらず放置されていた実害バグ。
// [Gate A1] login/register直後はbackend UserResponse(is_active/created_at無し)、
// GET /auth/me後はUserの全項目を持つため、両方を表すSessionUserとする。

// [Gate S5] F15 会員のアクセストークンは端末(localStorage)に保存しない。メモリだけに持ち、再読込では
// cookie(httpOnly。スクリプトから読めない)の更新鍵で取り直す(POST /auth/refresh)。
// - 通信できない時(旅先でのオフライン)は、ログイン中の表示とオフラインデータはそのまま使える(トークン無し)。
//   通信が戻って API が 401 になった時に、APIクライアントが cookie で取り直す。
// - cookie のログインが切れていた(401)時だけ、ログアウトした状態にする。
// ゲストには cookie の更新鍵が無いため、ゲストのトークンだけは従来どおり端末に保存する(権限は自分のゲストのデータだけ)。

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

interface AuthState {
  user: SessionUser | null;
  /** 会員のアクセストークン(メモリだけ。保存しない) */
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;
  // [Gate #35] Guest Travel View。登録ユーザーのuser/tokenとは別枠で保持する。
  // /auth/me は会員限定のため、既存のcheckAuthのロジックには一切触れない。
  isGuest: boolean;
  guestToken: string | null;
  guestId: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  /** [Gate P9] サーバーへ通信せずに、この端末のログイン状態だけを消す(アカウント削除後。セッションは失効済み) */
  clearLocalSession: () => void;
  clearError: () => void;
  checkAuth: () => Promise<void>;
  initialize: () => Promise<void>;
  /** [Gate S5] cookie の更新鍵で会員のアクセストークンを取り直す。戻り値は取れたか */
  restoreMemberSession: () => Promise<boolean>;
  startGuestSession: () => Promise<void>;
  upgradeGuest: (username: string, email: string, password: string) => Promise<void>;
}

const LOGGED_OUT = {
  user: null,
  token: null,
  isAuthenticated: false,
  isInitialized: true,
  error: null,
  isGuest: false,
  guestToken: null,
  guestId: null,
} as const;

let restoring: Promise<boolean> | null = null;
let initializing: Promise<void> | null = null;

/** 以前の版が端末に保存した会員のトークンを消す(ゲストのトークンは残す) */
function dropStoredMemberToken(isGuest: boolean): void {
  if (isGuest) return;
  try {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('access_token');
  } catch {
    // 何もしない
  }
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      isInitialized: false,
      error: null,
      isGuest: false,
      guestToken: null,
      guestId: null,

      restoreMemberSession: () => {
        if (restoring) return restoring;
        restoring = (async () => {
          try {
            const data = await apiService.refreshSession();
            apiService.setAccessToken(data.access_token);
            apiService.setGuestMode(false);
            apiService.setMemberSession(true);
            set({ user: data.user, token: data.access_token, isAuthenticated: true, isInitialized: true, error: null });
            return true;
          } catch (error) {
            const status = error instanceof AuthApiError ? error.status : null;
            if (status === 401 || status === 403) {
              // ログインが切れている(cookie が無い・失効・別の端末でログアウト)
              apiService.clearAccessToken();
              apiService.setGuestMode(false);
              apiService.setMemberSession(false);
              set({ ...LOGGED_OUT });
              return false;
            }
            // 通信できない・サーバーが一時的に応答しない: ログイン中のまま(オフライン)で続ける
            apiService.setGuestMode(false);
            apiService.setMemberSession(true);
            set({ isAuthenticated: true, isInitialized: true });
            return false;
          } finally {
            restoring = null;
          }
        })();
        return restoring;
      },

      // 初期化処理
      initialize: () => {
        if (initializing) return initializing;
        initializing = (async () => {
          const state = get();
          dropStoredMemberToken(state.isGuest);
          if (state.isGuest && state.guestToken) {
            // [Gate #35] ゲストセッションの復元。/auth/meを呼ばないため
            // checkAuthとは独立して、保存済みのguestTokenをそのまま信頼する
            // (期限切れの場合は後続のAPI呼び出しが401になった時点で判明する)。
            apiService.setAccessToken(state.guestToken, { persist: true });
            apiService.setGuestMode(true);
            apiService.setMemberSession(false);
            set({ isAuthenticated: true, isInitialized: true });
          } else if (state.user) {
            if (state.token) {
              apiService.setAccessToken(state.token);
              apiService.setGuestMode(false);
              apiService.setMemberSession(true);
              set({ isAuthenticated: true, isInitialized: true });
            } else {
              // [Gate S5] 再読込の後: cookie の更新鍵でトークンを取り直してから画面を出す
              await get().restoreMemberSession();
            }
          } else {
            apiService.setGuestMode(false);
            apiService.setMemberSession(false);
            set({ isAuthenticated: false, isInitialized: true });
          }
        })().finally(() => {
          initializing = null;
        });
        return initializing;
      },

      // 認証状態チェック
      // [Gate A1] GET /auth/me をAPIクライアント経由(decoder検証あり)で呼ぶ。silent指定のため
      // 共通エラー処理(toast・/loginへの強制遷移)は行わず、失敗時はこれまでどおり状態をクリアする。
      // access tokenが期限切れの場合は、interceptorがrefresh cookieでの更新を1回試みる。
      checkAuth: async () => {
        const { token, user, isGuest } = get();
        if (!token) {
          if (user && !isGuest) {
            // [Gate S5] メモリにトークンが無い会員(再読込の後): cookie で取り直す
            await get().restoreMemberSession();
            return;
          }
          set({ isAuthenticated: false, isInitialized: true });
          return;
        }

        try {
          set({ isLoading: true });
          apiService.setAccessToken(token);
          apiService.setGuestMode(false);
          apiService.setMemberSession(true);
          const response = await apiService.getCurrentUser({ silent: true });
          set({
            user: response.data,
            isAuthenticated: true,
            isLoading: false,
            isInitialized: true,
            error: null,
          });
        } catch (error) {
          console.warn('⚠️ 認証確認に失敗したため認証状態をクリアします:', errorMessage(error, '不明なエラー'));
          apiService.clearAccessToken();
          apiService.setGuestMode(false);
          apiService.setMemberSession(false);
          set({
            user: null,
            token: null,
            isAuthenticated: false,
            isLoading: false,
            isInitialized: true,
            error: null,
          });
        }
      },

      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null });

        try {
          const data = await apiService.login({ email, password });

          // [Gate #10] apiServiceのaxiosクライアントにもトークンを同期する。
          // これが無いと、ログイン後もspots/travel-plans等の認証必須APIが
          // Authorizationヘッダー無しで送信され、常に401で失敗していた。
          apiService.setAccessToken(data.access_token);
          apiService.setGuestMode(false);
          apiService.setMemberSession(true);

          set({
            user: data.user,
            token: data.access_token,
            isAuthenticated: true,
            isLoading: false,
            isInitialized: true,
            error: null,
          });
        } catch (error) {
          const message = errorMessage(error, 'ログインに失敗しました');
          console.error('❌ ログインエラー:', message);
          set({
            isLoading: false,
            isInitialized: true,
            error: message,
          });
          throw error;
        }
      },

      register: async (username: string, email: string, password: string) => {
        set({ isLoading: true, error: null });

        try {
          const data = await apiService.register({ username, email, password });

          apiService.setAccessToken(data.access_token);
          apiService.setGuestMode(false);
          apiService.setMemberSession(true);

          set({
            user: data.user,
            token: data.access_token,
            isAuthenticated: true,
            isLoading: false,
            isInitialized: true,
            error: null,
          });
        } catch (error) {
          const message = errorMessage(error, '登録に失敗しました');
          console.error('❌ 登録エラー:', message);
          set({
            isLoading: false,
            isInitialized: true,
            error: message,
          });
          throw error;
        }
      },

      logout: () => {
        // [Gate #28] サーバー側のセッション(refresh token)も失効させる。
        // 失敗しても(ネットワーク断など)クライアント側の状態は必ずクリアする。
        // [Gate #35] ゲストセッションはrefresh token(サーバー側セッション)を
        // 持たないため、/auth/logoutの呼び出しはisGuestでない場合のみ行う。
        // [Gate S4] アクセストークンが期限切れ・無くても、backend は cookie の更新鍵でセッションを失効させる。
        if (!get().isGuest) {
          apiService.post('/auth/logout', undefined, { skipGlobalErrorHandler: true }).catch(() => {
            console.warn('⚠️ サーバー側セッションの失効に失敗しましたが、ローカルの認証状態はクリアします');
          });
        }
        apiService.clearAccessToken();
        apiService.setGuestMode(false);
        apiService.setMemberSession(false);
        // [Gate K1] 端末内のオフライン鍵を消す(保存したオフラインデータは、次にログインして鍵を受け取るまで開けない)
        void forgetOfflineKeys();
        set({ ...LOGGED_OUT });
      },

      clearLocalSession: () => {
        apiService.clearAccessToken();
        apiService.setGuestMode(false);
        apiService.setMemberSession(false);
        set({ ...LOGGED_OUT });
      },

      startGuestSession: async () => {
        set({ isLoading: true, error: null });

        try {
          const data = await apiService.startGuestSession();
          apiService.setAccessToken(data.access_token, { persist: true });
          apiService.setGuestMode(true);
          apiService.setMemberSession(false);

          set({
            isGuest: true,
            guestToken: data.access_token,
            guestId: data.guest_id,
            isAuthenticated: true,
            isLoading: false,
            isInitialized: true,
            error: null,
          });
        } catch (error) {
          const message = errorMessage(error, 'ゲストセッションの開始に失敗しました');
          console.error('❌ ゲストセッション開始エラー:', message);
          set({
            isLoading: false,
            isInitialized: true,
            error: message,
          });
          throw error;
        }
      },

      upgradeGuest: async (username: string, email: string, password: string) => {
        set({ isLoading: true, error: null });

        try {
          const { guestToken } = get();
          if (!guestToken) {
            throw new Error('ゲストセッションが見つかりません。最初からやり直してください。');
          }

          const data = await apiService.upgradeGuest({ username, email, password }, guestToken);
          apiService.setAccessToken(data.access_token);
          apiService.setGuestMode(false);
          apiService.setMemberSession(true);

          set({
            user: data.user,
            token: data.access_token,
            isAuthenticated: true,
            isGuest: false,
            guestToken: null,
            guestId: null,
            isLoading: false,
            isInitialized: true,
            error: null,
          });
        } catch (error) {
          const message = errorMessage(error, 'アカウント登録に失敗しました');
          console.error('❌ ゲスト昇格エラー:', message);
          set({
            isLoading: false,
            isInitialized: true,
            error: message,
          });
          throw error;
        }
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'auth-storage',
      // [Gate S5] 版1: 会員のアクセストークン(token)を保存しない。古い版が保存した token は読み込み時に捨てる
      version: 1,
      migrate: (persisted) => {
        const state = { ...((persisted ?? {}) as Record<string, unknown>) };
        delete state.token;
        return state as unknown as AuthState;
      },
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        isGuest: state.isGuest,
        guestToken: state.guestToken,
        guestId: state.guestId,
      }),
      onRehydrateStorage: () => (state) => {
        // ストレージから復元後に初期化(React レンダリングサイクルを考慮して少し遅らせる)
        if (state) {
          setTimeout(() => {
            void state.initialize();
          }, 0);
        }
      },
    }
  )
);
