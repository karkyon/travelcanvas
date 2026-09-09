/**
 * ReservationsPage - SC-11 予約一覧・詳細(DOC-04 §画面詳細)。
 *
 * [Gate R3-2] backend/app/api/v1/reservations.py (Gate R3-0/R3-1)は
 * API/DBのみ実装済みでfrontendから一切到達不能だった(DOC-02 §1.1
 * 「画面だけ、APIだけ、DBだけ存在する状態は完成としない」に反する状態)。
 * 本画面でPlannerPageから到達可能にし、一覧・作成・編集・削除・
 * confirmation_number/pinのreveal・参加者管理までを縦に貫通させる。
 *
 * 権限はbackend側(plan_access.py)が最終判定するため、frontendはUIの
 * 出し分け(viewerには編集ボタンを出さない等)のみを行う不変条件の
 * 二重チェックとして扱う(信頼境界はbackend)。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Plane, Building2, Train, Bus, Ship, Car, UtensilsCrossed,
  Ticket as TicketIcon, Landmark, HelpCircle, Plus, Eye, EyeOff, Trash2,
  Users, X, CalendarDays, Lock, Unlock, Link2, QrCode,
} from 'lucide-react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import Input from '@/components/common/Input';
import Modal from '@/components/common/Modal';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import api, {
  getReservations,
  createReservation,
  deleteReservation,
  revealReservation,
  getReservationParticipants,
  createReservationParticipant,
  deleteReservationParticipant,
  getReservationEventLinks,
  createReservationEventLink,
  updateReservationEventLink,
  deleteReservationEventLink,
  getTickets,
  createTicket,
  deleteTicket,
  revealTicket,
} from '@/services/api';
import type {
  Reservation, ReservationCreateData, ReservationParticipant,
  ReservationEventLink, NormalizedDay, NormalizedEvent,
  Ticket, TicketCreateData,
} from '@/services/api';

const RESERVATION_TYPES: { value: string; label: string; icon: React.ReactNode }[] = [
  { value: 'accommodation', label: '宿泊', icon: <Building2 size={16} /> },
  { value: 'flight', label: '航空', icon: <Plane size={16} /> },
  { value: 'train', label: '鉄道', icon: <Train size={16} /> },
  { value: 'bus', label: 'バス', icon: <Bus size={16} /> },
  { value: 'ferry', label: '船', icon: <Ship size={16} /> },
  { value: 'rental_car', label: 'レンタカー', icon: <Car size={16} /> },
  { value: 'restaurant', label: '飲食', icon: <UtensilsCrossed size={16} /> },
  { value: 'activity', label: '体験', icon: <TicketIcon size={16} /> },
  { value: 'admission', label: '入場', icon: <Landmark size={16} /> },
  { value: 'other', label: 'その他', icon: <HelpCircle size={16} /> },
];

const STATUS_LABEL: Record<string, string> = {
  candidate: '未確定',
  confirmed: '確定',
  modified: '変更あり',
  cancelled: 'キャンセル',
  used: '利用済み',
  no_show: '不参加',
};

// [Gate R3-3] event_reservations.relation_type表示ラベル(DOC-05 §6.2)。
const RELATION_TYPE_LABEL: Record<string, string> = {
  primary: '主紐付け',
  required: '必須(連泊等)',
  related: '関連',
};

function typeIcon(type: string): React.ReactNode {
  return RESERVATION_TYPES.find((t) => t.value === type)?.icon ?? <HelpCircle size={16} />;
}

function typeLabel(type: string): string {
  return RESERVATION_TYPES.find((t) => t.value === type)?.label ?? type;
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

interface ReservationFormState {
  type: string;
  provider_name: string;
  confirmation_number: string;
  pin: string;
  holder_name: string;
  guest_count: string;
  start_at: string;
  end_at: string;
  total_amount: string;
  currency: string;
  notes: string;
}

const EMPTY_FORM: ReservationFormState = {
  type: 'accommodation',
  provider_name: '',
  confirmation_number: '',
  pin: '',
  holder_name: '',
  guest_count: '',
  start_at: '',
  end_at: '',
  total_amount: '',
  currency: 'JPY',
  notes: '',
};

function formToPayload(form: ReservationFormState): ReservationCreateData {
  const payload: ReservationCreateData = { type: form.type };
  if (form.provider_name) payload.provider_name = form.provider_name;
  if (form.confirmation_number) payload.confirmation_number = form.confirmation_number;
  if (form.pin) payload.pin = form.pin;
  if (form.holder_name) payload.holder_name = form.holder_name;
  if (form.guest_count) payload.guest_count = Number(form.guest_count);
  if (form.start_at) payload.start_at = new Date(form.start_at).toISOString();
  if (form.end_at) payload.end_at = new Date(form.end_at).toISOString();
  if (form.total_amount) payload.total_amount = Number(form.total_amount);
  if (form.currency) payload.currency = form.currency;
  if (form.notes) payload.notes = form.notes;
  return payload;
}

const ReservationsPage: React.FC = () => {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();

  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<ReservationFormState>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);

  const [selected, setSelected] = useState<Reservation | null>(null);
  const [revealed, setRevealed] = useState<{ confirmation_number: string | null; pin: string | null } | null>(null);
  const [isRevealing, setIsRevealing] = useState(false);

  const [participants, setParticipants] = useState<ReservationParticipant[]>([]);
  const [isParticipantsLoading, setIsParticipantsLoading] = useState(false);
  const [newParticipantName, setNewParticipantName] = useState('');
  const [newParticipantSeat, setNewParticipantSeat] = useState('');

  // [Gate R3-3] イベント複数紐付け(event_reservations)
  const [eventLinks, setEventLinks] = useState<ReservationEventLink[]>([]);
  const [isLinksLoading, setIsLinksLoading] = useState(false);
  const [planDays, setPlanDays] = useState<NormalizedDay[]>([]);
  const [isAddLinkOpen, setIsAddLinkOpen] = useState(false);
  const [newLinkEventId, setNewLinkEventId] = useState('');
  const [newLinkRelationType, setNewLinkRelationType] = useState<'primary' | 'required' | 'related'>('required');
  const [isAddingLink, setIsAddingLink] = useState(false);

  // [Gate R3-11] チケット(tickets)
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [isTicketsLoading, setIsTicketsLoading] = useState(false);
  const [isAddTicketOpen, setIsAddTicketOpen] = useState(false);
  const [newTicketType, setNewTicketType] = useState('');
  const [newTicketPayload, setNewTicketPayload] = useState('');
  const [newTicketBarcodeFormat, setNewTicketBarcodeFormat] = useState('');
  const [isAddingTicket, setIsAddingTicket] = useState(false);
  const [revealedTickets, setRevealedTickets] = useState<Record<string, string | null>>({});

  const loadReservations = useCallback(async () => {
    if (!planId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await getReservations(planId);
      setReservations(data);
    } catch (e: any) {
      setError(e?.response?.data?.detail || '予約一覧の取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    loadReservations();
  }, [loadReservations]);

  const loadParticipants = useCallback(async (reservation: Reservation) => {
    if (!planId) return;
    setIsParticipantsLoading(true);
    try {
      const data = await getReservationParticipants(planId, reservation.id);
      setParticipants(data);
    } catch {
      setParticipants([]);
    } finally {
      setIsParticipantsLoading(false);
    }
  }, [planId]);

  // [Gate R3-3] イベント紐付け一覧 + 紐付け候補となるplanの全イベント(日程別)を読み込む。
  const loadEventLinks = useCallback(async (reservation: Reservation) => {
    if (!planId) return;
    setIsLinksLoading(true);
    try {
      const [links, planDetail] = await Promise.all([
        getReservationEventLinks(planId, reservation.id),
        api.getPlanDetail(planId),
      ]);
      setEventLinks(links);
      setPlanDays(planDetail.data.days || []);
    } catch {
      setEventLinks([]);
      setPlanDays([]);
    } finally {
      setIsLinksLoading(false);
    }
  }, [planId]);

  // [Gate R3-11] チケット一覧の読み込み
  const loadTickets = useCallback(async (reservation: Reservation) => {
    if (!planId) return;
    setIsTicketsLoading(true);
    try {
      const data = await getTickets(planId, reservation.id);
      setTickets(data);
    } catch {
      setTickets([]);
    } finally {
      setIsTicketsLoading(false);
    }
  }, [planId]);

  const openDetail = (reservation: Reservation) => {
    setSelected(reservation);
    setRevealed(null);
    setParticipants([]);
    setEventLinks([]);
    setIsAddLinkOpen(false);
    setTickets([]);
    setIsAddTicketOpen(false);
    setRevealedTickets({});
    loadParticipants(reservation);
    loadEventLinks(reservation);
    loadTickets(reservation);
  };

  const closeDetail = () => {
    setSelected(null);
    setRevealed(null);
    setParticipants([]);
    setEventLinks([]);
    setIsAddLinkOpen(false);
    setTickets([]);
    setIsAddTicketOpen(false);
    setRevealedTickets({});
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!planId) return;
    setIsSaving(true);
    setError(null);
    try {
      await createReservation(planId, formToPayload(createForm));
      setIsCreateOpen(false);
      setCreateForm(EMPTY_FORM);
      await loadReservations();
    } catch (e: any) {
      setError(e?.response?.data?.detail || '予約の作成に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (reservation: Reservation) => {
    if (!planId) return;
    if (!window.confirm(`「${reservation.provider_name || typeLabel(reservation.type)}」を削除しますか?`)) return;
    try {
      await deleteReservation(planId, reservation.id, reservation.revision);
      if (selected?.id === reservation.id) closeDetail();
      await loadReservations();
    } catch (e: any) {
      setError(e?.response?.data?.detail || '予約の削除に失敗しました');
    }
  };

  const handleReveal = async () => {
    if (!planId || !selected) return;
    setIsRevealing(true);
    try {
      const result = await revealReservation(planId, selected.id);
      setRevealed({ confirmation_number: result.confirmation_number, pin: result.pin });
    } catch (e: any) {
      setError(e?.response?.data?.detail || '予約番号の開示に失敗しました(権限が必要です)');
    } finally {
      setIsRevealing(false);
    }
  };

  const handleAddParticipant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!planId || !selected || !newParticipantName.trim()) return;
    try {
      await createReservationParticipant(planId, selected.id, {
        name: newParticipantName.trim(),
        seat: newParticipantSeat.trim() || undefined,
      });
      setNewParticipantName('');
      setNewParticipantSeat('');
      await loadParticipants(selected);
    } catch (e: any) {
      setError(e?.response?.data?.detail || '参加者の追加に失敗しました');
    }
  };

  const handleRemoveParticipant = async (participant: ReservationParticipant) => {
    if (!planId || !selected) return;
    try {
      await deleteReservationParticipant(planId, selected.id, participant.id);
      await loadParticipants(selected);
    } catch (e: any) {
      setError(e?.response?.data?.detail || '参加者の削除に失敗しました');
    }
  };

  // [Gate R3-3] イベント複数紐付け(連泊等)
  const handleAddEventLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!planId || !selected || !newLinkEventId) return;
    setIsAddingLink(true);
    setError(null);
    try {
      await createReservationEventLink(planId, selected.id, {
        event_id: newLinkEventId,
        relation_type: newLinkRelationType,
      });
      setNewLinkEventId('');
      setNewLinkRelationType('required');
      setIsAddLinkOpen(false);
      await loadEventLinks(selected);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'イベント紐付けの追加に失敗しました');
    } finally {
      setIsAddingLink(false);
    }
  };

  const handleToggleLinkLock = async (link: ReservationEventLink) => {
    if (!planId || !selected) return;
    try {
      await updateReservationEventLink(planId, selected.id, link.id, { is_locked: !link.is_locked });
      await loadEventLinks(selected);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'イベント紐付けの更新に失敗しました');
    }
  };

  const handleDeleteEventLink = async (link: ReservationEventLink) => {
    if (!planId || !selected) return;
    try {
      await deleteReservationEventLink(planId, selected.id, link.id);
      await loadEventLinks(selected);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'イベント紐付けの解除に失敗しました(ロック中の可能性があります)');
    }
  };

  // planDaysから「イベントID -> 表示ラベル(日付+タイトル)」の逆引きを作る。
  const eventLabel = (eventId: string): string => {
    for (const day of planDays) {
      const found = (day.events || []).find((ev) => ev.id === eventId);
      if (found) return `${day.local_date} ${found.title}`;
    }
    return eventId;
  };

  // 既に紐付け済みのイベントを候補から除外する。
  const linkedEventIds = new Set(eventLinks.map((l) => l.event_id));
  const linkCandidates: { day: NormalizedDay; event: NormalizedEvent }[] = [];
  for (const day of planDays) {
    for (const ev of day.events || []) {
      if (!linkedEventIds.has(ev.id)) linkCandidates.push({ day, event: ev });
    }
  }

  // [Gate R3-11] チケット(tickets)
  const handleAddTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!planId || !selected || !newTicketType.trim()) return;
    setIsAddingTicket(true);
    setError(null);
    try {
      const payload: TicketCreateData = { ticket_type: newTicketType.trim() };
      if (newTicketPayload.trim()) payload.payload = newTicketPayload.trim();
      if (newTicketBarcodeFormat.trim()) payload.barcode_format = newTicketBarcodeFormat.trim();
      await createTicket(planId, selected.id, payload);
      setNewTicketType('');
      setNewTicketPayload('');
      setNewTicketBarcodeFormat('');
      setIsAddTicketOpen(false);
      await loadTickets(selected);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'チケットの追加に失敗しました');
    } finally {
      setIsAddingTicket(false);
    }
  };

  const handleDeleteTicket = async (ticket: Ticket) => {
    if (!planId || !selected) return;
    if (!window.confirm(`「${ticket.ticket_type}」チケットを削除しますか?`)) return;
    try {
      await deleteTicket(planId, selected.id, ticket.id, ticket.revision);
      await loadTickets(selected);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'チケットの削除に失敗しました');
    }
  };

  const handleRevealTicket = async (ticket: Ticket) => {
    if (!planId || !selected) return;
    try {
      const result = await revealTicket(planId, selected.id, ticket.id);
      setRevealedTickets((prev) => ({ ...prev, [ticket.id]: result.payload }));
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'チケットの表示に失敗しました(権限が必要な場合があります)');
    }
  };

  if (!planId) {
    return (
      <div className="p-8 text-center text-gray-500">
        プランが選択されていません。
        <div className="mt-4">
          <Button variant="primary" onClick={() => navigate('/planner')}>プラン一覧へ</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate(`/planner/${planId}`)} className="mb-2">
            ← プランへ戻る
          </Button>
          <h1 className="text-2xl font-bold text-gray-900">予約一覧</h1>
        </div>
        <Button variant="primary" icon={<Plus size={18} />} onClick={() => setIsCreateOpen(true)}>
          新規予約
        </Button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
      ) : reservations.length === 0 ? (
        <Card padding="lg" className="text-center text-gray-500">
          予約がまだ登録されていません。「新規予約」から追加できます。
        </Card>
      ) : (
        <div className="space-y-3">
          {reservations.map((r) => (
            <Card
              key={r.id}
              padding="md"
              hover
              onClick={() => openDetail(r)}
              className="cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-gray-500">{typeIcon(r.type)}</span>
                  <div>
                    <div className="font-medium text-gray-900">
                      {r.provider_name || typeLabel(r.type)}
                    </div>
                    <div className="text-sm text-gray-500">
                      {typeLabel(r.type)} ・ {formatDateTime(r.start_at)}
                      {r.confirmation_number_masked && ` ・ 予約番号 ${r.confirmation_number_masked}`}
                    </div>
                  </div>
                </div>
                <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600">
                  {STATUS_LABEL[r.status] ?? r.status}
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* 新規予約作成 */}
      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="新規予約" size="md">
        <form onSubmit={handleCreate}>
          <Modal.Body>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">種類</label>
                <select
                  value={createForm.type}
                  onChange={(e) => setCreateForm((f) => ({ ...f, type: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2"
                >
                  {RESERVATION_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <Input
                label="事業者名"
                value={createForm.provider_name}
                onChange={(e) => setCreateForm((f) => ({ ...f, provider_name: e.target.value }))}
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="予約番号"
                  value={createForm.confirmation_number}
                  onChange={(e) => setCreateForm((f) => ({ ...f, confirmation_number: e.target.value }))}
                />
                <Input
                  label="PIN"
                  value={createForm.pin}
                  onChange={(e) => setCreateForm((f) => ({ ...f, pin: e.target.value }))}
                />
              </div>
              <Input
                label="名義"
                value={createForm.holder_name}
                onChange={(e) => setCreateForm((f) => ({ ...f, holder_name: e.target.value }))}
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="開始日時"
                  type="datetime-local"
                  value={createForm.start_at}
                  onChange={(e) => setCreateForm((f) => ({ ...f, start_at: e.target.value }))}
                />
                <Input
                  label="終了日時"
                  type="datetime-local"
                  value={createForm.end_at}
                  onChange={(e) => setCreateForm((f) => ({ ...f, end_at: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="金額"
                  type="number"
                  value={createForm.total_amount}
                  onChange={(e) => setCreateForm((f) => ({ ...f, total_amount: e.target.value }))}
                />
                <Input
                  label="通貨"
                  value={createForm.currency}
                  onChange={(e) => setCreateForm((f) => ({ ...f, currency: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">メモ</label>
                <textarea
                  value={createForm.notes}
                  onChange={(e) => setCreateForm((f) => ({ ...f, notes: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2"
                  rows={3}
                />
              </div>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="ghost" type="button" onClick={() => setIsCreateOpen(false)}>キャンセル</Button>
            <Button variant="primary" type="submit" loading={isSaving}>作成</Button>
          </Modal.Footer>
        </form>
      </Modal>

      {/* 予約詳細 */}
      <Modal isOpen={!!selected} onClose={closeDetail} title="予約詳細" size="lg">
        {selected && (
          <>
            <Modal.Body>
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-lg font-semibold">
                  {typeIcon(selected.type)}
                  {selected.provider_name || typeLabel(selected.type)}
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="text-gray-500">種類</div>
                    <div>{typeLabel(selected.type)}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">状態</div>
                    <div>{STATUS_LABEL[selected.status] ?? selected.status}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">開始</div>
                    <div>{formatDateTime(selected.start_at)}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">終了</div>
                    <div>{formatDateTime(selected.end_at)}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">名義</div>
                    <div>{selected.holder_name || '-'}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">金額</div>
                    <div>
                      {selected.total_amount != null
                        ? `${selected.total_amount.toLocaleString()} ${selected.currency ?? ''}`
                        : '-'}
                    </div>
                  </div>
                </div>

                {/* 予約番号・PIN(マスク表示 + reveal) */}
                <div className="border rounded-lg p-3 bg-gray-50">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-700">予約番号 / PIN</span>
                    {!revealed && (
                      <Button
                        variant="outline"
                        size="sm"
                        icon={<Eye size={14} />}
                        loading={isRevealing}
                        onClick={handleReveal}
                      >
                        表示する
                      </Button>
                    )}
                    {revealed && (
                      <Button variant="ghost" size="sm" icon={<EyeOff size={14} />} onClick={() => setRevealed(null)}>
                        隠す
                      </Button>
                    )}
                  </div>
                  <div className="text-sm space-y-1">
                    <div>
                      予約番号:{' '}
                      {revealed
                        ? (revealed.confirmation_number || '(未登録)')
                        : (selected.confirmation_number_masked || '(未登録)')}
                    </div>
                    <div>
                      PIN: {revealed ? (revealed.pin || '(未登録)') : (selected.has_pin ? '••••' : '(未登録)')}
                    </div>
                  </div>
                </div>

                {selected.notes && (
                  <div>
                    <div className="text-gray-500 text-sm mb-1">メモ</div>
                    <div className="text-sm whitespace-pre-wrap">{selected.notes}</div>
                  </div>
                )}

                {/* [Gate R3-3] 紐付いているイベント(連泊等の複数日紐付け) */}
                <div className="border-t pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                      <Link2 size={16} /> 紐付いているイベント
                    </div>
                    {!isAddLinkOpen && linkCandidates.length > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        icon={<Plus size={14} />}
                        onClick={() => setIsAddLinkOpen(true)}
                      >
                        追加
                      </Button>
                    )}
                  </div>

                  {isLinksLoading ? (
                    <LoadingSpinner size="sm" />
                  ) : (
                    <div className="space-y-2 mb-3">
                      {eventLinks.length === 0 && (
                        <div className="text-sm text-gray-400">紐付いているイベントがありません</div>
                      )}
                      {eventLinks.map((link) => (
                        <div
                          key={link.id}
                          className="flex items-center justify-between text-sm bg-gray-50 rounded px-3 py-2"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <CalendarDays size={14} className="text-gray-400 shrink-0" />
                            <span className="truncate">{eventLabel(link.event_id)}</span>
                            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-600 shrink-0">
                              {RELATION_TYPE_LABEL[link.relation_type] ?? link.relation_type}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleToggleLinkLock(link)}
                              className="text-gray-400 hover:text-gray-700 p-1"
                              aria-label={link.is_locked ? 'ロック解除' : 'ロック'}
                              title={link.is_locked ? 'ロック解除する' : '誤操作防止のためロックする'}
                            >
                              {link.is_locked ? <Lock size={14} /> : <Unlock size={14} />}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteEventLink(link)}
                              disabled={link.is_locked}
                              className="text-gray-400 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed p-1"
                              aria-label="イベント紐付けを解除"
                              title={link.is_locked ? 'ロック中は解除できません' : '紐付けを解除する'}
                            >
                              <X size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {isAddLinkOpen && (
                    <form onSubmit={handleAddEventLink} className="flex flex-wrap gap-2 items-end">
                      <div className="flex-1 min-w-[180px]">
                        <label className="block text-xs text-gray-500 mb-1">イベント</label>
                        <select
                          value={newLinkEventId}
                          onChange={(e) => setNewLinkEventId(e.target.value)}
                          className="w-full border rounded-lg px-2 py-1.5 text-sm"
                        >
                          <option value="">選択してください</option>
                          {linkCandidates.map(({ day, event }) => (
                            <option key={event.id} value={event.id}>
                              {day.local_date} {event.title}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">紐付け種別</label>
                        <select
                          value={newLinkRelationType}
                          onChange={(e) => setNewLinkRelationType(e.target.value as 'required' | 'related')}
                          className="border rounded-lg px-2 py-1.5 text-sm"
                        >
                          <option value="required">必須(連泊等)</option>
                          <option value="related">関連</option>
                        </select>
                      </div>
                      <Button type="submit" variant="outline" size="sm" loading={isAddingLink} disabled={!newLinkEventId}>
                        紐付ける
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setIsAddLinkOpen(false)}>
                        キャンセル
                      </Button>
                    </form>
                  )}
                </div>

                {/* [Gate R3-11] チケット(QR/バーコード) */}
                <div className="border-t pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                      <QrCode size={16} /> チケット
                    </div>
                    {!isAddTicketOpen && (
                      <Button
                        variant="outline"
                        size="sm"
                        icon={<Plus size={14} />}
                        onClick={() => setIsAddTicketOpen(true)}
                      >
                        追加
                      </Button>
                    )}
                  </div>

                  {isTicketsLoading ? (
                    <LoadingSpinner size="sm" />
                  ) : (
                    <div className="space-y-2 mb-3">
                      {tickets.length === 0 && (
                        <div className="text-sm text-gray-400">チケットが登録されていません</div>
                      )}
                      {tickets.map((t) => (
                        <div key={t.id} className="text-sm bg-gray-50 rounded px-3 py-2">
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="font-medium">{t.ticket_type}</span>
                              {t.barcode_format && (
                                <span className="text-xs text-gray-500 ml-2">{t.barcode_format}</span>
                              )}
                              <span className="text-xs text-gray-400 ml-2">
                                {t.has_payload ? 'データあり' : 'データなし'}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {t.has_payload && (
                                revealedTickets[t.id] === undefined ? (
                                  <Button variant="ghost" size="sm" icon={<Eye size={14} />} onClick={() => handleRevealTicket(t)}>
                                    表示
                                  </Button>
                                ) : (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    icon={<EyeOff size={14} />}
                                    onClick={() => setRevealedTickets((prev) => {
                                      const next = { ...prev };
                                      delete next[t.id];
                                      return next;
                                    })}
                                  >
                                    隠す
                                  </Button>
                                )
                              )}
                              <button
                                type="button"
                                onClick={() => handleDeleteTicket(t)}
                                className="text-gray-400 hover:text-red-600"
                                aria-label="チケットを削除"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          </div>
                          {revealedTickets[t.id] !== undefined && (
                            <div className="mt-1 text-xs font-mono break-all text-gray-700">
                              {revealedTickets[t.id] || '(データなし)'}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {isAddTicketOpen && (
                    <form onSubmit={handleAddTicket} className="space-y-2">
                      <div className="flex flex-wrap gap-2">
                        <Input
                          placeholder="種類(例: boarding_pass)"
                          value={newTicketType}
                          onChange={(e) => setNewTicketType(e.target.value)}
                          containerClassName="flex-1 min-w-[140px]"
                        />
                        <Input
                          placeholder="バーコード形式(任意。例: QR_CODE)"
                          value={newTicketBarcodeFormat}
                          onChange={(e) => setNewTicketBarcodeFormat(e.target.value)}
                          containerClassName="flex-1 min-w-[140px]"
                        />
                      </div>
                      <Input
                        placeholder="QR/バーコードのデータ(任意)"
                        value={newTicketPayload}
                        onChange={(e) => setNewTicketPayload(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <Button type="submit" variant="outline" size="sm" loading={isAddingTicket} disabled={!newTicketType.trim()}>
                          追加
                        </Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => setIsAddTicketOpen(false)}>
                          キャンセル
                        </Button>
                      </div>
                    </form>
                  )}
                </div>

                {/* 参加者 */}
                <div className="border-t pt-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                    <Users size={16} /> 参加者
                  </div>
                  {isParticipantsLoading ? (
                    <LoadingSpinner size="sm" />
                  ) : (
                    <div className="space-y-2 mb-3">
                      {participants.length === 0 && (
                        <div className="text-sm text-gray-400">参加者が登録されていません</div>
                      )}
                      {participants.map((p) => (
                        <div key={p.id} className="flex items-center justify-between text-sm bg-gray-50 rounded px-3 py-2">
                          <span>{p.name}{p.seat ? `(座席: ${p.seat})` : ''}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveParticipant(p)}
                            className="text-gray-400 hover:text-red-600"
                            aria-label="参加者を削除"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <form onSubmit={handleAddParticipant} className="flex gap-2">
                    <Input
                      placeholder="氏名"
                      value={newParticipantName}
                      onChange={(e) => setNewParticipantName(e.target.value)}
                      containerClassName="flex-1"
                    />
                    <Input
                      placeholder="座席(任意)"
                      value={newParticipantSeat}
                      onChange={(e) => setNewParticipantSeat(e.target.value)}
                      containerClassName="w-32"
                    />
                    <Button type="submit" variant="outline" size="sm">追加</Button>
                  </form>
                </div>
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="danger" icon={<Trash2 size={16} />} onClick={() => handleDelete(selected)}>
                削除
              </Button>
              <Button variant="ghost" onClick={closeDetail}>閉じる</Button>
            </Modal.Footer>
          </>
        )}
      </Modal>
    </div>
  );
};

export default ReservationsPage;
