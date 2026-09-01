import { useAuthStore } from '../store/authStore';

/**
 * useAuth
 *
 * [2026-09-01 Gate #7d] 全面書き換え。
 * 旧実装はusePlan.tsxと同種のバグを抱えていた: 実在しない
 * `api.post(...)`(axios風の汎用呼び出し)を前提にしており、
 * 実際の `api`(CompleteTravelAPI)にそのようなメソッドは無かった。
 *
 * 一方 `store/authStore.ts` は fetch() を使った完結した認証実装
 * (login/register/logout/checkAuth/initialize)を既に持っていたため、
 * 本フックはそれへの薄いラッパーとして書き直す。
 *
 * 呼び出し元(layout/Header.tsx, layout/MainLayout.tsx)が実際に
 * 使っている `logout` と `user` のみを実装している。
 */
export const useAuth = () => {
  const { user, isAuthenticated, isLoading, error, login, register, logout, checkAuth, clearError } =
    useAuthStore();

  return {
    user,
    isAuthenticated,
    loading: isLoading,
    error,
    login,
    register,
    logout,
    checkAuth,
    clearError,
  };
};
