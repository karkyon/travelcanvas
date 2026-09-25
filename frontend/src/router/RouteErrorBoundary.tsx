/**
 * [Gate M9-FE-C3] ルート(画面)単位のエラー表示。
 *
 * React Routerのルートで例外が起きた場合に表示する。以前はerrorElement未設定で、
 * React Router既定の開発者向け表示(スタックトレース等)がそのまま利用者に出ていた。
 * 画面の読込(chunk)失敗は「新しいバージョンへの更新」として案内し、再読込を促す。
 */
import { isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { isChunkLoadError } from './lazyPage';

const RouteErrorBoundary = () => {
  const error = useRouteError();
  const chunkError = isChunkLoadError(error);
  const notFound = isRouteErrorResponse(error) && error.status === 404;

  const title = chunkError
    ? '画面を読み込めませんでした'
    : notFound
      ? 'ページが見つかりません'
      : '予期しないエラーが発生しました';
  const message = chunkError
    ? 'アプリが更新された可能性があります。ページを再読み込みしてください。'
    : notFound
      ? 'URLをご確認ください。'
      : '時間をおいて再度お試しください。解決しない場合はページを再読み込みしてください。';

  if (!chunkError && !notFound) {
    console.error('Route error:', error);
  }

  return (
    <div role="alert" className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow p-8 text-center">
        <h1 className="text-xl font-bold text-gray-900 mb-2">{title}</h1>
        <p className="text-gray-600 mb-6">{message}</p>
        <div className="flex justify-center gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
          >
            再読み込み
          </button>
          <a href="/" className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">
            ホームへ
          </a>
        </div>
      </div>
    </div>
  );
};

export default RouteErrorBoundary;
