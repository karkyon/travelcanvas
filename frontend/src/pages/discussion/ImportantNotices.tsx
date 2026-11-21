/**
 * [Gate② FC-064] 重大な変更・集合の変更のお知らせ。メンバーは「確認しました」を押し、編集できる人は誰がまだかを見る。
 */
import React, { useCallback, useEffect, useState } from 'react';
import Button from '@/components/common/Button';
import { acknowledgeNotice, createNotice, getNotices, type NoticeKind, type PlanNoticeItem } from '@/services/api/planNotices';
import { errorDetailMessage } from '@/utils/apiErrorDetail';

const field = 'tc-focus-ring mt-1 block w-full rounded-lg border border-cloud-200 bg-cloud-0 px-2 py-1 text-sm';

const ImportantNotices: React.FC<{ planId: string }> = ({ planId }) => {
  const [items, setItems] = useState<PlanNoticeItem[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ open: boolean; kind: NoticeKind; title: string; body: string }>(
    { open: false, kind: 'meeting_change', title: '', body: '' });
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await getNotices(planId);
      setItems(r.items);
      setCanEdit(r.can_edit);
    } catch {
      setError('お知らせを読めませんでした');
    }
  }, [planId]);
  useEffect(() => { void load(); }, [load]);
  const replace = (n: PlanNoticeItem) => setItems((list) => list.map((x) => (x.id === n.id ? n : x)));
  const ack = async (n: PlanNoticeItem) => {
    setError(null);
    try { replace(await acknowledgeNotice(planId, n.id)); } catch (e) { setError(errorDetailMessage(e, '確認を記録できませんでした')); }
  };
  const send = async () => {
    if (!form.title.trim()) { setError('題名を入れてください'); return; }
    setBusy(true);
    setError(null);
    try {
      const n = await createNotice(planId, form.kind, form.title.trim(), form.body);
      setItems((list) => [n, ...list]);
      setForm({ open: false, kind: 'meeting_change', title: '', body: '' });
    } catch (e) {
      setError(errorDetailMessage(e, 'お知らせを出せませんでした'));
    } finally {
      setBusy(false);
    }
  };
  if (!canEdit && items.length === 0 && !error) return null;
  return (
    <section className="mb-6 rounded-xl border border-cloud-200 p-3" aria-labelledby="notices-h" data-testid="important-notices">
      <h2 id="notices-h" className="tc-section-title">確認してほしいお知らせ</h2>
      <p className="text-xs text-ink-700">重大な変更・集合の変更を全員に知らせ、誰が確認したかを残します。</p>
      {error && <p role="alert" className="text-sm text-danger mt-1">{error}</p>}
      <ul className="mt-2 space-y-2">
        {items.map((n) => (
          <li key={n.id} className="rounded-lg border border-cloud-200 p-2 text-sm" data-testid={`notice-${n.id}`}>
            <p className="m-0"><b>{`${n.kind_label}: ${n.title}`}</b></p>
            {n.body && <p className="m-0 whitespace-pre-wrap text-ink-700">{n.body}</p>}
            <p className="m-0 text-xs text-ink-700">{`${n.created_by} が出した · 確認 ${n.ack_count}/${n.member_count}人`}</p>
            {n.needs_my_ack && (
              <Button type="button" size="sm" className="mt-1" onClick={() => void ack(n)} data-testid={`notice-ack-${n.id}`}>確認しました</Button>
            )}
            {n.acknowledged && <p className="m-0 text-xs text-ink-700" data-testid={`notice-acked-${n.id}`}>確認済み</p>}
            {n.members && n.members.length > 0 && (
              <p className="m-0 text-xs text-ink-700" data-testid={`notice-members-${n.id}`}>
                {`まだ: ${n.members.filter((m) => !m.acknowledged).map((m) => m.name).join('、') || 'なし'} / 確認済み: ${n.members.filter((m) => m.acknowledged).map((m) => m.name).join('、') || 'なし'}`}
              </p>
            )}
          </li>
        ))}
      </ul>
      {canEdit && !form.open && (
        <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => setForm((f) => ({ ...f, open: true }))}
          data-testid="notice-new">お知らせを出す</Button>
      )}
      {canEdit && form.open && (
        <div className="mt-2 space-y-2" data-testid="notice-form">
          <label className="block text-xs font-medium text-ink-700">種類
            <select className={field} value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as NoticeKind }))}
              data-testid="notice-kind">
              <option value="meeting_change">集合の変更</option>
              <option value="major_change">重大な変更</option>
            </select>
          </label>
          <label className="block text-xs font-medium text-ink-700">題名(通知に出ます。120 字まで)
            <input className={field} maxLength={120} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              data-testid="notice-title" />
          </label>
          <label className="block text-xs font-medium text-ink-700">くわしく(任意。アプリの中だけに出ます)
            <textarea className={field} rows={2} maxLength={1000} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} />
          </label>
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={() => void send()} loading={busy} disabled={busy} data-testid="notice-send">出す</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setForm((f) => ({ ...f, open: false }))}>やめる</Button>
          </div>
        </div>
      )}
    </section>
  );
};

export default ImportantNotices;
