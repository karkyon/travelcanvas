/**
 * ルートガードコンポーネント
 *
 * [Gate M9-FE-B2] 以前はrouter/index.tsx(router定数をexport)内のローカル定義だったが、
 * Vite Fast Refresh(eslint react-refresh/only-export-components)のため移設した。
 * ロジックは変更していない。
 */

import React, { Suspense, lazy } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
// [Gate G2] DEP-05 管理者の多要素認証の確認は管理者の画面でだけ使うため、その時に読み込む
const AdminMfaGate = lazy(() => import('@/components/admin/AdminMfaGate'));

// 認証が必要なルートを保護するコンポーネント
export const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated } = useAuthStore();
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  
  return <>{children}</>;
};

// [Gate #24] 管理者権限が必要なルートを保護するコンポーネント。
// 未ログインまたは管理者以外は/へリダイレクトする(各ページ内のuseEffectでも
// 二重にチェックしているが、ルート単位でも早期にガードする)。
export const AdminRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated, user } = useAuthStore();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  const isAdmin = user?.user_type === 'admin' || user?.user_type === 'super_admin' || user?.is_superuser === true;
  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  // [Gate S11] 管理者の画面は多要素認証を通したセッションだけ(backend の require_admin と同じ条件)
  return (
    <Suspense fallback={null}>
      {/* [Gate AdminLayout] 管理の画面も殻(上の帯・左の帯)との間に旅程などと同じ余白をとる */}
      <AdminMfaGate><div className="tc-admin-page">{children}</div></AdminMfaGate>
    </Suspense>
  );
};

// 認証済みユーザーのリダイレクト
export const AuthRedirect = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated } = useAuthStore();
  
  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }
  
  return <>{children}</>;
};
