/**
 * [Gate Remaining-6] FR-003 メールの確認(設定 → アカウント)。
 * 登録したメールが本人の物か、届くリンクで確かめる。確かめ済みなら「確認済み」と出す。
 */
import React, { useState } from 'react';
import Button from '@/components/common/Button';
import { useAuthStore } from '@/store/authStore';
import { requestEmailVerification } from '@/services/api/accountRecovery';
import { errorDetailMessage } from '@/utils/apiErrorDetail';

const EmailVerifySection: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!user || !user.email) return null;
  const verified = !!user.is_verified;

  const send = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await requestEmailVerification();
      if (r.verified) {
        const cur = useAuthStore.getState().user;
        if (cur) useAuthStore.setState({ user: { ...cur, is_verified: true } });
      }
      setMsg({ ok: r.accepted || r.verified, text: r.message });
    } catch (e) {
      setMsg({ ok: false, text: errorDetailMessage(e, '確認のメールを送れませんでした') });
    } finally { setBusy(false); }
  };

  return (
    <section aria-labelledby="email-verify-heading" className="border-t pt-6 space-y-2">
      <h2 id="email-verify-heading" className="text-lg font-semibold">メールの確認</h2>
      <p className="text-sm text-ink-700">
        {user.email} は{verified ? '確認済みです。' : 'まだ確認されていません。届くリンクを開くと確認できます。'}
      </p>
      {!verified && <Button type="button" variant="secondary" onClick={send} disabled={busy}>確認のメールを送る</Button>}
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`text-sm ${msg.ok ? 'text-green-800' : 'text-red-800'}`}>{msg.text}</p>}
    </section>
  );
};

export default EmailVerifySection;
