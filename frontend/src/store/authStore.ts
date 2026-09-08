import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@/types';
import { api as apiService } from '@/services/api';

// [2026-09-01 Gate #7d] api.ts と同じ環境変数解決方式に統一。
// 旧実装は 'http://192.168.1.248:8000/api/v1'(旧サーバー、廃止済み)
// をハードコードしており、omega-dev2上では認証系APIが常に
// 到達不能なホストへ送信され、静かに失敗する状態だった。
// [Gate #8] VITE_API_URL/VITE_API_BASE_URLはDockerビルド時に一切注入されておらず
// (frontend/Dockerfileにビルド用ARGが無く、docker-compose.ymlのbuild.argsも未設定、
// environment:はコンテナ起動時の値でありViteの静的ビルドには反映されない)、
// 常に下記フォールバックの廃止済み旧サーバー(192.168.1.248)が使われていた実害バグ。
// さらにVITE_API_URLの値自体に/api/v1が含まれておらず二重に壊れていた。
// resolveApiBaseUrlで正規化し、Dockerfile/docker-compose.yml側もビルドARGを
// 正しく受け取るよう修正済み(同Gate)。
function resolveApiBaseUrl(): string {
  const raw =
    import.meta.env.VITE_API_BASE_URL ||
    import.meta.env.VITE_API_URL ||
    'http://localhost:8001';
  const trimmed = raw.replace(/\/+$/, '');
  return trimmed.endsWith('/api/v1') ? trimmed : `${trimmed}/api/v1`;
}

const API_BASE_URL = resolveApiBaseUrl();

// [Gate #7j] authStore独自のローカルUser型(id: number)がバックエンドの
// UUID移行(Gate #5)に追従できておらず放置されていた実害バグ。
// 全体で唯一の定義であるtypes/index.tsのUser型(id: string/UUID)に統一。

interface AuthState {
  user: User | null;
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
      checkAuth: async () => {
        const { token } = get();
        if (!token) {
          set({ isAuthenticated: false, isInitialized: true });
          return;
        }

        try {
          set({ isLoading: true });
          console.log('🔍 認証状態確認中...');

          const response = await fetch(`${API_BASE_URL}/auth/me`, {
            credentials: 'include',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          });

          if (response.ok) {
            const data = await response.json();
            console.log('✅ 認証確認成功:', data);
            set({
              user: data.user || data,
              isAuthenticated: true,
              isLoading: false,
              isInitialized: true,
              error: null,
            });
          } else {
            console.warn('⚠️ 認証確認失敗:', response.status);
            // トークンが無効な場合はクリア
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
        } catch (error) {
          console.error('❌ 認証確認エラー:', error);
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
          const apiUrl = `${API_BASE_URL}/auth/login`;
          console.log('🔄 ログイン試行中...', { email, apiUrl });
          
          const response = await fetch(apiUrl, {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email, password }),
          });

          console.log('📡 レスポンス状態:', response.status, response.statusText);

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ detail: 'ログインに失敗しました' }));
            throw new Error(errorData.detail || `HTTP ${response.status}`);
          }

          const data = await response.json();
          console.log('✅ ログイン成功:', data);

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
          console.error('❌ ログインエラー:', error);
          set({
            isLoading: false,
            isInitialized: true,
            error: error instanceof Error ? error.message : 'ログインに失敗しました',
          });
          throw error;
        }
      },

      register: async (username: string, email: string, password: string) => {
        set({ isLoading: true, error: null });
        
        try {
          const apiUrl = `${API_BASE_URL}/auth/register`;
          console.log('🔄 登録試行中...', { username, email, apiUrl });
          
          const response = await fetch(apiUrl, {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ username, email, password }),
          });

          console.log('📡 レスポンス状態:', response.status, response.statusText);

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ detail: '登録に失敗しました' }));
            console.error('❌ 登録エラーレスポンス:', errorData);
            throw new Error(errorData.detail || `HTTP ${response.status}`);
          }

          const data = await response.json();
          console.log('✅ 登録成功:', data);

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
          console.error('❌ 登録エラー:', error);
          set({
            isLoading: false,
            isInitialized: true,
            error: error instanceof Error ? error.message : '登録に失敗しました',
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
          const response = await fetch(`${API_BASE_URL}/auth/guest`, {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
            },
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ detail: 'ゲストセッションの開始に失敗しました' }));
            throw new Error(errorData.detail || `HTTP ${response.status}`);
          }

          const data = await response.json();
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
          console.error('❌ ゲストセッション開始エラー:', error);
          set({
            isLoading: false,
            isInitialized: true,
            error: error instanceof Error ? error.message : 'ゲストセッションの開始に失敗しました',
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

          const response = await fetch(`${API_BASE_URL}/auth/guest/upgrade`, {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${guestToken}`,
            },
            body: JSON.stringify({ username, email, password }),
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ detail: 'アカウント登録に失敗しました' }));
            throw new Error(errorData.detail || `HTTP ${response.status}`);
          }

          const data = await response.json();
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
          console.error('❌ ゲスト昇格エラー:', error);
          set({
            isLoading: false,
            isInitialized: true,
            error: error instanceof Error ? error.message : 'アカウント登録に失敗しました',
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