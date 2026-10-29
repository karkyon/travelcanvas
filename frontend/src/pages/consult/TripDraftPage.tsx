/**
 * [Gate G11] 旅行相談から作った未確定の旅程の下書き(2026-10-29 の統合ハンドオフ §3「4)…旅程ドラフト」・§4.3)。
 *
 * - 「旅程ドラフト · まだ確定していません」。方面の名前を見出しに引き継ぐ(既存の例の旅行へは移らない)
 * - 1日目/2日目…のタブと「全日程を横断で見る」。時間帯(午前・昼食・午後・夕方・宿)に候補を置く
 * - 候補の間に移動の区間の行(移動手段のアイコン+名前 · 経路は未照会)
 * - 並べ替え: 上へ・下へ(触る・キーボード)、時間帯・日の選択、外す。変えるたびに保存し、「元に戻す」で前の並びへ戻せる。
 *   動かした後に読み上げで知らせる(移動と営業時間は未照会のまま)
 * - 確認の一覧: 移動時間(未照会)・営業時間(日付を決めた後に旅程の画面で照合)・宿(未照会)・日程の余裕(置いた数)
 * - 日付と時刻帯を決めると、下書きの並びを旅程(日・予定)にする(旅程の画面の「元に戻す」1回で戻せる)
 */
import React, { useCallback, useEffect, useId, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Button from '@/components/common/Button';
import PlanningUsageMeter from '@/components/planning/PlanningUsageMeter';
import { commitTripDraft, getTripDraft, updateDraftSlots } from '@/services/api/tripIntent';
import type { DraftPart, DraftSlot, TripDraft } from '@/services/api/types/tripIntent';
import { transportMode } from '@/utils/transportModes';
import { PART_ORDER, dayCounts, moveSlot, partsOfDay, placeSlot, removeSlot, retrievedLabel, sortSlots } from './consultModel';

const PART_LABEL: Record<DraftPart, string> = { morning: '午前', lunch: '昼食', afternoon: '午後', evening: '夕方・夕食', stay: '宿' };
const TIMEZONES = ['Asia/Tokyo', 'Asia/Seoul', 'Asia/Taipei', 'Asia/Shanghai', 'Asia/Bangkok', 'Europe/London', 'Europe/Paris',
  'America/New_York', 'America/Los_Angeles', 'Pacific/Honolulu'];

const TripDraftPage: React.FC = () => {
  const { planId = '' } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const id = useId();
  const [draft, setDraft] = useState<TripDraft | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'missing'>('loading');
  const [tab, setTab] = useState<number | 'all'>(1);
  const [history, setHistory] = useState<DraftSlot[][]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState('');
  const [tz, setTz] = useState('Asia/Tokyo');
  const [committing, setCommitting] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    try {
      setDraft(await getTripDraft(planId));
      setState('ready');
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      setState(status === 404 || status === 403 ? 'missing' : 'error');
    }
  }, [planId]);
  useEffect(() => { void load(); }, [load]);

  if (state === 'loading') return <p role="status" className="mx-auto max-w-5xl px-4 py-10 text-ink-700">読み込み中…</p>;
  if (state === 'missing' || state === 'error' || !draft) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-xl font-bold text-ink-900">旅程の下書き</h1>
        <p role="alert" className="mt-3 rounded-lg bg-danger-soft p-3 text-sm text-danger">
          {state === 'missing' ? 'この下書きは見つかりません(旅行相談から作った旅行ではないか、見る権限がありません)'
            : '下書きを読み込めませんでした。通信を確かめてください'}
        </p>
        <div className="mt-3 flex gap-2">
          {state === 'error' && <Button type="button" onClick={() => void load()}>もう一度読み込む</Button>}
          <Link to="/dashboard" className="tc-focus-ring inline-flex min-h-11 items-center px-3 text-sm text-accent underline">ダッシュボードへ</Link>
        </div>
      </div>
    );
  }

  const totalDays = draft.nights + 1;
  const committed = Boolean(draft.committed_at);
  const canEdit = draft.can_edit && !committed;
  const byId = Object.fromEntries(draft.candidates.map((c) => [c.id, c]));
  const slots = sortSlots(draft.slots);
  const placed = new Set(slots.map((s) => s.candidate_id));
  // 参考の出典(URL だけの候補)は場所が未確認のため置かない。候補箱で場所を確かめた候補(手入力・SNS など)は置ける
  const unplaced = draft.candidates.filter((c) => !placed.has(c.id) && c.source_kind !== 'url' && c.status !== 'dismissed');
  const sources = draft.candidates.filter((c) => c.source_kind === 'url');
  const mode = (draft.intent.transport as string) === 'car' ? 'driving' : null;
  const modeInfo = transportMode(mode);
  const counts = dayCounts(slots, totalDays);

  const save = async (next: DraftSlot[], announce: string) => {
    setSaving(true);
    setError(null);
    const before = draft.slots;
    try {
      const updated = await updateDraftSlots(planId, next, draft.revision);
      setHistory((h) => [...h, before].slice(-20));
      setDraft(updated);
      setMessage(`${announce}。移動時間と営業時間は未照会のままです`);
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      setError(status === 409 ? 'ほかの人がこの下書きを変えました。最新を読み込みます' : '並びを保存できませんでした。もう一度お試しください');
      if (status === 409) void load();
    } finally {
      setSaving(false);
    }
  };

  const undo = async () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setSaving(true);
    try {
      const updated = await updateDraftSlots(planId, prev, draft.revision);
      setHistory((h) => h.slice(0, -1));
      setDraft(updated);
      setMessage('前の並びに戻しました');
    } catch {
      setError('元に戻せませんでした。最新を読み込みます');
      void load();
    } finally {
      setSaving(false);
    }
  };

  const commit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!startDate) {
      setError('旅行の初日を選んでください');
      return;
    }
    setCommitting(true);
    setError(null);
    try {
      await commitTripDraft(planId, startDate, tz, draft.revision);
      navigate(`/planner/${encodeURIComponent(planId)}`);
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      setError(status === 409 ? 'この旅行はもう旅程になっているか、ほかの人が変えました。最新を読み込みます'
        : '旅程にできませんでした。日付と時刻帯を確かめてください');
      if (status === 409) void load();
      setCommitting(false);
    }
  };

  const slotCard = (s: DraftSlot) => {
    const c = byId[s.candidate_id];
    if (!c) return null;
    const parts = partsOfDay(s.day, totalDays);
    return (
      <li key={s.candidate_id} className="rounded-xl border border-cloud-200 bg-cloud-0 p-3" data-testid={`draft-slot-${c.title}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-ink-900 break-words">{c.title}</p>
            <p className="text-xs text-ink-700">
              {[c.category, c.provider === 'overpass' ? `出典: OpenStreetMap ${retrievedLabel(c.retrieved_at)}` : null]
                .filter(Boolean).join(' · ')}
            </p>
            <p className="text-xs text-warning">時刻 · 営業時間は未照会(日付を決めた後に旅程の画面で照合)</p>
          </div>
          {canEdit && (
            <div className="flex flex-wrap items-center gap-1">
              <button type="button" aria-label={`${c.title}を上へ`} disabled={saving}
                onClick={() => { const n = moveSlot(slots, s.candidate_id, -1, totalDays); if (n) void save(n, `${c.title}を上へ移しました`); }}
                className="tc-focus-ring grid h-11 w-11 place-items-center rounded-lg border border-cloud-200 text-ink-900">↑</button>
              <button type="button" aria-label={`${c.title}を下へ`} disabled={saving}
                onClick={() => { const n = moveSlot(slots, s.candidate_id, 1, totalDays); if (n) void save(n, `${c.title}を下へ移しました`); }}
                className="tc-focus-ring grid h-11 w-11 place-items-center rounded-lg border border-cloud-200 text-ink-900">↓</button>
              <select aria-label={`${c.title}の時間帯`} value={s.part} disabled={saving}
                onChange={(e) => void save(placeSlot(slots, s.candidate_id, s.day, e.target.value as DraftPart),
                  `${c.title}を${PART_LABEL[e.target.value as DraftPart]}へ移しました`)}
                className="tc-focus-ring min-h-11 rounded-lg border border-cloud-200 bg-cloud-0 px-2 text-sm text-ink-900">
                {parts.map((p) => <option key={p} value={p}>{PART_LABEL[p]}</option>)}
              </select>
              {totalDays > 1 && (
                <select aria-label={`${c.title}の日`} value={s.day} disabled={saving}
                  onChange={(e) => {
                    const day = Number(e.target.value);
                    const part = partsOfDay(day, totalDays).includes(s.part) ? s.part : 'afternoon';
                    void save(placeSlot(slots, s.candidate_id, day, part), `${c.title}を${day}日目へ移しました`);
                  }}
                  className="tc-focus-ring min-h-11 rounded-lg border border-cloud-200 bg-cloud-0 px-2 text-sm text-ink-900">
                  {Array.from({ length: totalDays }, (_, i) => <option key={i} value={i + 1}>{`${i + 1}日目`}</option>)}
                </select>
              )}
              <button type="button" disabled={saving} onClick={() => void save(removeSlot(slots, s.candidate_id), `${c.title}を外しました`)}
                className="tc-focus-ring min-h-11 rounded-lg px-2 text-sm text-ink-700 underline">外す</button>
            </div>
          )}
        </div>
      </li>
    );
  };

  const dayView = (day: number) => {
    const daySlots = slots.filter((s) => s.day === day);
    return (
      <ol aria-label={`${day}日目の下書き`} className="space-y-2">
        {partsOfDay(day, totalDays).map((p) => {
          const inPart = daySlots.filter((s) => s.part === p);
          const firstInDay = daySlots[0];
          return (
            <li key={p} className="grid grid-cols-[4rem_minmax(0,1fr)] gap-3">
              <span className="pt-3 text-right text-xs font-semibold text-ink-700">{PART_LABEL[p]}</span>
              <div className="space-y-2">
                {inPart.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-cloud-200 p-3 text-xs text-ink-700">
                    {p === 'stay' ? '宿 · 何人で1部屋の料金・空室は未照会(宿の提供元が未接続)' : 'まだ何も置いていません'}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {inPart.map((s) => (
                      <React.Fragment key={s.candidate_id}>
                        {s !== firstInDay && (
                          <li aria-label="移動の区間" className="ml-4 text-xs text-ink-700" data-testid="draft-segment">
                            <span className="rounded-full bg-cloud-100 px-2 py-1">
                              {`${modeInfo.icon ? `${modeInfo.icon} ` : ''}${modeInfo.label} · 経路・所要時間は未照会`}
                            </span>
                          </li>
                        )}
                        {slotCard(s)}
                      </React.Fragment>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    );
  };

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6" data-testid="trip-draft">
      <p className="text-xs font-semibold tracking-widest text-accent">TRIP DESIGN · ITINERARY DRAFT</p>
      <h1 className="mt-1 text-2xl font-bold text-ink-900 break-words">{draft.title}</h1>
      <div className={`mt-3 flex flex-wrap items-center gap-3 rounded-xl border p-3 ${committed ? 'border-success bg-success-soft' : 'border-cloud-200 bg-cloud-100'}`}
        data-testid="draft-banner">
        <span aria-hidden="true" className="text-lg">{committed ? '✓' : '✦'}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink-900">
            {committed ? '旅程にしました · 日程と予定は旅程の画面で編集します' : '旅程ドラフト · まだ確定していません'}
          </p>
          <p className="text-xs text-ink-700">
            {committed ? '予定の時刻・営業時間の照合・移動の区間は、旅程の画面で確かめてください。'
              : `方面: ${draft.area?.name ?? '未設定'} · 候補を日と時間帯に置き、日付を決めてから旅程にします。`}
          </p>
        </div>
        <Link to={`/planner/${encodeURIComponent(planId)}`} className="tc-focus-ring inline-flex min-h-11 items-center text-sm font-medium text-accent underline">
          {committed ? '旅程を開く →' : '旅程の画面を見る'}
        </Link>
      </div>
      <p aria-live="polite" className="sr-only" data-testid="draft-live">{message}</p>
      {message && <p className="mt-2 text-xs text-ink-700" aria-hidden="true">{message}</p>}
      {error && <p role="alert" className="mt-2 rounded-lg bg-danger-soft p-3 text-sm text-danger">{error}</p>}
      {/* [FR059-B] この旅行の AI・外部検索の利用枠(旅行の予算とは別) */}
      <PlanningUsageMeter planId={planId} className="mt-3" />
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section aria-labelledby={`${id}-days`} className="rounded-2xl border border-cloud-200 bg-surface p-4">
          <h2 id={`${id}-days`} className="sr-only">日ごとの下書き</h2>
          <div role="tablist" aria-label="日の切り替え" className="mb-4 flex flex-wrap gap-1 border-b border-cloud-200">
            {Array.from({ length: totalDays }, (_, i) => (
              <button key={i} type="button" role="tab" aria-selected={tab === i + 1} onClick={() => setTab(i + 1)}
                className={`tc-focus-ring min-h-11 border-b-2 px-3 text-sm font-semibold ${tab === i + 1 ? 'border-accent text-ink-900' : 'border-transparent text-ink-700'}`}>
                {`${i + 1}日目`}<span className="ml-1 text-xs font-normal">{`(${counts[i]}件)`}</span>
              </button>
            ))}
            <button type="button" role="tab" aria-selected={tab === 'all'} onClick={() => setTab('all')}
              className={`tc-focus-ring ml-auto min-h-11 border-b-2 px-3 text-sm font-semibold ${tab === 'all' ? 'border-accent text-ink-900' : 'border-transparent text-ink-700'}`}>
              全日程を横断で見る
            </button>
          </div>
          <div role="tabpanel" aria-label={tab === 'all' ? '全日程' : `${tab}日目`}>
            {tab === 'all' ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="draft-all-days">
                {Array.from({ length: totalDays }, (_, i) => (
                  <section key={i} aria-label={`${i + 1}日目`} className="rounded-xl border border-cloud-200 p-3">
                    <h3 className="text-sm font-semibold text-ink-900">{`${i + 1}日目 · ${counts[i]}件`}</h3>
                    <ul className="mt-2 space-y-1 text-xs text-ink-900">
                      {PART_ORDER.filter((p) => partsOfDay(i + 1, totalDays).includes(p)).map((p) => (
                        <li key={p}>
                          <span className="font-semibold text-ink-700">{`${PART_LABEL[p]}: `}</span>
                          {slots.filter((s) => s.day === i + 1 && s.part === p).map((s) => byId[s.candidate_id]?.title).join('、') || '—'}
                        </li>
                      ))}
                    </ul>
                    <button type="button" onClick={() => setTab(i + 1)} className="tc-focus-ring mt-2 min-h-11 text-xs font-medium text-accent underline">
                      この日を編集 →
                    </button>
                  </section>
                ))}
              </div>
            ) : dayView(tab)}
          </div>
          {canEdit && unplaced.length > 0 && (
            <section aria-label="まだ置いていない候補" className="mt-4 border-t border-cloud-200 pt-3">
              <h3 className="text-sm font-semibold text-ink-900">まだ置いていない候補</h3>
              <ul className="mt-2 flex flex-wrap gap-2">
                {unplaced.map((c) => (
                  <li key={c.id}>
                    <Button type="button" size="sm" variant="outline" disabled={saving}
                      onClick={() => void save(placeSlot(slots, c.id, typeof tab === 'number' ? tab : 1, 'afternoon'),
                        `${c.title}を${typeof tab === 'number' ? tab : 1}日目の午後へ置きました`)}>
                      {`＋ ${c.title} を${typeof tab === 'number' ? tab : 1}日目の午後へ`}
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {sources.length > 0 && (
            <section aria-label="参考の出典" className="mt-4 border-t border-cloud-200 pt-3 text-xs text-ink-700">
              <h3 className="text-sm font-semibold text-ink-900">参考の出典(場所は未確認 · 候補箱で確かめる)</h3>
              <ul className="mt-1 space-y-1">
                {sources.map((c) => <li key={c.id} className="break-all">{c.source_url ?? c.title}</li>)}
              </ul>
            </section>
          )}
          {canEdit && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-cloud-200 pt-3">
              <Button type="button" variant="ghost" disabled={saving || history.length === 0} onClick={() => void undo()}
                data-testid="draft-undo">
                ↶ 元に戻す
              </Button>
              <Link to={`/planner/${encodeURIComponent(planId)}/candidates`}
                className="tc-focus-ring inline-flex min-h-11 items-center px-3 text-sm text-accent underline">候補箱で場所を足す</Link>
            </div>
          )}
        </section>
        <aside aria-labelledby={`${id}-check`} className="h-fit space-y-4">
          <div className="rounded-2xl border border-cloud-200 bg-surface p-4" data-testid="draft-validation">
            <p className="text-xs font-semibold tracking-widest text-accent">PLAN VALIDATION</p>
            <h2 id={`${id}-check`} className="mt-1 font-semibold text-ink-900">旅程チェック</h2>
            <dl className="mt-2 divide-y divide-cloud-200 text-xs">
              <div className="flex justify-between gap-2 py-2"><dt className="font-semibold text-ink-900">移動時間</dt><dd className="text-right text-warning">未照会(道路の提供元が未接続)</dd></div>
              <div className="flex justify-between gap-2 py-2"><dt className="font-semibold text-ink-900">営業時間</dt><dd className="text-right text-warning">{committed ? '旅程の画面で照合' : '日付を決めた後'}</dd></div>
              <div className="flex justify-between gap-2 py-2"><dt className="font-semibold text-ink-900">宿の料金・空室</dt><dd className="text-right text-warning">未照会(宿の提供元が未接続)</dd></div>
              <div className="flex justify-between gap-2 py-2"><dt className="font-semibold text-ink-900">日程の余裕</dt>
                <dd className="text-right text-ink-900">{counts.map((n, i) => `${i + 1}日目 ${n}件`).join(' · ')}<span className="block text-ink-700">計算値 · 置いた数だけ</span></dd></div>
            </dl>
          </div>
          {canEdit && (
            <form onSubmit={commit} aria-label="日付を決めて旅程にする" className="rounded-2xl border border-cloud-200 bg-surface p-4">
              <h2 className="font-semibold text-ink-900">日付を決めて旅程にする</h2>
              <p className="text-xs text-ink-700">{`${totalDays}日分の日程を作り、置いた候補を予定にします(時刻は未定のまま)。旅程の画面の「元に戻す」で戻せます。`}</p>
              <label htmlFor={`${id}-start`} className="mt-2 block text-xs font-semibold text-ink-900">初日</label>
              <input id={`${id}-start`} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required
                className="tc-focus-ring mt-1 min-h-11 w-full rounded-lg border border-cloud-200 bg-cloud-0 px-2 text-ink-900" />
              <label htmlFor={`${id}-tz`} className="mt-2 block text-xs font-semibold text-ink-900">旅行先の時刻帯</label>
              <select id={`${id}-tz`} value={tz} onChange={(e) => setTz(e.target.value)}
                className="tc-focus-ring mt-1 min-h-11 w-full rounded-lg border border-cloud-200 bg-cloud-0 px-2 text-ink-900">
                {TIMEZONES.map((z) => <option key={z} value={z}>{z}</option>)}
              </select>
              <Button type="submit" fullWidth className="mt-3" loading={committing} disabled={committing}
                data-testid="draft-commit">この並びで旅程にする</Button>
            </form>
          )}
        </aside>
      </div>
    </div>
  );
};

export default TripDraftPage;
