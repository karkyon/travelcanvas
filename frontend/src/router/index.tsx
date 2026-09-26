import { createBrowserRouter, Navigate } from 'react-router-dom';
import Layout from '@/components/Layout';
import { ProtectedRoute, AdminRoute, AuthRedirect } from './guards';
import RouteErrorBoundary from './RouteErrorBoundary';
import { lazyPage } from './lazyPage';

// [Gate M9-FE-C3] 全ページをルート単位で遅延読込する(React.lazy)。以前は25ページを
// 静的importしており、どの画面を開いても全画面分(main JS 約732kB)を最初に読み込んでいた。
// 読込中の表示は components/Layout.tsx の<Suspense>、読込失敗(デプロイ後に旧chunkが
// 消えた等)は lazyPage の1回限りの自動再読込と RouteErrorBoundary で扱う。

// 既存ページのインポート
const LandingPage = lazyPage(() => import('@/pages/LandingPage'));
const LoginPage = lazyPage(() => import('@/pages/LoginPage'));
const RegisterPage = lazyPage(() => import('@/pages/RegisterPage'));
const GuestUpgradePage = lazyPage(() => import('@/pages/GuestUpgradePage'));
const DashboardPage = lazyPage(() => import('@/pages/DashboardPage'));
const PlannerPage = lazyPage(() => import('@/pages/PlannerPage'));
const SearchPage = lazyPage(() => import('@/pages/SearchPage'));
const SearchSettingsPage = lazyPage(() => import('@/pages/SearchSettingsPage'));
const SettingsPage = lazyPage(() => import('@/pages/SettingsPage'));
const SharePage = lazyPage(() => import('@/pages/SharePage'));
const PublicSharePage = lazyPage(() => import('@/pages/PublicSharePage'));
const NotFoundPage = lazyPage(() => import('@/pages/NotFoundPage'));

// 新しく作成したページのインポート
const SpotRegisterPage = lazyPage(() => import('@/pages/SpotRegisterPage'));
const SpotListPage = lazyPage(() => import('@/pages/SpotListPage'));
const ProfilePage = lazyPage(() => import('@/pages/ProfilePage'));

// [Gate #24] 管理者ページのインポート。以前はどちらもファイルは存在するが
// ここでインポート・ルート登録されておらず、画面として一度も到達できなかった。
const AdminDashboard = lazyPage(() => import('@/pages/Admin/AdminDashboard'));
const AdminUsers = lazyPage(() => import('@/pages/Admin/AdminUsers'));
const NotificationsPage = lazyPage(() => import('@/pages/NotificationsPage'));
const OptimizationSelectPage = lazyPage(() => import('@/pages/OptimizationSelectPage'));
const ReservationsPage = lazyPage(() => import('@/pages/ReservationsPage'));
const ImportsPage = lazyPage(() => import('@/pages/ImportsPage'));
const DocumentsPage = lazyPage(() => import('@/pages/DocumentsPage'));
const TodayPage = lazyPage(() => import('@/pages/TodayPage'));
const SegmentsPage = lazyPage(() => import('@/pages/SegmentsPage'));
const RouteOptionsPage = lazyPage(() => import('@/pages/RouteOptionsPage'));
const ConstraintsPage = lazyPage(() => import('@/pages/ConstraintsPage'));

// [Gate M9-FE-B2] ルートガード(ProtectedRoute/AdminRoute/AuthRedirect)は
// Fast Refresh対応のため ./guards.tsx へ移設(ロジック変更なし)。

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    // [Gate M9-FE-C3] 画面の描画・chunk読込で例外が起きた場合の回復画面
    // (以前はReact Router既定の開発者向けエラー表示になっていた)。
    errorElement: <RouteErrorBoundary />,
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

      // 📄 [Gate R3-10] 文書ウォレット(FR-013)。backend(Gate R3-6)は
      // 実装済みだったがどこからもリンクされておらず画面から到達不能
      // だった(同上パターンの再発防止)。
      {
        path: 'planner/:planId/documents',
        element: (
          <ProtectedRoute>
            <DocumentsPage />
          </ProtectedRoute>
        ),
      },

      // ☀️ [Gate L1] FR-029当日モード(NOW/NEXT)。DOC-04 SC-07。
      {
        path: 'planner/:planId/today',
        element: (
          <ProtectedRoute>
            <TodayPage />
          </ProtectedRoute>
        ),
      },

      // 🚶 [Gate M2] 移動区間(FR-014)。backend(Gate M1)は実装済みだった
      // がどこからもリンクされておらず画面から到達不能だった(Gate R3-2/
      // #25と同じパターンの再発防止)。
      {
        path: 'planner/:planId/segments',
        element: (
          <ProtectedRoute>
            <SegmentsPage />
          </ProtectedRoute>
        ),
      },

      // 🗺️ [Gate M4] 経路の比較(FR-015)。backend(Gate M3)は実装済みだった
      // がどこからもリンクされておらず画面から到達不能だった。
      {
        path: 'planner/:planId/route-options',
        element: (
          <ProtectedRoute>
            <RouteOptionsPage />
          </ProtectedRoute>
        ),
      },

      // ⚖️ [Gate L2] 制約(FR-016)。ハード/ソフト、共有/秘匿の制約を登録する。
      {
        path: 'planner/:planId/constraints',
        element: (
          <ProtectedRoute>
            <ConstraintsPage />
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