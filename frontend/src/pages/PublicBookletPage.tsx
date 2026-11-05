/**
 * [Gate BookletWeb] Web で公開したしおり(/b/:token)。ログインしなくても見られる(URL を知っている人だけ)。
 * backend/app/api/v1/booklet.py の public_router(GET /public/booklets/{token})を読む。印刷はブラウザの機能。
 */
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { getPublicBooklet, type PublicBooklet } from '@/services/api/bookletWeb';
import BookletView from './booklet/BookletView';
import { printWhenReady } from './booklet/bookletModel';

const PublicBookletPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PublicBooklet | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!token) return undefined;
    let alive = true;
    getPublicBooklet(token).then((d) => { if (alive) setData(d); }).catch((e: { response?: { status?: number } }) => {
      if (!alive) return;
      setError(e?.response?.status === 429 ? 'アクセスが多すぎます。しばらく待ってから開いてください。'
        : 'このしおりは見つからないか、公開が終わっています。');
    });
    return () => { alive = false; };
  }, [token]);
  useEffect(() => {
    // 検索に出さない(サーバーの X-Robots-Tag と同じ)
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => { meta.remove(); };
  }, []);
  return (
    <main className="min-h-screen bg-cloud-50 px-3 py-6" data-testid="public-booklet">
      {!data && !error && <div className="flex justify-center py-16" role="status"><LoadingSpinner size="lg" /></div>}
      {error && <p role="alert" className="mx-auto max-w-xl rounded-xl border border-cloud-200 bg-cloud-0 p-6 text-center text-ink-900">{error}</p>}
      {data && (
        <>
          <div className="no-print mx-auto mb-3 flex max-w-3xl items-center justify-between gap-2 print:hidden">
            <p className="text-xs text-ink-700">TravelCanvas で作ったしおり(Web で公開)</p>
            <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={() => void printWhenReady()}>印刷・PDF</button>
          </div>
          <BookletView booklet={data.booklet} exportInfo={null} stampLabel={`第${data.version_no}版(Web で公開)`} />
        </>
      )}
    </main>
  );
};

export default PublicBookletPage;
