/**
 * AlertsPage - 遅延・休業などの状況(アラート)の登録と一覧(SC-24 / FR-030・FR-031)。
 *
 * [Gate P10] backend/app/api/v1/replans.py の画面。遅延・運休・休業・天候を、情報源・取得時刻・確度とともに登録し、
 * そこから再計画案(A/B)を作る。案の比較・承認は ReplanPage で行う。登録済み経路の運行状態が遅延・運休の予定は
 * 「検出した状況」として示し、ワンタップでアラートにできる。古い情報(取得から3時間以上)は現在の状況のように見せない。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import api, { createAlert, createReplan, getAlerts, updateAlert } from '@/services/api';
import type { AlertList, DetectedRouteIssue, NormalizedDay, PlanAlert } from '@/services/api';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import {
  CONFIDENCE_LABEL, KIND_OPTIONS, REPLAN_STATE_LABEL, SOURCE_LABEL, STATUS_LABEL, alertFormToPayload, emptyAlertForm,
  formatObserved, needsDelay, needsEvent, replanErrorInfo, type AlertForm,
} from './replan/replanModel';

const inputClass = 'w-full border rounded-lg px-3 py-2';

const AlertCard: React.FC<{
  alert: PlanAlert;
  canEdit: boolean;
  busy: boolean;
  onReplan: (a: PlanAlert) => void;
  onOpenReplan: (replanId: string) => void;
  onStatus: (a: PlanAlert, status: 'resolved' | 'dismissed' | 'active') => void;
}> = ({ alert, canEdit, busy, onReplan, onOpenReplan, onStatus }) => {
  const active = alert.status === 'active';
  const target = alert.event_missing
    ? '対象の予定は削除されました'
    : alert.event_title
      ? `${alert.local_date ?? ''} ${alert.event_local_start_time ?? ''} ${alert.event_title}`.trim()
      : `${alert.local_date ?? ''} の屋外の予定`;
  return (
    <Card padding="md">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-gray-900">
            <span className="mr-2 text-xs px-1.5 py-0.5 rounded-sm bg-amber-100 text-amber-900">{alert.kind_label}</span>
            {target}
            {alert.delay_minutes !== null && <span className="ml-2 text-sm text-gray-800">約{alert.delay_minutes}分の遅れ</span>}
          </p>
          <p className="text-xs text-gray-700 mt-1">
            {`${alert.source_label ?? SOURCE_LABEL[alert.source]} ・ ${formatObserved(alert.observed_at)} ・ ${CONFIDENCE_LABEL[alert.confidence]} ・ ${STATUS_LABEL[alert.status]}`}
            {alert.latest_replan_status && ` ・ 再計画: ${REPLAN_STATE_LABEL[alert.latest_replan_status]}`}
          </p>
          {alert.is_stale && active && (
            <p className="text-xs text-red-800 mt-1">取得から3時間以上たった情報です。最新の状況を確認してください</p>
          )}
          {alert.note && <p className="text-sm text-gray-800 mt-1 wrap-break-word">{alert.note}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {alert.latest_replan_id && (
            <Button variant="outline" size="sm" onClick={() => onOpenReplan(alert.latest_replan_id!)}>案を見る</Button>
          )}
          {canEdit && active && !alert.event_missing && (
            <Button variant="primary" size="sm" loading={busy} onClick={() => onReplan(alert)}>再計画案を作る</Button>
          )}
          {canEdit && active && (
            <>
              <Button variant="ghost" size="sm" onClick={() => onStatus(alert, 'resolved')}>解決済みにする</Button>
              <Button variant="ghost" size="sm" onClick={() => onStatus(alert, 'dismissed')}>取り下げる</Button>
            </>
          )}
          {canEdit && !active && (
            <Button variant="ghost" size="sm" onClick={() => onStatus(alert, 'active')}>対応中に戻す</Button>
          )}
        </div>
      </div>
    </Card>
  );
};

const AlertsPage: React.FC = () => {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const [list, setList] = useState<AlertList | null>(null);
  const [days, setDays] = useState<NormalizedDay[]>([]);
  const [form, setForm] = useState<AlertForm>(emptyAlertForm);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!planId) return;
    try {
      const [alerts, detail] = await Promise.all([getAlerts(planId), api.getPlanDetail(planId)]);
      setList(alerts);
      setDays(detail.data?.days ?? []);
    } catch (e) {
      setError(errorDetailMessage(e, '状況の取得に失敗しました'));
    } finally {
      setIsLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    load();
  }, [load]);

  const eventOptions = useMemo(
    () => days.flatMap((d) => (d.events ?? [])
      .filter((e) => !needsDelay(form.kind) || (e.local_start_time && !e.is_all_day))
      .map((e) => ({ id: e.id, label: `${d.local_date} ${e.local_start_time ?? '時刻未定'} ${e.title}` }))),
    [days, form.kind],
  );

  const fromDetected = (d: DetectedRouteIssue) => {
    setForm({
      ...emptyAlertForm(), kind: d.suggested_kind, event_id: d.event_id, source: 'route_status',
      source_label: '登録済み経路の運行状態', confidence: 'reported',
    });
    setMessage(`「${d.event_title}」の状況を下の欄に入れました。遅れの見込みを確認して登録してください`);
    document.getElementById('alert-create-heading')?.scrollIntoView?.({ behavior: 'smooth' });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!planId) return;
    const r = alertFormToPayload(form);
    if (!r.ok) return setError(r.error);
    setIsSaving(true);
    setError(null);
    setMessage(null);
    try {
      await createAlert(planId, r.data);
      setForm(emptyAlertForm());
      setMessage('状況を登録しました。「再計画案を作る」で代わりの案を比べられます');
      await load();
    } catch (err) {
      setError(errorDetailMessage(err, '状況の登録に失敗しました'));
    } finally {
      setIsSaving(false);
    }
  };

  const replan = async (a: PlanAlert) => {
    if (!planId) return;
    setBusyId(a.id);
    setError(null);
    try {
      const created = await createReplan(planId, a.id);
      navigate(`/planner/${planId}/replans/${created.id}`);
    } catch (err) {
      setError(replanErrorInfo(err).message);
      setBusyId(null);
    }
  };

  const changeStatus = async (a: PlanAlert, status: 'resolved' | 'dismissed' | 'active') => {
    if (!planId) return;
    setError(null);
    try {
      await updateAlert(planId, a.id, { status }, a.revision);
      await load();
    } catch (err) {
      setError(errorDetailMessage(err, '状況の更新に失敗しました'));
    }
  };

  if (!planId) return <div className="p-8 text-center text-gray-700">プランが選択されていません。</div>;
  const canEdit = list?.can_edit ?? false;
  const active = list?.alerts.filter((a) => a.status === 'active') ?? [];
  const closed = list?.alerts.filter((a) => a.status !== 'active') ?? [];

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="flex flex-wrap gap-2 mb-2">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/planner/${planId}`)}>← プランへ戻る</Button>
        <Button variant="ghost" size="sm" onClick={() => navigate(`/planner/${planId}/today`)}>☀️ 今日の画面</Button>
      </div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">遅延・休業などへの対応</h1>
        <button type="button" onClick={load} aria-label="再読み込み" className="text-gray-700 hover:text-blue-700 p-2">
          <RefreshCw size={20} />
        </button>
      </div>
      <p className="text-sm text-gray-700 mt-1">
        遅延・運休・休業・天候を登録すると、予約付きの予定を守る代わりの案を2つ作って比べられます。承認するまで旅程は変わりません。
      </p>

      {error && <div className="mt-4 p-3 rounded-lg bg-red-50 text-red-800 text-sm" role="alert">{error}</div>}
      {message && <div className="mt-4 p-3 rounded-lg bg-green-50 text-green-900 text-sm" role="status">{message}</div>}

      {isLoading ? (
        <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
      ) : (
        <>
          {list && list.detected.length > 0 && (
            <section aria-labelledby="detected-heading" className="mt-6">
              <h2 id="detected-heading" className="font-semibold text-gray-900 mb-2">登録済み経路で見つかった遅延・運休</h2>
              <ul className="space-y-2" aria-label="見つかった遅延・運休">
                {list.detected.map((d) => (
                  <li key={d.event_id}>
                    <Card padding="md" className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium text-gray-900">
                          <AlertTriangle size={16} aria-hidden="true" className="inline mr-1 text-amber-700" />
                          {`${d.local_date ?? ''} ${d.event_local_start_time ?? ''} ${d.event_title}へ向かう経路が${d.transport_status === 'cancelled' ? '運休' : '遅延'}`}
                        </p>
                        <p className="text-xs text-gray-700 mt-1">
                          {`${SOURCE_LABEL.route_status} ・ ${formatObserved(d.observed_at)}`}
                          {d.is_stale && ' ・ 取得から3時間以上たった情報です'}
                        </p>
                      </div>
                      {canEdit && <Button variant="outline" size="sm" onClick={() => fromDetected(d)}>状況として登録</Button>}
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="alert-list-heading" className="mt-6">
            <h2 id="alert-list-heading" className="font-semibold text-gray-900 mb-2">対応中の状況</h2>
            {active.length === 0 ? (
              <Card padding="lg" className="text-center text-gray-700">対応中の状況はありません。</Card>
            ) : (
              <ul className="space-y-2" aria-label="対応中の状況">
                {active.map((a) => (
                  <li key={a.id}>
                    <AlertCard alert={a} canEdit={canEdit} busy={busyId === a.id} onReplan={replan}
                      onOpenReplan={(id) => navigate(`/planner/${planId}/replans/${id}`)} onStatus={changeStatus} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {canEdit && (
            <Card padding="md" className="mt-6">
              <form onSubmit={submit} noValidate aria-labelledby="alert-create-heading">
                <h2 id="alert-create-heading" className="font-semibold text-gray-900 mb-3">状況を登録する</h2>
                <div className="space-y-3">
                  <fieldset>
                    <legend className="block text-sm font-medium text-gray-800 mb-1">種類</legend>
                    <div className="grid sm:grid-cols-2 gap-1 text-sm">
                      {KIND_OPTIONS.map((o) => (
                        <label key={o.value} className="flex items-start gap-2">
                          <input type="radio" name="alert-kind" className="mt-1" checked={form.kind === o.value}
                            onChange={() => setForm({ ...form, kind: o.value, event_id: '' })} />
                          <span><span className="font-medium">{o.label}</span><span className="block text-xs text-gray-700">{o.help}</span></span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  {needsEvent(form.kind) ? (
                    <div>
                      <label htmlFor="alert-event" className="block text-sm font-medium text-gray-800 mb-1">影響を受ける予定</label>
                      <select id="alert-event" className={inputClass} value={form.event_id}
                        onChange={(e) => setForm({ ...form, event_id: e.target.value })}>
                        <option value="">選んでください</option>
                        {eventOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                      </select>
                      {needsDelay(form.kind) && <p className="text-xs text-gray-700 mt-1">時刻のある予定だけ選べます</p>}
                    </div>
                  ) : (
                    <div>
                      <label htmlFor="alert-day" className="block text-sm font-medium text-gray-800 mb-1">影響を受ける日</label>
                      <select id="alert-day" className={inputClass} value={form.day_id}
                        onChange={(e) => setForm({ ...form, day_id: e.target.value })}>
                        <option value="">選んでください</option>
                        {days.map((d) => <option key={d.id} value={d.id}>{d.local_date}</option>)}
                      </select>
                    </div>
                  )}
                  {needsDelay(form.kind) && (
                    <div>
                      <label htmlFor="alert-delay" className="block text-sm font-medium text-gray-800 mb-1">遅れの見込み(分)</label>
                      <input id="alert-delay" inputMode="numeric" className={inputClass} value={form.delay_minutes}
                        onChange={(e) => setForm({ ...form, delay_minutes: e.target.value })} />
                    </div>
                  )}
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="alert-source" className="block text-sm font-medium text-gray-800 mb-1">情報源(任意)</label>
                      <input id="alert-source" className={inputClass} maxLength={100} value={form.source_label}
                        placeholder="例: 駅の掲示、運行情報アプリ" onChange={(e) => setForm({ ...form, source_label: e.target.value })} />
                    </div>
                    <div>
                      <label htmlFor="alert-observed" className="block text-sm font-medium text-gray-800 mb-1">情報を得た時刻(空なら今)</label>
                      <input id="alert-observed" type="datetime-local" className={inputClass} value={form.observed_at}
                        onChange={(e) => setForm({ ...form, observed_at: e.target.value })} />
                    </div>
                  </div>
                  <fieldset>
                    <legend className="block text-sm font-medium text-gray-800 mb-1">確かさ</legend>
                    <div className="flex gap-4 text-sm">
                      {(['reported', 'confirmed'] as const).map((c) => (
                        <label key={c} className="flex items-center gap-2">
                          <input type="radio" name="alert-confidence" checked={form.confidence === c}
                            onChange={() => setForm({ ...form, confidence: c })} />
                          {CONFIDENCE_LABEL[c]}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <div>
                    <label htmlFor="alert-note" className="block text-sm font-medium text-gray-800 mb-1">メモ(任意)</label>
                    <textarea id="alert-note" className={inputClass} rows={2} maxLength={500} value={form.note}
                      onChange={(e) => setForm({ ...form, note: e.target.value })} />
                  </div>
                  <Button variant="primary" type="submit" loading={isSaving}>登録する</Button>
                </div>
              </form>
            </Card>
          )}

          {closed.length > 0 && (
            <section aria-labelledby="closed-heading" className="mt-6">
              <h2 id="closed-heading" className="font-semibold text-gray-900 mb-2">解決・取り下げた状況</h2>
              <ul className="space-y-2" aria-label="解決・取り下げた状況">
                {closed.map((a) => (
                  <li key={a.id}>
                    <AlertCard alert={a} canEdit={canEdit} busy={false} onReplan={replan}
                      onOpenReplan={(id) => navigate(`/planner/${planId}/replans/${id}`)} onStatus={changeStatus} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
};

export default AlertsPage;
