/**
 * [Gate P9] アカウントの削除(FR-039、SC-29)。
 * 1. 「削除の内容を確認する」で、所有する旅行・参加している旅行で消えるもの/残るもの・保持期間を表示する
 * 2. 確認の文字と(登録ユーザーは)パスワードを入力して削除する。取り消せない
 * 削除後は onDeleted を呼ぶ(端末のデータ消去・ログアウトは削除完了画面で行う)。
 */
import React, { useState } from 'react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import { deleteAccount, getAccountDeletionPreview } from '@/services/api';
import type { AccountDeletionPreview } from '@/services/api';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { canDelete, deletionEffects } from './privacyModel';

const AccountDeletionCard: React.FC<{ onDeleted: () => void }> = ({ onDeleted }) => {
  const [preview, setPreview] = useState<AccountDeletionPreview | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'preview' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setBusy('preview');
    setError(null);
    try {
      setPreview(await getAccountDeletionPreview());
    } catch (e) {
      setError(errorDetailMessage(e, '削除の内容を取得できませんでした'));
    } finally {
      setBusy(null);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!preview || !canDelete(preview, confirmation, password)) return;
    setBusy('delete');
    setError(null);
    try {
      await deleteAccount(confirmation.trim(), preview.requires_password ? password : undefined);
      onDeleted();
    } catch (err) {
      setError(errorDetailMessage(err, 'アカウントを削除できませんでした'));
      setBusy(null);
    }
  };

  return (
    <Card padding="md" className="mt-4">
      <section aria-labelledby="account-deletion-heading">
        <h2 id="account-deletion-heading" className="font-semibold text-gray-900">アカウントの削除</h2>
        <p className="text-sm text-gray-700 mt-1">
          アカウントを削除すると元に戻せません。必要なデータは、先に「アカウントのデータを書き出す」で保存してください。
        </p>
        {error && <p className="text-sm text-red-800 mt-2" role="alert">{error}</p>}
        {!preview ? (
          <Button variant="outline" size="sm" className="mt-3" loading={busy === 'preview'} onClick={load}>削除の内容を確認する</Button>
        ) : (
          <form className="mt-3" onSubmit={submit} aria-label="アカウントの削除">
            <ul className="text-sm text-gray-800 list-disc pl-5 space-y-1" data-testid="deletion-effects">
              {deletionEffects(preview).map((t) => <li key={t}>{t}</li>)}
            </ul>
            {preview.owned_plans.length > 0 && (
              <>
                <h3 className="text-sm font-medium text-gray-900 mt-3">削除する旅行</h3>
                <ul className="text-sm text-gray-800 mt-1 list-disc pl-5" aria-label="削除する旅行">
                  {preview.owned_plans.map((p) => (
                    <li key={p.id}>{p.title}{p.member_count > 0 ? `(参加者${p.member_count}人も見られなくなります)` : ''}</li>
                  ))}
                </ul>
              </>
            )}
            <p className="text-sm text-gray-700 mt-3">
              操作の記録(監査ログ)とバックアップは、内容を含めない形で保持期間の間残ります(下の「削除したデータの保持期間」)。
            </p>
            {preview.requires_password && (
              <div className="mt-3">
                <label htmlFor="delete-password" className="block text-sm font-medium text-gray-800">現在のパスワード</label>
                <input id="delete-password" type="password" autoComplete="current-password" value={password}
                  onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full max-w-sm border rounded px-2 py-1" />
              </div>
            )}
            <div className="mt-3">
              <label htmlFor="delete-confirmation" className="block text-sm font-medium text-gray-800">
                確認のため「{preview.confirmation_text}」と入力してください
              </label>
              <input id="delete-confirmation" type="text" value={confirmation} autoComplete="off"
                onChange={(e) => setConfirmation(e.target.value)} className="mt-1 w-full max-w-sm border rounded px-2 py-1" />
            </div>
            <div className="mt-3 flex gap-2">
              <button type="submit" disabled={!canDelete(preview, confirmation, password) || busy !== null}
                className="px-4 py-2 rounded-lg bg-red-700 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed">
                {busy === 'delete' ? '削除しています…' : 'アカウントを削除する'}
              </button>
              <Button variant="ghost" size="sm" type="button" onClick={() => { setPreview(null); setConfirmation(''); setPassword(''); }}>
                やめる
              </Button>
            </div>
          </form>
        )}
      </section>
    </Card>
  );
};

export default AccountDeletionCard;
