/**
 * [Gate Remaining-6] FR-003 パスワードを忘れた時。登録したメールに再設定のリンクを送る(登録の有無は答えない)。
 * /reset-password?token=… で新しいパスワードを決める(同じ画面の部品で出し分ける)。
 */
import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { requestPasswordReset, resetPassword } from '@/services/api/accountRecovery';
import { errorDetailMessage } from '@/utils/apiErrorDetail';

const box = 'w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500';
const btn = 'w-full py-3 px-4 rounded-xl text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50';

const ForgotPasswordPage: React.FC = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null); setMsg(null);
    try {
      setMsg((await requestPasswordReset(email.trim())).message);
    } catch (x) {
      setErr(errorDetailMessage(x, '受け付けられませんでした。しばらくしてから試してください'));
    } finally { setBusy(false); }
  };

  const reset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw !== pw2) { setErr('2 つのパスワードが違います'); return; }
    setBusy(true); setErr(null);
    try {
      setMsg((await resetPassword(token ?? '', pw)).message);
      setDone(true);
    } catch (x) {
      setErr(errorDetailMessage(x, 'パスワードを変えられませんでした'));
    } finally { setBusy(false); }
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 space-y-5">
        <h1 className="text-2xl font-bold text-ink-900">{token ? '新しいパスワード' : 'パスワードを忘れた時'}</h1>
        {msg && <p role="status" className="p-3 rounded-lg bg-green-50 text-green-900 text-sm">{msg}</p>}
        {err && <p role="alert" className="p-3 rounded-lg bg-red-50 text-red-800 text-sm">{err}</p>}
        {token ? (
          done ? (
            <button type="button" className={btn} onClick={() => navigate('/login')}>ログインへ</button>
          ) : (
            <form onSubmit={reset} className="space-y-4">
              <label className="block text-sm text-ink-700">新しいパスワード
                <input type="password" autoComplete="new-password" required className={box} value={pw} onChange={(e) => setPw(e.target.value)} />
              </label>
              <label className="block text-sm text-ink-700">もう一度
                <input type="password" autoComplete="new-password" required className={box} value={pw2} onChange={(e) => setPw2(e.target.value)} />
              </label>
              <button type="submit" className={btn} disabled={busy || !pw}>パスワードを変える</button>
            </form>
          )
        ) : (
          <form onSubmit={send} className="space-y-4">
            <p className="text-sm text-ink-700">登録したメールに、パスワードを決め直すリンクを送ります(1 時間有効・1 回だけ)。</p>
            <label className="block text-sm text-ink-700">メール
              <input type="email" autoComplete="email" required className={box} value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <button type="submit" className={btn} disabled={busy || !email.trim()}>リンクを送る</button>
          </form>
        )}
        <p className="text-center text-sm"><Link to="/login" className="text-blue-700 underline">ログインへ戻る</Link></p>
      </div>
    </main>
  );
};

export default ForgotPasswordPage;
