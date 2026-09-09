import { createBrowserRouter, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import Layout from '@/components/Layout';

// 既存ページのインポート
import LandingPage from '@/pages/LandingPage';
import LoginPage from '@/pages/LoginPage';
import RegisterPage from '@/pages/RegisterPage';
import GuestUpgradePage from '@/pages/GuestUpgradePage';
import DashboardPage from '@/pages/DashboardPage';
import PlannerPage from '@/pages/PlannerPage';
import SearchPage from '@/pages/SearchPage';
import SearchSettingsPage from '@/pages/SearchSettingsPage';
import SettingsPage from '@/pages/SettingsPage';
import SharePage from '@/pages/SharePage';
import PublicSharePage from '@/pages/PublicSharePage';
import NotFoundPage from '@/pages/NotFoundPage';

// 新しく作成したページのインポート
import SpotRegisterPage from '@/pages/SpotRegisterPage';
import SpotListPage from '@/pages/SpotListPage';
import ProfilePage from '@/pages/ProfilePage';

// [Gate #24] 管理者ページのインポート。以前はどちらもファイルは存在するが
// ここでインポート・ルート登録されておらず、画面として一度も到達できなかった。
import AdminDashboard from '@/pages/Admin/AdminDashboard';
import AdminUsers from '@/pages/Admin/AdminUsers';
import NotificationsPage from '@/pages/NotificationsPage';
import OptimizationSelectPage from '@/pages/OptimizationSelectPage';
import ReservationsPage from '@/pages/ReservationsPage';
import ImportsPage from '@/pages/ImportsPage';

// 認証が必要なルートを保護するコンポーネント
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated } = useAuthStore();
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  
  return <>{children}</>;
};

// [Gate #24] 管理者権限が必要なルートを保護するコンポーネント。
// 未ログインまたは管理者以外は/へリダイレクトする(各ページ内のuseEffectでも
// 二重にチェックしているが、ルート単位でも早期にガードする)。
const AdminRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated, user } = useAuthStore();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  if (user?.user_type !== 'admin') {
    return <Navigate to="/" replace />;
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
      {
        // [Gate #35] AuthRedirectでラップしない。ゲストはisAuthenticated=trueの
        // ためAuthRedirectだと即座に/dashboardへ弾かれてしまう。認証(ゲスト含む)
        // 必須のみをProtectedRouteで課し、非ゲストの場合はページ自身がリダイレクトする。
        path: 'guest/upgrade',
        element: (
          <ProtectedRoute>
            <GuestUpgradePage />
          </ProtectedRoute>
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

      // 🧳 [Gate R3-2] 予約一覧・詳細(SC-11)。backend(Gate R3-0/R3-1)は
      // 実装済みだったがどこからもリンクされておらず画面から到達不能だった。
      {
        path: 'planner/:planId/reservations',
        element: (
          <ProtectedRoute>
            <ReservationsPage />
          </ProtectedRoute>
        ),
      },

      // 📥 [Gate R3-9] 予約取込(FR-011)。backend(Gate R3-7)は実装済み
      // だったがどこからもリンクされておらず画面から到達不能だった
      // (Gate #25/R3-2と同じパターンの再発防止として、実装直後に
      // 到達経路も必ず追加する)。
      {
        path: 'planner/:planId/imports',
        element: (
          <ProtectedRoute>
            <ImportsPage />
          </ProtectedRoute>
        ),
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

      // 🛡️ 管理者ページ [Gate #24]
      {
        path: 'admin',
        children: [
          {
            index: true,
            element: (
              <AdminRoute>
                <AdminDashboard />
              </AdminRoute>
            ),
          },
          {
            path: 'users',
            element: (
              <AdminRoute>
                <AdminUsers />
              </AdminRoute>
            ),
          },
        ],
      },
      
      // 📲 通知関連
      // [Gate #26] 以前は固定の「開発中です」表示だった。
      {
        path: 'notifications',
        element: (
          <ProtectedRoute>
            <NotificationsPage />
          </ProtectedRoute>
        ),
      },
      
      // 🤝 共有・コラボレーション
      // [Gate #25] このルートはプラン所有者が共有リンク/コラボレーターを
      // 管理する画面(SharePage.tsx)であり、公開の共有トークン閲覧画面では
      // ない。以前はパラメータ名がshareTokenになっていたが、SharePage.tsx
      // 側は一貫してplanIdを読んでおり、常にundefinedになっていた(この
      // ルート自体もどこからもリンクされておらず、一度も到達できていなかった)。
      {
        path: 'share/:planId',
        element: (
          <ProtectedRoute>
            <SharePage />
          </ProtectedRoute>
        ),
      },

      // 🔓 共有リンクの公開閲覧(未認証) [Gate #30]
      // 管理画面(share/:planId)とはpath自体を分離し、衝突を避ける。
      // ProtectedRouteで包まないため未ログインでもアクセス可能。
      {
        path: 's/:token',
        element: <PublicSharePage />,
      },
      
      // 🤖 AI最適化
      // [Gate #27 / item8] 以前は固定の「開発中です」表示だった。
      // AI最適化自体はGate #23で実装済み(OptimizationPanel経由でplan単位に
      // 実行)のため、実際にプランを選択して最適化へ進める画面に置き換える。
      // [Gate #34b] 旧ジョブ型結果画面(/optimization/:jobId, OptimizationPage)は
      // Gate #34aでバックエンドの対応エンドポイントを410 Goneへ廃止済みのため、
      // 到達しても常にエラーになる状態だった。ルート・画面ごと除去し、
      // /optimization はプラン選択画面(OptimizationSelectPage)のみに一本化する。
      {
        path: 'optimization',
        element: (
          <ProtectedRoute>
            <OptimizationSelectPage />
          </ProtectedRoute>
        ),
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
  // [Gate #7j] インストール済みのreact-router-dom@6.30.1にはv7_startTransitionフラグが
  // 存在しない(@remix-run/router FutureConfig型を確認済み、他5項目は有効)ため除去。
  future: {
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