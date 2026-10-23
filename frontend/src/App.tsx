import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from '@/router';
import { useAuthStore } from '@/store/authStore';
import { Toaster } from 'react-hot-toast';
import '@/styles/globals.css';

function App() {
  const { initialize, isInitialized } = useAuthStore();
  // [Gate S5] 会員のトークンはメモリだけ。再読込直後・通信できない時はトークンが無いので、利用者 ID で区別する
  const sessionTag = useAuthStore((s) =>
    s.isGuest ? s.guestToken : (s.token ?? (s.user && s.isAuthenticated ? `member:${String(s.user.id)}` : null)));

  useEffect(() => {
    // アプリ起動時に認証状態を初期化(会員は cookie でトークンを取り直す)
    void initialize();
  }, [initialize]);

  // [Gate K1] ログインしたら(ゲスト開始・トークン更新を含む)オフライン鍵を先に受け取って端末に置く。
  // 後で通信できなくなっても、保存したオフラインデータを開けるようにするため。失敗しても何もしない。
  useEffect(() => {
    if (!isInitialized || !sessionTag) return;
    // [Gate G2] DEP-05 最初に読む JS を小さくするため、オフラインの鍵の処理は必要になってから読み込む
    void Promise.all([import('@/utils/offlineVault'), import('@/utils/offlineSession')])
      .then(([vault, session]) => vault.obtainOfflineKey(session.currentOfflineSession()))
      .catch(() => undefined);
  }, [isInitialized, sessionTag]);

  // 初期化中の表示
  // [Gate A1] 以前は `!isInitialized || isLoading` としており、ログイン・登録・ゲスト開始/昇格の
  // 通信中(isLoading)にもアプリ全体(RouterProvider)をこのスプラッシュへ差し替えていた。
  // そのため通信のたびに画面が作り直され、ログイン失敗後にはメールアドレス等の入力内容が
  // 消えていた(browser E2Eで発覚)。通信中の表示は各画面がisLoadingで行っているため、
  // ここでは起動時の初期化(isInitialized)だけを待つ。
  if (!isInitialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-16 h-16 bg-linear-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center mx-auto mb-4">
            <span className="text-white font-bold text-2xl">TC</span>
          </div>
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">TravelCanvas を起動中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="App">
      {/* [Gate G2] React Router 7: startTransition は既定の動作(future flag は不要) */}
      <RouterProvider router={router} />
      <Toaster 
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: '#fff',
            color: '#374151',
            borderRadius: '12px',
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
            border: '1px solid #e5e7eb',
            fontSize: '14px',
            fontWeight: '500',
          },
          // [Gate G5] 白の文字と背景のコントラストを WCAG 2.1 AA(4.5:1)以上にする(以前の #10b981・#ef4444 は不足)
          success: {
            style: {
              background: '#047857',
              color: '#fff',
            },
            iconTheme: {
              primary: '#fff',
              secondary: '#047857',
            },
          },
          error: {
            style: {
              background: '#b91c1c',
              color: '#fff',
            },
            iconTheme: {
              primary: '#fff',
              secondary: '#b91c1c',
            },
          },
          loading: {
            style: {
              background: '#3b82f6',
              color: '#fff',
            },
            iconTheme: {
              primary: '#fff',
              secondary: '#3b82f6',
            },
          },
        }}
      />
    </div>
  );
}

export default App;