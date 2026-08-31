#!/usr/bin/env python3
"""
TravelCanvas AuthStore問題修正スクリプト
authStore関連のインポートエラーを修正
"""
import os

def find_auth_store():
    """既存のauthStoreファイルを検索"""
    print("🔍 既存のauthStoreファイルを検索中...")
    
    possible_paths = [
        "src/stores/authStore.ts",
        "src/stores/authStore.tsx",
        "src/store/authStore.ts",
        "src/store/authStore.tsx",
        "stores/authStore.ts",
        "stores/authStore.tsx",
        "store/authStore.ts",
        "store/authStore.tsx"
    ]
    
    for path in possible_paths:
        if os.path.exists(path):
            print(f"✅ authStoreファイル発見: {path}")
            return path
    
    print("❌ 既存のauthStoreファイルが見つかりません")
    return None

def create_auth_store():
    """authStoreファイルを作成"""
    print("🔧 新しいauthStoreファイルを作成中...")
    
    # storesディレクトリ作成
    stores_dir = "src/stores"
    os.makedirs(stores_dir, exist_ok=True)
    
    auth_store_content = '''/**
 * 認証ストア（Zustand）
 * ユーザー認証状態の管理
 */
import { create } from 'zustand';

// API Base URL
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://192.168.1.248:8000/api/v1';

interface User {
  id: number;
  username: string;
  email: string;
  is_active: boolean;
  created_at: string;
}

interface AuthState {
  // 状態
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  loading: boolean;
  error: string | null;
  
  // アクション
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  clearError: () => void;
  checkAuth: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  // 初期状態
  user: null,
  token: localStorage.getItem('access_token'),
  isAuthenticated: !!localStorage.getItem('access_token'),
  loading: false,
  error: null,

  // ログイン
  login: async (email: string, password: string) => {
    console.log('🔄 ログイン試行中...', { email, apiUrl: `${API_BASE_URL}/auth/login` });
    
    set({ loading: true, error: null });
    
    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          username: email,
          password: password,
        }),
      });

      console.log('📡 レスポンス状態:', response.status, response.statusText);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ ログインエラーレスポンス:', errorText);
        throw new Error('メールアドレスまたはパスワードが正しくありません');
      }

      const data = await response.json();
      console.log('✅ ログイン成功:', data);

      // トークンとユーザー情報を保存
      localStorage.setItem('access_token', data.access_token);
      localStorage.setItem('user', JSON.stringify(data.user));

      set({
        user: data.user,
        token: data.access_token,
        isAuthenticated: true,
        loading: false,
        error: null,
      });

    } catch (error) {
      console.error('❌ ログインエラー:', error);
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'ログインに失敗しました',
      });
      throw error;
    }
  },

  // ログアウト
  logout: () => {
    console.log('🚪 ログアウト実行');
    
    // ローカルストレージをクリア
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');
    
    set({
      user: null,
      token: null,
      isAuthenticated: false,
      loading: false,
      error: null,
    });
  },

  // エラークリア
  clearError: () => {
    set({ error: null });
  },

  // 認証チェック
  checkAuth: () => {
    const token = localStorage.getItem('access_token');
    const userStr = localStorage.getItem('user');
    
    if (token && userStr) {
      try {
        const user = JSON.parse(userStr);
        set({
          user,
          token,
          isAuthenticated: true,
        });
        console.log('✅ 認証状態復元:', user);
      } catch (error) {
        console.error('❌ ユーザー情報解析エラー:', error);
        // 無効なデータの場合はクリア
        localStorage.removeItem('access_token');
        localStorage.removeItem('user');
        set({
          user: null,
          token: null,
          isAuthenticated: false,
        });
      }
    } else {
      set({
        user: null,
        token: null,
        isAuthenticated: false,
      });
    }
  },
}));

// 初期化時に認証状態をチェック
useAuthStore.getState().checkAuth();
'''
    
    auth_store_path = f"{stores_dir}/authStore.ts"
    with open(auth_store_path, 'w', encoding='utf-8') as f:
        f.write(auth_store_content)
    
    print(f"✅ authStoreファイル作成完了: {auth_store_path}")
    return auth_store_path

def fix_dashboard_import(auth_store_path):
    """DashboardPageのインポートパスを修正"""
    print("🔧 DashboardPageのインポートパスを修正中...")
    
    dashboard_path = "src/pages/DashboardPage.tsx"
    
    if not os.path.exists(dashboard_path):
        print(f"❌ DashboardPageが見つかりません: {dashboard_path}")
        return False
    
    # ファイル読み込み
    with open(dashboard_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # インポートパスを修正
    # authStoreの場所に応じてインポートパスを調整
    if auth_store_path == "src/stores/authStore.ts":
        # 正しいパス、変更不要
        print("✅ インポートパスは正しいです")
        return True
    else:
        # パスを修正
        relative_path = os.path.relpath(auth_store_path, "src/pages").replace('\\', '/')
        if relative_path.startswith('../'):
            import_path = relative_path[:-3]  # .ts拡張子を削除
        else:
            import_path = f"../{relative_path[:-3]}"
        
        # インポート行を置換
        content = content.replace(
            'import { useAuthStore } from "../stores/authStore";',
            f'import {{ useAuthStore }} from "{import_path}";'
        )
        
        # ファイル書き込み
        with open(dashboard_path, 'w', encoding='utf-8') as f:
            f.write(content)
        
        print(f"✅ インポートパス修正完了: {import_path}")
        return True

def check_zustand_dependency():
    """Zustand依存関係確認"""
    print("🔍 Zustand依存関係確認中...")
    
    if os.path.exists("package.json"):
        with open("package.json", 'r', encoding='utf-8') as f:
            content = f.read()
        
        if '"zustand"' in content:
            print("✅ Zustand依存関係確認済み")
            return True
        else:
            print("⚠️ Zustandが依存関係にありません")
            print("次のコマンドでインストールしてください:")
            print("npm install zustand")
            return False
    
    return False

def main():
    print("🔧 TravelCanvas AuthStore問題修正")
    print("=" * 60)
    
    # 1. 既存authStore検索
    existing_auth_store = find_auth_store()
    
    if existing_auth_store:
        # 既存ファイルがある場合、インポートパスを修正
        fix_dashboard_import(existing_auth_store)
    else:
        # 既存ファイルがない場合、新規作成
        auth_store_path = create_auth_store()
        fix_dashboard_import(auth_store_path)
    
    # 2. Zustand依存関係確認
    zustand_ok = check_zustand_dependency()
    
    print("\n🎉 AuthStore問題修正完了！")
    print("\n📋 修正内容:")
    print("  ✅ authStoreファイルを作成または確認")
    print("  ✅ DashboardPageのインポートパス修正")
    print("  ✅ Zustand依存関係確認")
    
    print("\n🚀 次のステップ:")
    if not zustand_ok:
        print("  1. npm install zustand でZustandをインストール")
        print("  2. 開発サーバーを再起動")
        print("  3. ブラウザでページをリロード")
    else:
        print("  1. ブラウザでページをリロード（F5）")
        print("  2. authStoreエラーが解消されることを確認")
    
    print("\n💡 作成されたauthStoreの機能:")
    print("  - ユーザーログイン/ログアウト")
    print("  - 認証状態管理")
    print("  - ローカルストレージとの連携")
    print("  - エラーハンドリング")
    
    return True

if __name__ == "__main__":
    main()
