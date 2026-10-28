import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import Header from './Header';
import RecordingIndicator from './location/RecordingIndicator';

const PageLoading = () => (
  <div role="status" aria-live="polite" className="flex justify-center items-center py-24">
    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-accent" />
    <span className="sr-only">読み込み中...</span>
  </div>
);

const Layout = () => {
  return (
    <div className="min-h-screen bg-cloud-50 text-ink-900">
      <Header />
      {/* [Gate L5] 位置の記録中であることを全ての画面で示す(CA-014) */}
      <RecordingIndicator />
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
