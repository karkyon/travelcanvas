/**
 * [Gate G8] FR-021 自分あての所有者の移譲の申し出(お知らせの画面)。受け入れはパスワードで本人確認する。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { acceptOwnershipTransfer, declineOwnershipTransfer, getIncomingTransfers } from '@/services/api/g8';
import type { OwnershipTransfer } from '@/services/api/types/g8';

const KEEP: Record<string, string> = {
  editor: '前の所有者は編集者として残ります', viewer: '前の所有者は閲覧者として残ります', none: '前の所有者は共同編集者から外れます',
};

const IncomingTransfers: React.FC = () => {
  const [items, setItems] = useState<OwnershipTransfer[]>([]);
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await getIncomingTransfers());
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (items.length === 0 && !message) return null;

  const act = async (t: OwnershipTransfer, accept: boolean) => {
    setBusy(t.id);
    setError(null);
    setMessage(null);
    try {
      if (accept) {
        await acceptOwnershipTransfer(t.id, passwords[t.id] ?? '');
        setMessage(`「${t.plan_title ?? '旅行'}」の所有者になりました。`);
      } else {
        await declineOwnershipTransfer(t.id);
        setMessage('移譲の申し出を断りました。');
      }
      await load();
    } catch (e) {
      setError(errorDetailMessage(e, accept ? '受け入れに失敗しました' : '断るのに失敗しました'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card padding="md" className="mb-6">
      <section aria-labelledby="incoming-transfers">
        <h2 id="incoming-transfers" className="font-semibold text-gray-900 flex items-center gap-2">
          <KeyRound size={18} aria-hidden="true" />所有者の移譲の申し出
        </h2>
        <div aria-live="polite">{message && <p className="text-sm text-green-800 mt-2" role="status">{message}</p>}</div>
        {error && <p className="text-sm text-red-800 mt-2" role="alert">{error}</p>}
        <ul className="mt-2 space-y-3">
          {items.map((t) => (
            <li key={t.id} className="border rounded-sm p-3" data-testid={`incoming-transfer-${t.id}`}>
              <p className="text-sm text-gray-900">
                {`${t.from_name} さんから「${t.plan_title ?? '旅行'}」の所有者を引き継ぐ申し出(期限 ${new Date(t.expires_at).toLocaleString('ja-JP')})`}
              </p>
              <p className="text-xs text-gray-700 mt-1">{KEEP[t.keep_role]}</p>
              {t.message && <p className="text-sm text-gray-800 mt-1">{`ひとこと: ${t.message}`}</p>}
              <div className="flex flex-wrap items-end gap-2 mt-2">
                <div>
                  <label htmlFor={`transfer-pw-${t.id}`} className="block text-xs text-gray-800">受け入れるにはパスワード</label>
                  <input id={`transfer-pw-${t.id}`} type="password" autoComplete="current-password"
                    className="border rounded-sm px-2 py-1 text-sm" value={passwords[t.id] ?? ''}
                    onChange={(e) => setPasswords((p) => ({ ...p, [t.id]: e.target.value }))} />
                </div>
                <Button variant="primary" size="sm" loading={busy === t.id} disabled={!passwords[t.id]}
                  onClick={() => act(t, true)}>所有者を引き継ぐ</Button>
                <Button variant="ghost" size="sm" disabled={busy === t.id} onClick={() => act(t, false)}>断る</Button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </Card>
  );
};

export default IncomingTransfers;
