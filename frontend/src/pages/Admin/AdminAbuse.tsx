/**
 * [Gate G4] FC-097 濫用への対応(管理者・多要素認証の確認済みだけ)。backend: app/services/abuse.py。
 *
 * - 公開の共有への通報(詐欺・有害・迷惑・個人の情報など)と、自動の検知(大量の閲覧・合言葉の総当たり・共有の乱造・
 *   感染した文書)を一覧にする。旅行の中身は出さない(題名・所有者の ID・共有の状態・24時間の閲覧数だけ)
 * - 対応: 却下・共有を止める(所有者に知らせる)・濫用の対応で止めた共有を戻す。対応は監査に残る
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Card from '@/components/common/Card';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { actOnAbuseReport, getAbuseReports } from '@/services/api/g4';
import type { AbuseReportItem, AbuseReportList } from '@/services/api';
import { errorDetailMessage } from '@/utils/apiErrorDetail';

type StatusFilter = 'open' | 'dismissed' | 'actioned' | 'all';
const STATUS_LABEL: Record<AbuseReportItem['status'], string> = { open: '未対応', dismissed: '却下', actioned: '対応済み' };
const FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'open', label: '未対応' }, { value: 'actioned', label: '対応済み' }, { value: 'dismissed', label: '却下' },
  { value: 'all', label: 'すべて' },
];
const btn = 'px-3 py-1.5 rounded-lg text-sm border disabled:opacity-50';

function fmt(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('ja-JP');
}

const AdminAbuse: React.FC = () => {
  const [filter, setFilter] = useState<StatusFilter>('open');
  const [data, setData] = useState<AbuseReportList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setData(await getAbuseReports(filter));
      setError(null);
    } catch (e) {
      setError(errorDetailMessage(e, '通報の一覧を読めませんでした'));
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const ACTION_TEXT = {
    dismiss: { confirm: null, done: '却下しました' },
    revoke_share: { confirm: '共有を止めますか?(所有者に知らせます)', done: '共有を止めました' },
    restore_share: { confirm: '共有を戻しますか?', done: '共有を戻しました' },
  } as const;

  const act = async (r: AbuseReportItem, action: 'dismiss' | 'revoke_share' | 'restore_share') => {
    const text = ACTION_TEXT[action];
    if (text.confirm && !window.confirm(text.confirm)) return;
    setBusy(r.id);
    setError(null);
    try {
      await actOnAbuseReport(r.id, action, notes[r.id]?.trim() || undefined);
      setNotice(text.done);
      await load();
    } catch (e) {
      setError(errorDetailMessage(e, '対応を記録できませんでした'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <p className="mb-2"><Link to="/admin" className="text-blue-700 underline">管理者ダッシュボードへ</Link></p>
      <h1 className="text-2xl font-bold text-ink-900">濫用への対応</h1>
      <p className="text-sm text-ink-700 mt-1">公開の共有への通報と、自動の検知です。旅行の中身は表示しません。</p>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="状態で絞り込む">
        {FILTERS.map((f) => (
          <button key={f.value} type="button" aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}
            className={`text-sm px-3 py-1 rounded-full border ${filter === f.value ? 'bg-indigo-700 text-white border-indigo-700' : 'border-gray-300 text-ink-900'}`}>
            {f.label}{data && f.value !== 'all' ? `(${data.counts[f.value]})` : ''}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="mt-3 p-2 rounded-sm bg-red-50 text-red-800 text-sm">{error}</p>}
      {notice && <p role="status" className="mt-3 p-2 rounded-sm bg-green-50 text-green-900 text-sm">{notice}</p>}
      {!data && !error && <div className="flex justify-center py-12"><LoadingSpinner /></div>}
      {data && data.reports.length === 0 && <Card className="mt-4 p-6 text-center text-ink-700">該当する通報はありません。</Card>}
      <ul className="mt-4 space-y-3" aria-label="通報">
        {data?.reports.map((r) => (
          <li key={r.id}>
            <Card className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-ink-900">{r.reason_label}</span>
                <span className="text-xs px-2 py-0.5 rounded-sm bg-gray-100 text-ink-900">{r.source === 'auto' ? '自動の検知' : '通報'}</span>
                <span className="text-xs px-2 py-0.5 rounded-sm bg-indigo-100 text-indigo-900">{STATUS_LABEL[r.status]}</span>
                <span className="text-xs text-ink-700">{fmt(r.created_at)}</span>
              </div>
              {r.note && <p className="mt-1 text-sm text-ink-900">{r.note}</p>}
              <p className="mt-1 text-xs text-ink-700">
                旅行: {r.plan ? `${r.plan.title}(所有者 ${r.plan.owner_user_id.slice(0, 8)}…)` : '—'}
                {r.share && ` ・ 共有 …${r.share.token_prefix}・${r.share.is_active ? '有効' : '停止中'}・24時間の閲覧 ${r.share.accesses_24h}回`}
                {r.share?.revoked_reason && ` ・ 停止の理由 ${r.share.revoked_reason}`}
              </p>
              {r.resolution && <p className="mt-1 text-xs text-ink-700">対応: {r.resolution}</p>}
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className="text-sm text-ink-900">対応のメモ
                  <input className="ml-1 border rounded-sm px-2 py-1" maxLength={500} value={notes[r.id] ?? ''}
                    onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                </label>
                {r.status === 'open' && (
                  <button type="button" className={btn} disabled={busy === r.id} onClick={() => void act(r, 'dismiss')}>却下</button>
                )}
                {r.share && r.share.is_active && (
                  <button type="button" className={`${btn} border-red-300 text-red-800`} disabled={busy === r.id}
                    onClick={() => void act(r, 'revoke_share')}>共有を止める</button>
                )}
                {r.share && !r.share.is_active && (r.share.revoked_reason === 'abuse_auto' || r.share.revoked_reason === 'admin_abuse') && (
                  <button type="button" className={btn} disabled={busy === r.id}
                    onClick={() => void act(r, 'restore_share')}>共有を戻す</button>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default AdminAbuse;
