import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api as apiService } from '@/services/api';
import type { SessionUser } from '@/services/api';

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

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

interface AuthState {
  user: SessionUser | null;
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
  clearError: () => void;
  checkAuth: () => Promise<void>;
  initialize: () => void;
  startGuestSession: () => Promise<void>;
  upgradeGuest: (username: string, email: string, password: string) => Promise<void>;
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

      // 初期化処理
      initialize: () => {
        const state = get();
        console.log('🔄 AuthStore初期化中...', { 
          hasToken: !!state.token, 
          hasUser: !!state.user,
          isAuthenticated: state.isAuthenticated 
        });

        // トークンとユーザー情報がある場合は認証済みとする
        if (state.token && state.user) {
          // [Gate #10] apiServiceはlocalStorageの別キー('auth_token'/'access_token')
          // からしかトークンを読まないため、zustand永続化からの復元時にも明示的に同期する。
          apiService.setAccessToken(state.token);
          apiService.setGuestMode(false);
          set({ 
            isAuthenticated: true, 
            isInitialized: true 
          });
          console.log('✅ 認証状態復元完了');
        } else if (state.isGuest && state.guestToken) {
          // [Gate #35] ゲストセッションの復元。/auth/meを呼ばないため
          // checkAuthとは独立して、保存済みのguestTokenをそのまま信頼する
          // (期限切れの場合は後続のAPI呼び出しが401になった時点で判明する)。
          apiService.setAccessToken(state.guestToken);
          apiService.setGuestMode(true);
          set({
            isAuthenticated: true,
            isInitialized: true,
          });
          console.log('✅ ゲストセッション復元完了');
        } else {
          apiService.setGuestMode(false);
          set({ 
            isAuthenticated: false, 
            isInitialized: true 
          });
          console.log('⚪ 非認証状態で初期化完了');
        }
      },

      // 認証状態チェック
      // [Gate A1] GET /auth/me をAPIクライアント経由(decoder検証あり)で呼ぶ。silent指定のため
      // 共通エラー処理(toast・/loginへの強制遷移)は行わず、失敗時はこれまでどおり状態をクリアする。
      // access tokenが期限切れの場合は、interceptorがrefresh cookieでの更新を1回試みる。
      checkAuth: async () => {
        const { token } = get();
        if (!token) {
          set({ isAuthenticated: false, isInitialized: true });
          return;
        }

        try {
          set({ isLoading: true });
          apiService.setAccessToken(token);
          apiService.setGuestMode(false);
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
        console.log('🚪 ログアウト');
        // [Gate #28] サーバー側のセッション(refresh token)も失効させる。
        // 失敗しても(ネットワーク断など)クライアント側の状態は必ずクリアする。
        // [Gate #35] ゲストセッションはrefresh token(サーバー側セッション)を
        // 持たないため、/auth/logoutの呼び出しはisGuestでない場合のみ行う。
        if (!get().isGuest) {
          apiService.post('/auth/logout').catch(() => {
            console.warn('⚠️ サーバー側セッションの失効に失敗しましたが、ローカルの認証状態はクリアします');
          });
        }
        apiService.clearAccessToken();
        apiService.setGuestMode(false);
        set({
          user: null,
          token: null,
          isAuthenticated: false,
          isInitialized: true,
          error: null,
          isGuest: false,
          guestToken: null,
          guestId: null,
        });
      },

      startGuestSession: async () => {
        set({ isLoading: true, error: null });

        try {
          const data = await apiService.startGuestSession();
          apiService.setAccessToken(data.access_token);
          apiService.setGuestMode(true);

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
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
        isGuest: state.isGuest,
        guestToken: state.guestToken,
        guestId: state.guestId,
      }),
      onRehydrateStorage: () => (state) => {
        // ストレージから復元後に初期化
        if (state) {
          console.log('💾 ストレージからの復元完了', {
            hasToken: !!state.token,
            hasUser: !!state.user,
            isAuthenticated: state.isAuthenticated
          });
          // 少し遅延させて初期化（React レンダリングサイクルを考慮）
          setTimeout(() => {
            state.initialize();
          }, 0);
        }
      },
    }
  )
);