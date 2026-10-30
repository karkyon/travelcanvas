/**
 * RouteOptionsPage - FR-015複数経路比較(DOC-02 FR-015 / DOC-05 §7.2)。
 *
 * [Gate M4] backend/app/api/v1/route_options.py (Gate M3)はAPI/DBのみ
 * 実装済みでfrontendから一切到達不能だった(FR-014のGate M1→M2、Gate
 * R3-2/#25と同じパターン)。本画面でPlannerPageから到達可能にし、
 * 候補の作成・比較・採用までを縦に貫通させる。
 *
 * スコープ: 外部ルーティングAPIは未導入のため、候補は全て手動入力
 * (provider="manual")。legの追加・編集・削除には対応するが、並べ替え・
 * 途中挿入はbackend未対応のため本画面でも提供しない
 * (ADR-route-options.md §5参照)。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Plus, Trash2, CheckCircle2, X, Accessibility, Leaf, Mountain } from 'lucide-react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import Input from '@/components/common/Input';
import Modal from '@/components/common/Modal';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import api, {
  getRouteOptions, createRouteOption, deleteRouteOption, adoptRouteOption,
} from '@/services/api';
import type {
  RouteOption, RouteOptionCreateData, NormalizedDay, NormalizedEvent,
} from '@/services/api';
import { describeRouteOptionDeletion } from '@/store/itemDeletionMessages';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import UiIcon from '@/components/common/UiIcon';
import PageHead from '@/components/shell/PageHead';
import { useTripContext } from '@/hooks/useTripContext';
import { IcRoute } from '@/components/common/uiIcons';

function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `idem_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function eventLabel(events: NormalizedEvent[], eventId: string | null): string {
  if (!eventId) return '(場所)';
  const found = events.find((e) => e.id === eventId);
  return found ? found.title : '(不明なイベント)';
}

interface OptionFormState {
  from_event_id: string;
  to_event_id: string;
  total_duration_minutes: string;
  total_distance_km: string;
  total_cost: string;
  currency: string;
  walking_minutes: string;
  transfer_count: string;
  accessibility_score: string;
  scenic_score: string;
  co2_estimate_kg: string;
}

const EMPTY_FORM: OptionFormState = {
  from_event_id: '',
  to_event_id: '',
  total_duration_minutes: '',
  total_distance_km: '',
  total_cost: '',
  currency: 'JPY',
  walking_minutes: '',
  transfer_count: '',
  accessibility_score: '',
  scenic_score: '',
  co2_estimate_kg: '',
};

function formToPayload(form: OptionFormState): RouteOptionCreateData {
  const payload: RouteOptionCreateData = {
    from_event_id: form.from_event_id,
    to_event_id: form.to_event_id,
  };
  if (form.total_duration_minutes) payload.total_duration_minutes = Number(form.total_duration_minutes);
  if (form.total_distance_km) payload.total_distance_km = Number(form.total_distance_km);
  if (form.total_cost) {
    payload.total_cost = form.total_cost;
    payload.currency = form.currency;
  }
  if (form.walking_minutes) payload.walking_minutes = Number(form.walking_minutes);
  if (form.transfer_count) payload.transfer_count = Number(form.transfer_count);
  if (form.accessibility_score) payload.accessibility_score = Number(form.accessibility_score);
  if (form.scenic_score) payload.scenic_score = Number(form.scenic_score);
  if (form.co2_estimate_kg) payload.co2_estimate_kg = Number(form.co2_estimate_kg);
  return payload;
}

const RouteOptionsPage: React.FC = () => {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  // [Gate MockScreens] 上の帯の旅行の切り替えに、この旅行の名前を出す
  useTripContext(planId);

  const [options, setOptions] = useState<RouteOption[]>([]);
  const [days, setDays] = useState<NormalizedDay[]>([]);
  // [Gate B-014] 採用・削除のIf-Matchはbackendでプランの版番号と照合される(経路候補ごとの
  // revisionではない)。以前は経路候補のrevisionを送っていたため、ほぼ常に409で失敗していた。
  const [planRevision, setPlanRevision] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [form, setForm] = useState<OptionFormState>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const allEvents: NormalizedEvent[] = days.flatMap((d) => d.events ?? []);

  const loadAll = useCallback(async () => {
    if (!planId) return;
    setIsLoading(true);
    setError(null);
    try {
      const [optionList, planDetail] = await Promise.all([
        getRouteOptions(planId),
        api.getPlanDetail(planId),
      ]);
      setOptions(optionList);
      if (planDetail.success && planDetail.data) {
        setDays(planDetail.data.days ?? []);
        setPlanRevision(planDetail.data.revision);
      }
    } catch (e) {
      setError(errorDetailMessage(e, '経路候補一覧の取得に失敗しました'));
    } finally {
      setIsLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const openCreateForm = () => {
    setForm(EMPTY_FORM);
    setFormError(null);
    setIsFormOpen(true);
  };

  const handleSave = async () => {
    if (!planId) return;
    if (!form.from_event_id || !form.to_event_id) {
      setFormError('出発・到着イベントを両方選択してください');
      return;
    }
    if (form.from_event_id === form.to_event_id) {
      setFormError('出発と到着に同じイベントは選択できません');
      return;
    }
    setIsSaving(true);
    setFormError(null);
    try {
      await createRouteOption(planId, formToPayload(form), generateIdempotencyKey());
      setIsFormOpen(false);
      await loadAll();
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      setFormError(typeof detail === 'string' ? detail : (detail as { message?: string })?.message || '保存に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (option: RouteOption) => {
    if (!planId || planRevision === null) return;
    if (!window.confirm('この経路候補を削除しますか?')) return;
    setNotice(null);
    try {
      const result = await deleteRouteOption(planId, option.id, planRevision);
      setNotice(describeRouteOptionDeletion(result.detached?.segments_unlinked));
      await loadAll();
    } catch (e) {
      setError(errorDetailMessage(e, '削除に失敗しました'));
    }
  };

  const handleAdopt = async (option: RouteOption) => {
    if (!planId || planRevision === null) return;
    setNotice(null);
    try {
      await adoptRouteOption(planId, option.id, planRevision);
      setNotice('経路候補を採用し、移動区間に反映しました。');
      await loadAll();
    } catch (e) {
      setError(errorDetailMessage(e, '採用に失敗しました'));
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="tc-page tc-optimize">
      <div>
        {/* [Gate MockScreens] モックの比較: 候補を並べ、所要時間・距離・費用の数字で見比べてから採用する */}
        <PageHead
          eyebrow="PLAN · 経路の比較"
          title="ルートを、見比べて決める"
          sub="経路の候補を、所要時間・距離・費用・乗換で見比べてから採用します。採用するまで今の旅程は変わりません。外部の経路検索は未接続のため、候補の数字は手で入力します。"
          actions={<>
            <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={() => navigate(`/planner/${planId}`)}>← 旅程に戻る</button>
            <Button variant="primary" size="sm" onClick={openCreateForm} disabled={allEvents.length < 2}>
              <Plus size={16} className="mr-1" /> 候補を追加
            </Button>
          </>}
        />

        {error && (
          <Card className="mb-4 bg-red-50 border-red-200">
            <p className="text-sm text-red-700">{error}</p>
          </Card>
        )}
        {notice && (
          <Card className="mb-4 bg-green-50 border-green-200">
            <p className="text-sm text-green-800" role="status">{notice}</p>
          </Card>
        )}

        {allEvents.length < 2 && (
          <Card className="mb-4">
            <p className="text-sm text-ink-500">
              経路候補を作成するには、旅程に2つ以上のイベントが必要です。
            </p>
          </Card>
        )}

        {options.length === 0 ? (
          <div className="tc-card tc-kit-empty text-center">
            <UiIcon icon={IcRoute} size={28} className="mx-auto" />
            <p className="font-semibold text-ink-900">まだ経路候補がありません</p>
            <p>「候補を追加」で、2つの予定の間の行き方を数字で入れると、ここで並べて見比べられます。</p>
          </div>
        ) : (
          <div className="tc-compare-grid">
            {options.map((option) => (
              <article key={option.id} className={`tc-card tc-compare-card ${option.status === 'adopted' ? 'is-current' : ''}`}
                aria-label={`${eventLabel(allEvents, option.from_event_id)}から${eventLabel(allEvents, option.to_event_id)}への経路候補`}>
                <div>
                  <div>
                    <div className="tc-section-row">
                      <p className="tc-label">{option.status === 'adopted' ? 'CURRENT · 採用中' : option.status === 'discarded' ? 'DISCARDED · 見送り' : 'OPTION · 候補'}</p>
                      {option.status === 'adopted' && <span className="tc-pill tc-pill--good">採用済み</span>}
                      {option.status === 'discarded' && <span className="tc-pill">見送り</span>}
                    </div>
                    <h2 className="tc-compare-title">
                      {eventLabel(allEvents, option.from_event_id)} → {eventLabel(allEvents, option.to_event_id)}
                    </h2>
                    <div className="tc-compare-metrics">
                      <span><b>{option.total_duration_minutes != null ? `${Math.round(option.total_duration_minutes)}分` : '—'}</b><small>所要時間</small></span>
                      <span><b>{option.total_distance_km != null ? `${option.total_distance_km.toFixed(1)}km` : '—'}</b><small>距離</small></span>
                      <span><b>{option.total_cost != null ? `${option.total_cost} ${option.currency}` : '—'}</b><small>費用</small></span>
                    </div>
                    <div className="mt-2 text-xs text-ink-500 flex flex-wrap gap-x-3 gap-y-1">
                      {option.transfer_count != null && <span>乗換{option.transfer_count}回</span>}
                      {option.walking_minutes != null && <span>徒歩{Math.round(option.walking_minutes)}分</span>}
                      <span>手で入力した値</span>
                    </div>
                    <div className="mt-1 flex gap-3 text-xs text-ink-700">
                      {option.accessibility_score != null && (
                        <span className="flex items-center gap-1">
                          <Accessibility size={12} /> {(option.accessibility_score * 100).toFixed(0)}%
                        </span>
                      )}
                      {option.scenic_score != null && (
                        <span className="flex items-center gap-1">
                          <Mountain size={12} /> {(option.scenic_score * 100).toFixed(0)}%
                        </span>
                      )}
                      {option.co2_estimate_kg != null && (
                        <span className="flex items-center gap-1">
                          <Leaf size={12} /> {option.co2_estimate_kg.toFixed(1)}kg
                        </span>
                      )}
                    </div>
                    {option.legs.length > 0 && (
                      <div className="mt-2 text-xs text-ink-500">
                        {option.legs.map((leg) => leg.line || leg.mode).join(' → ')}
                      </div>
                    )}
                  </div>
                  <div className="tc-compare-actions">
                    {option.status !== 'adopted' && (
                      <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--primary" onClick={() => handleAdopt(option)} aria-label="この経路候補を採用">
                        <CheckCircle2 size={16} aria-hidden="true" />この案を採用する
                      </button>
                    )}
                    <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={() => handleDelete(option)} aria-label="この経路候補を削除">
                      <Trash2 size={14} aria-hidden="true" />削除
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}

        <div className="tc-card tc-memory-check">
          <p><b>確認する条件</b><span>予約の固定・営業時間・休みたい時間は、旅行の条件で決めます。1日の並べ替えは旅程の「この日の並べ替え(検証つき)」から。</span></p>
          <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={() => navigate(`/planner/${planId}/constraints`)}>条件を編集</button>
        </div>
      </div>

      <Modal isOpen={isFormOpen} onClose={() => setIsFormOpen(false)} title="経路候補を追加">
        <Modal.Body>
          <div className="space-y-3">
            {formError && <p className="text-sm text-red-600">{formError}</p>}

            <div>
              <label className="block text-sm font-medium mb-1">出発イベント</label>
              <select
                className="w-full border rounded-md px-3 py-2 text-sm"
                value={form.from_event_id}
                onChange={(e) => setForm({ ...form, from_event_id: e.target.value })}
              >
                <option value="">選択してください</option>
                {allEvents.map((ev) => (
                  <option key={ev.id} value={ev.id}>{ev.title}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">到着イベント</label>
              <select
                className="w-full border rounded-md px-3 py-2 text-sm"
                value={form.to_event_id}
                onChange={(e) => setForm({ ...form, to_event_id: e.target.value })}
              >
                <option value="">選択してください</option>
                {allEvents.map((ev) => (
                  <option key={ev.id} value={ev.id}>{ev.title}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input
                label="所要時間(分)"
                type="number"
                value={form.total_duration_minutes}
                onChange={(e) => setForm({ ...form, total_duration_minutes: e.target.value })}
              />
              <Input
                label="距離(km)"
                type="number"
                value={form.total_distance_km}
                onChange={(e) => setForm({ ...form, total_distance_km: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input
                label="費用"
                type="number"
                value={form.total_cost}
                onChange={(e) => setForm({ ...form, total_cost: e.target.value })}
              />
              <Input
                label="通貨"
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
                maxLength={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input
                label="徒歩時間(分)"
                type="number"
                value={form.walking_minutes}
                onChange={(e) => setForm({ ...form, walking_minutes: e.target.value })}
              />
              <Input
                label="乗換回数"
                type="number"
                value={form.transfer_count}
                onChange={(e) => setForm({ ...form, transfer_count: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Input
                label="バリアフリー(0-1)"
                type="number"
                step="0.1"
                min="0"
                max="1"
                value={form.accessibility_score}
                onChange={(e) => setForm({ ...form, accessibility_score: e.target.value })}
              />
              <Input
                label="景観(0-1)"
                type="number"
                step="0.1"
                min="0"
                max="1"
                value={form.scenic_score}
                onChange={(e) => setForm({ ...form, scenic_score: e.target.value })}
              />
              <Input
                label="CO2(kg)"
                type="number"
                value={form.co2_estimate_kg}
                onChange={(e) => setForm({ ...form, co2_estimate_kg: e.target.value })}
              />
            </div>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onClick={() => setIsFormOpen(false)}>
            <X size={16} className="mr-1" /> キャンセル
          </Button>
          <Button variant="primary" onClick={handleSave} loading={isSaving}>
            保存
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default RouteOptionsPage;
