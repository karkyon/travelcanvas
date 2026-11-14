/**
 * [Gate Remaining-7] FR-002 すでにアカウントを持っている人が、ゲストで作った旅行などを自分のアカウントへまとめる。
 * まとめた後は既存のアカウントでログインした状態になり、ゲストは使えなくなる。
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import type { User } from '@/types';

const box = 'mt-1 w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500';

const GuestMergeForm: React.FC = () => {
  const navigate = useNavigate();
  const guestToken = useAuthStore((s) => s.guestToken);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needCode, setNeedCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!guestToken) { setErr('ゲストのセッションが見つかりません'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await (await import('@/services/api/remaining6')).mergeGuestIntoAccount(email.trim(), password, code.trim() || undefined, guestToken);
      api.setAccessToken(r.access_token);
      api.setGuestMode(false);
      api.setMemberSession(true);
      useAuthStore.setState({ user: r.user as unknown as User, token: r.access_token, isAuthenticated: true, isGuest: false,
        guestToken: null, guestId: null, isInitialized: true, error: null });
      navigate('/dashboard', { replace: true, state: { merged: r.merge.moved_total } });
    } catch (x) {
      const codeOf = (x as { response?: { data?: { detail?: { code?: string } } } })?.response?.data?.detail?.code;
      if (codeOf === 'mfa_required') setNeedCode(true);
      setErr(errorDetailMessage(x, 'まとめられませんでした'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" aria-labelledby="guest-merge-title" data-testid="guest-merge-form">
      <h2 id="guest-merge-title" className="text-lg font-bold text-ink-900">すでにアカウントをお持ちの方</h2>
      <p className="text-sm text-ink-700">
        ゲストで作った旅行・予定・持ち物などを、今のアカウントへまとめます。まとめた後はそのアカウントでログインした状態になります。
      </p>
      {err && <p role="alert" className="p-3 rounded-lg bg-red-50 text-red-800 text-sm">{err}</p>}
      <label className="block text-sm text-ink-700">メール
        <input type="email" autoComplete="email" required className={box} value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="block text-sm text-ink-700">パスワード
        <input type="password" autoComplete="current-password" required className={box} value={password}
          onChange={(e) => setPassword(e.target.value)} />
      </label>
      {needCode && (
        <label className="block text-sm text-ink-700">確認コード(認証アプリ)
          <input inputMode="numeric" autoComplete="one-time-code" className={box} value={code} onChange={(e) => setCode(e.target.value)} />
        </label>
      )}
      <button type="submit" disabled={busy || !email || !password}
        className="w-full py-3 px-4 rounded-xl text-sm font-medium text-white bg-ink-900 hover:bg-ink-700 disabled:opacity-50">
        {busy ? 'まとめています…' : 'このアカウントへまとめる'}
      </button>
    </form>
  );
};

export default GuestMergeForm;
