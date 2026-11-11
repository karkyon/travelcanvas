import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { nextEventIndexFor } from './planner/nextEventModel';
import { getHoursCheck } from '../services/api/g11planner';
import type { EventHoursCheck } from '../services/api/types/g11planner';
import type { TravelSegment } from '../services/api/types/segments';
import { hoursBadge, keepSlots, moveBlockedReason, reorderImpact, segmentRow } from './planner/plannerModel';
import { applyExtra, areaDrop, areaMove, areaRoles, areaSummary, blockOf, isInnerPair, type AreaExtra } from './planner/areaModel';
import ReorderImpact from './planner/ReorderImpact';
import ReorderPreview from './planner/ReorderPreview';
import TransportIcon from './common/TransportIcon';
import SegmentPicker from './planner/SegmentPicker';
import EventPhotoDialog from './planner/EventPhotoDialog';
import { getEventImageMedia, getEventImages, getMediaProviderStatus } from '../services/api/g11discover';
import type { EventImage } from '../services/api/types/g11discover';
import { creditOf } from '../hooks/useCoverPhoto';
import { getPlanCover } from '../services/api/g11';
import { usePlan } from '../hooks/usePlan';
import { useDragDrop, containerId, finalIndexForGap, reorderArray } from '../hooks/useDragDrop';
import { useToast } from './common/toastContext';
import JourneyAnchorRow from '@/components/planner/JourneyAnchorRow';
import type { DayAnchor } from '@/components/planner/journeyModel';
import Button from './common/Button';
import Modal from './common/Modal';
import ScheduleItem from './planner/ScheduleItem';
import type { PlaceDraft, PlaceTab } from './search/PlaceFinder';
import NewEventForm from './planner/NewEventForm';
import { applyCandidate, lookupPlace, toCategory, type NewEventData } from './planner/newEventLookup';
import type { PlaceInfoResult } from '../services/api/planEdit';
import { nearPoint } from '@/components/places/placeHelpers';
import { usePlanStore } from '@/store/planStore';
import BookingBadge from './planner/BookingBadge';
import { getBookingStatus, linkReservationToEvent, type EventBooking } from '@/services/api/bookingStatus';
import type { DaySchedule, ScheduleItem as ScheduleItemType, CreateScheduleItemData } from '../types';
import UiIcon from '@/components/common/UiIcon';
import { IcCalendar, IcFootprints, IcMapPin, IcTimer, IcWallet } from '@/components/common/uiIcons';

const PlaceFinder = React.lazy(() => import('./search/PlaceFinder'));

/** [Gate WishPlaces] 場所の種類から予定のカテゴリへ */
const toEventCategory = (c: string | null): CreateScheduleItemData['category'] => {
  if (!c) return 'sightseeing';
  if (/rest|food|dining|cafe|meal/i.test(c)) return 'dining';
  if (/hotel|lodging|accom/i.test(c)) return 'accommodation';
  if (/shop|store|market/i.test(c)) return 'shopping';
  return 'sightseeing';
};

interface DayViewProps {
  day: DaySchedule;
  /** [Gate JourneyEnds] 日の最初・最後の「出発・到着・宿」の行 */
  startAnchor?: DayAnchor | null;
  endAnchor?: DayAnchor | null;
  /** [Gate JourneyMove] 出発・帰着の移動手段を設定する(旅行の基本情報を開く) */
  onEditJourney?: () => void;
  planId: string;
  isActive?: boolean;
  showTimeProgress?: boolean;
  onItemClick?: (item: ScheduleItemType) => void;
  onItemEdit?: (item: ScheduleItemType) => void;
  /** 消した後の知らせ(DayView が確かめて消す。呼び出し側は消さない) */
  onItemDelete?: (itemId: string) => void;
  /** [Gate G4] COL-03 予定へのコメントを開く */
  onItemComment?: (item: ScheduleItemType) => void;
  className?: string;
  /** [Gate G11] 旅行の移動区間(予定へ着く移動の名前・時差) */
  segments?: TravelSegment[];
  /** [Gate G11] 予定 → その日の時刻帯(時差をまたぐ区間の出発地) */
  zones?: Record<string, string | undefined>;
  /** [Gate G11] 予定 → 題名(区間の行の出発の予定。別の日の予定を含む) */
  titles?: Record<string, string>;
  /** [Gate MockScreens] 時間の流れの見出しの小見出し(例: DAY 1 · 現地の時刻) */
  headerLabel?: string;
  /** [Gate MockScreens] 見出しの下の日のタブ(旅程の画面が渡す) */
  dayTabs?: React.ReactNode;
  /** [Gate MockScreens] 「ルートを見る」(経路の比較へ) */
  onOpenRoute?: () => void;
  /** [Gate MockScreens] 選んでいる予定(行を強調する) */
  selectedEventId?: string | null;
  /** [Gate MockScreens] 営業時間の照合の結果(選んだ予定の欄へ渡す) */
  onHoursChange?: (byId: Record<string, EventHoursCheck>, pending: boolean) => void;
  /** [Gate PlanUX] 旅程の版(移動区間の保存の If-Match) */
  revision?: number;
  /** [Gate PlanUX] 予定の間で移動手段を選んだ・詳細を直した時(区間の一覧を差し替える) */
  onSegmentSaved?: (segment: TravelSegment) => void | Promise<void>;
  /** [Gate PlanSpotEdit] この日程を削除(日のカードの上に控えめに出す。日が 1 つの時は渡さない) */
  onDeleteDay?: () => void;
  /** [Gate PlanSpotEdit] 値が変わったら予定の写真を読み直す(編集の画面で写真を変えた時) */
  photoSignal?: number;
  /** [Gate TripShare] 予定の写真の表示用 URL(予定 ID → URL)。右の「選択中の予定」でも同じ写真を出す */
  onImageUrls?: (urls: Record<string, string>) => void;
}

const DayView: React.FC<DayViewProps> = ({
  day,
  startAnchor = null,
  endAnchor = null,
  onEditJourney,
  planId,
  isActive = false,
  showTimeProgress = true,
  onItemClick,
  onItemEdit,
  onItemDelete,
  onItemComment,
  className = '',
  segments = [],
  zones = {},
  titles,
  headerLabel,
  dayTabs,
  onOpenRoute,
  selectedEventId = null,
  onHoursChange,
  revision,
  onSegmentSaved,
  onDeleteDay,
  photoSignal = 0,
  onImageUrls,
}) => {
  const { addNewScheduleItem, deleteScheduleItem, reorderSpots } = usePlan();
  const { dragState, handleDragStart, handleDragEnd, isItemDragged } = useDragDrop();

  // [Gate G11] 営業時間の照合。予定の順・時刻・場所が変わったら読み直し、読み直すまでは古い判定を「確認中」にする
  const hoursKey = useMemo(() => day.events.map((e) => `${e.id}|${e.start_time ?? ''}|${e.end_time ?? ''}|${e.place_id ?? ''}`)
    .join(','), [day.events]);
  const [hours, setHours] = useState<{ key: string; byId: Record<string, EventHoursCheck> } | null>(null);
  const [announce, setAnnounce] = useState('');
  useEffect(() => {
    if (!day.events.some((e) => e.place_id)) {
      setHours({ key: hoursKey, byId: {} });
      return undefined;
    }
    let active = true;
    getHoursCheck(planId, day.id).then((r) => {
      if (!active) return;
      setHours({ key: hoursKey, byId: Object.fromEntries(r.events.map((h) => [h.event_id, h])) });
    }).catch(() => {
      if (active) setHours({ key: hoursKey, byId: {} });
    });
    return () => { active = false; };
  }, [planId, day.id, hoursKey, day.events]);
  const hoursPending = !hours || hours.key !== hoursKey;
  useEffect(() => {
    onHoursChange?.(hours?.byId ?? {}, hoursPending);
  }, [hours, hoursPending, onHoursChange]);
  useEffect(() => {
    if (!hoursPending && announce.endsWith('確かめています')) setAnnounce(announce.replace('確かめています', '確かめました'));
  }, [hoursPending, announce]);

  // [Gate G11] 予定のカードの写真(見える写真だけ。一時の URL)
  const [images, setImages] = useState<Record<string, EventImage>>({});
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const imageUrlsCb = useRef(onImageUrls);
  imageUrlsCb.current = onImageUrls;
  useEffect(() => { imageUrlsCb.current?.(imageUrls); }, [imageUrls]);
  const [imagesVersion, setImagesVersion] = useState(0);
  const [photoFor, setPhotoFor] = useState<ScheduleItemType | null>(null);
  const [externalEnabled, setExternalEnabled] = useState(false);
  useEffect(() => {
    let active = true;
    getEventImages(planId).then((m) => { if (active) setImages(m); }).catch(() => { if (active) setImages({}); });
    return () => { active = false; };
  }, [planId, imagesVersion, photoSignal]);
  const imageKey = day.events.filter((e) => images[e.id]).map((e) => `${e.id}:${images[e.id]!.memory_id}`).join(',');
  useEffect(() => {
    let active = true;
    const made: string[] = [];
    const ids = day.events.filter((e) => images[e.id]).map((e) => e.id);
    Promise.all(ids.map((id) => getEventImageMedia(planId, id).then((b) => [id, URL.createObjectURL(b)] as const)
      .catch(() => null))).then((rows) => {
      const ok = rows.filter((r): r is readonly [string, string] => r !== null);
      ok.forEach(([, u]) => made.push(u));
      if (active) setImageUrls(Object.fromEntries(ok));
      else ok.forEach(([, u]) => URL.revokeObjectURL(u));
    });
    return () => { active = false; made.forEach((u) => URL.revokeObjectURL(u)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 写真の組み合わせ(imageKey)が変わった時だけ読み直す
  }, [planId, imageKey]);
  // 予定の写真を変えられるのは編集できる人だけ(表紙の API の can_edit と同じ判定)
  const [canEdit, setCanEdit] = useState(false);
  useEffect(() => {
    let active = true;
    getPlanCover(planId).then((r) => { if (active) setCanEdit(r.can_edit); }).catch(() => { if (active) setCanEdit(false); });
    return () => { active = false; };
  }, [planId]);
  useEffect(() => {
    if (!canEdit) return undefined;
    let active = true;
    getMediaProviderStatus().then((s) => { if (active) setExternalEnabled(s.image_providers.length > 0); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [canEdit]);

  // [Gate BookingBadge] 予定ごとの予約の状態(予約済み・食い違い・合いそうな予約・まだ)。予定が変わったら読み直す
  const bookingKey = day.events.map((e) => `${e.id}|${e.category}|${e.start_time ?? ''}|${e.title}`).join(',');
  const [bookings, setBookings] = useState<Record<string, EventBooking>>({});
  const [bookingVersion, setBookingVersion] = useState(0);
  useEffect(() => {
    let active = true;
    getBookingStatus(planId).then((r) => { if (active) setBookings(r.events ?? {}); }).catch(() => { if (active) setBookings({}); });
    return () => { active = false; };
  }, [planId, bookingKey, bookingVersion]);
  const linkBooking = useCallback(async (reservationId: string, eventId: string) => {
    try {
      await linkReservationToEvent(planId, reservationId, eventId);
      setBookingVersion((v) => v + 1);
    } catch {
      setAnnounce('予約を予定につなげませんでした');
    }
  }, [planId]);

  // [Gate G11] 並べ替えの影響(UIX-M03): 動かす前の並びと営業時間の判定を覚え、差・合わなくなった区間・元に戻すを出す。
  // 続けて動かした時は最初の並びを覚えたまま(元に戻すと、まとめて最初の並びへ戻る)
  const [impact, setImpact] = useState<{ order: string[]; hours: Record<string, EventHoursCheck> | null } | null>(null);
  const [impactBusy, setImpactBusy] = useState(false);
  const titleMap = useMemo(() => titles ?? Object.fromEntries(day.events.map((e) => [e.id, e.title])), [titles, day.events]);
  const impactModel = useMemo(() => (impact
    ? reorderImpact(impact.order, impact.hours, day.events, hours?.byId ?? null, hoursPending, segments) : null),
  [impact, day.events, hours, hoursPending, segments]);
  const impactShown = Boolean(impactModel && impactModel.moves.length > 0);
  useEffect(() => { setImpact(null); }, [day.id]);
  const undoReorder = useCallback(async () => {
    if (!impact) return;
    const now = day.events.map((e) => e.id);
    const back = [...impact.order.filter((id) => now.includes(id)), ...now.filter((id) => !impact.order.includes(id))];
    setImpactBusy(true);
    try {
      // [Gate PlanSpotEdit] 同じ規則(スポットだけを入れ替える)で元の並びへ戻すと、時刻と移動手段も元の位置のまま戻る
      if (!(await reorderSpots(planId, day.id, back))) return;
      setImpact(null);
      setAnnounce('元の並びに戻しました。営業時間と移動を確かめています');
    } finally {
      setImpactBusy(false);
    }
  }, [impact, day.events, day.id, planId, reorderSpots]);
  const keepReorder = useCallback(() => {
    setImpact(null);
    setAnnounce('この並びのままにしました');
  }, []);

  const { addToast } = useToast();

  // [Gate G11 段階7] 並べ替えは保存する前に「案」として見せる(UIX-M03 の preview)。触る・矢印キー・ドラッグは案を作るだけで、
  // 「この並びにする」で1回に保存する。保存の後は ReorderImpact(実際の判定の差と元に戻す)が続く
  const savedOrder = useMemo(() => day.events.map((e) => e.id), [day.events]);
  const byId = useMemo(() => Object.fromEntries(day.events.map((e) => [e.id, e])), [day.events]);
  const [pending, setPending] = useState<string[] | null>(null);
  // [Gate EventArea] エリアのまとまりを動かす案は、時刻を予定に付けたまま(位置の時刻を受け継がない)
  const [pendingKeep, setPendingKeep] = useState(true);
  // [Gate AreaDrag] エリアの出し入れ・時刻の付け直し(並びと一緒に保存する)
  const [pendingExtra, setPendingExtra] = useState<AreaExtra | null>(null);
  const [applying, setApplying] = useState(false);
  // [Gate PlanSpotEdit] 案の並びは「スポットだけを入れ替える」見え方(時刻・移動手段は位置に残す。保存の結果と同じ)
  const slotted = useMemo(() => {
    if (!pending) return null;
    if (pendingKeep) return keepSlots(day.events, pending, segments);
    const byIdNow = new Map(day.events.map((e) => [e.id, e]));
    return { events: applyExtra(pending.map((id) => byIdNow.get(id)!).filter(Boolean), pendingExtra), segments };
  }, [pending, pendingKeep, pendingExtra, day.events, segments]);
  const view = slotted ? slotted.events : day.events;
  // [Gate EventArea] エリアの枠(エリアと、すぐ後ろに続く中の予定)と見出しの数
  const roles = useMemo(() => areaRoles(view), [view]);
  const areaSums = useMemo(() => {
    const out = new Map<string, string>();
    for (const a of view) {
      if (roles.get(a.id)?.role !== 'area') continue;
      out.set(a.id, areaSummary(a, view.filter((e) => roles.get(e.id)?.role === 'member' && roles.get(e.id)?.areaId === a.id)).text);
    }
    return out;
  }, [view, roles]);
  const viewSegments = slotted ? slotted.segments : segments;
  useEffect(() => {
    if (!pending) return;
    const same = pending.length === savedOrder.length && pending.every((id) => savedOrder.includes(id));
    if (!same) {
      setPending(null);
      setAnnounce('予定が変わったため、並べ替えの案を取り消しました(保存していません)');
    }
  }, [pending, savedOrder]);
  useEffect(() => { setPending(null); }, [day.id]);
  const previewModel = useMemo(() => (pending ? reorderImpact(savedOrder, null, view, null, false, viewSegments) : null),
    [pending, savedOrder, view, viewSegments]);
  const propose = useCallback((next: string[], message: string, keep = true, extra: AreaExtra | null = null) => {
    setImpact(null);
    setPendingKeep(keep);
    const hasExtra = Boolean(extra && (extra.parents || (extra.times && Object.keys(extra.times).length)));
    setPendingExtra(hasExtra ? extra : null);
    setPending(next.join(',') === savedOrder.join(',') && !hasExtra ? null : next);
    setAnnounce(message);
  }, [savedOrder]);
  const applyPending = useCallback(async () => {
    if (!pending) return;
    setApplying(true);
    try {
      const baseline = { order: savedOrder, hours: hoursPending ? null : (hours?.byId ?? {}) };
      const extra = pendingExtra;
      const ok = extra ? await reorderSpots(planId, day.id, pending, pendingKeep, extra)
        : await reorderSpots(planId, day.id, pending, pendingKeep);
      setPending(null);
      setPendingExtra(null);
      if (!ok) {
        setAnnounce('並べ替えを保存できませんでした(何も変えていません)');
        return;
      }
      setImpact(baseline);
      addToast({ type: 'success', message: extra ? 'エリアの中の予定と時刻を保存しました'
        : pendingKeep ? 'スポットを入れ替えました(時刻と移動手段はそのまま)' : '並びを変えました(時刻は予定に付いたまま)' });
      setAnnounce('この並びを保存しました。営業時間と移動を確かめています');
    } finally {
      setApplying(false);
    }
  }, [pending, pendingKeep, pendingExtra, savedOrder, hoursPending, hours, reorderSpots, planId, day.id, addToast]);
  const cancelPending = useCallback(() => {
    setPending(null);
    setPendingExtra(null);
    setAnnounce('並べ替えの案をやめました(保存していません)');
  }, []);
  const moveBy = useCallback((event: ScheduleItemType, delta: -1 | 1) => {
    const index = view.findIndex((e) => e.id === event.id);
    // [Gate EventArea] 中の予定はエリアの中でだけ。エリア・エリアを越える時は、まとまりごと(時刻は予定に付いたまま)
    const am = areaMove(view, index, delta);
    if (am.kind === 'blocked') { setAnnounce(am.reason); return; }
    if (am.kind === 'move') { propose(am.order, am.text, false); return; }
    const blocked = moveBlockedReason(view, index, delta);
    if (blocked) {
      setAnnounce(blocked);
      return;
    }
    const to = index + delta;
    if (index < 0 || to < 0 || to >= view.length) return;
    const next = view.map((e) => e.id);
    [next[index], next[to]] = [next[to]!, next[index]!];
    propose(next, `「${event.title}」を${to + 1}番目へ動かす案にしました。まだ保存していません`);
  }, [view, propose]);
  
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [placeTab, setPlaceTabState] = useState<PlaceTab>('manual');
  // [Gate AddEventForm] 手で入力はスポットを編集と同じ入れ方(自動取得・URL・地図・滞在時間)。名前で検索から来たら自動取得する
  const [urlRows, setUrlRows] = useState<string[]>(['']);
  const [stay, setStay] = useState<{ h: string; m: string }>({ h: '', m: '' });
  const [lookupState, setLookupState] = useState<{ busy: boolean; result: PlaceInfoResult | null; error: string | null }>(
    { busy: false, result: null, error: null });
  const lastQuery = useRef('');
  const near = () => {
    const days = usePlanStore.getState().currentPlan?.days ?? [];
    return nearPoint(null, day.events, days.flatMap((d) => d.events));
  };
  // 名前で自動取得し、一番上の候補を空の欄へ入れる(ほかの候補は一覧で選び直せる)
  const autoFill = async (name: string, address?: string | null, at?: { latitude: number; longitude: number } | null) => {
    if (!name.trim()) return;
    setLookupState({ busy: true, result: null, error: null });
    try {
      const { result, best } = await lookupPlace(name, at ?? near(), address);
      if (best) {
        setNewItemData((prev) => (prev.title !== name ? prev : applyCandidate(prev, [], best, false).data));
        setUrlRows((rows) => applyCandidate({}, rows, best, false).urlRows);
      }
      setLookupState({ busy: false, result: result.candidates.length > 1 ? result : null,
        error: result.unavailable ? '場所の情報を読めませんでした(手で入れられます)'
          : best ? `自動取得で住所・電話・公式サイト・地図の位置を入れました。違う時は下の候補から選び直すか、手で直してください`
            : '場所の情報が見つかりませんでした。住所を入れて「自動取得」か「住所から位置を探す」を押してください' });
    } catch {
      setLookupState({ busy: false, result: null, error: '場所の情報を読めませんでした(手で入れられます)' });
    }
  };
  const setPlaceTab = (next: PlaceTab) => {
    setPlaceTabState(next);
    const q = lastQuery.current.trim();
    if (next === 'manual' && q && !newItemData.title?.trim()) {
      setNewItemData((prev) => ({ ...prev, title: q }));
      void autoFill(q);
    }
  };
  const pickPlace = (d: PlaceDraft) => {
    setNewItemData((prev) => ({
      ...prev, title: d.name, location_name: d.name, address: d.address ?? '', category: d.category ? toEventCategory(d.category) : undefined,
      latitude: d.latitude ?? undefined, longitude: d.longitude ?? undefined, phone: '',
      description: d.description ?? prev.description, notes: d.sourceUrl ? `出典: ${d.sourceUrl}` : prev.notes,
    }));
    setUrlRows(['']);
    setPlaceTabState('manual');
    if (!d.name.trim()) return;
    void autoFill(d.name, d.address, d.latitude !== null && d.longitude !== null ? { latitude: d.latitude, longitude: d.longitude } : null);
  };
  // [Gate SpotFromMedia] 動画・投稿・写真の候補を複数まとめて予定に入れる(それぞれ自動取得してから)
  const [bulk, setBulk] = useState<string | null>(null);
  const pickMany = async (drafts: PlaceDraft[]) => {
    let done = 0;
    for (const d of drafts) {
      setBulk(`${done + 1} / ${drafts.length} 件目「${d.name}」を調べています…`);
      let data: NewEventData = {
        title: d.name, location_name: d.name, category: toCategory(d.category) ?? 'sightseeing', address: d.address ?? '',
        latitude: d.latitude ?? undefined, longitude: d.longitude ?? undefined,
        notes: [d.description, d.sourceUrl ? `出典: ${d.sourceUrl}` : null].filter(Boolean).join('\n'),
      };
      let rows: string[] = [];
      try {
        const { best } = await lookupPlace(d.name, near(), d.address);
        if (best) ({ data, urlRows: rows } = applyCandidate(data, [], best, false));
      } catch { /* 名前だけでも入れる */ }
      try {
        await addNewScheduleItem(planId, day.id, {
          ...(data as CreateScheduleItemData), title: d.name, category: data.category ?? 'sightseeing', currency: 'JPY', priority: 3,
          urls: rows.filter((u) => /^https?:\/\//.test(u)).map((url) => ({ url, label: null })),
        });
        done += 1;
      } catch { /* 次へ */ }
    }
    setBulk(null);
    addToast({ type: done === drafts.length ? 'success' : 'warning',
      message: `${done} 件を予定に追加しました${done < drafts.length ? `(${drafts.length - done} 件は追加できませんでした)` : ''}。時刻は未定です` });
    if (done > 0) setIsAddModalOpen(false);
  };
  const [newItemData, setNewItemData] = useState<Partial<CreateScheduleItemData>>({
    title: '',
    description: '',
    category: 'sightseeing',
    start_time: '',
    end_time: '',
    location_name: '',
    address: '',
    cost: 0,
    priority: 3
  });

  // 優先度(数値)と表示ラベルの相互変換
  const priorityToLabel = (p?: number): 'low' | 'medium' | 'high' => {
    if (p === undefined) return 'medium';
    if (p <= 2) return 'low';
    if (p >= 4) return 'high';
    return 'medium';
  };

  // 日付から曜日を算出(DaySchedule型にday_of_weekフィールドが存在しないため)
  const getDayOfWeek = (dateStr?: string): string => {
    if (!dateStr) return '';
    const labels = ['日', '月', '火', '水', '木', '金', '土'];
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '';
    return labels[d.getDay()] || '';
  };

  // 時間の計算
  const timeStats = useMemo(() => {
    const totalDuration = day.events.reduce((sum, item) => sum + (item.duration || 0), 0);
    const totalCost = day.events.reduce((sum, item) => sum + (item.cost || 0), 0);
    const totalTravelTime = day.events.reduce((sum, item) => sum + (item.travel_time || 0), 0);
    
    return {
      totalDuration,
      totalCost,
      totalTravelTime,
      eventCount: day.events.length
    };
  }, [day.events]);

  // 現在時刻に基づく次のイベントの特定。[Gate SpotInfo] その日が「今日」(その日の現地の日付)の時だけ。
  // 旅行の当日でない日に NEXT を出すと意味が無い(2026-11-07 の指摘)
  const nextEventIndex = useMemo(
    () => (showTimeProgress ? nextEventIndexFor(day.events, day.date, day.timezone_id) : -1),
    [day.events, day.date, day.timezone_id, showTimeProgress],
  );

  // スケジュールアイテム追加
  const handleAddItem = useCallback(async () => {
    try {
      if (!newItemData.title?.trim()) {
        addToast({
          type: 'warning',
          message: 'タイトルを入力してください'
        });
        return;
      }

      const itemData: CreateScheduleItemData = {
        title: newItemData.title!,
        description: newItemData.description || '',
        category: newItemData.category || 'sightseeing',
        start_time: newItemData.start_time || '',
        end_time: newItemData.end_time || '',
        duration: newItemData.duration || 60,
        location_name: newItemData.location_name || '',
        latitude: newItemData.latitude,
        longitude: newItemData.longitude,
        address: newItemData.address || '',
        cost: newItemData.cost || 0,
        currency: 'JPY',
        priority: newItemData.priority || 3,
        travel_method: newItemData.travel_method || 'walking',
        travel_time: newItemData.travel_time || 0,
        travel_cost: newItemData.travel_cost || 0,
        notes: newItemData.notes || '',
        phone: newItemData.phone?.trim() || undefined,
        urls: urlRows.map((u) => u.trim()).filter((u) => /^https?:\/\//.test(u)).slice(0, 5).map((url) => ({ url, label: null })),
        dining: newItemData.dining ?? undefined,
        // [Gate EventArea] エリアの中へ(エリア自身は入れない)
        parent_event_id: newItemData.category !== 'area' && newItemData.parent_event_id ? newItemData.parent_event_id : undefined,
      };
      const badUrl = urlRows.map((u) => u.trim()).find((u) => u && !/^https?:\/\/[^\s]+$/.test(u));
      if (badUrl) {
        addToast({ type: 'warning', message: `URL の形が違います: ${badUrl}` });
        return;
      }

      await addNewScheduleItem(planId, day.id, itemData);
      
      setIsAddModalOpen(false);
      setLookupState({ busy: false, result: null, error: null });
      setUrlRows(['']);
      setStay({ h: '', m: '' });
      lastQuery.current = '';
      setNewItemData({
        title: '',
        description: '',
        category: 'sightseeing',
        start_time: '',
        end_time: '',
        location_name: '',
        address: '',
        cost: 0,
        priority: 3
      });

      addToast({
        type: 'success',
        message: 'スケジュールを追加しました'
      });

    } catch (error) {
      console.error('スケジュール追加エラー:', error);
      addToast({
        type: 'error',
        message: 'スケジュールの追加に失敗しました'
      });
    }
  }, [newItemData, urlRows, addNewScheduleItem, planId, day.id, addToast]);

  // スケジュールアイテム削除
  const handleDeleteItem = useCallback(async (itemId: string) => {
    if (!confirm('このスケジュールを削除しますか？')) return;

    try {
      // [Gate B-013] 失敗(確定ロック・競合等)はストア側でロールバックと理由の表示を済ませる。
      // 成功した時だけ成功表示を出し、予約等との紐付けを外した場合はその内容を案内する。
      const { ok, note } = await deleteScheduleItem(itemId);
      if (!ok) return;
      onItemDelete?.(itemId);

      addToast({
        type: 'success',
        message: note ?? 'スケジュールを削除しました'
      });

    } catch (error) {
      console.error('スケジュール削除エラー:', error);
      addToast({
        type: 'error',
        message: 'スケジュールの削除に失敗しました'
      });
    }
  }, [deleteScheduleItem, onItemDelete, addToast]);

  // ドロップゾーンの処理
  // [Gate G11 段階7] ドラッグも案を作るだけ(保存は「この並びにする」)。確定(🔒)の予定の位置が変わる並べ替えは作らない
  // [Gate PlanSpotEdit] 予定の行そのものを落とせる場所にし、行の上半分なら前・下半分なら後ろに入れる(線で示す)
  // [Gate AreaDrag] 落とした所がエリアの中か外かも見る(エリアの中へ入れる・外へ出す・中で並べ替える)。
  // エリアの見出しの下半分・中の予定の行・「ここに落とすとエリアに入ります」はエリアの中。エリアの見出しの上半分は前(外)
  const [dropAt, setDropAt] = useState<{ gap: number; parent: string | null } | null>(null);
  const ownDrag = dragState.isDragging && dragState.sourceContainer === containerId(planId, day.id);
  const draggedId = ownDrag ? dragState.draggedItems?.[0]?.id ?? null : null;
  const draggingArea = Boolean(draggedId && roles.get(draggedId)?.role === 'area');
  useEffect(() => { if (!dragState.isDragging) setDropAt(null); }, [dragState.isDragging]);
  const setDrop = useCallback((gap: number, parent: string | null) => {
    setDropAt((d) => (d && d.gap === gap && d.parent === parent ? d : { gap, parent }));
  }, []);
  const overRow = useCallback((e: React.DragEvent<HTMLElement>, index: number, mode: 'none' | 'member' | 'areaHead', areaId?: string) => {
    if (!ownDrag) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const r = e.currentTarget.getBoundingClientRect();
    const lower = !(e.clientY < r.top + r.height / 2);
    if (mode === 'member' && !draggingArea) { setDrop(lower ? index + 1 : index, areaId ?? null); return; }
    if (mode === 'areaHead' && !draggingArea) { setDrop(lower ? index + 1 : index, lower ? view[index]!.id : null); return; }
    if (mode === 'areaHead' || mode === 'member') {
      // エリアを動かす時は、エリアの枠の前か後ろ(外)
      const ai = mode === 'member' ? view.findIndex((x) => x.id === areaId) : index;
      const [, be] = blockOf(view, ai, roles);
      setDrop(lower ? be + 1 : ai, null);
      return;
    }
    setDrop(lower ? index + 1 : index, null);
  }, [ownDrag, draggingArea, setDrop, view, roles]);
  const handleItemDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const at = dropAt;
    setDropAt(null);
    let itemId: string | null = null;
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json')) as { itemId?: string; sourceContainer?: string };
      itemId = data.sourceContainer === containerId(planId, day.id) && data.itemId ? data.itemId : null;
    } catch {
      itemId = null;
    }
    handleDragEnd();
    if (!itemId || !byId[itemId] || !at) return;
    // [Gate AreaDrag] エリアが関わる時は、並び・エリアの指定・時刻(はみ出したらエリアを延ばす)を 1 つの案に
    const ad = areaDrop(view, itemId, at.gap, at.parent);
    if (ad.kind === 'blocked') {
      if (ad.reason !== '同じ位置です') addToast({ type: 'warning', message: ad.reason });
      setAnnounce(ad.reason);
      return;
    }
    if (ad.kind === 'move') { propose(ad.order, ad.text, false, ad.extra); return; }
    const order = view.map((x) => x.id);
    const next = reorderArray(order, itemId, finalIndexForGap(order, itemId, at.gap));
    if (view.some((x, i) => x.locked && next[i] !== x.id)) {
      setAnnounce('確定の予定の位置が変わるため、この並べ替えはできません');
      addToast({ type: 'error', message: '確定の予定の位置は変えられません' });
      return;
    }
    propose(next, `「${byId[itemId]!.title}」を${next.indexOf(itemId) + 1}番目へ動かす案にしました。まだ保存していません`);
  }, [planId, day.id, view, byId, handleDragEnd, propose, addToast, dropAt]);

  // [Gate AreaDrag] 旅程の並び → まとまり(普通の予定 1 つ・エリアと中の予定)
  const blocks = useMemo(() => {
    const out: Array<{ kind: 'single'; index: number } | { kind: 'area'; index: number; members: number[] }> = [];
    view.forEach((e, i) => {
      const r = roles.get(e.id);
      if (r?.role === 'area') { out.push({ kind: 'area', index: i, members: [] }); return; }
      const last = out[out.length - 1];
      if (r?.role === 'member' && last?.kind === 'area' && view[last.index]!.id === r.areaId) { last.members.push(i); return; }
      out.push({ kind: 'single', index: i });
    });
    return out;
  }, [view, roles]);
  // エリアの詳細(写真・住所・リンク)は見出しの「エリアの詳細を開く」で出す
  const [openAreas, setOpenAreas] = useState<Set<string>>(() => new Set());
  const toggleArea = useCallback((id: string) => {
    setOpenAreas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }, []);
  const dropLine = (gap: number, parent: string | null) => (ownDrag && dropAt && dropAt.gap === gap && dropAt.parent === parent
    ? <div className={`tc-day-drop-line${parent ? ' is-in-area' : ''}`} aria-hidden="true" data-testid="drop-line" /> : null);

  // [Gate G11] この予定へ着く移動の区間(タイムラインの独立した行)。[Gate EventArea] エリアの中は歩いて回る(数えない)
  const segmentFor = (index: number): React.ReactNode => {
    const event = view[index]!;
    const row = segmentRow(view, index, viewSegments, zones, day.timezone_id, titleMap);
    const inner = index > 0 && isInnerPair(view[index - 1], event);
    if (inner) {
      return (
        <div role="listitem" className="tc-segment-row tc-segment-row--inner" data-testid="segment-inner" data-to-event={event.id}>
          <span className="sr-only">移動:</span>エリアの中 · 歩いて回る(移動として数えない)
        </div>
      );
    }
    if (index > 0) {
      return (
        <SegmentPicker planId={planId} revision={revision} fromEventId={view[index - 1]!.id}
          fromTitle={view[index - 1]!.title} toEventId={event.id} toTitle={event.title}
          segment={row ? (viewSegments.find((sg) => sg.to_event_id === event.id) ?? null) : null}
          mismatch={Boolean(row?.mismatch)} canEdit={canEdit && Boolean(onSegmentSaved) && !pending}
          onSaved={(sg) => onSegmentSaved?.(sg)}>
          {row ? (
            <div data-testid="segment-row" data-to-event={event.id}
              data-mismatch={row.mismatch ? 'true' : 'false'}
              className={`tc-segment-row ${row.mismatch ? 'is-mismatch' : ''}`}>
              <span className="sr-only">移動:</span>
              <TransportIcon mode={row.leg.mode} />
              <span>{row.leg.text}</span>
              {row.leg.distance && <span data-testid="segment-distance">· {row.leg.distance}</span>}
              {row.leg.isEstimate && <span>(推定)</span>}
              {row.leg.status === 'confirmed' && <span>・確定</span>}
              {row.leg.detail && (
                <span className="tc-seg-detail" data-testid="segment-detail" title={row.leg.basis ?? undefined}>{row.leg.detail}</span>
              )}
              {row.leg.crossZone && <span data-testid="schedule-cross-zone">{row.leg.crossZone.text}</span>}
              {row.leg.zoneUnknown && <span>・時刻帯未確認</span>}
              {row.mismatch && (
                <span data-testid="segment-mismatch">⚠ 前の予定と合っていません(区間は自動では直しません)</span>
              )}
            </div>
          ) : undefined}
        </SegmentPicker>
      );
    }
    // [Gate JourneyMove] 2 日目以降の最初の予定の前: 前の夜の宿 → 最初の予定の移動を選べる
    if (startAnchor?.kind === 'lodging-from' && startAnchor.eventId) {
      return (
        <SegmentPicker planId={planId} revision={revision} fromEventId={startAnchor.eventId}
          fromTitle={startAnchor.place ?? '宿'} toEventId={event.id} toTitle={event.title}
          segment={row ? (viewSegments.find((sg) => sg.to_event_id === event.id) ?? null) : null}
          canEdit={canEdit && Boolean(onSegmentSaved) && !pending} onSaved={(sg) => onSegmentSaved?.(sg)}>
          {row ? (
            <div data-testid="segment-row" data-to-event={event.id} data-mismatch="false" className="tc-segment-row">
              <span className="sr-only">宿からの移動:</span>
              <TransportIcon mode={row.leg.mode} />
              <span>{row.leg.text}</span>
              {row.leg.distance && <span data-testid="segment-distance">· {row.leg.distance}</span>}
              {row.leg.isEstimate && <span>(推定)</span>}
              {row.leg.detail && (
                <span className="tc-seg-detail" data-testid="segment-detail" title={row.leg.basis ?? undefined}>{row.leg.detail}</span>
              )}
            </div>
          ) : undefined}
        </SegmentPicker>
      );
    }
    if (!row) return null;
    return (
      <div role="listitem" data-testid="segment-row" data-to-event={event.id}
        data-mismatch={row.mismatch ? 'true' : 'false'}
        className={`tc-segment-row ${row.mismatch ? 'is-mismatch' : ''}`}>
        <span className="sr-only">移動:</span>
        <TransportIcon mode={row.leg.mode} />
        <span>{row.leg.text}</span>
        {row.leg.distance && <span data-testid="segment-distance">· {row.leg.distance}</span>}
        {row.leg.isEstimate && <span>(推定)</span>}
        {row.leg.detail && (
          <span className="tc-seg-detail" data-testid="segment-detail" title={row.leg.basis ?? undefined}>{row.leg.detail}</span>
        )}
        {row.leg.crossZone && <span data-testid="schedule-cross-zone">{row.leg.crossZone.text}</span>}
        {row.mismatch && (
          <span data-testid="segment-mismatch">⚠ 前の予定と合っていません(区間は自動では直しません)</span>
        )}
      </div>
    );
  };

  // 予定の行(エリアは見出しにし、詳細は開いた時だけ)
  const itemRow = (index: number, opts?: { head?: React.ReactNode; onOver?: (e: React.DragEvent<HTMLElement>) => void }): React.ReactNode => {
    const event = view[index]!;
    const row = segmentRow(view, index, viewSegments, zones, day.timezone_id, titleMap);
    // [Gate EventArea] 並べ替えのボタン: エリアのまとまり・中の予定の決まりも見る
    const blockedBy = (delta: -1 | 1) => {
      const am = areaMove(view, index, delta);
      return am.kind === 'blocked' || (am.kind === 'default' && moveBlockedReason(view, index, delta) !== null);
    };
    const upBlocked = index === 0 || blockedBy(-1);
    const downBlocked = index === view.length - 1 || blockedBy(1);
    const isAreaHead = Boolean(opts?.head);
    const showItem = !isAreaHead || openAreas.has(event.id);
    return (
      <div
        draggable={!event.locked}
        tabIndex={0}
        role="listitem"
        aria-label={`${isAreaHead ? `エリア ${event.title}` : event.title}(上下矢印キーで並べ替え)`}
        onDragStart={(e) => handleDragStart(e, event, containerId(planId, day.id))}
        onDragEnd={handleDragEnd}
        onDragOver={opts?.onOver}
        onDrop={opts?.onOver ? (e) => { if (ownDrag) handleItemDrop(e); } : undefined}
        onClick={() => onItemClick?.(event)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            moveBy(event, e.key === 'ArrowUp' ? -1 : 1);
          }
        }}
        className={`tc-event-row${isAreaHead ? ' tc-area-head' : ''} ${isItemDragged(event.id) ? 'opacity-50' : ''} ${event.locked ? '' : 'tc-draggable'}`.trim()}
      >
        <div className="min-w-0 flex-1">
        {opts?.head}
        {showItem && (
        <ScheduleItem
          id={event.id}
          title={event.title}
          description={event.description}
          startTime={event.start_time || ''}
          endTime={event.end_time || ''}
          endDayOffset={event.end_day_offset}
          duration={event.duration || 0}
          locationName={event.location_name || ''}
          address={event.address || ''}
          cost={event.cost}
          currency={event.currency}
          category={event.category}
          locked={Boolean(event.locked)}
          priority={priorityToLabel(event.priority)}
          travelMethod={row ? undefined : event.travel_method}
          travelTime={event.travel_time}
          travelCost={event.travel_cost}
          notes={event.notes}
          isNext={showTimeProgress && index === nextEventIndex}
          bookingInfo={event.booking_info as { url?: string; phone?: string } | undefined}
          contactInfo={event.phone
            ? { ...(event.contact_info as { website?: string } | undefined), phone: event.phone }
            : event.contact_info as { website?: string; phone?: string } | undefined}
          links={event.urls}
          onEdit={() => onItemEdit?.(event)}
          onDelete={() => handleDeleteItem(event.id)}
          onComment={onItemComment ? () => onItemComment(event) : undefined}
          hours={hoursBadge(hours?.byId[event.id], hoursPending && Boolean(event.place_id))}
          image={imageUrls[event.id] ? { src: imageUrls[event.id]!, credit: creditOf(images[event.id]?.source) } : null}
          onPhoto={canEdit ? () => setPhotoFor(event) : undefined}
          selected={selectedEventId === event.id}
          badge={bookings[event.id] ? (
            <BookingBadge planId={planId} eventId={event.id} title={event.title} category={event.category} booking={bookings[event.id]!} canEdit={canEdit}
              onLink={(rid) => linkBooking(rid, event.id)} />
          ) : null}
        />
        )}
        </div>
        {/* [Gate G11] 触って使える並べ替え(ドラッグ・上下矢印キーと同じ入れ替え)。[Gate MockScreens] モックの event-actions(右) */}
        <div className="tc-event-actions">
          <button type="button" aria-label={`「${event.title}」を上へ移す`} disabled={upBlocked}
            data-testid={`move-up-${event.id}`} className="tc-focus-ring"
            onClick={(e) => { e.stopPropagation(); moveBy(event, -1); }}>↑</button>
          <button type="button" aria-label={`「${event.title}」を下へ移す`} disabled={downBlocked}
            data-testid={`move-down-${event.id}`} className="tc-focus-ring"
            onClick={(e) => { e.stopPropagation(); moveBy(event, 1); }}>↓</button>
        </div>
      </div>
    );
  };

  return (
    <div className={`tc-dayview ${className}`.trim()}>
      {/* [Gate MockScreens] モックの timeline-card の見出し: 小見出し・日の題・ルートを見る・日のタブ・現地時間・集計・移動手段の凡例 */}
      <div className="tc-day-head" data-active={isActive ? 'true' : 'false'}>
        <div className="tc-section-row">
          <div className="min-w-0">
            {headerLabel && <p className="tc-label">{headerLabel}</p>}
            <h2 className="tc-section-title tc-day-title">{day.date ? `${day.date} (${getDayOfWeek(day.date)})` : '日付未定'}</h2>
          </div>
          <div className="tc-day-head-actions">
            {/* [Gate DayAdd] 予定の追加はこの 1 つ(以前は旅程の見出しと日の下に同じ働きの 2 つがあった) */}
            <Button variant="outline" size="sm" className="tc-day-add" onClick={() => setIsAddModalOpen(true)} data-testid="day-add-event"
              title={`${day.date ? `${day.date} (${getDayOfWeek(day.date)})` : 'この日'}に予定を追加`}>
              ＋ 予定を追加
            </Button>
            {onOpenRoute && (
              <button type="button" className="tc-focus-ring tc-mini-link" onClick={onOpenRoute}>ルートを見る <span aria-hidden="true">↗</span></button>
            )}
            {/* [Gate PlanSpotEdit] どの日程を消すかが分かるよう、日のカードの上に控えめな赤い文字で置く */}
            {onDeleteDay && (
              <button type="button" className="tc-focus-ring tc-day-delete" onClick={onDeleteDay} data-testid="day-delete"
                aria-label={`${day.date ? `${day.date} (${getDayOfWeek(day.date)})` : 'この日'}の日程を削除`}>
                この日程を削除
              </button>
            )}
          </div>
        </div>
        {dayTabs}
        {/* [Gate G11] 予定の時刻はこの日の現地時間(端末と同じ時刻帯でも省かない) */}
        <p className="tc-day-meta" data-testid="day-timezone">{`現地時間 · ${day.timezone_id || '時刻帯未確認'}`}</p>
        <div className="tc-day-stats">
          <span><UiIcon icon={IcMapPin} size={13} className="mr-1 align-[-2px]" />{timeStats.eventCount}件</span>
          {timeStats.totalDuration > 0 && (
            <span><UiIcon icon={IcTimer} size={13} className="mr-1 align-[-2px]" />{Math.floor(timeStats.totalDuration / 60)}時間{timeStats.totalDuration % 60}分</span>
          )}
          {timeStats.totalCost > 0 && (
            <span><UiIcon icon={IcWallet} size={13} className="mr-1 align-[-2px]" />¥{timeStats.totalCost.toLocaleString()}</span>
          )}
          {timeStats.totalTravelTime > 0 && (
            <span><UiIcon icon={IcFootprints} size={13} className="mr-1 align-[-2px]" />移動{timeStats.totalTravelTime}分</span>
          )}
        </div>
        {/* [Gate PlanUX] 移動手段の印は常に並べない。予定と予定の間の「移動手段を選ぶ」で出す */}
      </div>

      {photoFor && (
        <EventPhotoDialog isOpen onClose={() => setPhotoFor(null)} planId={planId} eventId={photoFor.id}
          eventTitle={photoFor.title}
          near={typeof photoFor.latitude === 'number' && typeof photoFor.longitude === 'number'
            ? { latitude: photoFor.latitude, longitude: photoFor.longitude } : null}
          current={images[photoFor.id] ?? null} externalEnabled={externalEnabled}
          onChanged={() => setImagesVersion((v) => v + 1)} />
      )}

      {/* [Gate G11] 並べ替えの結果と再確認の知らせ(読み上げ) */}
      <p className="sr-only" role="status" aria-live="polite" data-testid="reorder-status">{announce}</p>

      {pending && previewModel && (
        <ReorderPreview dayId={day.id} model={previewModel} busy={applying}
          onApply={() => { void applyPending(); }} onCancel={cancelPending} />
      )}

      {!pending && impactShown && impactModel && (
        <ReorderImpact dayId={day.id} model={impactModel} busy={impactBusy}
          onUndo={() => { void undoReorder(); }} onKeep={keepReorder} />
      )}

      {startAnchor && <JourneyAnchorRow anchor={startAnchor} position="start" onEditMove={onEditJourney} />}

      {/* スケジュールリスト
          [Gate B-013] 予定(role="listitem")は一覧(role="list")の中に置く必要がある(axe
          aria-required-parent)。予定がある時だけ一覧の役割を与え、間の包みは役割無しにする。 */}
      <div
        className="tc-event-list"
        role={day.events.length > 0 ? 'list' : undefined}
        aria-label={day.events.length > 0 ? `${day.date}の予定` : undefined}
      >
        {day.events.length === 0 ? (
          /* 空の状態 */
          <div className="tc-day-empty">
            <div className="text-center py-6 text-ink-500">
              <div className="mb-2 flex justify-center"><UiIcon icon={IcCalendar} size={32} /></div>
              <p className="text-base font-semibold text-ink-900 mb-1">まだスケジュールがありません</p>
              <p className="text-sm mb-4">行きたい場所を予定にすると、地図と選んだ予定の欄に出ます</p>
              <Button
                variant="primary"
                onClick={() => setIsAddModalOpen(true)}
                leftIcon={
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                  </svg>
                }
              >
                最初のスケジュールを追加
              </Button>
            </div>
          </div>
        ) : (
          blocks.map((block) => {
            if (block.kind === 'single') {
              const index = block.index;
              const event = view[index]!;
              return (
                <div key={event.id} role="none" onDragOver={(e) => overRow(e, index, 'none')} data-area-role="none"
                  onDrop={(e) => { if (ownDrag) handleItemDrop(e); }}>
                  {dropLine(index, null)}
                  {segmentFor(index)}
                  {itemRow(index)}
                </div>
              );
            }
            const index = block.index;
            const area = view[index]!;
            const open = openAreas.has(area.id);
            const lastGap = (block.members.length ? block.members[block.members.length - 1]! : index) + 1;
            return (
              <div key={area.id} role="none" data-area-role="area-block">
                <div role="none" onDragOver={(e) => overRow(e, index, 'none')} onDrop={(e) => { if (ownDrag) handleItemDrop(e); }}>
                  {dropLine(index, null)}
                  {segmentFor(index)}
                </div>
                {/* [Gate AreaDrag] エリアの枠: 見出し(エリアの名前・時刻・滞在・中の予定・空き・詳細を開く)と、中の予定 */}
                <div className="tc-area-block" data-testid={`area-block-${area.id}`}
                  data-drop={ownDrag && dropAt?.parent === area.id ? 'in' : undefined}>
                  {itemRow(index, {
                    head: (
                      <div className="tc-area-head-main">
                        <p className="tc-area-head-title">
                          <span className="tc-area-tag">エリア</span>
                          <strong>{area.title}</strong>
                          <span className="tc-area-head-time">{area.start_time ? `${area.start_time.slice(0, 5)}〜${area.end_time ? area.end_time.slice(0, 5) : ''}` : '時刻未設定'}</span>
                        </p>
                        <p className="tc-area-sum" data-testid={`area-summary-${area.id}`}>{areaSums.get(area.id)}</p>
                        <button type="button" className="tc-focus-ring tc-mini-link tc-area-toggle" aria-expanded={open}
                          data-testid={`area-toggle-${area.id}`}
                          onClick={(e) => { e.stopPropagation(); toggleArea(area.id); }}>
                          {open ? 'エリアの詳細を閉じる' : 'エリアの詳細を開く'}
                        </button>
                      </div>
                    ),
                    onOver: (e) => overRow(e, index, 'areaHead'),
                  })}
                  <div className="tc-area-inner" role="none">
                    <p className="tc-area-inner-label" aria-hidden="true">エリアの中の予定</p>
                    {block.members.map((mi) => {
                      const m = view[mi]!;
                      return (
                        <div key={m.id} role="none" className="tc-area-member" data-area-role="member"
                          onDragOver={(e) => overRow(e, mi, 'member', area.id)}
                          onDrop={(e) => { if (ownDrag) handleItemDrop(e); }}>
                          {dropLine(mi, area.id)}
                          {segmentFor(mi)}
                          {itemRow(mi)}
                        </div>
                      );
                    })}
                    {dropLine(lastGap, area.id)}
                    {(block.members.length === 0 || ownDrag) && (
                      <div role="none" className={`tc-area-dropzone${ownDrag ? ' is-active' : ''}`} data-testid={`area-dropzone-${area.id}`}
                        onDragOver={(e) => { if (!ownDrag || draggingArea) return; e.preventDefault(); e.stopPropagation(); setDrop(lastGap, area.id); }}
                        onDrop={(e) => { if (ownDrag) { e.stopPropagation(); handleItemDrop(e); } }}>
                        {ownDrag ? 'ここに落とすとエリアに入ります' : '中の予定はまだありません(予定をここへドラッグすると入ります)'}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}

        {/* 最後の予定の後ろへ落とす所(エリアの外) */}
        {ownDrag && (
          <div role="none" className="tc-day-drop-tail" data-testid="drop-tail"
            onDragOver={(e) => { e.preventDefault(); setDrop(view.length, null); }}
            onDrop={(e) => handleItemDrop(e)}>
            {dropLine(view.length, null)}
            <span>ここに落とすと最後へ</span>
          </div>
        )}
      </div>

      {endAnchor && <JourneyAnchorRow anchor={endAnchor} position="end" onAddLodging={() => setIsAddModalOpen(true)}
        onEditMove={onEditJourney} />}

      {/* スケジュール追加モーダル */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title="予定を追加"
        size="lg"
      >
        <Modal.Body>
          <React.Suspense fallback={<p className="text-sm text-ink-700" role="status">読み込み中…</p>}>
            <PlaceFinder tab={placeTab} onTab={setPlaceTab} onPick={pickPlace} withWish pickLabel="入れる" planId={planId}
              onPickMany={(d) => void pickMany(d)} onQuery={(q) => { lastQuery.current = q; }} />
          </React.Suspense>
          {bulk && <p className="mt-3 text-sm text-ink-700" role="status" data-testid="add-bulk">{bulk}</p>}
          <div className={placeTab === 'manual' ? '' : 'hidden'}>
            <NewEventForm data={newItemData} setData={setNewItemData} urlRows={urlRows} setUrlRows={setUrlRows} stay={stay} setStay={setStay}
              near={near()} lookupState={lookupState} setLookupState={setLookupState}
              areas={day.events.filter((e) => e.category === 'area').map((e) => ({ id: e.id, title: e.title }))} />
          </div>
        </Modal.Body>
        
        <Modal.Footer>
          <Button
            variant="outline"
            onClick={() => setIsAddModalOpen(false)}
          >
            キャンセル
          </Button>
          <Button
            variant="primary"
            onClick={handleAddItem}
          >
            追加
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default DayView;