/**
 * CandidatesPage - 候補箱(DOC-04 SC-08、FR-007、DOC-14 §7.1/7.2)。
 *
 * [Gate C2] backend/app/api/v1/candidates.py の画面。
 * - URL・テキスト・手入力で候補を足す。URL は追跡用のパラメータを外して出典として残す(サーバーから取りに行かない)
 * - 候補カード: 出典(元の URL・提供元・取得時刻)、登録した人、優先度、状態(候補 / 予定に配置済み / 見送り)、重複の候補(理由つき)
 * - 旅程に追加(日・時刻)。候補は消えない。予定を消すと候補に戻る。重複はまとめられる(自動では消さない)
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import api, {
  createCandidate, deleteCandidate, getCandidates, mergeCandidate, scheduleCandidate, updateCandidate,
} from '@/services/api';
import type { CandidateList, NormalizedDay, PlanCandidateItem } from '@/services/api';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { safeExternalUrl } from '@/utils/safeNavigation';

const REASON_LABEL: Record<string, string> = {
  same_provider_id: '同じ提供元の場所', same_name: '同じ名前', nearby: '100m以内', same_address: '同じ住所', same_url: '同じURL',
};
const PRIORITY_LABEL: Record<number, string> = { 1: '高', 2: '中', 3: '低' };
const STATUS_BADGE: Record<string, string> = {
  open: 'bg-indigo-50 text-indigo-900', scheduled: 'bg-green-50 text-green-900', dismissed: 'bg-gray-100 text-ink-900',
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }) : '');

const CandidatesPage: React.FC = () => {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<CandidateList | null>(null);
  const [days, setDays] = useState<NormalizedDay[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: '', source_url: '', note: '', priority: 2 });
  const [scheduling, setScheduling] = useState<Record<string, { day_id: string; time: string }>>({});
  const [showDismissed, setShowDismissed] = useState(false);

  const load = useCallback(async () => {
    if (!planId) return;
    try {
      const [list, detail] = await Promise.all([getCandidates(planId), api.getPlanDetail(planId)]);
      setData(list);
      setDays(detail.data?.days ?? []);
    } catch (e) {
      setError(errorDetailMessage(e, '候補箱を取得できませんでした'));
    } finally {
      setIsLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!planId) return <div className="p-8 text-center text-ink-700">プランが選択されていません。</div>;

  const run = async (fn: () => Promise<CandidateList | void>, done: string, fallback: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fn();
      if (res) setData((d) => ({ ...res, can_edit: d?.can_edit ?? res.can_edit }));
      else await load();
      setMessage(done);
    } catch (e) {
      setError(errorDetailMessage(e, fallback));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const input = {
      title: form.title.trim() || null, source_url: form.source_url.trim() || null, note: form.note.trim() || null,
      priority: form.priority,
    };
    if (!input.title && !input.source_url) {
      setError('名前か URL を入力してください');
      return;
    }
    run(async () => {
      const res = await createCandidate(planId, input);
      setForm({ title: '', source_url: '', note: '', priority: 2 });
      return res;
    }, '候補を追加しました', '候補を追加できませんでした');
  };

  const canEdit = Boolean(data?.can_edit);
  const items = (data?.items ?? []).filter((c) => showDismissed || c.status !== 'dismissed');
  const titleOf = (id: string) => data?.items.find((c) => c.id === id)?.title ?? '';

  const schedule = (c: PlanCandidateItem) => {
    const s = scheduling[c.id] ?? { day_id: days[0]?.id ?? '', time: '' };
    if (!s.day_id) {
      setError('先に日程を作ってください');
      return;
    }
    run(() => scheduleCandidate(planId, c.id, { day_id: s.day_id, local_start_time: s.time || null }, c.revision),
      `「${c.title}」を旅程に追加しました`, '旅程に追加できませんでした。画面を読み込み直してください');
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <Button variant="ghost" size="sm" onClick={() => navigate(`/planner/${planId}`)} className="mb-2">← プランへ戻る</Button>
      <h1 className="text-2xl font-bold text-ink-900">候補箱</h1>
      <p className="text-sm text-ink-700 mt-1">
        行きたい場所・気になる店を、まだ予定にしないで貯めておけます。旅程に追加しても候補は残り、予定を消すと候補に戻ります。
        URL はページを取りに行かず、出典として残すだけです(追跡用の付け足しは外します)。
      </p>
      {error && <div className="mt-4 p-3 rounded-lg bg-red-50 text-red-800 text-sm" role="alert">{error}</div>}
      {message && <div className="mt-4 p-3 rounded-lg bg-green-50 text-green-900 text-sm" role="status">{message}</div>}

      {isLoading ? (
        <div className="py-12 flex justify-center"><LoadingSpinner /></div>
      ) : data && (
        <>
          {canEdit && (
            <Card className="mt-4 p-4">
              <form aria-label="候補を追加" onSubmit={add} className="space-y-3">
                <h2 className="text-lg font-semibold text-ink-900">候補を追加</h2>
                <label className="block text-sm text-ink-900">名前
                  <input className="mt-1 w-full border rounded-sm px-2 py-1 text-ink-900" value={form.title} maxLength={200}
                    onChange={(e) => setForm({ ...form, title: e.target.value })} />
                </label>
                <label className="block text-sm text-ink-900">URL(任意)
                  <input className="mt-1 w-full border rounded-sm px-2 py-1 text-ink-900" value={form.source_url} inputMode="url"
                    onChange={(e) => setForm({ ...form, source_url: e.target.value })} placeholder="https://" />
                </label>
                <label className="block text-sm text-ink-900">メモ(任意)
                  <textarea className="mt-1 w-full border rounded-sm px-2 py-1 text-ink-900" value={form.note} maxLength={2000}
                    rows={2} onChange={(e) => setForm({ ...form, note: e.target.value })} />
                </label>
                <label className="block text-sm text-ink-900">優先度
                  <select className="ml-2 border rounded-sm px-2 py-1 text-ink-900" value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}>
                    {[1, 2, 3].map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
                  </select>
                </label>
                <Button type="submit" disabled={busy}>候補に追加</Button>
              </form>
            </Card>
          )}

          <section aria-label="候補の一覧" className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-semibold text-ink-900">候補({data.counts.open}件・予定に配置済み {data.counts.scheduled}件)</h2>
              <label className="text-sm text-ink-900 inline-flex items-center gap-1">
                <input type="checkbox" checked={showDismissed} onChange={() => setShowDismissed((v) => !v)} />
                見送り・まとめた候補も出す({data.counts.dismissed}件)
              </label>
            </div>
            {data.duplicate_pairs > 0 && (
              <p className="text-sm text-amber-900">重複の可能性がある候補が {data.duplicate_pairs}組あります(自動では消しません)。</p>
            )}
            {items.length === 0 && <p className="text-ink-700">候補はまだありません。</p>}
            {items.map((c) => {
              const headingId = `cand-${c.id}`;
              const s = scheduling[c.id] ?? { day_id: days[0]?.id ?? '', time: '' };
              return (
                <Card key={c.id} className="p-4">
                  <article aria-labelledby={headingId}>
                    <div className="flex flex-wrap items-baseline gap-2">
                      <h3 id={headingId} className="font-semibold text-ink-900">{c.title}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-sm ${STATUS_BADGE[c.status]}`} data-testid="candidate-status">{c.status_label}</span>
                      <span className="text-xs text-ink-700">優先度 {PRIORITY_LABEL[c.priority]}</span>
                    </div>
                    <p className="text-sm text-ink-700 mt-1">
                      {c.created_by} が {fmt(c.created_at)} に追加
                      {c.source_url && (safeExternalUrl(c.source_url)
                        ? <>・出典 <a className="text-indigo-800 underline" href={safeExternalUrl(c.source_url) ?? undefined} target="_blank" rel="noopener noreferrer nofollow">{c.source_label}</a></>
                        : <>・出典 {c.source_label}</>
                      )}
                      {c.provider && `・${c.provider}${c.retrieved_at ? `(${fmt(c.retrieved_at)}取得)` : ''}`}
                    </p>
                    {c.note && <p className="text-sm text-ink-900 mt-1 whitespace-pre-wrap">{c.note}</p>}
                    {c.merged_from.length > 0 && (
                      <p className="text-sm text-ink-900 mt-1">まとめた候補: {c.merged_from.map((m) => m.title).join('、')}</p>
                    )}
                    {c.merged_into_id && <p className="text-sm text-ink-900 mt-1">「{titleOf(c.merged_into_id)}」にまとめました</p>}
                    {c.duplicates.map((d) => (
                      <div key={d.id} className="mt-2 text-sm text-amber-900 flex flex-wrap items-center gap-2">
                        <span>「{d.title}」と重複の可能性({d.reasons.map((r) => REASON_LABEL[r] ?? r).join('・')})</span>
                        {canEdit && c.status !== 'scheduled' && (
                          <Button size="sm" variant="outline" disabled={busy} aria-label={`${c.title}を「${d.title}」にまとめる`}
                            onClick={() => run(() => mergeCandidate(planId, c.id, d.id, c.revision),
                              `「${c.title}」を「${d.title}」にまとめました`, 'まとめられませんでした')}>
                            こちらを「{d.title}」にまとめる
                          </Button>
                        )}
                      </div>
                    ))}
                    {canEdit && (
                      <div className="mt-3 flex flex-wrap items-end gap-2">
                        {c.status === 'open' && (
                          <>
                            <label className="text-sm text-ink-900">日
                              <select className="ml-1 border rounded-sm px-2 py-1 text-ink-900" value={s.day_id}
                                onChange={(e) => setScheduling((x) => ({ ...x, [c.id]: { ...s, day_id: e.target.value } }))}>
                                {days.map((d) => <option key={d.id} value={d.id}>{d.local_date}{d.title ? ` ${d.title}` : ''}</option>)}
                              </select>
                            </label>
                            <label className="text-sm text-ink-900">時刻
                              <input type="time" className="ml-1 border rounded-sm px-2 py-1 text-ink-900" value={s.time}
                                onChange={(e) => setScheduling((x) => ({ ...x, [c.id]: { ...s, time: e.target.value } }))} />
                            </label>
                            <Button size="sm" disabled={busy || days.length === 0} onClick={() => schedule(c)}
                              aria-label={`${c.title}を旅程に追加`}>旅程に追加</Button>
                            <Button size="sm" variant="outline" disabled={busy} aria-label={`${c.title}を見送る`}
                              onClick={() => run(() => updateCandidate(planId, c.id, { status: 'dismissed' }, c.revision),
                                `「${c.title}」を見送りにしました`, '変更できませんでした')}>見送る</Button>
                          </>
                        )}
                        {c.status === 'dismissed' && (
                          <Button size="sm" variant="outline" disabled={busy} aria-label={`${c.title}を候補に戻す`}
                            onClick={() => run(() => updateCandidate(planId, c.id, { status: 'open' }, c.revision),
                              `「${c.title}」を候補に戻しました`, '変更できませんでした')}>候補に戻す</Button>
                        )}
                        {c.place_id && (
                          <Link className="text-sm text-indigo-800 underline" to={`/planner/${planId}/places/${c.place_id}`}>場所の詳細</Link>
                        )}
                        <Button size="sm" variant="ghost" disabled={busy} aria-label={`${c.title}を削除`}
                          onClick={() => {
                            if (!window.confirm(`「${c.title}」を候補箱から削除しますか?(予定は消えません)`)) return;
                            run(() => deleteCandidate(planId, c.id), `「${c.title}」を削除しました`, '削除できませんでした');
                          }}>削除</Button>
                      </div>
                    )}
                  </article>
                </Card>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
};

export default CandidatesPage;
