import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Header from './Header';
import AppRail from './shell/AppRail';
import { useAuthStore } from '../store/authStore';
import RecordingIndicator from './location/RecordingIndicator';

const PageLoading = () => (
  <div role="status" aria-live="polite" className="flex justify-center items-center py-24">
    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-accent" />
    <span className="sr-only">読み込み中...</span>
  </div>
);

const Layout = () => {
  // [Gate LP] LP(/)は景色の上に自分の案内(lp-nav)を持つため、全体の見出しの帯を出さない
  const { pathname } = useLocation();
  // [Gate AppShell] ログインした後の画面は、モックの殻(上の帯+左の帯。スマホは下の帯)で包む
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLanding = pathname === '/';
  const withRail = isAuthenticated && !isLanding && !PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  const body = (
    <main className={withRail ? 'tc-shell-main' : undefined}>
      {/* [Gate M9-FE-C3] ページはルート単位で遅延読込するため、読込中はヘッダーを
          残したまま本文領域にだけ読込表示を出す。 */}
      <Suspense fallback={<PageLoading />}>
        <Outlet />
      </Suspense>
    </main>
  );
  return (
    <div className="min-h-screen bg-cloud-50 text-ink-900">
      {!isLanding && <Header />}
      {/* [Gate L5] 位置の記録中であることを全ての画面で示す(CA-014) */}
      <RecordingIndicator />
      {withRail ? (
        <div className="tc-shell">
          <AppRail />
          {body}
        </div>
      ) : body}
    </div>
  );
};

/** 殻(左の帯)を出さない画面: ログイン・登録・公開の共有と旅行記・見つからない */
const PUBLIC_PATHS = ['/login', '/register', '/forgot-password', '/reset-password', '/account-deleted', '/s/', '/journal/', '/404'];

export default Layout;
