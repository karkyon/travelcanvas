/**
 * CorrectionRequestsPage - 旅行の中の本人に関わる情報の訂正の申し出(/planner/:planId/corrections、FR-039)。
 *
 * [Gate G8] 参加者は、旅行の所有者へ「どの情報を・どう直してほしいか・その根拠」を申し出る(内容は旅行のデータ鍵で
 * 暗号化して保存)。所有者は全ての申し出を見て、旅行の画面で直したら「対応した」、直さない時は「見送る」を理由つきで
 * 記録する(申し出た人へ通知)。参加者は自分の申し出だけを見る。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import {
  createCorrectionRequest, getOwnership, listCorrectionRequests, resolveCorrectionRequest,
} from '@/services/api/g8';
import type { CorrectionRequest, CorrectionSource } from '@/services/api/types/g8';

const SOURCES: Array<{ value: CorrectionSource; label: string }> = [
  { value: 'self_statement', label: '本人の申告' }, { value: 'official_document', label: '公的な書類' },
  { value: 'booking_document', label: '予約の確認書' }, { value: 'other', label: 'その他' },
];
const STATUS: Record<string, string> = { open: '確認待ち', resolved: '対応済み', declined: '見送り' };

const CorrectionRequestsPage: React.FC = () => {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const [role, setRole] = useState<string | null>(null);
  const [rows, setRows] = useState<CorrectionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState('');
  const [current, setCurrent] = useState('');
  const [proposed, setProposed] = useState('');
  const [source, setSource] = useState<CorrectionSource>('self_statement');
  const [note, setNote] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!planId) return;
    try {
      const [o, list] = await Promise.all([getOwnership(planId), listCorrectionRequests(planId)]);
      setRole(o.role);
      setRows(list);
    } catch (e) {
      setError(errorDetailMessage(e, '訂正の申し出を取得できませんでした'));
    } finally {
      setLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    if (!planId) return;
    setBusy('new');
    setError(null);
    setMessage(null);
    try {
      await createCorrectionRequest(planId, {
        field_label: label.trim(), proposed_value: proposed.trim(), source,
        ...(current.trim() ? { current_value: current.trim() } : {}), ...(note.trim() ? { source_note: note.trim() } : {}),
      });
      setLabel('');
      setCurrent('');
      setProposed('');
      setNote('');
      setMessage('所有者へ申し出ました。所有者が対応すると知らせが届きます。');
      await load();
    } catch (e) {
      setError(errorDetailMessage(e, '申し出に失敗しました'));
    } finally {
      setBusy(null);
    }
  };

  const resolve = async (r: CorrectionRequest, status: 'resolved' | 'declined') => {
    if (!planId) return;
    setBusy(r.id);
    setError(null);
    setMessage(null);
    try {
      await resolveCorrectionRequest(planId, r.id, status, notes[r.id]?.trim() || undefined);
      setMessage(status === 'resolved' ? '対応したことを記録しました。' : '見送ったことを記録しました。');
      await load();
    } catch (e) {
      setError(errorDetailMessage(e, '記録に失敗しました'));
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>;
  const isOwner = role === 'owner';

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <Button variant="ghost" size="sm" onClick={() => navigate(`/planner/${planId}`)} className="mb-2">← プランへ戻る</Button>
      <h1 className="text-2xl font-bold text-ink-900">情報の訂正の申し出</h1>
      <p className="text-sm text-ink-700 mt-1">
        {isOwner
          ? '参加者から届いた、旅行の中の情報(予約の名義・参加者の名前など)の訂正の申し出です。旅行の画面で直したら「対応した」を記録してください。'
          : 'この旅行の中のあなたに関わる情報が違う時に、所有者へ直してもらうよう申し出ます。根拠(出典)を添えてください。'}
      </p>
      <div aria-live="polite">{message && <p className="mt-3 p-3 rounded-lg bg-green-50 text-green-900 text-sm" role="status">{message}</p>}</div>
      {error && <p className="mt-3 p-3 rounded-lg bg-red-50 text-red-800 text-sm" role="alert">{error}</p>}

      {!isOwner && role && (
        <Card padding="md" className="mt-4">
          <section aria-labelledby="new-correction">
            <h2 id="new-correction" className="font-semibold text-ink-900">申し出る</h2>
            <form className="grid gap-2 sm:grid-cols-2 mt-2" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
              <div>
                <label htmlFor="cr-label" className="block text-xs text-ink-900">どの情報か(例: 予約の名義)</label>
                <input id="cr-label" maxLength={80} className="w-full border rounded-sm px-2 py-1 text-sm" value={label}
                  onChange={(e) => setLabel(e.target.value)} />
              </div>
              <div>
                <label htmlFor="cr-current" className="block text-xs text-ink-900">今の表示(任意)</label>
                <input id="cr-current" maxLength={500} className="w-full border rounded-sm px-2 py-1 text-sm" value={current}
                  onChange={(e) => setCurrent(e.target.value)} />
              </div>
              <div>
                <label htmlFor="cr-proposed" className="block text-xs text-ink-900">正しい内容</label>
                <input id="cr-proposed" maxLength={500} className="w-full border rounded-sm px-2 py-1 text-sm" value={proposed}
                  onChange={(e) => setProposed(e.target.value)} />
              </div>
              <div>
                <label htmlFor="cr-source" className="block text-xs text-ink-900">根拠(出典)</label>
                <select id="cr-source" className="w-full border rounded-sm px-2 py-1 text-sm" value={source}
                  onChange={(e) => setSource(e.target.value as CorrectionSource)}>
                  {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="cr-note" className="block text-xs text-ink-900">根拠の補足(任意)</label>
                <input id="cr-note" maxLength={500} className="w-full border rounded-sm px-2 py-1 text-sm" value={note}
                  onChange={(e) => setNote(e.target.value)} />
              </div>
              <div>
                <Button type="submit" variant="primary" size="sm" loading={busy === 'new'} disabled={!label.trim() || !proposed.trim()}>
                  所有者へ申し出る
                </Button>
              </div>
            </form>
          </section>
        </Card>
      )}

      <Card padding="md" className="mt-4">
        <section aria-labelledby="correction-list">
          <h2 id="correction-list" className="font-semibold text-ink-900">{isOwner ? '届いた申し出' : 'あなたの申し出'}</h2>
          {rows.length === 0 ? <p className="text-sm text-ink-700 mt-2">申し出はありません。</p> : (
            <ul className="mt-2 divide-y" aria-label={isOwner ? '届いた申し出' : 'あなたの申し出'}>
              {rows.map((r) => (
                <li key={r.id} className="py-3 text-sm" data-testid={`correction-request-${r.id}`}>
                  <p className="text-ink-900 font-medium">
                    {`${r.field_label ?? ''}: ${r.current_value ? `${r.current_value} → ` : ''}${r.proposed_value ?? ''}`}
                  </p>
                  <p className="text-xs text-ink-700">
                    {`${r.requester_name ? `${r.requester_name}・` : ''}出典: ${r.source_label}${r.source_note ? `(${r.source_note})` : ''}`
                      + `・${STATUS[r.status]}${r.resolution_note ? `・所有者: ${r.resolution_note}` : ''}`}
                  </p>
                  {isOwner && r.status === 'open' && (
                    <div className="flex flex-wrap items-end gap-2 mt-2">
                      <div>
                        <label htmlFor={`cr-res-${r.id}`} className="block text-xs text-ink-900">ひとこと(任意)</label>
                        <input id={`cr-res-${r.id}`} maxLength={500} className="border rounded-sm px-2 py-1 text-sm"
                          value={notes[r.id] ?? ''} onChange={(e) => setNotes((p) => ({ ...p, [r.id]: e.target.value }))} />
                      </div>
                      <Button variant="primary" size="sm" loading={busy === r.id} onClick={() => resolve(r, 'resolved')}>対応した</Button>
                      <Button variant="ghost" size="sm" disabled={busy === r.id} onClick={() => resolve(r, 'declined')}>見送る</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </Card>
    </div>
  );
};

export default CorrectionRequestsPage;
