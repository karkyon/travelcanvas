/**
 * [Gate Remaining-7] FR-003 passkey(パスワード無しのログイン)。設定 → アカウント。
 * 端末(スマホ・PC・パスワード管理)に鍵を作り、指紋・顔・PIN でログインできるようにする。秘密の鍵は端末から出ない。
 */
import React, { useEffect, useState } from 'react';
import Button from '@/components/common/Button';
import type { PasskeyItem } from '@/services/api/remaining6';
import { errorDetailMessage } from '@/utils/apiErrorDetail';

const r6 = () => import('@/services/api/remaining6');
const passkeySupported = () => typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function';
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('ja-JP') : '—');

const PasskeySection: React.FC = () => {
  const [items, setItems] = useState<PasskeyItem[] | null>(null);
  const [name, setName] = useState('この端末');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const supported = passkeySupported();

  useEffect(() => {
    let alive = true;
    r6().then((m) => m.listPasskeys()).then((r) => { if (alive) setItems(r.passkeys); }).catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, []);

  const add = async () => {
    setBusy(true); setMsg(null);
    try {
      const created = await (await r6()).registerPasskey(name.trim() || 'passkey');
      setItems((xs) => [...(xs ?? []), created]);
      setMsg({ ok: true, text: `「${created.name}」を作りました。次からログインの画面で「passkey でログイン」を使えます` });
    } catch (e) {
      const n = (e as { name?: string })?.name;
      setMsg({ ok: false, text: n === 'NotAllowedError' ? 'passkey の作成が取り消されました' : errorDetailMessage(e, 'passkey を作れませんでした') });
    } finally { setBusy(false); }
  };

  const remove = async (p: PasskeyItem) => {
    if (!window.confirm(`「${p.name}」を消しますか?この passkey ではログインできなくなります`)) return;
    setBusy(true); setMsg(null);
    try {
      await (await r6()).deletePasskey(p.id);
      setItems((xs) => (xs ?? []).filter((x) => x.id !== p.id));
    } catch (e) {
      setMsg({ ok: false, text: errorDetailMessage(e, '消せませんでした') });
    } finally { setBusy(false); }
  };

  return (
    <section aria-labelledby="passkey-heading" className="border-t pt-6 space-y-2" data-testid="passkey-section">
      <h2 id="passkey-heading" className="text-lg font-semibold">passkey(パスワード無しのログイン)</h2>
      <p className="text-sm text-ink-700">
        この端末の指紋・顔・PIN でログインできるようにします。秘密の鍵は端末から出ません(サーバーは公開の鍵だけを持ちます)。
      </p>
      {!supported && <p className="text-sm text-ink-700">このブラウザでは passkey を使えません。</p>}
      {items && items.length > 0 && (
        <ul className="divide-y rounded border border-cloud-200">
          {items.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-2 text-sm">
              <span>{`${p.name}・作った日 ${day(p.created_at)}・最後に使った日 ${day(p.last_used_at)}`}</span>
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void remove(p)}>消す</Button>
            </li>
          ))}
        </ul>
      )}
      {supported && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm text-ink-700">名前
            <input className="ml-2 border rounded-sm px-2 py-1" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </label>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void add()}>passkey を作る</Button>
        </div>
      )}
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`text-sm ${msg.ok ? 'text-green-800' : 'text-red-800'}`}>{msg.text}</p>}
    </section>
  );
};

export default PasskeySection;
