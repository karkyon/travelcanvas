import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api as apiService, AuthApiError } from '@/services/api';
import type { MfaStatus } from '@/services/api';

/**
 * [Gate S11] SEC-06 管理者の画面の前の多要素認証。
 *
 * backend の管理者 API(require_admin)は、多要素認証を設定していない・このセッションで確認コードを
 * 通していない時は 403 を返す。画面では先に GET /auth/mfa で状態を確かめ、
 * - 未設定: 設定 → セキュリティへの案内
 * - 確認がまだ(または古い): その場で確認コードを入力(POST /auth/mfa/step-up)
 * - 確認済み: 管理者の画面を表示
 * する。管理者の画面のデータは、確認の前には1件も読み込まない。
 */
type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; status: MfaStatus };

const AdminMfaGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoad({ state: 'loading' });
    try {
      setLoad({ state: 'ready', status: await apiService.getMfaStatus() });
    } catch {
      setLoad({ state: 'error' });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const status = await apiService.stepUpMfa(code.trim());
      setCode('');
      setLoad({ state: 'ready', status });
    } catch (err) {
      setCode('');
      setError(err instanceof AuthApiError ? err.message : '確認できませんでした。もう一度お試しください。');
    } finally {
      setBusy(false);
    }
  };

  if (load.state === 'loading') {
    return <p role="status" className="p-8 text-gray-700">確認しています…</p>;
  }
  if (load.state === 'error') {
    return (
      <div role="alert" className="p-8 text-red-700">
        多要素認証の状態を確認できませんでした。
        <button type="button" className="ml-2 underline" onClick={() => void refresh()}>再試行</button>
      </div>
    );
  }
  const { status } = load;
  if (!status.required || status.session_verified) return <>{children}</>;

  return (
    <div className="min-h-screen bg-gray-50 flex items-start justify-center px-4 py-16">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow">
        <h1 className="text-xl font-bold text-gray-900 mb-3">管理者の確認</h1>
        {!status.enabled ? (
          <>
            <p className="text-sm text-gray-800 mb-4">
              管理者の画面を使うには、多要素認証(認証アプリの確認コード)を有効にしてください。
              パスワードだけが漏れても、管理者の操作をされないようにするためです。
            </p>
            <Link to="/settings?tab=security"
              className="inline-block rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800">
              多要素認証を設定する
            </Link>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-sm text-gray-800">
              認証アプリの6桁の確認コード(または回復コード)を入力してください。確認は12時間ごとに求めます。
            </p>
            <div>
              <label htmlFor="admin-mfa-code" className="block text-sm font-medium text-gray-700 mb-1">確認コード</label>
              <input id="admin-mfa-code" type="text" autoComplete="one-time-code" maxLength={32} autoFocus required
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-blue-500"
                value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            <button type="submit" disabled={busy || !code.trim()}
              className="w-full rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50">
              確認する
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default AdminMfaGate;
