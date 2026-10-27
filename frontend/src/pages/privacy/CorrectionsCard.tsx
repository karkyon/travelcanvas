/**
 * [Gate G8] FR-039 出典・確認・履歴つきの訂正(データとプライバシーの画面)。
 *
 * 表示名・メールアドレスを、出典(本人の申告・公的な書類・予約の確認書・その他)と補足を添えて訂正する。メールアドレスは
 * パスワードで本人確認する(確認済みの印が外れ、他の端末はログアウトする)。履歴から取り消せる(今の値が訂正の後の
 * ままの時だけ)。共同の旅行の所有者へ出した訂正の申し出の状態も見られる。
 */
import React, { useCallback, useEffect, useState } from 'react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { createCorrection, getCorrections, revertCorrection } from '@/services/api/g8';
import type { CorrectionSource, CorrectionsOverview } from '@/services/api/types/g8';

const STATUS: Record<string, string> = {
  applied: '訂正済み', reverted: '取り消し済み', open: '所有者の確認待ち', resolved: '対応済み', declined: '見送り',
};

const CorrectionsCard: React.FC = () => {
  const [data, setData] = useState<CorrectionsOverview | null>(null);
  const [field, setField] = useState<'username' | 'email'>('username');
  const [value, setValue] = useState('');
  const [source, setSource] = useState<CorrectionSource>('self_statement');
  const [note, setNote] = useState('');
  const [password, setPassword] = useState('');
  const [revertPassword, setRevertPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getCorrections());
    } catch (e) {
      setError(errorDetailMessage(e, '訂正の履歴を取得できませんでした'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const needsPassword = data?.fields.find((f) => f.field === field)?.requires_password ?? field === 'email';

  const submit = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const c = await createCorrection({ field, value, source, ...(note.trim() ? { source_note: note.trim() } : {}),
        ...(needsPassword ? { password } : {}) });
      setValue('');
      setNote('');
      setPassword('');
      setMessage(`${c.field_label}を訂正しました(出典: ${c.source_label})。`
        + (field === 'email' ? '新しいメールアドレスの確認が済むまで、確認済みの印は外れます。' : ''));
      await load();
    } catch (e) {
      setError(errorDetailMessage(e, '訂正に失敗しました'));
    } finally {
      setBusy(false);
    }
  };

  const revert = async (id: string, isEmail: boolean) => {
    const pw = isEmail ? revertPassword : undefined;
    if (isEmail && !pw) {
      setError('メールアドレスの訂正を取り消すには、パスワードを入力してください');
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await revertCorrection(id, pw);
      setRevertPassword('');
      setMessage('訂正を取り消しました。');
      await load();
    } catch (e) {
      setError(errorDetailMessage(e, '取り消しに失敗しました'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card padding="md" className="mt-4">
      <section aria-labelledby="corrections-heading">
        <h2 id="corrections-heading" className="font-semibold text-gray-900">情報の訂正</h2>
        <p className="text-sm text-gray-700 mt-1">
          アカウントの情報を、根拠(出典)を添えて直します。訂正の前後と根拠は履歴に残り、あなただけが見られます。
        </p>
        <div aria-live="polite">{message && <p className="text-sm text-green-800 mt-2" role="status">{message}</p>}</div>
        {error && <p className="text-sm text-red-800 mt-2" role="alert">{error}</p>}
        {data && (
          <form className="grid gap-2 sm:grid-cols-2 mt-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <div>
              <label htmlFor="corr-field" className="block text-xs text-gray-800">直す項目</label>
              <select id="corr-field" className="w-full border rounded-sm px-2 py-1 text-sm" value={field}
                onChange={(e) => setField(e.target.value as 'username' | 'email')}>
                {data.fields.map((f) => <option key={f.field} value={f.field}>{f.label}</option>)}
              </select>
              <p className="text-xs text-gray-700 mt-0.5">{`今の値: ${data.current[field] ?? '(なし)'}`}</p>
            </div>
            <div>
              <label htmlFor="corr-value" className="block text-xs text-gray-800">正しい値</label>
              <input id="corr-value" className="w-full border rounded-sm px-2 py-1 text-sm" maxLength={254} value={value}
                type={field === 'email' ? 'email' : 'text'} onChange={(e) => setValue(e.target.value)} />
            </div>
            <div>
              <label htmlFor="corr-source" className="block text-xs text-gray-800">根拠(出典)</label>
              <select id="corr-source" className="w-full border rounded-sm px-2 py-1 text-sm" value={source}
                onChange={(e) => setSource(e.target.value as CorrectionSource)}>
                {data.sources.map((s) => <option key={s.source} value={s.source}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="corr-note" className="block text-xs text-gray-800">根拠の補足(任意・500文字まで)</label>
              <input id="corr-note" className="w-full border rounded-sm px-2 py-1 text-sm" maxLength={500} value={note}
                onChange={(e) => setNote(e.target.value)} />
            </div>
            {needsPassword && (
              <div>
                <label htmlFor="corr-password" className="block text-xs text-gray-800">本人確認のためのパスワード</label>
                <input id="corr-password" type="password" autoComplete="current-password"
                  className="w-full border rounded-sm px-2 py-1 text-sm" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            )}
            <div className="flex items-end">
              <Button type="submit" variant="primary" size="sm" loading={busy}
                disabled={!value.trim() || (needsPassword && !password)}>訂正する</Button>
            </div>
          </form>
        )}
        {data && data.history.length > 0 && (
          <>
            <h3 className="font-medium text-gray-900 mt-4">訂正の履歴</h3>
            {data.history.some((h) => h.field === 'email' && h.status === 'applied') && (
              <div className="mt-1">
                <label htmlFor="corr-revert-password" className="block text-xs text-gray-800">
                  メールアドレスの訂正を取り消す時のパスワード
                </label>
                <input id="corr-revert-password" type="password" autoComplete="current-password"
                  className="border rounded-sm px-2 py-1 text-sm" value={revertPassword}
                  onChange={(e) => setRevertPassword(e.target.value)} />
              </div>
            )}
            <ul className="mt-1 divide-y" aria-label="訂正の履歴">
              {data.history.map((h) => (
                <li key={h.id} className="py-2 text-sm">
                  <p className="text-gray-900">{`${h.field_label}: ${h.before ?? '(なし)'} → ${h.after ?? '(なし)'}`}</p>
                  <p className="text-xs text-gray-700">
                    {`${h.created_at ? new Date(h.created_at).toLocaleString('ja-JP') : ''}・出典: ${h.source_label}`
                      + `${h.source_note ? `(${h.source_note})` : ''}・確認: ${h.verification === 'password' ? 'パスワード' : 'ログイン中の本人'}`
                      + `・${STATUS[h.status]}`}
                  </p>
                  {h.status === 'applied' && (
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => revert(h.id, h.field === 'email')}>
                      この訂正を取り消す
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        {data && data.requests.length > 0 && (
          <>
            <h3 className="font-medium text-gray-900 mt-4">旅行の所有者への訂正の申し出</h3>
            <ul className="mt-1 divide-y" aria-label="訂正の申し出">
              {data.requests.map((r) => (
                <li key={r.id} className="py-2 text-sm">
                  <p className="text-gray-900">{`${r.plan_title ?? '(見られない旅行)'}: ${r.field_label ?? ''} → ${r.proposed_value ?? ''}`}</p>
                  <p className="text-xs text-gray-700">
                    {`${STATUS[r.status]}${r.resolution_note ? `(所有者: ${r.resolution_note})` : ''}`}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </Card>
  );
};

export default CorrectionsCard;
