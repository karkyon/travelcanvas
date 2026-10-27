/**
 * [Gate G8] FR-021・FR-039 旅行の所有者の移譲(所有者だけに表示)。
 *
 * 参加済みの会員の共同編集者を選び、パスワードで本人確認して申し出る。相手が受け入れた時に所有者が替わる。
 * 手続き中は取り下げられる。手続き中は旅行の削除と、受け取る人を共同編集者から外すことはできない。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import Button from '@/components/common/Button';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { cancelOwnershipTransfer, getOwnership, requestOwnershipTransfer } from '@/services/api/g8';
import type { KeepRole, OwnershipInfo } from '@/services/api/types/g8';

const KEEP_LABEL: Record<KeepRole, string> = {
  editor: '編集者として残る', viewer: '閲覧者として残る', none: '共同編集者から外れる',
};

const OwnershipTransferPanel: React.FC<{ planId: string; reloadKey?: number }> = ({ planId, reloadKey }) => {
  const [info, setInfo] = useState<OwnershipInfo | null>(null);
  const [target, setTarget] = useState('');
  const [keep, setKeep] = useState<KeepRole>('editor');
  const [password, setPassword] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setInfo(await getOwnership(planId));
    } catch (e) {
      setError(errorDetailMessage(e, '所有者の移譲の状態を取得できませんでした'));
    }
  }, [planId]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  if (!info || info.role !== 'owner') return null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const t = await requestOwnershipTransfer(planId, target, password, keep, note.trim() || undefined);
      setPassword('');
      setNote('');
      setDone(`${t.to_name} さんへ申し出ました(期限 ${new Date(t.expires_at).toLocaleDateString('ja-JP')})。相手が受け入れると所有者が替わります。`);
      await load();
    } catch (e) {
      setError(errorDetailMessage(e, '申し出に失敗しました'));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    setError(null);
    try {
      await cancelOwnershipTransfer(planId);
      setDone('移譲の申し出を取り下げました。');
      await load();
    } catch (e) {
      setError(errorDetailMessage(e, '取り下げに失敗しました'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-6 border-t pt-4" aria-labelledby="ownership-heading">
      <h3 id="ownership-heading" className="font-semibold text-gray-900 flex items-center gap-2">
        <KeyRound size={18} aria-hidden="true" />所有者の移譲
      </h3>
      <p className="text-sm text-gray-700 mt-1">
        旅行の所有者を、参加済みの共同編集者へ引き継ぎます。相手が受け入れるまで所有者は替わりません。
      </p>
      <div aria-live="polite">{done && <p className="text-sm text-green-800 mt-2" role="status">{done}</p>}</div>
      {error && <p className="text-sm text-red-800 mt-2" role="alert">{error}</p>}
      {info.pending && info.pending.status === 'pending' ? (
        <div className="mt-2 p-3 rounded-sm bg-amber-50 text-amber-900 text-sm" data-testid="ownership-pending">
          <p>{`${info.pending.to_name} さんへ移譲を申し出ています(期限 ${new Date(info.pending.expires_at).toLocaleString('ja-JP')})。`}</p>
          <p className="mt-1">{`受け入れ後のあなた: ${KEEP_LABEL[info.pending.keep_role]}`}</p>
          <Button variant="outline" size="sm" className="mt-2" loading={busy} onClick={cancel}>申し出を取り下げる</Button>
        </div>
      ) : info.candidates.length === 0 ? (
        <p className="text-sm text-gray-700 mt-2">移譲できる相手がいません(招待を承諾した会員の共同編集者を選べます)。</p>
      ) : !info.can_transfer ? (
        <p className="text-sm text-gray-700 mt-2">所有者の移譲は会員登録したアカウントだけが使えます。</p>
      ) : (
        <form className="mt-2 grid gap-2 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <div>
            <label htmlFor="ownership-target" className="block text-xs text-gray-800">引き継ぐ人</label>
            <select id="ownership-target" className="w-full border rounded-sm px-2 py-1 text-sm" value={target}
              onChange={(e) => setTarget(e.target.value)}>
              <option value="">選ぶ</option>
              {info.candidates.map((c) => <option key={c.collaborator_id} value={c.collaborator_id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="ownership-keep" className="block text-xs text-gray-800">引き継いだ後のあなた</label>
            <select id="ownership-keep" className="w-full border rounded-sm px-2 py-1 text-sm" value={keep}
              onChange={(e) => setKeep(e.target.value as KeepRole)}>
              {(Object.keys(KEEP_LABEL) as KeepRole[]).map((k) => <option key={k} value={k}>{KEEP_LABEL[k]}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="ownership-note" className="block text-xs text-gray-800">ひとこと(任意・500文字まで)</label>
            <input id="ownership-note" maxLength={500} className="w-full border rounded-sm px-2 py-1 text-sm" value={note}
              onChange={(e) => setNote(e.target.value)} />
          </div>
          <div>
            <label htmlFor="ownership-password" className="block text-xs text-gray-800">本人確認のためのパスワード</label>
            <input id="ownership-password" type="password" autoComplete="current-password"
              className="w-full border rounded-sm px-2 py-1 text-sm" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button type="submit" variant="primary" size="sm" loading={busy} disabled={!target || !password}>
              移譲を申し出る
            </Button>
          </div>
          <p className="text-xs text-gray-700 sm:col-span-2">
            {`申し出の期限は${info.transfer_days}日です。手続き中は旅行の削除と、引き継ぐ人を外すことはできません。`}
          </p>
        </form>
      )}
    </section>
  );
};

export default OwnershipTransferPanel;
