/**
 * [Gate C1] FR-023 秘匿プロフィール(設定 → 非公開の条件)。
 *
 * 旅行をまたいで使う非公開の条件を本人だけが登録する。旅行の「制約」画面で「この旅行に適用する」を選ぶと、
 * その旅行の確認(実行可能性チェック・並べ替え)に使われる。ほかの参加者には「秘匿制約を満たしていません」だけが伝わる。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import Button from '@/components/common/Button';
import { extractApiErrorDetailMessage, getPrivateProfile, putPrivateProfile } from '@/services/api';
import type { PrivateProfile, PrivateProfileItemInput, PrivateProfileKind } from '@/services/api';
import { KIND_OPTIONS, UNIT_LABEL, describeItem, draftToItem, emptyDraft, kindOption, type ItemDraft } from '@/utils/privateProfile';

function errorText(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return extractApiErrorDetailMessage(detail) ?? fallback;
}

const inputClass = 'w-full border rounded-lg px-3 py-2';

const PrivateProfileSection: React.FC = () => {
  const [profile, setProfile] = useState<PrivateProfile | null>(null);
  const [draft, setDraft] = useState<ItemDraft>(emptyDraft());
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setProfile(await getPrivateProfile());
    } catch (e) {
      setMessage({ type: 'error', text: errorText(e, '非公開の条件を読み込めませんでした') });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (items: PrivateProfileItemInput[], done: string) => {
    if (!profile) return;
    setIsSaving(true);
    setMessage(null);
    try {
      setProfile(await putPrivateProfile(items, profile.revision));
      setMessage({ type: 'ok', text: done });
      return true;
    } catch (e) {
      setMessage({ type: 'error', text: errorText(e, '保存できませんでした') });
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const current = (): PrivateProfileItemInput[] => (profile?.items ?? []).map((i) => ({
    id: i.id, kind: i.kind, label: i.label, hardness: i.hardness, value: i.value, unit: i.unit,
  }));

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const item = draftToItem(draft);
    if (typeof item === 'string') {
      setMessage({ type: 'error', text: item });
      return;
    }
    if (await save([...current(), item], '非公開の条件を保存しました')) setDraft(emptyDraft(draft.kind));
  };

  const handleRemove = (id: string) => save(current().filter((i) => i.id !== id), '非公開の条件を削除しました');

  const opt = kindOption(draft.kind);
  const full = !!profile && profile.items.length >= profile.max_items;

  return (
    <section aria-labelledby="private-profile-heading" className="space-y-4">
      <div>
        <h3 id="private-profile-heading" className="text-lg font-medium text-gray-900">非公開の条件(あなただけに見えます)</h3>
        <p className="text-sm text-gray-600 mt-1">
          体力・食事・予算など、ほかの参加者に詳しく知られたくない条件を登録します。旅行の「制約」画面で
          「この旅行に適用する」を選ぶと、その旅行の確認に使われます。ほかの参加者には「秘匿制約を満たしていません」
          とだけ伝わり、名前や値は見えません。運用者にも見えないよう暗号化して保存します。
        </p>
      </div>

      {message && (
        <p role={message.type === 'error' ? 'alert' : 'status'}
          className={`text-sm ${message.type === 'error' ? 'text-red-700' : 'text-green-800'}`}>{message.text}</p>
      )}
      {profile && !profile.readable && (
        <p role="alert" className="text-sm text-red-700">保存済みの内容を読めません(暗号鍵の問題)。管理者に連絡してください。</p>
      )}

      <div>
        <h4 className="text-sm font-medium text-gray-800 mb-2">登録した条件 {profile ? `${profile.items.length}件` : ''}</h4>
        {profile && profile.items.length === 0 ? (
          <p className="text-sm text-gray-500">まだありません</p>
        ) : (
          <ul className="space-y-2" aria-label="登録した非公開の条件">
            {profile?.items.map((i) => (
              <li key={i.id} className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2">
                <div>
                  <div className="font-medium text-gray-900">{i.label}</div>
                  <div className="text-sm text-gray-600">{describeItem(i)}</div>
                </div>
                <button type="button" onClick={() => void handleRemove(i.id)} disabled={isSaving}
                  className="text-gray-400 hover:text-red-600 p-1" aria-label={`${i.label}を削除`}>
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form onSubmit={handleAdd} className="rounded-lg border p-4 space-y-3" aria-label="非公開の条件を追加">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="pp-kind" className="block text-sm font-medium text-gray-700 mb-1">種類</label>
            <select id="pp-kind" className={inputClass} value={draft.kind}
              onChange={(e) => setDraft(emptyDraft(e.target.value as PrivateProfileKind))}>
              {KIND_OPTIONS.map((o) => <option key={o.kind} value={o.kind}>{o.label}</option>)}
            </select>
            <p className="text-xs text-gray-500 mt-1">{opt.hint}</p>
          </div>
          <div>
            <label htmlFor="pp-label" className="block text-sm font-medium text-gray-700 mb-1">名前(あなたにだけ表示)</label>
            <input id="pp-label" className={inputClass} maxLength={60} value={draft.label}
              placeholder="例: 朝はゆっくりしたい" onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))} />
          </div>
          <div>
            <label htmlFor="pp-value" className="block text-sm font-medium text-gray-700 mb-1">
              {opt.type === 'time' ? '時刻' : opt.type === 'number' ? '上限' : '語'}
            </label>
            <div className="flex gap-2">
              <input id="pp-value" className={inputClass}
                type={opt.type === 'time' ? 'time' : opt.type === 'number' ? 'number' : 'text'}
                min={opt.type === 'number' ? 0 : undefined} value={draft.value}
                onChange={(e) => setDraft((d) => ({ ...d, value: e.target.value }))} />
              {opt.type === 'number' && (
                <select aria-label="単位" className="border rounded-lg px-2" value={draft.unit}
                  onChange={(e) => setDraft((d) => ({ ...d, unit: e.target.value }))}>
                  {opt.units.map((u) => <option key={u} value={u}>{UNIT_LABEL[u] ?? u}</option>)}
                </select>
              )}
            </div>
          </div>
          <fieldset>
            <legend className="block text-sm font-medium text-gray-700 mb-1">強さ</legend>
            <div className="flex gap-4 text-sm pt-2">
              <label className="flex items-center gap-1">
                <input type="radio" name="pp-hardness" checked={draft.hardness === 'hard'}
                  onChange={() => setDraft((d) => ({ ...d, hardness: 'hard' }))} />必ず守る
              </label>
              <label className="flex items-center gap-1">
                <input type="radio" name="pp-hardness" checked={draft.hardness === 'soft'}
                  onChange={() => setDraft((d) => ({ ...d, hardness: 'soft' }))} />できれば
              </label>
            </div>
          </fieldset>
        </div>
        <Button type="submit" variant="primary" loading={isSaving} disabled={!profile || full || !profile.readable}>
          条件を追加して保存
        </Button>
        {full && <p className="text-xs text-gray-600">条件は{profile?.max_items}件までです</p>}
      </form>

      {profile && profile.applied_plans.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-gray-800 mb-1">適用している旅行</h4>
          <ul className="list-disc ml-5 text-sm">
            {profile.applied_plans.map((p) => (
              <li key={p.plan_id}><Link className="text-blue-700 underline" to={`/planner/${p.plan_id}/constraints`}>{p.title || '(名前のない旅行)'}</Link></li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};

export default PrivateProfileSection;
