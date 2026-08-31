import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// API Base URLをハードコードで確実に設定
const API_BASE_URL = 'http://192.168.1.248:8000/api/v1';

// 環境変数の確認（デバッグ用）
console.log('🔧 環境変数 VITE_API_BASE_URL:', import.meta.env.VITE_API_BASE_URL);
console.log('🔗 使用する API Base URL:', API_BASE_URL);

interface User {
  id: number;
  username: string;
  email: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  clearError: () => void;
  checkAuth: () => Promise<void>;
  initialize: () => void;
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
          set({ 
            isAuthenticated: true, 
            isInitialized: true 
          });
          console.log('✅ 認証状態復元完了');
        } else {
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
        set({
          user: null,
          token: null,
          isAuthenticated: false,
          isInitialized: true,
          error: null,
        });
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
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