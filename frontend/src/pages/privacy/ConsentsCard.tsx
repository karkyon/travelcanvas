/**
 * [Gate P9] 目的別の同意と撤回(DOC-11 §15 Consent withdrawal、SC-29)。
 * 切り替えるとすぐに保存する。既定は全て「同意しない」。
 */
import React, { useEffect, useState } from 'react';
import Card from '@/components/common/Card';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { getConsents, updateConsents } from '@/services/api';
import type { ConsentItem, ConsentPurpose } from '@/services/api';
import { errorDetailMessage } from '@/utils/apiErrorDetail';

const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ja-JP') : null);

const ConsentsCard: React.FC = () => {
  const [items, setItems] = useState<ConsentItem[] | null>(null);
  const [saving, setSaving] = useState<ConsentPurpose | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    getConsents().then((s) => setItems(s.purposes)).catch((e) => setError(errorDetailMessage(e, '同意の状態を取得できませんでした')));
  }, []);

  const toggle = async (item: ConsentItem, granted: boolean) => {
    setSaving(item.purpose);
    setError(null);
    setMessage(null);
    try {
      const s = await updateConsents({ [item.purpose]: granted });
      setItems(s.purposes);
      setMessage(`「${item.label}」を${granted ? '同意する' : '同意しない'}に変更しました。`);
    } catch (e) {
      setError(errorDetailMessage(e, '同意の変更を保存できませんでした'));
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card padding="md" className="mt-4">
      <section aria-labelledby="consents-heading">
        <h2 id="consents-heading" className="font-semibold text-ink-900">同意の管理</h2>
        <p className="text-sm text-ink-700 mt-1">
          目的ごとに、データの使い方に同意するかを選べます。いつでも撤回でき、撤回した後はその目的の処理を行いません。
          最初はすべて「同意しない」です。
        </p>
        <div aria-live="polite">{message && <p className="text-sm text-green-900 mt-2" role="status">{message}</p>}</div>
        {error && <p className="text-sm text-red-800 mt-2" role="alert">{error}</p>}
        {!items && !error ? <div className="flex justify-center py-6"><LoadingSpinner /></div> : items && (
          <ul className="mt-3 divide-y" aria-label="同意の一覧">
            {items.map((i) => (
              <li key={i.purpose} className="py-2">
                <label className="flex items-start gap-3">
                  <input type="checkbox" className="mt-1" checked={i.granted} disabled={saving !== null}
                    onChange={(e) => void toggle(i, e.target.checked)} />
                  <span>
                    <span className="font-medium text-ink-900">{i.label}</span>
                    <span className="ml-2 text-sm text-ink-700">{i.granted ? '同意しています' : '同意していません'}</span>
                    <span className="block text-sm text-ink-700">{i.description}</span>
                    {!i.in_use && <span className="block text-xs text-ink-700">現在、この目的の処理を行う機能はありません。</span>}
                    {i.updated_at && <span className="block text-xs text-ink-700">最終変更: {formatDate(i.updated_at)}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Card>
  );
};

export default ConsentsCard;
