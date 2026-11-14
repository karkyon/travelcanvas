/** [Gate Remaining-7] FR-003 passkey でログインする(端末の指紋・顔・PIN で本人を確かめる。パスワードは使わない)。 */
import React, { useState } from 'react';
import { api } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import type { User } from '@/types';

const passkeySupported = () => typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function';

const PasskeyLoginButton: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!passkeySupported()) return null;

  const go = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await (await import('@/services/api/remaining6')).loginWithPasskey();
      api.setAccessToken(r.access_token);
      api.setGuestMode(false);
      api.setMemberSession(true);
      useAuthStore.setState({ user: r.user as unknown as User, token: r.access_token, isAuthenticated: true,
        isLoading: false, isInitialized: true, error: null, pendingMfa: null });
      onDone();
    } catch (e) {
      const name = (e as { name?: string })?.name;
      setErr(name === 'NotAllowedError' ? 'passkey の確認が取り消されました' : errorDetailMessage(e, 'passkey でログインできませんでした'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <button type="button" onClick={() => void go()} disabled={busy} data-testid="passkey-login"
        className="w-full py-3 px-4 rounded-xl text-sm font-medium border border-ink-900 text-ink-900 hover:bg-gray-50 disabled:opacity-50">
        {busy ? '確かめています…' : 'passkey でログイン'}
      </button>
      {err && <p role="alert" className="text-sm text-red-800">{err}</p>}
    </div>
  );
};

export default PasskeyLoginButton;
