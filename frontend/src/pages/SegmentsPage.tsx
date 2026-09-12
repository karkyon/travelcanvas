/**
 * SegmentsPage - FR-014移動区間(DOC-05 §7.1 travel_segments)。
 *
 * [Gate M2] backend/app/api/v1/segments.py (Gate M1)はAPI/DBのみ実装済みで
 * frontendから一切到達不能だった(DOC-02 §1.1「画面だけ、APIだけ、DBだけ
 * 存在する状態は完成としない」に反する状態、Gate R3-2/#25と同じパターン)。
 * 本画面でPlannerPageから到達可能にし、一覧・作成・編集・削除までを
 * 縦に貫通させる。
 *
 * 権限はbackend側(plan_access.py)が最終判定するため、frontendはUIの
 * 出し分け(viewerには編集ボタンを出さない等)のみを行う不変条件の
 * 二重チェックとして扱う(信頼境界はbackend)。
 *
 * スコープ: 作成・編集の端点(from/to)はEventのみをUIから選択できるように
 * する(Place端点はGate M1のbackend契約には存在するが、frontend側で
 * Place選択UIを提供する候補導線がまだ無いため、本Gateでは選択肢に含めない。
 * 既存のPlace端点を持つSegmentは一覧・詳細表示は可能)。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  PersonStanding, Car, Train, Bus, Ship, Plane, Bike, Car as TaxiIcon,
  Shuffle, Plus, Trash2, Pencil, X, HelpCircle,
} from 'lucide-react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import Input from '@/components/common/Input';
import Modal from '@/components/common/Modal';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import api, { getSegments, createSegment, updateSegment, deleteSegment } from '@/services/api';
import type {
  TravelSegment, SegmentCreateData, SegmentMode, SegmentStatus,
  NormalizedDay, NormalizedEvent,
} from '@/services/api';

const MODE_OPTIONS: { value: SegmentMode; label: string; icon: React.ReactNode }[] = [
  { value: 'walking', label: '徒歩', icon: <PersonStanding size={16} /> },
  { value: 'driving', label: '車', icon: <Car size={16} /> },
  { value: 'train', label: '鉄道', icon: <Train size={16} /> },
  { value: 'bus', label: 'バス', icon: <Bus size={16} /> },
  { value: 'ferry', label: '船', icon: <Ship size={16} /> },
  { value: 'flight', label: '航空', icon: <Plane size={16} /> },
  { value: 'bicycle', label: '自転車', icon: <Bike size={16} /> },
  { value: 'taxi', label: 'タクシー', icon: <TaxiIcon size={16} /> },
  { value: 'mixed', label: '混合', icon: <Shuffle size={16} /> },
];

const STATUS_LABEL: Record<SegmentStatus, string> = {
  planned: '未確定',
  confirmed: '確定',
  cancelled: 'キャンセル',
};

function modeIcon(mode: string): React.ReactNode {
  return MODE_OPTIONS.find((m) => m.value === mode)?.icon ?? <HelpCircle size={16} />;
}

function modeLabel(mode: string): string {
  return MODE_OPTIONS.find((m) => m.value === mode)?.label ?? mode;
}

function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `idem_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function formatDateTime(value: string | null): string {
  if (!value) return '未設定';
  try {
    return new Date(value).toLocaleString('ja-JP', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return value;
  }
}

function eventLabel(events: NormalizedEvent[], eventId: string | null): string {
  if (!eventId) return '(Place)';
  const found = events.find((e) => e.id === eventId);
  return found ? found.title : '(不明なイベント)';
}

interface SegmentFormState {
  from_event_id: string;
  to_event_id: string;
  mode: SegmentMode;
  status: SegmentStatus;
  planned_departure_at: string;
  planned_arrival_at: string;
  cost: string;
  currency: string;
  transport_number: string;
  platform: string;
  preparation_minutes: string;
  buffer_before_minutes: string;
}

const EMPTY_FORM: SegmentFormState = {
  from_event_id: '',
  to_event_id: '',
  mode: 'walking',
  status: 'planned',
  planned_departure_at: '',
  planned_arrival_at: '',
  cost: '',
  currency: 'JPY',
  transport_number: '',
  platform: '',
  preparation_minutes: '',
  buffer_before_minutes: '',
};

function formToPayload(form: SegmentFormState): SegmentCreateData {
  const payload: SegmentCreateData = {
    from_event_id: form.from_event_id,
    to_event_id: form.to_event_id,
    mode: form.mode,
    status: form.status,
  };
  if (form.planned_departure_at) payload.planned_departure_at = new Date(form.planned_departure_at).toISOString();
  if (form.planned_arrival_at) payload.planned_arrival_at = new Date(form.planned_arrival_at).toISOString();
  if (form.cost) {
    payload.cost = form.cost;
    payload.currency = form.currency;
  }
  if (form.transport_number) payload.transport_number = form.transport_number;
  if (form.platform) payload.platform = form.platform;
  if (form.preparation_minutes) payload.preparation_minutes = Number(form.preparation_minutes);
  if (form.buffer_before_minutes) payload.buffer_before_minutes = Number(form.buffer_before_minutes);
  return payload;
}

const SegmentsPage: React.FC = () => {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();

  const [segments, setSegments] = useState<TravelSegment[]>([]);
  const [days, setDays] = useState<NormalizedDay[]>([]);
  const [planRevision, setPlanRevision] = useState<number>(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SegmentFormState>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const allEvents: NormalizedEvent[] = days.flatMap((d) => d.events ?? []);

  const loadAll = useCallback(async () => {
    if (!planId) return;
    setIsLoading(true);
    setError(null);
    try {
      const [segmentList, planDetail] = await Promise.all([
        getSegments(planId),
        api.getPlanDetail(planId),
      ]);
      setSegments(segmentList);
      if (planDetail.success && planDetail.data) {
        setDays(planDetail.data.days ?? []);
        setPlanRevision(planDetail.data.revision);
      }
    } catch (e: any) {
      setError(e?.response?.data?.detail || '移動区間一覧の取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const openCreateForm = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setIsFormOpen(true);
  };

  const openEditForm = (segment: TravelSegment) => {
    setEditingId(segment.id);
    setForm({
      from_event_id: segment.from_event_id ?? '',
      to_event_id: segment.to_event_id ?? '',
      mode: segment.mode,
      status: segment.status,
      planned_departure_at: segment.planned_departure_at ? segment.planned_departure_at.slice(0, 16) : '',
      planned_arrival_at: segment.planned_arrival_at ? segment.planned_arrival_at.slice(0, 16) : '',
      cost: segment.cost ?? '',
      currency: segment.currency ?? 'JPY',
      transport_number: segment.transport_number ?? '',
      platform: segment.platform ?? '',
      preparation_minutes: String(segment.preparation_minutes ?? ''),
      buffer_before_minutes: String(segment.buffer_before_minutes ?? ''),
    });
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
      const payload = formToPayload(form);
      if (editingId) {
        const current = segments.find((s) => s.id === editingId);
        await updateSegment(planId, editingId, payload, current?.revision ?? planRevision);
      } else {
        await createSegment(planId, payload, generateIdempotencyKey());
      }
      setIsFormOpen(false);
      await loadAll();
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      setFormError(typeof detail === 'string' ? detail : detail?.message || '保存に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (segment: TravelSegment) => {
    if (!planId) return;
    if (!window.confirm('この移動区間を削除しますか?')) return;
    try {
      await deleteSegment(planId, segment.id, segment.revision);
      await loadAll();
    } catch (e: any) {
      setError(e?.response?.data?.detail || '削除に失敗しました');
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
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/planner/${planId}`)} className="mb-4">
          ← プランへ戻る
        </Button>

        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold">🚶 移動区間</h1>
          <Button variant="primary" size="sm" onClick={openCreateForm} disabled={allEvents.length < 2}>
            <Plus size={16} className="mr-1" /> 追加
          </Button>
        </div>

        {error && (
          <Card className="mb-4 bg-red-50 border-red-200">
            <p className="text-sm text-red-700">{error}</p>
          </Card>
        )}

        {allEvents.length < 2 && (
          <Card className="mb-4">
            <p className="text-sm text-gray-500">
              移動区間を作成するには、旅程に2つ以上のイベントが必要です。
            </p>
          </Card>
        )}

        {segments.length === 0 ? (
          <Card>
            <p className="text-sm text-gray-500 text-center py-8">まだ移動区間がありません</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {segments.map((segment) => (
              <Card key={segment.id}>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {modeIcon(segment.mode)}
                      <span>{modeLabel(segment.mode)}</span>
                      <span className="text-gray-400">|</span>
                      <span className="text-xs text-gray-500">{STATUS_LABEL[segment.status]}</span>
                    </div>
                    <div className="mt-1 text-sm text-gray-700">
                      {eventLabel(allEvents, segment.from_event_id)} → {eventLabel(allEvents, segment.to_event_id)}
                    </div>
                    <div className="mt-1 text-xs text-gray-500 space-x-3">
                      {segment.distance_km != null && (
                        <span>
                          {segment.distance_km.toFixed(1)}km
                          {segment.is_estimate && <span className="text-amber-600">(概算)</span>}
                        </span>
                      )}
                      {segment.duration_minutes != null && (
                        <span>約{Math.round(segment.duration_minutes)}分</span>
                      )}
                      {segment.cost != null && (
                        <span>{segment.cost} {segment.currency}</span>
                      )}
                    </div>
                    {segment.recommended_departure_at && (
                      <div className="mt-1 text-xs text-blue-600">
                        推奨出発: {formatDateTime(segment.recommended_departure_at)}
                      </div>
                    )}
                    {segment.transport_number && (
                      <div className="mt-1 text-xs text-gray-500">
                        便名: {segment.transport_number}
                        {segment.platform && ` / ${segment.platform}`}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => openEditForm(segment)}>
                      <Pencil size={14} />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(segment)}>
                      <Trash2 size={14} className="text-red-500" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Modal isOpen={isFormOpen} onClose={() => setIsFormOpen(false)} title={editingId ? '移動区間を編集' : '移動区間を追加'}>
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

            <div>
              <label className="block text-sm font-medium mb-1">交通手段</label>
              <select
                className="w-full border rounded-md px-3 py-2 text-sm"
                value={form.mode}
                onChange={(e) => setForm({ ...form, mode: e.target.value as SegmentMode })}
              >
                {MODE_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input
                label="出発予定時刻"
                type="datetime-local"
                value={form.planned_departure_at}
                onChange={(e) => setForm({ ...form, planned_departure_at: e.target.value })}
              />
              <Input
                label="到着予定時刻"
                type="datetime-local"
                value={form.planned_arrival_at}
                onChange={(e) => setForm({ ...form, planned_arrival_at: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input
                label="費用"
                type="number"
                value={form.cost}
                onChange={(e) => setForm({ ...form, cost: e.target.value })}
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
                label="便名"
                value={form.transport_number}
                onChange={(e) => setForm({ ...form, transport_number: e.target.value })}
              />
              <Input
                label="Platform/ゲート"
                value={form.platform}
                onChange={(e) => setForm({ ...form, platform: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input
                label="準備時間(分)"
                type="number"
                value={form.preparation_minutes}
                onChange={(e) => setForm({ ...form, preparation_minutes: e.target.value })}
              />
              <Input
                label="出発前バッファ(分)"
                type="number"
                value={form.buffer_before_minutes}
                onChange={(e) => setForm({ ...form, buffer_before_minutes: e.target.value })}
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

export default SegmentsPage;
