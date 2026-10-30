/**
 * PlannerPage - 旅行プランナー
 *
 * [Gate #11] これまでスタブ("The travel planner interface will be
 * implemented here.")のままだったページを実装。DayView/PlanHeader/planStoreは
 * 既にGate #7g以降で修正・接続済みだったが、実際にレンダリングするページが
 * 存在しなかったため一度も画面に表示されていなかった。
 *
 * /planner        -> プラン一覧 + 新規作成
 * /planner/:planId -> 選択したプランの日程編集画面(PlanHeader + 日タブ + DayView)
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { usePlanStore } from '@/store/planStore';
import { useAuthStore } from '@/store/authStore';
import PlanHeader from '@/components/PlanHeader';
import DayView from '@/components/DayView';
import OptimizationPanel from '@/components/planner/OptimizationPanel';
import EventTimeImpact, { type EndValue } from '@/components/planner/EventTimeImpact';
import Button from '@/components/common/Button';
import UiIcon from '@/components/common/UiIcon';
import {
  BookOpen, Camera, Compass, Download, Earth, FileText, Footprints, GitBranch, Inbox, Lightbulb, ListChecks, Luggage, Map as MapIcon,
  MapPin, Pencil, Route, Scale, Share2, Star, Sun, TriangleAlert, Undo2, Upload, Vote, Wallet, WifiOff,
} from 'lucide-react';
import Card from '@/components/common/Card';
import Input from '@/components/common/Input';
import Modal from '@/components/common/Modal';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { useToast } from '@/components/common/toastContext';
import { spotApiService } from '@/services/spotApi';
import { api as apiService } from '@/services/api';
import type { RoutePreview } from '@/services/api';
import PlanMap from '@/components/planner/PlanMap';
import AllDaysChart from '@/components/planner/AllDaysChart';
import { hoursBadge, segmentRow, titleOfEvent, zoneOfEvent } from '@/components/planner/plannerModel';
import type { EventHoursCheck } from '@/services/api/types/g11planner';
import { getSegments } from '@/services/api';
import type { TravelSegment } from '@/services/api/types/segments';
import SyncStatusBar from '@/components/planner/SyncStatusBar';
import PlanningUsageMeter from '@/components/planning/PlanningUsageMeter';
import type { RouteSummaryStatus } from '@/components/planner/RouteSummaryLine';
import DeletedPlansSection from './planner/DeletedPlansSection';
import PageHead from '@/components/shell/PageHead';
import Landscape from '@/components/shell/Landscape';
import SelectedEventCard from '@/components/planner/SelectedEventCard';
import type { ScheduleItem as ScheduleItemType, EventCategory } from '@/types';
import { VisitDetector, type VisitSuggestion } from '@/utils/visitDetection';
import PresenceBar from '@/components/planner/PresenceBar';
import { usePlanPresence } from '@/hooks/usePlanPresence';
import MemberPolicyNotice from '@/components/planner/MemberPolicyNotice';
import { othersEditing } from '@/utils/presence';
import { FIELD_LABEL, detectConflict, mergeMine, unreadConflict, type EditConflict, type EditFields } from '@/utils/editConflict';

// SearchPage.tsxから渡ってくる検索結果スポットの形状(最小限のフィールドのみ利用)
interface IncomingSpot {
  name: string;
  description?: string;
  category?: string;
  address?: string;
  location?: { latitude?: number; longitude?: number; address?: string };
  estimated_duration?: number;
  estimated_cost?: number;
}

// 日付から曜日を算出(DaySchedule型にday_of_weekフィールドが存在しないため、DayView.tsxと同じ方式)
const getDayOfWeek = (dateStr?: string): string => {
  if (!dateStr) return '';
  const labels = ['日', '月', '火', '水', '木', '金', '土'];
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  return labels[d.getDay()] || '';
};

/** [Gate MockScreens] 旅行の期間(日程の最初と最後。無ければ開始・終了の日) */
function planDateRange(plan: { days: Array<{ date?: string }>; start_date?: string; end_date?: string }): string {
  const first = plan.days[0]?.date || plan.start_date;
  const last = plan.days[plan.days.length - 1]?.date || plan.end_date;
  if (!first) return '';
  const fmt = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;
  return last && last !== first ? `${fmt(first)} — ${fmt(last)}` : fmt(first);
}

const PlannerPage: React.FC = () => {
  const { planId } = useParams<{ planId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { addToast } = useToast();

  const {
    plans,
    currentPlan,
    currentDayIndex,
    isLoading,
    isOfflineData,
    loadPlans,
    loadPlan,
    createPlan,
    deletePlan,
    setCurrentDay,
    addDay,
    removeDay,
    clearCurrentPlan,
    updateScheduleItem,
    deleteScheduleItem,
    searchResults,
    addScheduleItemFromCandidate,
    saveCurrentPlanOffline,
    removeOfflinePlan,
    checkOfflineAvailability,
    createQuickPlan,
  } = usePlanStore();

  const { isGuest } = useAuthStore();

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isQuickPage, setIsQuickPage] = useState(false);
  useEffect(() => {
    if (planId) setIsQuickPage(false);
  }, [planId]);
  // [Gate AppShell][Gate MockScreens] 左の帯の「クイック」・ホームの「旅行をつくる」(/planner?new=1)はクイックのページを開く
  const wantsNew = !planId && searchParams.get('new') === '1';
  useEffect(() => {
    if (!wantsNew) return;
    setIsQuickPage(true);
    const next = new URLSearchParams(searchParams);
    next.delete('new');
    setSearchParams(next, { replace: true });
  }, [wantsNew, searchParams, setSearchParams]);
  const [newPlanTitle, setNewPlanTitle] = useState('');
  const [newPlanDestination, setNewPlanDestination] = useState('');
  // [Gate #38] Quick Plan(CA-001): 開始日・終了日・最初の予定も同じ画面で
  // 入力できるようにする。全て任意項目(未定でも保存できる)。
  const [newPlanStartDate, setNewPlanStartDate] = useState('');
  const [newPlanEndDate, setNewPlanEndDate] = useState('');
  const [newEventTitle, setNewEventTitle] = useState('');
  const [newEventTime, setNewEventTime] = useState('');
  const [newEventLocation, setNewEventLocation] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  // [Gate #32] PLAN MAP: timelineとMAPの双方向選択同期用
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [routePreview, setRoutePreview] = useState<RoutePreview | null>(null);
  // [G11-Layout] 移動概算の読み込みの状態(地図の下の行の場所を読み込み中から確保する)
  const [routePreviewStatus, setRoutePreviewStatus] = useState<RouteSummaryStatus>('off');
  const [showMap, setShowMap] = useState(true);
  // [Gate G11] 日別 / 全日程の横断チャート、予定へ着く移動区間(移動手段の名前・時差)
  const [planView, setPlanView] = useState<'day' | 'all'>('day');
  // [Gate MockScreens] 見出しの「＋ 予定を追加」→ DayView の追加を開く。営業時間の照合を選んだ予定の欄へ渡す
  const [addSignal, setAddSignal] = useState(0);
  const [dayHours, setDayHours] = useState<{ byId: Record<string, EventHoursCheck>; pending: boolean }>({ byId: {}, pending: false });
  const handleHoursChange = useCallback((byId: Record<string, EventHoursCheck>, pending: boolean) => {
    setDayHours({ byId, pending });
  }, []);
  const [segments, setSegments] = useState<TravelSegment[]>([]);
  // [Gate #36] Offline Travel Pack: 現在のプランが既にオフライン保存済みか
  const [isOfflineSaved, setIsOfflineSaved] = useState(false);
  const [isSavingOffline, setIsSavingOffline] = useState(false);
  // [Gate #37] Visited Area Layer: GPS自動判定
  const [isAutoDetectEnabled, setIsAutoDetectEnabled] = useState(false);
  const [visitSuggestion, setVisitSuggestion] = useState<VisitSuggestion | null>(null);
  const [autoDetectError, setAutoDetectError] = useState<string | null>(null);
  const visitDetectorRef = React.useRef<VisitDetector | null>(null);

  // [Gate #18] DayView.tsxのonItemClick/onItemEdit/onItemDeleteがどこからも
  // 渡されておらず、日程に追加したスケジュールアイテムをクリックしても編集も
  // 削除も一切できなかった。編集モーダルとstoreへの実際の保存処理を実装する。
  // [Gate C1] 以前は終了時刻・場所・費用・メモを入力しても保存の通信に載らず、黙って捨てていた(場所は address、
  // メモは description として保存する。終了時刻・費用は予定の項目に無いため、この画面からは外した。費用は「予算・費用」)。
  const [editingItem, setEditingItem] = useState<ScheduleItemType | null>(null);
  const segmentPlanId = currentPlan?.id;
  const segmentRevision = currentPlan?.revision;
  useEffect(() => {
    if (!segmentPlanId) return undefined;
    let active = true;
    getSegments(segmentPlanId).then((rows) => { if (active) setSegments(rows); })
      .catch(() => { if (active) setSegments([]); });
    return () => { active = false; };
  }, [segmentPlanId, segmentRevision]);
  const emptyEdit: EditFields = { title: '', start_time: '', location_name: '', notes: '' };
  const [editForm, setEditForm] = useState<EditFields>(emptyEdit);
  // [Gate C1] FR-020 編集を始めた時の内容(競合した時に「相手が変えた/自分が変えた」を出すため)
  const [editOriginal, setEditOriginal] = useState<EditFields>(emptyEdit);
  const [editConflict, setEditConflict] = useState<EditConflict | null>(null);
  // [Gate G7] FR-005 終了時刻と終わる日(競合の比較には入れず、変えた時だけ送る)
  const [editEnd, setEditEnd] = useState<EndValue>({ time: '', offset: 0 });
  const [editEndOriginal, setEditEndOriginal] = useState<EndValue>({ time: '', offset: 0 });
  const [isSavingItem, setIsSavingItem] = useState(false);
  const [isReloadingPlan, setIsReloadingPlan] = useState(false);

  const fieldsOf = (item: ScheduleItemType): EditFields => ({
    title: item.title,
    start_time: item.start_time || '',
    location_name: item.location_name || item.address || '',
    notes: item.notes || item.description || '',
  });

  const openEditItem = (item: ScheduleItemType) => {
    setEditingItem(item);
    setEditForm(fieldsOf(item));
    setEditOriginal(fieldsOf(item));
    const end = { time: item.end_time || '', offset: item.end_day_offset ?? 0 };
    setEditEnd(end);
    setEditEndOriginal(end);
    setEditConflict(null);
  };

  const closeEditItem = () => {
    setEditingItem(null);
    setEditConflict(null);
  };

  const saveFields = async (itemId: string, fields: EditFields, original: EditFields) => {
    setIsSavingItem(true);
    try {
      const result = await updateScheduleItem(itemId, {
        title: fields.title,
        start_time: fields.start_time || undefined,
        address: fields.location_name || undefined,
        description: fields.notes || undefined,
        ...(editEnd.time !== editEndOriginal.time || (editEnd.time && editEnd.offset !== editEndOriginal.offset)
          ? { end_time: editEnd.time, end_day_offset: editEnd.offset } : {}),
      });
      if (result === 'saved') setEditEndOriginal(editEnd);
      if (result === 'conflict') {
        // 最新を読み直した後の内容と比べ、入力は残したまま違いを示す(黙って上書きしない)
        const latestItem = usePlanStore.getState().currentPlan?.days.flatMap((d) => d.events).find((e) => e.id === itemId);
        setEditConflict(detectConflict(original, fields, latestItem ? fieldsOf(latestItem) : null));
        return;
      }
      if (result === 'conflict_unread') {
        // [G11-Conflict] 読み直せなかった: 古い内容と比べて「変わった項目は無い」と言い切らない。入力は残す
        setEditConflict(unreadConflict(original, fields));
        return;
      }
      if (result !== 'failed') closeEditItem();
    } finally {
      setIsSavingItem(false);
    }
  };

  const handleSaveEditItem = async () => {
    if (!editingItem) return;
    await saveFields(editingItem.id, editForm, editOriginal);
  };

  // 競合した後: 最新の内容に、自分が変えた項目だけを重ねて保存する
  const handleSaveMergedEdit = async () => {
    if (!editingItem || !editConflict?.latest) return;
    const merged = mergeMine(editOriginal, editForm, editConflict.latest);
    const latest = editConflict.latest;
    setEditForm(merged);
    setEditOriginal(latest);
    setEditConflict(null);
    await saveFields(editingItem.id, merged, latest);
  };

  // [G11-Conflict] 競合した後に最新を読み直せなかった時: もう一度読み直し、読めたら違いを示す
  const [isRereading, setIsRereading] = useState(false);
  const handleRereadAfterConflict = async () => {
    if (!editingItem || !currentPlan) return;
    setIsRereading(true);
    try {
      const ok = await usePlanStore.getState().loadPlan(currentPlan.id);
      if (!ok) return;
      const latestItem = usePlanStore.getState().currentPlan?.days.flatMap((d) => d.events).find((e) => e.id === editingItem.id);
      setEditConflict(detectConflict(editOriginal, editForm, latestItem ? fieldsOf(latestItem) : null));
    } finally {
      setIsRereading(false);
    }
  };

  // 競合した後: 自分の入力を捨てて、最新の内容から編集し直す
  const handleEditFromLatest = () => {
    if (!editConflict?.latest) return;
    setEditForm(editConflict.latest);
    setEditOriginal(editConflict.latest);
    setEditConflict(null);
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!confirm('このスポットを日程から削除しますか？')) return;
    await deleteScheduleItem(itemId);
  };

  // [Gate #16] SearchPage.tsxの「プランに追加」ボタンはlocation.state.newSpotで
  // スポットを渡していたが、これまでPlannerPage側で一切受け取っておらず、
  // 検索結果が実際にはどこにも保存されないまま「プランに追加しました」という
  // 偽の成功トーストだけが表示されていた実害バグ。ここで実際に受け取り処理する。
  // [Gate #17] SpotListPage.tsxの「詳細」ボタンも同様にlocation.state.spotId
  // (登録済みスポットのID)を渡していたが、こちらも一切受け取られていなかった。
  // spotIdのみの場合はAPIから詳細を取得してから同じ追加フローに合流させる。
  const routeState = location.state as { newSpot?: IncomingSpot; spotId?: string } | null;
  const [incomingSpot, setIncomingSpot] = useState<IncomingSpot | undefined>(routeState?.newSpot);
  const [isAddSpotModalOpen, setIsAddSpotModalOpen] = useState(false);
  const [isAddingSpot, setIsAddingSpot] = useState(false);
  // [Gate M9-FE-B3] effectが参照する値をローカル変数へ取り出し、依存を正確に宣言する
  // (以前はeslint-disableで抑制していた。発火条件はnewSpot/spotIdの変化時のみで不変)。
  const routeNewSpot = routeState?.newSpot;
  const routeSpotId = routeState?.spotId;

  useEffect(() => {
    if (routeNewSpot) {
      setIncomingSpot(routeNewSpot);
      setIsAddSpotModalOpen(true);
    } else if (routeSpotId) {
      (async () => {
        try {
          const spot = await spotApiService.getSpot(routeSpotId);
          setIncomingSpot({
            name: spot.name,
            description: spot.description,
            category: spot.category,
            address: spot.address,
            location: { latitude: spot.latitude, longitude: spot.longitude },
          });
          setIsAddSpotModalOpen(true);
        } catch (error) {
          console.error('スポット詳細取得エラー:', error);
          addToast({ message: 'スポット情報の取得に失敗しました', type: 'error' });
        }
      })();
    }
  }, [routeNewSpot, routeSpotId, addToast]);

  const addSpotToExistingOrNewPlan = async (targetPlanId?: string) => {
    if (!incomingSpot) return;
    setIsAddingSpot(true);
    try {
      let plan = targetPlanId ? plans.find((p) => p.id === targetPlanId) : undefined;

      if (!plan) {
        // 新規プランとして作成(検索結果の名前をプラン名の初期値に)
        const created = await createPlan({
          title: `${incomingSpot.name}の旅`,
          days: [],
        });
        if (!created) throw new Error('プランの作成に失敗しました');
        plan = created;
      }

      await loadPlan(plan.id);
      // ロード直後のstoreの最新状態を直接参照(useEffectの再レンダリング待ちを避ける)
      const loadedPlan = usePlanStore.getState().currentPlan;
      if (!loadedPlan) throw new Error('プランの読み込みに失敗しました');

      if (loadedPlan.days.length === 0) {
        await addDay();
      }

      await usePlanStore.getState().addScheduleItem(0, {
        title: incomingSpot.name,
        description: incomingSpot.description,
        category: (incomingSpot.category as EventCategory) || 'sightseeing',
        location_name: incomingSpot.name,
        address: incomingSpot.address || incomingSpot.location?.address,
        latitude: incomingSpot.location?.latitude,
        longitude: incomingSpot.location?.longitude,
        duration: incomingSpot.estimated_duration,
        cost: incomingSpot.estimated_cost,
      });

      addToast({ message: `${incomingSpot.name}をプランに追加しました`, type: 'success' });
      setIsAddSpotModalOpen(false);
      navigate(`/planner/${plan.id}`, { replace: true, state: null });
    } catch (error) {
      console.error('スポット追加エラー:', error);
      addToast({
        message: error instanceof Error ? error.message : 'プランへの追加に失敗しました',
        type: 'error',
      });
    } finally {
      setIsAddingSpot(false);
    }
  };

  // 一覧画面: プラン一覧を読み込む
  useEffect(() => {
    if (!planId) {
      loadPlans();
    }
  }, [planId, loadPlans]);

  // 詳細画面: 指定プランを読み込む
  useEffect(() => {
    if (planId) {
      loadPlan(planId);
    } else {
      clearCurrentPlan();
    }
  }, [planId, loadPlan, clearCurrentPlan]);

  // [Gate #36] オフラインパックの保存有無を表示に反映する
  // [Gate M9-FE-B3] currentPlan全体ではなくidだけに依存させる(従来の発火条件と同じ)。
  const currentPlanId = currentPlan?.id;
  useEffect(() => {
    if (!currentPlanId) {
      setIsOfflineSaved(false);
      return;
    }
    let cancelled = false;
    checkOfflineAvailability(currentPlanId).then((available) => {
      if (!cancelled) setIsOfflineSaved(available);
    });
    return () => {
      cancelled = true;
    };
  }, [currentPlanId, checkOfflineAvailability]);

  // [Gate #37] 自動検出のON/OFFと表示中の日付に応じてVisitDetectorを起動/停止する。
  // 「今日」の日程イベント(spot_idを持つもののみ)だけを対象にする —
  // 過去/未来の予定に対してGPS判定を行っても意味が無いため。
  useEffect(() => {
    const activeDay = currentPlan?.days[currentDayIndex];
    const isToday =
      !!activeDay?.date && new Date(activeDay.date).toDateString() === new Date().toDateString();

    if (!isAutoDetectEnabled || !activeDay || !isToday) {
      visitDetectorRef.current?.stop();
      visitDetectorRef.current = null;
      return;
    }

    const targets = activeDay.events
      .filter((e) => e.spot_id && e.latitude != null && e.longitude != null)
      .map((e) => ({
        eventId: e.id,
        spotId: e.spot_id as string,
        title: e.title,
        latitude: e.latitude as number,
        longitude: e.longitude as number,
      }));

    if (visitDetectorRef.current) {
      visitDetectorRef.current.updateTargets(targets);
    } else {
      const detector = new VisitDetector(
        targets,
        (suggestion) => setVisitSuggestion(suggestion),
        (message) => setAutoDetectError(message)
      );
      detector.start();
      visitDetectorRef.current = detector;
    }

    return () => {
      // isAutoDetectEnabledやactiveDayが変わる際にeffectがクリーンアップ
      // される場合のみ止める(依存配列の変化ごとに毎回止めて張り直す)。
    };
  }, [isAutoDetectEnabled, currentPlan?.id, currentDayIndex, currentPlan?.days]);

  // ページを離れる際は必ず位置情報監視を止める
  useEffect(() => {
    return () => {
      visitDetectorRef.current?.stop();
    };
  }, []);

  const handleConfirmVisitSuggestion = async () => {
    if (!visitSuggestion) return;
    try {
      await spotApiService.addVisit(visitSuggestion.spotId, undefined, {
        source: 'auto_gps',
        confidence: visitSuggestion.confidence,
        detectedAccuracyMeters: visitSuggestion.accuracyMeters,
      });
      addToast({ message: '訪問済みとして記録しました', type: 'success' });
    } catch (error) {
      console.error('Failed to record auto-detected visit:', error);
      addToast({ message: '訪問記録の保存に失敗しました', type: 'error' });
    } finally {
      setVisitSuggestion(null);
    }
  };

  const handleToggleOfflineSave = async () => {
    if (!currentPlan) return;
    if (isOfflineSaved) {
      await removeOfflinePlan(currentPlan.id);
      setIsOfflineSaved(false);
      return;
    }
    setIsSavingOffline(true);
    try {
      const success = await saveCurrentPlanOffline();
      if (success) setIsOfflineSaved(true);
    } finally {
      setIsSavingOffline(false);
    }
  };

  // [Gate #32] 表示中の日が変わるたびに移動概算(route-preview)を取得する。
  // 座標が無い/1件以下の日はlegsが空になるだけで、架空の値は作らない。
  // [Gate R2-6 v8] backend `GET /plans/{id}/days/{id}/route-preview` は
  // `get_current_active_user`(会員限定)を要求するため、ゲストが呼ぶと
  // 常に401になる。Header.tsxの通知ポーリングと同じ実害バグパターン
  // (401→axiosインターセプターの/auth/refresh試行→これも401→
  // window.location.href='/login'強制リロード)がここでも発生していた
  // (Playwright E2E実行で発覚)。ゲストの間はroute-preview取得自体を
  // 行わないようにする(catchで握りつぶしても、interceptor側の強制
  // リダイレクトは止められないため、呼び出し自体を避ける必要がある)。
  // [Gate M9-FE-B3] 以前はcurrentPlan全体を参照しながら依存を
  // [currentPlan?.id, currentDayIndex, currentPlan?.days.length, isGuest]としていた
  // (警告)。実際に使う値(プランID・表示中の日のID)だけに依存させる。表示中の日が
  // 変わらないまま他の日が追加/削除された場合の無駄な再取得も起きなくなる。
  const activeDayId = currentPlan?.days[currentDayIndex]?.id;
  useEffect(() => {
    if (!currentPlanId || !activeDayId || isGuest) {
      setRoutePreview(null);
      setRoutePreviewStatus('off');
      return;
    }
    let cancelled = false;
    setRoutePreviewStatus('loading');
    apiService
      .getRoutePreview(currentPlanId, activeDayId, 'walking')
      .then((preview) => {
        if (cancelled) return;
        setRoutePreview(preview);
        setRoutePreviewStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setRoutePreview(null);
        setRoutePreviewStatus('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [currentPlanId, activeDayId, isGuest]);

  const handleCreatePlan = async () => {
    // [Gate #38] CA-001の受入条件「旅行名未入力でも作成できる」に合わせ、
    // タイトル必須のガードを撤廃。空欄時はstore側で目的地/日付から自動生成する。
    setIsCreating(true);
    try {
      const created = await createQuickPlan({
        title: newPlanTitle,
        destination: newPlanDestination,
        startDate: newPlanStartDate,
        endDate: newPlanEndDate,
        firstEventTitle: newEventTitle,
        firstEventTime: newEventTime,
        firstEventLocation: newEventLocation,
      });
      if (created) {
        setIsCreateModalOpen(false);
        setNewPlanTitle('');
        setNewPlanDestination('');
        setNewPlanStartDate('');
        setNewPlanEndDate('');
        setNewEventTitle('');
        setNewEventTime('');
        setNewEventLocation('');
        navigate(`/planner/${created.id}`);
      }
      // createがnullの場合、createQuickPlan内部(createPlan)が既にエラー
      // トーストを表示済み。入力内容は保持されるので再試行できる。
    } finally {
      setIsCreating(false);
    }
  };

  // [Gate B-012] 削除は論理削除。30日以内なら「最近削除したプラン」から復元できる。
  const [trashRefreshKey, setTrashRefreshKey] = useState(0);
  const handleDeletePlan = async (id: string) => {
    if (!confirm('このプランを削除しますか？\n削除から30日以内なら「最近削除したプラン」から復元できます。')) return;
    try {
      await deletePlan(id);
    } finally {
      setTrashRefreshKey((k) => k + 1);
    }
  };

  // [Gate R3-12] FR-047 旅程複製
  const [cloningPlanId, setCloningPlanId] = useState<string | null>(null);
  const handleClonePlan = async (id: string, title: string) => {
    if (!confirm(`「${title}」を複製しますか？`)) return;
    setCloningPlanId(id);
    try {
      await apiService.clonePlan(id);
      await loadPlans();
    } catch {
      alert('複製に失敗しました。しばらくしてから再試行してください。');
    } finally {
      setCloningPlanId(null);
    }
  };

  // [Gate C1] FR-020 同じ旅行を開いている人・編集中・他の人の変更(オフラインのデータを表示している間は止める)
  const presencePlanId = planId && currentPlan?.id === planId && !isOfflineData ? planId : null;
  const presence = usePlanPresence(presencePlanId, currentPlan?.revision, editingItem?.id ?? null);
  const editingOthers = othersEditing(presence.viewers, editingItem?.id);

  const handleReloadPlan = async () => {
    if (!planId) return;
    setIsReloadingPlan(true);
    try {
      await loadPlan(planId);
    } finally {
      setIsReloadingPlan(false);
      presence.refresh();
    }
  };

  // ===== 詳細画面(日程編集) =====
  if (planId) {
    if (isLoading && !currentPlan) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      );
    }

    if (!currentPlan) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <p className="text-ink-700 mb-4">プランが見つかりませんでした</p>
            <Button variant="primary" onClick={() => navigate('/planner')}>
              プラン一覧へ戻る
            </Button>
          </div>
        </div>
      );
    }

    const activeDay = currentPlan.days[currentDayIndex];
    // [Gate MockScreens] 選んだ予定(未選択なら最初の予定。モックと同じく右の欄は空にしない)
    const selectedEvent = activeDay
      ? activeDay.events.find((e) => e.id === selectedEventId) ?? activeDay.events[0] ?? null : null;
    const selectedIndex = activeDay && selectedEvent ? activeDay.events.findIndex((e) => e.id === selectedEvent.id) : -1;
    const selectedArrival = activeDay && selectedIndex >= 0
      ? segmentRow(activeDay.events, selectedIndex, segments, zoneOfEvent(currentPlan.days), activeDay.timezone_id,
        titleOfEvent(currentPlan.days))?.leg ?? null
      : null;

    return (
      <div className="min-h-screen bg-cloud-50">
        <div className="tc-page">
          {/* [Gate MockScreens] モックの旅程の画面: page-head・plan-controls・3列(時間の流れ・地図・選んだ予定) */}
          <PageHead
            eyebrow="PLAN · 旅程を組み立てる"
            titleId="planner-trip-title"
            title={currentPlan.title}
            sub={<>
              {[currentPlan.destination, planDateRange(currentPlan)].filter(Boolean).join(' · ')}
              {currentPlan.destination || planDateRange(currentPlan) ? ' — ' : ''}
              営業時間・移動手段・現地時間を予定カードで確認。ドラッグまたは↑↓で順番を入れ替えます。
            </>}
            actions={<>
              <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={() => navigate('/planner')}>← プラン一覧</button>
              {activeDay && planView === 'day' && (
                <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--primary" onClick={() => setAddSignal((n) => n + 1)}
                  data-testid="planner-add-event">＋ 予定を追加</button>
              )}
            </>}
          />

          <SyncStatusBar planId={currentPlan.id} />

          <MemberPolicyNotice planId={currentPlan.id} />

          <PresenceBar
            viewers={presence.viewers}
            changes={presence.changes}
            remoteRevision={presence.remoteRevision}
            localRevision={currentPlan.revision}
            offline={presence.offline}
            live={presence.live}
            onReload={handleReloadPlan}
            isReloading={isReloadingPlan}
          />





          {/* [Gate G11] 日別 / 全日程の切り替え(全日程は同じ時刻の物差しで日を並べる)。[Gate MockScreens] モックの plan-controls に日の操作をまとめる */}
          <div className="tc-plan-controls" data-testid="plan-controls">
            {currentPlan.days.length > 0 && (
              <div className="tc-seg" role="group" aria-label="旅程の表示">
                <button type="button" className="tc-focus-ring tc-day-tab" aria-pressed={planView === 'day'}
                  onClick={() => setPlanView('day')} data-testid="plan-view-day">日別</button>
                <button type="button" className="tc-focus-ring tc-day-tab" aria-pressed={planView === 'all'}
                  onClick={() => setPlanView('all')} data-testid="plan-view-all">全日程</button>
              </div>
            )}
            <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={() => navigate(`/planner/${currentPlan.id}/candidates`)}>
              <UiIcon icon={Star} />近くを発見・候補
            </button>
            <span className="tc-plan-controls-sep" aria-hidden="true" />
            <Button variant="outline" size="sm" onClick={addDay}>
              ＋ 日を追加
            </Button>
            {currentPlan.days.length > 1 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeDay(currentDayIndex)}
              >
                この日を削除
              </Button>
            )}
            {/* [Gate #31.5C] Gate #29 APIが持つ直近1件のUndoを画面から呼べる
                ようにする。編集操作は全て正規化APIを経由するようになった
                ため、ここから正しくUndoできる。 */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => usePlanStore.getState().undoLastChange()}
              title="直前の変更を取り消す"
              icon={<UiIcon icon={Undo2} />}
            >
              元に戻す
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowMap((prev) => !prev)}
              icon={<UiIcon icon={MapIcon} />}
            >
              {showMap ? '地図を隠す' : '地図を表示'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleToggleOfflineSave}
              disabled={isSavingOffline}
              title="このプランを暗号化してこの端末に保存し、オフラインでも閲覧できるようにします"
              icon={isSavingOffline ? undefined : <UiIcon icon={isOfflineSaved ? WifiOff : Download} />}
            >
              {isSavingOffline
                ? '保存中...'
                : isOfflineSaved
                ? 'オフライン保存済み(削除)'
                : 'オフラインで使う'}
            </Button>
            {activeDay?.date &&
              new Date(activeDay.date).toDateString() === new Date().toDateString() && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setAutoDetectError(null);
                    setIsAutoDetectEnabled((prev) => !prev);
                  }}
                  title="現在地が近くのスポットに一定時間留まると、訪問済みにするか提案します(このタブを開いている間のみ動作します)"
                  icon={<UiIcon icon={MapPin} />}
                >
                  {isAutoDetectEnabled ? '自動検出をOFFにする' : '近くのスポットを自動検出する'}
                </Button>
              )}
          </div>

          {isOfflineData && (
            <div className="mb-4 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-2">
              <UiIcon icon={WifiOff} className="mr-1 align-[-3px]" />
              オフラインで保存されたデータを表示しています。最新の内容と異なる場合があります。
            </div>
          )}

          {autoDetectError && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-2">
              {autoDetectError}
            </div>
          )}

          {visitSuggestion && (
            <div className="mb-4 bg-blue-50 border border-blue-200 text-blue-800 text-sm rounded-lg px-4 py-3 flex items-center justify-between gap-4">
              <span>
                <UiIcon icon={MapPin} className="mr-1 align-[-3px]" />「{visitSuggestion.title}」の近くに
                {Math.round(visitSuggestion.dwellMs / 60000)}分ほど滞在したようです(信頼度
                {Math.round(visitSuggestion.confidence * 100)}%)。訪問済みにしますか?
              </span>
              <div className="flex gap-2 shrink-0">
                <Button size="sm" variant="primary" onClick={handleConfirmVisitSuggestion}>
                  訪問済みにする
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setVisitSuggestion(null)}>
                  無視
                </Button>
              </div>
            </div>
          )}

          {currentPlan.days.length === 0 ? (
            <Card>
              <div className="p-8 text-center text-ink-500">
                <p className="mb-4">まだ日程がありません</p>
                <Button variant="primary" onClick={addDay}>
                  最初の日を追加
                </Button>
              </div>
            </Card>
          ) : planView === 'all' ? (
            <AllDaysChart days={currentPlan.days} segments={segments} currentDay={currentDayIndex}
              onOpenDay={(i) => { setCurrentDay(i); setPlanView('day'); }} />
          ) : activeDay ? (
            <div className={`tc-planner-layout${showMap ? '' : ' tc-planner-layout--nomap'}`} data-testid="planner-layout">
              <section className="tc-card tc-timeline-card" aria-label={`${currentDayIndex + 1}日目の予定`}>
                <DayView
                  headerLabel={`${(currentPlan.destination || 'TRIP').toUpperCase()} · DAY ${currentDayIndex + 1} · LOCAL TIME`}
                  dayTabs={(
                    <div className="tc-day-tabs" role="group" aria-label="日を選ぶ">
                      {currentPlan.days.map((d, i) => (
                        <button key={d.id} type="button" className="tc-focus-ring tc-day-tab" aria-pressed={i === currentDayIndex}
                          onClick={() => setCurrentDay(i)} data-testid={`day-tab-${i}`}>
                          {d.date ? `${d.date.slice(5).replace('-', '/')} ${getDayOfWeek(d.date)}` : `${i + 1}日目`}
                          <span className="sr-only">{`(${d.events.length}件)`}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  onOpenRoute={() => navigate(`/planner/${currentPlan.id}/route-options`)}
                  selectedEventId={selectedEvent?.id ?? null}
                  onHoursChange={handleHoursChange}
                  addSignal={addSignal}
                  day={activeDay}
                  planId={currentPlan.id}
                  isActive
                  onItemClick={(item) => {
                    setSelectedEventId(item.id);
                    openEditItem(item);
                  }}
                  onItemEdit={openEditItem}
                  onItemDelete={handleDeleteItem}
                  onItemComment={(item) => navigate(`/planner/${currentPlan.id}/discussion?target=event&id=${item.id}`)}
                  segments={segments}
                  zones={zoneOfEvent(currentPlan.days)}
                  titles={titleOfEvent(currentPlan.days)}
                />
              </section>
              {showMap && (
                <div className="tc-map-frame tc-route-map min-w-0" data-testid="planner-map">
                  <div className="tc-map-toolbar" aria-hidden="true">
                    <span className="tc-map-chip">⌖ {activeDay.date ? `${activeDay.date.slice(5).replace('-', '/')} ${getDayOfWeek(activeDay.date)}` : `${currentDayIndex + 1}日目`} · MAP</span>
                  </div>
                  <div className="tc-map-legend" aria-hidden="true">
                    <span className="tc-pill tc-pill--blue">● 予定</span>
                    <span className="tc-pill">☆ 候補</span>
                  </div>
                  <PlanMap
                    day={activeDay}
                    height={530}
                    candidates={searchResults}
                    routePreview={routePreview}
                    routePreviewStatus={routePreviewStatus}
                    selectedEventId={selectedEvent?.id ?? null}
                    onSelectEvent={setSelectedEventId}
                    onAddCandidateToItinerary={(candidateId, fallbackTitle) =>
                      addScheduleItemFromCandidate(currentDayIndex, candidateId, fallbackTitle)
                    }
                  />
                </div>
              )}
              <SelectedEventCard
                planId={currentPlan.id}
                dayNumber={currentDayIndex + 1}
                event={selectedEvent}
                onEdit={openEditItem}
                hours={selectedEvent ? hoursBadge(dayHours.byId[selectedEvent.id], dayHours.pending && Boolean(selectedEvent.place_id)) : null}
                arrival={selectedArrival}
              />
            </div>
          ) : null}

          {/* 最適化(経路の提案・適用・戻す)は3列の下に置く */}
          <OptimizationPanel plan={currentPlan} dayIndex={currentDayIndex} className="mt-6" />

          <section className="tc-plan-more" aria-labelledby="plan-more-title">
            <h2 id="plan-more-title" className="tc-section-title">旅行の情報と、この旅行のほかの画面</h2>
            <PlanHeader plan={currentPlan} className="mb-4" headingLevel={2} onDelete={() => navigate('/planner')} />
          {/* [FR059-B] この旅行の AI・外部検索の利用枠(旅行の予算とは別) */}
          <PlanningUsageMeter planId={currentPlan.id} className="mb-4" />

          {/* [Gate #25] 共有ページ・最適化パネルはどちらも実装済みだったが、
              どこからもリンクされておらずUIから一度も到達できなかった。
              [Gate R3-2] 予約一覧も同様に実装済みだが未到達だったため追加。 */}
          {/* [Gate G9] UX-3 旅行の中の移動を、目的ごとのまとまり(当日・計画・予約と準備・一緒に・記録)に分けて並べる。
              全ての入口は今までどおり押せる(以前は23個を1行に詰めていた)。
              旅行の見出し(表紙)の後に置く(スマホで最初に旅行名が見えるように)。 */}
          <nav aria-label="旅行の中の移動" data-testid="planner-actions"
            className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5 rounded-lg border border-gray-200 bg-surface p-3">
            <div role="group" aria-labelledby="planner-actions-0">
              <p id="planner-actions-0" className="text-xs font-semibold text-ink-700 mb-1">当日</p>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/planner/${currentPlan.id}/today`)}
                  icon={<UiIcon icon={Sun} />}
                >
                  今日
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/planner/${currentPlan.id}/alerts`)}
                  icon={<UiIcon icon={TriangleAlert} />}
                >
                  遅延・休業の対応
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/planner/${currentPlan.id}/track`)}
                  icon={<UiIcon icon={MapPin} />}
                >
                  位置の記録
                </Button>
              </div>
            </div>
            <div role="group" aria-labelledby="planner-actions-1">
              <p id="planner-actions-1" className="text-xs font-semibold text-ink-700 mb-1">計画</p>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/planner/${currentPlan.id}/candidates`)}
                  icon={<UiIcon icon={Star} />}
                >
                  候補箱
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/planner/${currentPlan.id}/constraints`)}
                  icon={<UiIcon icon={Scale} />}
                >
                  制約
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/planner/${currentPlan.id}/segments`)}
                  icon={<UiIcon icon={Footprints} />}
                >
                  移動区間
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/planner/${currentPlan.id}/route-options`)}
                  icon={<UiIcon icon={Route} />}
                >
                  経路の比較
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/planner/${currentPlan.id}/branches`)}
                  icon={<UiIcon icon={GitBranch} />}
                >
                  もしもの案
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/planner/${currentPlan.id}/memory-replan`)}
                  icon={<UiIcon icon={Lightbulb} />}
                >
                  過去の旅からの提案
                </Button>
              </div>
            </div>
            <div role="group" aria-labelledby="planner-actions-2">
              <p id="planner-actions-2" className="text-xs font-semibold text-ink-700 mb-1">予約・準備・費用</p>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/planner/${currentPlan.id}/reservations`)}
                  icon={<UiIcon icon={Luggage} />}
                >
                  予約
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/planner/${currentPlan.id}/imports`)}
                  icon={<UiIcon icon={Inbox} />}
                >
                  予約取込
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/planner/${currentPlan.id}/documents`)}
                  icon={<UiIcon icon={FileText} />}
                >
                  文書
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/planner/${currentPlan.id}/preparation`)}
                  icon={<UiIcon icon={ListChecks} />}
                >
                  準備
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/planner/${currentPlan.id}/expenses`)}
                  icon={<UiIcon icon={Wallet} />}
                >
                  予算・費用
                </Button>
              </div>
            </div>
            <div role="group" aria-labelledby="planner-actions-3">
              <p id="planner-actions-3" className="text-xs font-semibold text-ink-700 mb-1">一緒に・出力</p>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/share/${currentPlan.id}`)}
                  icon={<UiIcon icon={Share2} />}
                >
                  共有
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/planner/${currentPlan.id}/discussion`)}
                  icon={<UiIcon icon={Vote} />}
                >
                  相談・投票
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/planner/${currentPlan.id}/corrections`)}
                  icon={<UiIcon icon={Pencil} />}
                >
                  訂正の申し出
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/planner/${currentPlan.id}/booklet`)}
                  icon={<UiIcon icon={BookOpen} />}
                >
                  しおり・印刷
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/planner/${currentPlan.id}/exports`)}
                  icon={<UiIcon icon={Upload} />}
                >
                  書き出し
                </Button>
              </div>
            </div>
            <div role="group" aria-labelledby="planner-actions-4">
              <p id="planner-actions-4" className="text-xs font-semibold text-ink-700 mb-1">記録・振り返り</p>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/planner/${currentPlan.id}/memories`)}
                  icon={<UiIcon icon={Camera} />}
                >
                  旅の記録
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/planner/${currentPlan.id}/journey`)}
                  icon={<UiIcon icon={Compass} />}
                >
                  振り返り
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/planner/${currentPlan.id}/visits`)}
                  icon={<UiIcon icon={MapIcon} />}
                >
                  訪問の地図
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate('/atlas')}
                  icon={<UiIcon icon={Earth} />}
                >
                  旅の地図
                </Button>
              </div>
            </div>
          </nav>
          </section>

        </div>

        {/* スケジュールアイテム編集モーダル(Gate #18)。[Gate C1] 共同編集の競合を示す */}
        <Modal isOpen={!!editingItem} onClose={closeEditItem} title="スポットを編集">
          <Modal.Body>
            <div className="space-y-4">
              {editingOthers.length > 0 && !editConflict && (
                <p role="status" className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-900">
                  {editingOthers.map((v) => `${v.label}さん`).join('・')}もこの予定を編集中です。先に保存された方が通り、
                  あとから保存した方には違いを示します(黙って上書きしません)。
                </p>
              )}
              {editConflict && (
                <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-3 text-sm text-red-900 space-y-2"
                  data-testid="edit-conflict">
                  {editConflict.unread ? (
                    <>
                      <p className="font-medium">
                        保存する前に、ほかの人かほかの端末がこの旅程を変更しました。あなたの入力は残っています。
                      </p>
                      <p data-testid="edit-conflict-unread">
                        最新の内容を読み直せなかったため、どの項目が変わったか(削除されたかどうかを含む)を示せません。
                        読み直してから、違いを確かめて保存してください。
                      </p>
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Button size="sm" variant="primary" onClick={handleRereadAfterConflict} loading={isRereading}>
                          最新を読み直して違いを確かめる
                        </Button>
                      </div>
                    </>
                  ) : editConflict.deleted ? (
                    <p className="font-medium">この予定は、保存する前にほかの人が削除しました。</p>
                  ) : (
                    <>
                      <p className="font-medium">保存する前に、ほかの人がこの予定を変更しました。あなたの入力は残っています。</p>
                      {editConflict.theirs.length > 0 ? (
                        <ul className="list-disc ml-5">
                          {editConflict.theirs.map((k) => (
                            <li key={k}>
                              {FIELD_LABEL[k]}: ほかの人の値「{editConflict.latest?.[k] || '(空)'}」
                              {editConflict.both.includes(k) && <span>/ あなたの値「{editForm[k] || '(空)'}」</span>}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>ほかの人が変えた項目はこの画面の項目にはありません(日程・並び順などの変更です)。</p>
                      )}
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Button size="sm" variant="primary" onClick={handleSaveMergedEdit} loading={isSavingItem}
                          disabled={editConflict.mine.length === 0}>
                          自分の変更を最新の内容に重ねて保存
                        </Button>
                        <Button size="sm" variant="outline" onClick={handleEditFromLatest}>最新の内容で編集し直す</Button>
                      </div>
                    </>
                  )}
                </div>
              )}
              <Input
                label="タイトル"
                value={editForm.title}
                onChange={(e) => setEditForm((prev) => ({ ...prev, title: e.target.value }))}
                fullWidth
              />
              <Input
                label="開始時刻"
                type="time"
                value={editForm.start_time}
                onChange={(e) => setEditForm((prev) => ({ ...prev, start_time: e.target.value }))}
                fullWidth
              />
              {currentPlan && editingItem && (
                <EventTimeImpact planId={currentPlan.id} eventId={editingItem.id} startTime={editForm.start_time}
                  end={editEnd} onEndChange={setEditEnd} />
              )}
              {/* [Gate G2] FR-045 所有者が見せない設定にした項目は入力を出さない */}
              {!currentPlan?.hidden_fields?.includes('event_address') && (
                <Input
                  label="場所"
                  value={editForm.location_name}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, location_name: e.target.value }))}
                  fullWidth
                />
              )}
              {!currentPlan?.hidden_fields?.includes('event_notes') && (
                <Input
                  label="メモ"
                  value={editForm.notes}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, notes: e.target.value }))}
                  fullWidth
                />
              )}
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline" onClick={closeEditItem}>
              {editConflict?.deleted ? '閉じる' : 'キャンセル'}
            </Button>
            {!editConflict && (
              <Button
                variant="primary"
                onClick={handleSaveEditItem}
                loading={isSavingItem}
                disabled={!editForm.title.trim()}
              >
                保存
              </Button>
            )}
          </Modal.Footer>
        </Modal>
      </div>
    );
  }

  // [Gate MockScreens] クイック(モックの QUICK PLAN)の入力と旅行カードの予告。作成の画面と、クイックのページで同じものを使う
  const quickLayout = (
          <div className="tc-quick-layout">
            <div className="tc-card tc-quick-form">
              <div className="tc-section-row mb-2">
                <h3 className="tc-section-title">旅行の基本</h3>
                <span className="tc-pill tc-pill--blue">かんたん入力</span>
              </div>
              <div className="space-y-4">
                <Input
                  label="旅行の名前(任意、未入力なら自動で名付けます)"
                  value={newPlanTitle}
                  onChange={(e) => setNewPlanTitle(e.target.value)}
                  placeholder="例: 東京旅行"
                  fullWidth
                  autoFocus
                />
                <Input
                  label="行き先(任意)"
                  value={newPlanDestination}
                  onChange={(e) => setNewPlanDestination(e.target.value)}
                  placeholder="例: 東京"
                  fullWidth
                />
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="出発日(任意)"
                    type="date"
                    value={newPlanStartDate}
                    onChange={(e) => setNewPlanStartDate(e.target.value)}
                    fullWidth
                  />
                  <Input
                    label="帰着日(任意)"
                    type="date"
                    value={newPlanEndDate}
                    onChange={(e) => setNewPlanEndDate(e.target.value)}
                    fullWidth
                  />
                </div>
                <div className="pt-2 border-t border-cloud-200">
                  <p className="text-sm font-medium text-ink-700 mb-3">最初に行きたい場所・予定(任意)</p>
                  <div className="space-y-3">
                    <Input
                      label="予定名"
                      value={newEventTitle}
                      onChange={(e) => setNewEventTitle(e.target.value)}
                      placeholder="例: ホテルチェックイン"
                      fullWidth
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <Input
                        label="時刻(任意)"
                        type="time"
                        value={newEventTime}
                        onChange={(e) => setNewEventTime(e.target.value)}
                        fullWidth
                      />
                      <Input
                        label="場所(任意)"
                        value={newEventLocation}
                        onChange={(e) => setNewEventLocation(e.target.value)}
                        placeholder="例: 東京駅"
                        fullWidth
                      />
                    </div>
                    <p className="text-xs text-ink-500">場所がまだ決まらなくても旅行を作れます。</p>
                  </div>
                </div>
              </div>
            </div>
            <aside className="tc-card tc-quick-preview" aria-label="旅行カードの予告">
              <p className="tc-label">旅行カード · プレビュー</p>
              <div className="tc-preview-card">
                <div className="tc-trip-thumb" style={{ width: '100%', height: 122 }}><Landscape /></div>
                <span className="tc-pill tc-pill--good mt-3">新しい旅行</span>
                <h3 data-testid="quick-preview-title">{newPlanTitle.trim() || (newPlanDestination.trim() ? `${newPlanDestination.trim()}の旅` : '名前は保存の時に付きます')}</h3>
                <p className="text-xs text-ink-500">
                  {[newPlanDestination.trim() || '行き先は未定',
                    newPlanStartDate ? `${newPlanStartDate}${newPlanEndDate && newPlanEndDate !== newPlanStartDate ? `〜${newPlanEndDate}` : ''}` : '日付は未定']
                    .join(' · ')}
                </p>
                {newEventTitle.trim() && (
                  <p className="text-xs text-ink-700 mt-1">{`最初の予定: ${newEventTime ? `${newEventTime} ` : ''}${newEventTitle.trim()}`}</p>
                )}
                <p className="text-xs text-ink-500 mt-2">行きたい場所から、あとで予定を整えられます。</p>
              </div>
              <ol className="mt-4" aria-label="旅行ができるまで">
                {['① 旅行を作る', '② 場所を集める', '③ 日程に並べる', '④ みんなと共有'].map((t) => (
                  <li key={t} className="tc-step-chip">{t}</li>
                ))}
              </ol>
            </aside>
          </div>
  );

  // [Gate MockScreens] 左の帯の「クイック」・ホームの「旅行をつくる」(/planner?new=1)は、モックと同じくページで開く
  if (isQuickPage) {
    return (
      <div className="tc-page tc-quick-page">
        <PageHead
          eyebrow="QUICK PLAN · クイック"
          title="まず、行きたい気持ちから"
          sub="目的地と日付だけで保存できます。時刻や予約はあとから追加できます。"
          actions={<button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={() => setIsQuickPage(false)}>旅程の一覧へ</button>}
        />
        <form onSubmit={(e) => { e.preventDefault(); void handleCreatePlan(); }} aria-label="クイックで旅行を作る">
          {quickLayout}
          <div className="tc-quick-submit">
            <Button variant="primary" type="submit" loading={isCreating}>この旅を保存して旅程へ →</Button>
          </div>
        </form>
      </div>
    );
  }

  // ===== 一覧画面 =====
  return (
    <div className="min-h-screen bg-cloud-50">
      <div className="tc-page">
        {/* [Gate AppShell] モックの page-head */}
        <PageHead
          eyebrow="TRIPS · 旅程の一覧"
          title="プランナー"
          sub="旅行ごとに、日程・地図・予約・準備をひとつにまとめます。"
          actions={(
            <>
              {/* [Gate G11] 行き先が未定なら相談から(段階5) */}
              <Button variant="outline" onClick={() => navigate('/trip-consult')}>✦ 条件から旅行先を相談</Button>
              <Button variant="primary" onClick={() => setIsCreateModalOpen(true)}>
                ＋ 新しいプラン
              </Button>
            </>
          )}
        />

        {isLoading ? (
          <div className="flex justify-center py-16">
            <LoadingSpinner size="lg" />
          </div>
        ) : plans.length === 0 ? (
          // [Gate AppShell] 監査 Gate App UX: 空の時は始め方を2つ(行き先が決まっている / まだ決まっていない)
          <section aria-labelledby="planner-empty-title" data-testid="planner-empty">
            <h2 id="planner-empty-title" className="tc-section-title mb-3">まだ旅行がありません。どちらから始めますか?</h2>
            <div className="tc-planner-empty">
              <div className="tc-card">
                <div className="tc-detail-art w-full"><Landscape /></div>
                <p className="tc-eyebrow">QUICK PLAN · 行き先が決まっている</p>
                <h2>行き先と日付だけで、旅行を作る</h2>
                <p>時刻・予約・持ち物は、あとから同じ旅行に足せます。決まっていない項目は空のままで保存できます。</p>
                <Button variant="primary" onClick={() => setIsCreateModalOpen(true)}>行き先を入れて作る →</Button>
              </div>
              <div className="tc-card">
                <div className="tc-detail-art w-full"><Landscape /></div>
                <p className="tc-eyebrow">TRIP CONSULT · まだ決まっていない</p>
                <h2>条件から、行き先を相談する</h2>
                <p>出発地・時期・人数・したいことから、方面の候補を並べて比べられます。</p>
                <Button variant="outline" onClick={() => navigate('/trip-consult')}>✦ 旅行相談をはじめる</Button>
              </div>
            </div>
          </section>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" aria-label="プラン一覧">
            {plans.map((plan) => (
              // [Gate E1] 各プランを名前付きの一覧項目にし、開く・複製・削除のボタン名にプラン名を含める
              // (同じ「複製」「削除」が並ぶと読み上げで区別できない。以前はカード全体の <div onClick>
              // でしか開けず、キーボードから開けなかった)。
              <li key={plan.id} aria-label={plan.title}>
                <Card className="hover:shadow-lg transition-shadow cursor-pointer">
                  <div className="p-5" onClick={() => navigate(`/planner/${plan.id}`)}>
                    <h3 className="text-lg font-semibold text-ink-900 mb-1">
                      <button
                        type="button"
                        className="text-left rounded-sm focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-600"
                        aria-label={`「${plan.title}」を開く`}
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/planner/${plan.id}`);
                        }}
                      >
                        {plan.title}
                      </button>
                    </h3>
                    {plan.destination && (
                      <p className="text-sm text-ink-700 mb-2"><UiIcon icon={MapPin} size={14} className="mr-1 align-[-2px]" />{plan.destination}</p>
                    )}
                    <p className="text-xs text-ink-700">
                      {plan.days?.length ?? 0}日間の日程
                    </p>
                  </div>
                  <div className="px-5 pb-4 flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={cloningPlanId === plan.id}
                      aria-label={`「${plan.title}」を複製`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleClonePlan(plan.id, plan.title);
                      }}
                    >
                      複製
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`「${plan.title}」を削除`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeletePlan(plan.id);
                      }}
                    >
                      削除
                    </Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}

        <DeletedPlansSection refreshKey={trashRefreshKey} onRestored={() => loadPlans()} />
      </div>

      {/* [Gate AppShell] モックの QUICK PLAN: 左に入力、右に旅行カードの予告。全て任意(未定でも保存できる) */}
      <Modal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} title="新しい旅行プラン" size="xl">
        <Modal.Body>
          <p className="tc-eyebrow">QUICK PLAN · まず、行きたい気持ちから</p>
          <p className="tc-subhead mb-4">目的地と日付だけで保存できます。時刻や予約はあとから追加できます。</p>
          {quickLayout}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline" onClick={() => setIsCreateModalOpen(false)}>
            キャンセル
          </Button>
          <Button
            variant="primary"
            onClick={handleCreatePlan}
            loading={isCreating}
          >
            作成して旅程へ →
          </Button>
        </Modal.Footer>

      </Modal>

      {/* 検索結果からのスポット追加モーダル(Gate #16) */}
      <Modal
        isOpen={isAddSpotModalOpen}
        onClose={() => {
          setIsAddSpotModalOpen(false);
          navigate('/planner', { replace: true, state: null });
        }}
        title="プランに追加"
      >
        <Modal.Body>
          <p className="text-sm text-ink-700 mb-4">
            「{incomingSpot?.name}」をどのプランに追加しますか？
          </p>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {plans.map((plan) => (
              <button
                key={plan.id}
                onClick={() => addSpotToExistingOrNewPlan(plan.id)}
                disabled={isAddingSpot}
                className="w-full text-left px-4 py-3 border border-gray-200 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-colors disabled:opacity-50"
              >
                <div className="font-medium text-ink-900">{plan.title}</div>
                {plan.destination && (
                  <div className="text-xs text-ink-500"><UiIcon icon={MapPin} size={14} className="mr-1 align-[-2px]" />{plan.destination}</div>
                )}
              </button>
            ))}
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="primary"
            onClick={() => addSpotToExistingOrNewPlan(undefined)}
            loading={isAddingSpot}
          >
            ＋ 新しいプランを作成して追加
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default PlannerPage;
