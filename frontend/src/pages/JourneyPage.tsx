/**
 * JourneyPage - 旅の振り返り(DOC-04 SC-42 Journey Review、FR-054 Plan-to-Memory・FR-053 旅の達成指標)。
 *
 * [Gate P14] backend/app/api/v1/journey.py の画面。
 * - 予定ごとに「行った/行かなかった」と実際の到着・出発を記録する(予定そのものは変えない)
 * - あなたの位置の軌跡・記録の日時から到着と出発を提案し、使うかを選べる(自動では確定しない)
 * - 達成指標(計画達成率・訪問達成率・写真付き訪問率・記録完成率・滞在時間・移動距離)。数値は隠せる。順位は作らない
 * - 行かなかった予定を、別の旅行の日へ予定として戻せる
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import api, { carryOverEvent, deleteEventActual, getJourney, putEventActual } from '@/services/api';
import type { ActualInput, JourneyEvent, JourneyReview, NormalizedDay } from '@/services/api';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { diffLabel, localTime, metricRows, zonedToIso } from './journey/journeyModel';

const HIDE_KEY = 'tc_journey_hide_metrics';
const readHidden = (): boolean => {
  try {
    return localStorage.getItem(HIDE_KEY) === '1';
  } catch {
    return false;
  }
};

interface CarryState {
  plans: Array<{ id: string; title: string }>;
  planId: string;
  days: NormalizedDay[];
  dayId: string;
}

const JourneyPage: React.FC = () => {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<JourneyReview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(readHidden);
  const [times, setTimes] = useState<Record<string, { start: string; end: string }>>({});
  const [carry, setCarry] = useState<Record<string, CarryState>>({});

  const load = useCallback(async () => {
    if (!planId) return;
    try {
      setData(await getJourney(planId));
    } catch (e) {
      setError(errorDetailMessage(e, '振り返りの取得に失敗しました'));
    } finally {
      setIsLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleHidden = () => {
    const next = !hidden;
    setHidden(next);
    try {
      localStorage.setItem(HIDE_KEY, next ? '1' : '0');
    } catch {
      // 表示の好みなので、保存できなくても続ける
    }
  };

  const run = async (fn: () => Promise<unknown>, done: string, fallback: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await fn();
      setMessage(done);
    } catch (e) {
      setError(errorDetailMessage(e, fallback));
    } finally {
      setBusy(false);
      await load();
    }
  };

  if (!planId) return <div className="p-8 text-center text-gray-700">プランが選択されていません。</div>;

  const save = (e: JourneyEvent, input: ActualInput, done: string) =>
    run(() => putEventActual(planId, e.event_id, input, e.actual?.revision), done, '実績を保存できませんでした。画面を読み込み直してください');

  const saveTimes = (e: JourneyEvent, date: string, tz: string) => {
    const t = times[e.event_id] ?? { start: localTime(e.actual?.actual_start_at ?? null, tz), end: localTime(e.actual?.actual_end_at ?? null, tz) };
    const start = t.start ? zonedToIso(date, t.start, tz) : null;
    const end = t.end ? zonedToIso(date, t.end, tz) : null;
    if ((t.start && !start) || (t.end && !end)) {
      setError('時刻はHH:MMで入力してください');
      return;
    }
    if (start && end && end < start) {
      setError('出発は到着より後にしてください');
      return;
    }
    save(e, { status: 'visited', actual_start_at: start, actual_end_at: end, note: e.actual?.note ?? null }, '到着と出発を保存しました');
  };

  const openCarry = async (e: JourneyEvent) => {
    try {
      const res = await api.getPlans();
      const plans = (res.data ?? []).filter((p) => p.id !== planId).map((p) => ({ id: p.id, title: p.title }));
      setCarry((c) => ({ ...c, [e.event_id]: { plans, planId: '', days: [], dayId: '' } }));
    } catch (err) {
      setError(errorDetailMessage(err, '旅行の一覧を取得できませんでした'));
    }
  };

  const chooseCarryPlan = async (e: JourneyEvent, targetPlanId: string) => {
    const base = carry[e.event_id];
    if (!base) return;
    setCarry((c) => ({ ...c, [e.event_id]: { ...base, planId: targetPlanId, days: [], dayId: '' } }));
    if (!targetPlanId) return;
    try {
      const detail = await api.getPlanDetail(targetPlanId);
      const days = detail.data?.days ?? [];
      setCarry((c) => ({ ...c, [e.event_id]: { ...base, planId: targetPlanId, days, dayId: days[0]?.id ?? '' } }));
    } catch (err) {
      setError(errorDetailMessage(err, '戻し先の日程を取得できませんでした'));
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <Button variant="ghost" size="sm" onClick={() => navigate(`/planner/${planId}`)} className="mb-2">← プランへ戻る</Button>
      <h1 className="text-2xl font-bold text-gray-900">旅の振り返り</h1>
      <p className="text-sm text-gray-700 mt-1">
        予定ごとに、行ったか・いつ着いて出たかを記録します。予定そのものは変わりません。時刻は各日のタイムゾーンで表示します。
      </p>
      {error && <div className="mt-4 p-3 rounded-lg bg-red-50 text-red-800 text-sm" role="alert">{error}</div>}
      {message && <div className="mt-4 p-3 rounded-lg bg-green-50 text-green-900 text-sm" role="status">{message}</div>}

      {isLoading || !data ? (
        <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
      ) : (
        <>
          <Card padding="md" className="mt-6">
            <section aria-label="達成指標" className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-gray-900">達成指標</h2>
                <Button size="sm" variant="ghost" onClick={toggleHidden}>{hidden ? '数値を表示する' : '数値を隠す'}</Button>
              </div>
              {hidden ? (
                <p className="text-sm text-gray-700">数値は隠しています。</p>
              ) : (
                <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {metricRows(data.metrics).map((r) => (
                    <div key={r.label} className="p-2 rounded bg-gray-50">
                      <dt className="text-sm text-gray-700">{r.label}</dt>
                      <dd className="text-xl font-semibold text-gray-900">{r.value}</dd>
                      <dd className="text-xs text-gray-700">{r.help}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>
          </Card>

          {data.days.length === 0 && <Card padding="lg" className="mt-6 text-center text-gray-700">日程がありません。</Card>}
          {data.days.map((d) => (
            <section key={d.day_id} aria-label={d.date} className="mt-6">
              <h2 className="font-semibold text-gray-900">{`${d.date}${d.title ? ` ${d.title}` : ''}`}</h2>
              <ul className="mt-2 space-y-2">
                {d.events.map((e) => {
                  const t = times[e.event_id] ?? {
                    start: localTime(e.actual?.actual_start_at ?? null, d.timezone_id),
                    end: localTime(e.actual?.actual_end_at ?? null, d.timezone_id),
                  };
                  const c = carry[e.event_id];
                  const status = e.actual?.status;
                  return (
                    <li key={e.event_id}>
                      <Card padding="md" className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-gray-900">{`${e.planned_time ? `${e.planned_time} ` : ''}${e.title}`}</span>
                          <span className="px-2 py-0.5 rounded text-sm bg-gray-100 text-gray-800" data-testid="actual-status">
                            {status === 'visited' ? '行った' : status === 'skipped' ? '行かなかった' : '未記録'}
                          </span>
                          {e.start_diff_minutes !== null && <span className="text-sm text-gray-700">{diffLabel(e.start_diff_minutes)}</span>}
                        </div>
                        {status === 'visited' && (e.actual?.actual_start_at || e.actual?.actual_end_at) && (
                          <p className="text-sm text-gray-800">
                            {`到着 ${localTime(e.actual?.actual_start_at ?? null, d.timezone_id) || '—'}・出発 ${localTime(e.actual?.actual_end_at ?? null, d.timezone_id) || '—'}`}
                            {e.actual?.source === 'suggested' ? '(提案から)' : ''}
                          </p>
                        )}
                        {(e.memory_count > 0) && (
                          <p className="text-sm text-gray-700">
                            {`記録${e.memory_count}件(写真${e.photo_count}枚)`}・<Link className="text-blue-800 underline" to={`/planner/${planId}/memories`}>旅の記録を見る</Link>
                          </p>
                        )}
                        {e.suggestion && (
                          <p className="text-sm text-gray-800">
                            {`提案: 到着 ${localTime(e.suggestion.actual_start_at, d.timezone_id)}・出発 ${localTime(e.suggestion.actual_end_at, d.timezone_id)}(${e.suggestion.basis === 'track' ? 'あなたの位置の軌跡' : '記録の日時'}から)`}
                            {data.can_edit && (
                              <Button size="sm" variant="outline" className="ml-2" disabled={busy} onClick={() => save(e, {
                                status: 'visited', actual_start_at: e.suggestion!.actual_start_at, actual_end_at: e.suggestion!.actual_end_at,
                                source: 'suggested', note: e.actual?.note ?? null,
                              }, '提案した時刻で記録しました')}>提案を使う</Button>
                            )}
                          </p>
                        )}
                        {data.can_edit && (
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant={status === 'visited' ? 'primary' : 'outline'} disabled={busy}
                              aria-pressed={status === 'visited'}
                              onClick={() => save(e, { status: 'visited', actual_start_at: e.actual?.actual_start_at ?? null, actual_end_at: e.actual?.actual_end_at ?? null }, '「行った」を記録しました')}>
                              行った
                            </Button>
                            <Button size="sm" variant={status === 'skipped' ? 'primary' : 'outline'} disabled={busy}
                              aria-pressed={status === 'skipped'}
                              onClick={() => save(e, { status: 'skipped' }, '「行かなかった」を記録しました')}>
                              行かなかった
                            </Button>
                            {status && (
                              <Button size="sm" variant="ghost" disabled={busy}
                                onClick={() => run(() => deleteEventActual(planId, e.event_id), '実績を消しました', '実績を消せませんでした')}>
                                記録を消す
                              </Button>
                            )}
                          </div>
                        )}
                        {data.can_edit && status === 'visited' && (
                          <fieldset className="flex flex-wrap items-end gap-2">
                            <legend className="text-sm text-gray-800">{`到着と出発(${d.timezone_id})`}</legend>
                            <label className="text-sm text-gray-800">到着
                              <input type="time" className="block border rounded px-2 py-1" value={t.start}
                                onChange={(ev) => setTimes((s) => ({ ...s, [e.event_id]: { ...t, start: ev.target.value } }))} />
                            </label>
                            <label className="text-sm text-gray-800">出発
                              <input type="time" className="block border rounded px-2 py-1" value={t.end}
                                onChange={(ev) => setTimes((s) => ({ ...s, [e.event_id]: { ...t, end: ev.target.value } }))} />
                            </label>
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => saveTimes(e, d.date, d.timezone_id)}>時刻を保存</Button>
                          </fieldset>
                        )}
                        {status !== 'visited' && (
                          !c ? (
                            <Button size="sm" variant="ghost" onClick={() => openCarry(e)}>次の旅行の候補に戻す</Button>
                          ) : (
                            <fieldset className="flex flex-wrap items-end gap-2">
                              <legend className="text-sm text-gray-800">戻し先</legend>
                              {c.plans.length === 0 ? (
                                <p className="text-sm text-gray-700">ほかの旅行がありません。先に次の旅行を作ってください。</p>
                              ) : (
                                <>
                                  <label className="text-sm text-gray-800">旅行
                                    <select className="block border rounded px-2 py-1" value={c.planId} onChange={(ev) => chooseCarryPlan(e, ev.target.value)}>
                                      <option value="">選んでください</option>
                                      {c.plans.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                                    </select>
                                  </label>
                                  {c.planId && (
                                    c.days.length === 0 ? <p className="text-sm text-gray-700">その旅行には日程がありません。</p> : (
                                      <label className="text-sm text-gray-800">日
                                        <select className="block border rounded px-2 py-1" value={c.dayId}
                                          onChange={(ev) => setCarry((s) => ({ ...s, [e.event_id]: { ...c, dayId: ev.target.value } }))}>
                                          {c.days.map((day) => <option key={day.id} value={day.id}>{day.local_date}</option>)}
                                        </select>
                                      </label>
                                    )
                                  )}
                                  <Button size="sm" variant="outline" disabled={busy || !c.planId || !c.dayId} onClick={() => run(async () => {
                                    await carryOverEvent(planId, e.event_id, c.planId, c.dayId);
                                    setCarry((s) => {
                                      const next = { ...s };
                                      delete next[e.event_id];
                                      return next;
                                    });
                                  }, '次の旅行に予定として戻しました(戻し先の「元に戻す」で取り消せます)', '戻せませんでした')}>戻す</Button>
                                </>
                              )}
                            </fieldset>
                          )
                        )}
                      </Card>
                    </li>
                  );
                })}
                {d.events.length === 0 && <li className="text-sm text-gray-700">予定はありません。</li>}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
};

export default JourneyPage;
