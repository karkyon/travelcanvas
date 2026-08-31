import { createBrowserRouter, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import Layout from '@/components/Layout';

// 既存ページのインポート
import LandingPage from '@/pages/LandingPage';
import LoginPage from '@/pages/LoginPage';
import RegisterPage from '@/pages/RegisterPage';
import DashboardPage from '@/pages/DashboardPage';
import PlannerPage from '@/pages/PlannerPage';
import SearchPage from '@/pages/SearchPage';
import SearchSettingsPage from '@/pages/SearchSettingsPage';
import SettingsPage from '@/pages/SettingsPage';
import SharePage from '@/pages/SharePage';
import OptimizationPage from '@/pages/OptimizationPage';
import NotFoundPage from '@/pages/NotFoundPage';

// 新しく作成したページのインポート
import SpotRegisterPage from '@/pages/SpotRegisterPage';
import SpotListPage from '@/pages/SpotListPage';
import ProfilePage from '@/pages/ProfilePage';

// 認証が必要なルートを保護するコンポーネント
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated } = useAuthStore();
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  
  return <>{children}</>;
};

// 認証済みユーザーのリダイレクト
const AuthRedirect = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated } = useAuthStore();
  
  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }
  
  return <>{children}</>;
};

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      // 🏠 基本ページ
      {
        index: true,
        element: <LandingPage />,
      },
      {
        path: 'login',
        element: (
          <AuthRedirect>
            <LoginPage />
          </AuthRedirect>
        ),
      },
      {
        path: 'register',
        element: (
          <AuthRedirect>
            <RegisterPage />
          </AuthRedirect>
        ),
      },
      
      // 🎯 メインアプリケーション
      {
        path: 'dashboard',
        element: (
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        ),
      },
      
      // 📋 プランナー関連
      {
        path: 'planner',
        children: [
          {
            index: true,
            element: (
              <ProtectedRoute>
                <PlannerPage />
              </ProtectedRoute>
            ),
          },
          {
            path: ':planId?',
            element: (
              <ProtectedRoute>
                <PlannerPage />
              </ProtectedRoute>
            ),
          },
        ],
      },
      
      // 🔍 AI検索機能（拡張版）
      {
        path: 'search',
        children: [
          {
            index: true, // /search
            element: (
              <ProtectedRoute>
                <SearchPage />
              </ProtectedRoute>
            ),
          },
          {
            path: 'settings', // /search/settings - AI検索設定
            element: (
              <ProtectedRoute>
                <SearchSettingsPage />
              </ProtectedRoute>
            ),
          },
          {
            path: 'spots', // /search/spots - スポット検索（エイリアス）
            element: (
              <ProtectedRoute>
                <SearchPage />
              </ProtectedRoute>
            ),
          },
        ],
      },
      
      // 📍 スポット関連（ダッシュボードからの遷移対応）
      {
        path: 'spots',
        children: [
          {
            index: true, // /spots
            element: (
              <ProtectedRoute>
                <SpotListPage />
              </ProtectedRoute>
            ),
          },
          {
            path: 'search', // /spots/search
            element: (
              <ProtectedRoute>
                <SearchPage />
              </ProtectedRoute>
            ),
          },
          {
            path: 'register', // /spots/register
            element: (
              <ProtectedRoute>
                <SpotRegisterPage />
              </ProtectedRoute>
            ),
          },
        ],
      },
      
      // ⚙️ ユーザー設定
      {
        path: 'settings',
        element: (
          <ProtectedRoute>
            <SettingsPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'profile',
        element: (
          <ProtectedRoute>
            <ProfilePage />
          </ProtectedRoute>
        ),
      },
      
      // 📲 通知関連
      {
        path: 'notifications',
        element: (
          <ProtectedRoute>
            <div className="container mx-auto px-4 py-8">
              <h1 className="text-2xl font-bold mb-6">通知</h1>
              <div className="bg-white rounded-lg shadow p-6">
                <p className="text-gray-600">通知機能は開発中です。</p>
              </div>
            </div>
          </ProtectedRoute>
        ),
      },
      
      // 🤝 共有・コラボレーション
      {
        path: 'share/:shareToken',
        element: (
          <ProtectedRoute>
            <SharePage />
          </ProtectedRoute>
        ),
      },
      
      // 🤖 AI最適化
      {
        path: 'optimization',
        children: [
          {
            index: true,
            element: (
              <ProtectedRoute>
                <div className="container mx-auto px-4 py-8">
                  <h1 className="text-2xl font-bold mb-6">AI最適化</h1>
                  <div className="bg-white rounded-lg shadow p-6">
                    <p className="text-gray-600">AI最適化機能は開発中です。</p>
                  </div>
                </div>
              </ProtectedRoute>
            ),
          },
          {
            path: ':jobId',
            element: (
              <ProtectedRoute>
                <OptimizationPage />
              </ProtectedRoute>
            ),
          },
        ],
      },
      
      // 📄 エラー・その他
      {
        path: '404',
        element: <NotFoundPage />,
      },
      {
        path: '*',
        element: <Navigate to="/404" replace />,
      },
    ],
  },
], {
  // 🚀 React Router v7 Future Flags の設定
  future: {
    // Transition機能の有効化
    v7_startTransition: true,
    // 相対パス処理の改善
    v7_relativeSplatPath: true,
    // フェッチャーの永続化
    v7_fetcherPersist: true,
    // フォームメソッドの正規化
    v7_normalizeFormMethod: true,
    // 部分的ハイドレーションの対応
    v7_partialHydration: true,
    // アクションエラー時の再検証スキップ
    v7_skipActionErrorRevalidation: true,
  }
});

export default router;