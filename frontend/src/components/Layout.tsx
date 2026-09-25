import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import Header from './Header';

const PageLoading = () => (
  <div role="status" aria-live="polite" className="flex justify-center items-center py-24">
    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
    <span className="sr-only">読み込み中...</span>
  </div>
);

const Layout = () => {
  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main>
        {/* [Gate M9-FE-C3] ページはルート単位で遅延読込するため、読込中はヘッダーを
            残したまま本文領域にだけ読込表示を出す。 */}
        <Suspense fallback={<PageLoading />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
};

export default Layout;
