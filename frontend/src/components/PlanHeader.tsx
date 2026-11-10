import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { usePlan } from '../hooks/usePlan';
import { useToast } from './common/toastContext';
import Button from './common/Button';
import UiIcon from './common/UiIcon';
import { CalendarDays, MapPin, TriangleAlert, Users, Wallet } from 'lucide-react';
import Card from './common/Card';
import Modal from './common/Modal';
import type { TravelPlan } from '../types';
import TripCover from './trip/TripCover';
import CoverPhotoDialog from './trip/CoverPhotoDialog';
import { getPlanCover } from '../services/api/g11';
import type { PlanCover } from '../services/api/types/g11';
import { useCoverPhoto, useCoverVersions } from '../hooks/useCoverPhoto';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

/** [Gate G9] UX-0 旅行の最初・最後の日(日程の日付を優先し、無ければ旅行の開始・終了の日)。無ければ空 */
function firstDate(plan: TravelPlan): string {
  return plan.days?.[0]?.date || plan.start_date || '';
}

function lastDate(plan: TravelPlan): string {
  return plan.days?.[plan.days.length - 1]?.date || plan.end_date || '';
}

interface PlanHeaderProps {
  plan: TravelPlan;
  onShare?: () => void;
  onOptimize?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  className?: string;
  /** [Gate MockScreens] 旅行の名前の見出しの段 */
  headingLevel?: 1 | 2;
  /** [Gate TripHead] 題名の見出しの id(画面の aria-labelledby 用) */
  titleId?: string;
  /** [Gate TripHead] 「編集」= 旅行の基本情報のモーダルを開く(題名・行き先・日程・人数・予算・メモ・背景の写真) */
  onEdit?: () => void;
  /** [Gate TripHead] 編集・複製・削除の前に並べる画面ごとの操作(← 旅行の一覧 など) */
  actions?: React.ReactNode;
  /** [Gate TripHead] 表紙の下に出す短い説明 */
  hint?: React.ReactNode;
}

/** [Gate HeadFold] 旅行のカードの詳細を開いたままにするか(端末に覚える) */
const DETAILS_KEY = 'tc.planHeadDetails';

const PlanHeader: React.FC<PlanHeaderProps> = ({
  plan,
  onShare,
  onOptimize,
  onDuplicate,
  onDelete,
  headingLevel = 1,
  titleId,
  onEdit,
  actions,
  hint,
  className = ''
}) => {
  const { duplicatePlan, deletePlan } = usePlan();
  const [detailsOpen, setDetailsOpen] = useState(() => {
    try { return window.localStorage.getItem(DETAILS_KEY) === 'open'; } catch { return false; }
  });
  const toggleDetails = () => setDetailsOpen((v) => {
    try { window.localStorage.setItem(DETAILS_KEY, v ? 'closed' : 'open'); } catch { /* 保存できない環境 */ }
    return !v;
  });
  const { addToast } = useToast();
  const online = useOnlineStatus();
  
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  // [Gate G11] 表紙の写真(見える人だけ)。変えられるのは編集できる人だけ
  const [cover, setCover] = useState<PlanCover | null>(null);
  const [canEditCover, setCanEditCover] = useState(false);
  const [coverDialog, setCoverDialog] = useState(false);
  const coverVersion = useCoverVersions((s) => s.versions[plan.id] ?? 0);
  useEffect(() => {
    let active = true;
    getPlanCover(plan.id).then((r) => {
      if (!active) return;
      setCover(r.cover);
      setCanEditCover(r.can_edit);
    }).catch(() => {
      if (active) { setCover(null); setCanEditCover(false); }
    });
    return () => { active = false; };
  }, [plan.id, coverVersion]);
  const coverPhoto = useCoverPhoto(plan.id, cover, '');

  // プラン統計の計算
  const planStats = useMemo(() => {
    const totalDays = plan.days?.length || 0;
    const totalEvents = plan.days?.reduce((sum, day) => sum + day.events.length, 0) || 0;
    const totalCost = plan.days?.reduce((daySum, day) => 
      daySum + day.events.reduce((eventSum, event) => eventSum + (event.cost || 0), 0), 0) || 0;
    const totalDuration = plan.days?.reduce((daySum, day) => 
      daySum + day.events.reduce((eventSum, event) => eventSum + (event.duration || 0), 0), 0) || 0;

    // [Gate G9] UX-0 旅行の期間は日程(days)を優先し、無ければ開始・終了の日から求める(どちらも無ければ null = 未設定)。
    // 以前は日付の無い旅行で「Invalid Date」「1日間」と出ていた
    const startDate = new Date(firstDate(plan) || NaN);
    const endDate = new Date(lastDate(plan) || NaN);
    const fromDates = Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())
      ? null : Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const daysDiff = totalDays > 0 ? totalDays : fromDates;

    return {
      totalDays,
      totalEvents,
      totalCost,
      totalDuration,
      daysDiff,
      averageCostPerDay: totalDays > 0 ? Math.round(totalCost / totalDays) : 0,
      averageEventsPerDay: totalDays > 0 ? Math.round(totalEvents / totalDays) : 0
    };
  }, [plan]);

  // プラン複製
  const handleDuplicatePlan = useCallback(async () => {
    try {
      await duplicatePlan(plan.id);
      onDuplicate?.();
      
      addToast({
        type: 'success',
        message: 'プランを複製しました'
      });
    } catch (error) {
      console.error('プラン複製エラー:', error);
      addToast({
        type: 'error',
        message: 'プラン複製に失敗しました'
      });
    }
  }, [plan.id, duplicatePlan, onDuplicate, addToast]);

  // プラン削除
  const handleDeletePlan = useCallback(async () => {
    // [Gate B-012] 成功・失敗の通知はplanStore.deletePlanが表示する(以前は二重表示で、
    // 失敗時もここで「削除しました」と表示していた)。
    try {
      await deletePlan(plan.id);
      setShowDeleteModal(false);
      onDelete?.();
    } catch (error) {
      console.error('プラン削除エラー:', error);
    }
  }, [plan.id, deletePlan, onDelete]);

  // 日付フォーマット
  const formatDate = useCallback((dateString: string) => {
    const date = new Date(dateString || NaN);
    if (Number.isNaN(date.getTime())) return '未設定';
    return date.toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'short'
    });
  }, []);

  return (
    <div className={className}>
      <Card variant="elevated" padding="md">
        {/* [Gate TripHead] 旅程の画面の一番上の見出し。編集は基本情報のモーダル(onEdit)に一本化した(以前の
            この場での編集はタグ・人数の欄がサーバーに無く保存されず、上の「基本情報・日程を編集」と二重だった) */}
        <div className="space-y-4">
            {/* ヘッダー情報 */}
            {/* [Gate G9] UX-0 スマホの幅では題名と操作を縦に並べる(以前は題名が1文字ずつ折り返した) */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex-1 min-w-0">
                {/* [Gate G9] UX-2・UX-3 旅行の表紙(生成グラデーション)に題名・状態・行き先・期間・通信の状態をまとめる */}
                <TripCover size="header" destination={plan.destination} tripTitle={plan.title}
                  startDate={firstDate(plan) || null} className="mb-3" data-testid="trip-header-cover"
                  photo={coverPhoto.photo} onPhotoError={coverPhoto.onError}>
                  <div className="flex flex-wrap items-center gap-2 pr-28 text-xs font-semibold">
                    <span className="rounded-full border border-white px-2 py-0.5">
                      {plan.status === 'active' ? 'アクティブ' :
                       plan.status === 'draft' ? 'ドラフト' :
                       plan.status === 'completed' ? '完了' : plan.status}
                    </span>
                    {!online && (
                      <span className="rounded-full border border-white px-2 py-0.5" role="status">オフライン(保存済みの内容)</span>
                    )}
                  </div>
                  {React.createElement(`h${headingLevel}`, { id: titleId, className: 'mt-2 text-2xl font-bold break-words', style: { fontFamily: 'var(--tc-font-display)' } }, plan.title)}
                  <p className="mt-1 text-sm">
                    {[plan.destination || null, `${formatDate(firstDate(plan))} 〜 ${formatDate(lastDate(plan))}`]
                      .filter(Boolean).join('・')}
                  </p>
                  {/* [Gate G11] 表紙の右上に重ねる(権限は後から分かるため、置いても他の要素の位置を動かさない) */}
                  {canEditCover && (
                    <button type="button" onClick={() => setCoverDialog(true)} data-testid="cover-edit"
                      className="tc-on-cover-button absolute right-3 top-3">
                      {cover ? '写真を変更' : '写真を設定'}
                    </button>
                  )}
                </TripCover>
                {canEditCover && (
                  <CoverPhotoDialog isOpen={coverDialog} onClose={() => setCoverDialog(false)} planId={plan.id}
                    tripTitle={plan.title} destination={plan.destination} startDate={firstDate(plan) || null}
                    current={cover} onSaved={setCover} />
                )}
                
                {plan.description && (
                  <p className="text-ink-700 mb-2 leading-relaxed line-clamp-2">{plan.description}</p>
                )}

                {/* [Gate HeadFold] 目的地・期間・人数・予算と数字(総スポット数など)は折りたたむ(既定は閉じる。端末に覚える)。
                    閉じている時も 1 行の要約は見せ、下の旅程・地図を広く使う */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-700" data-testid="plan-head-summary">
                  <span>{[plan.destination || null, planStats.daysDiff ? `${planStats.daysDiff}日間` : null,
                    `予定 ${planStats.totalEvents}件`, plan.budget != null ? `予算 ¥${plan.budget.toLocaleString()}` : null]
                    .filter(Boolean).join(' · ')}</span>
                  <button type="button" className="tc-focus-ring tc-mini-link" aria-expanded={detailsOpen}
                    aria-controls="plan-head-details" onClick={toggleDetails} data-testid="plan-head-toggle">
                    {detailsOpen ? '詳細を閉じる ▲' : '詳細を開く ▼'}
                  </button>
                </div>
              </div>
              {/* アクションボタン(スマホでは折り返す) */}
              <div className="flex flex-wrap gap-2 sm:ml-4 sm:justify-end" data-testid="trip-head-actions">
                {actions}
                {onEdit && <Button
                  size="sm"
                  variant="outline"
                  onClick={onEdit}
                  data-testid="plan-basics-open"
                  title="旅行の基本情報・日程・背景の写真を編集"
                  leftIcon={
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                    </svg>
                  }
                >
                  編集
                </Button>}
                
                <div className="flex gap-1">
                  {onShare && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={onShare}
                      leftIcon={
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M15 8a3 3 0 10-2.977-2.63l-4.94 2.47a3 3 0 100 4.319l4.94 2.47a3 3 0 10.895-1.789l-4.94-2.47a3.027 3.027 0 000-.74l4.94-2.47C13.456 7.68 14.19 8 15 8z" />
                        </svg>
                      }
                    >
                      共有
                    </Button>
                  )}
                  
                  {onOptimize && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={onOptimize}
                      leftIcon={
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      }
                    >
                      最適化
                    </Button>
                  )}
                  
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleDuplicatePlan}
                    leftIcon={
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M7 9a2 2 0 012-2h6a2 2 0 012 2v6a2 2 0 01-2 2H9a2 2 0 01-2-2V9z" />
                        <path d="M5 3a2 2 0 00-2 2v6a2 2 0 002 2V5h8a2 2 0 00-2-2H5z" />
                      </svg>
                    }
                  >
                    複製
                  </Button>
                  
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowDeleteModal(true)}
                    leftIcon={
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                    }
                    className="text-red-600 hover:text-red-700"
                  >
                    削除
                  </Button>
                </div>
              </div>
            </div>

            {detailsOpen && (
              <div id="plan-head-details" className="space-y-4" data-testid="plan-head-details">
                {hint && <p className="text-sm text-ink-700">{hint}</p>}
                {/* 基本情報 */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="text-ink-500"><UiIcon icon={MapPin} size={14} className="mr-1 align-[-2px]" />目的地</span>
                      <div className="font-medium">{plan.destination || '未設定'}</div>
                    </div>
                    <div>
                      <span className="text-ink-500"><UiIcon icon={CalendarDays} size={14} className="mr-1 align-[-2px]" />期間</span>
                      <div className="font-medium">{planStats.daysDiff ? `${planStats.daysDiff}日間` : '未設定'}</div>
                    </div>
                    <div>
                      <span className="text-ink-500"><UiIcon icon={Users} size={14} className="mr-1 align-[-2px]" />人数</span>
                      <div className="font-medium">{plan.group_size ? `${plan.group_size}人` : '未設定'}</div>
                    </div>
                    <div>
                      <span className="text-ink-500"><UiIcon icon={Wallet} size={14} className="mr-1 align-[-2px]" />予算</span>
                      <div className="font-medium">{plan.budget !== undefined && plan.budget !== null ? `¥${plan.budget.toLocaleString()}` : '未設定'}</div>
                    </div>
                  </div>


                  {/* タグ */}
                  {plan.tags && plan.tags.length > 0 && (
                    <div className="mt-4">
                      <div className="flex flex-wrap gap-2">
                        {plan.tags.map((tag, index) => (
                          <span
                            key={index}
                            className="px-2 py-1 bg-gray-100 text-ink-700 text-xs rounded-full"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
            {/* 統計情報 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-gray-200">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">{planStats.totalEvents}</div>
                <div className="text-sm text-ink-700">総スポット数</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">¥{planStats.totalCost.toLocaleString()}</div>
                <div className="text-sm text-ink-700">総費用</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600">{Math.floor(planStats.totalDuration / 60)}h</div>
                <div className="text-sm text-ink-700">総所要時間</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-orange-600">¥{planStats.averageCostPerDay.toLocaleString()}</div>
                <div className="text-sm text-ink-700">1日平均費用</div>
              </div>
            </div>
              </div>
            )}
          </div>

      </Card>

      {/* 削除確認モーダル */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="プランを削除"
        size="sm"
      >
        <Modal.Body>
          <div className="text-center">
            <div className="mb-4 flex justify-center text-danger"><UiIcon icon={TriangleAlert} size={36} /></div>
            <p className="text-ink-700 mb-2">
              「{plan.title}」を削除しますか？
            </p>
            <p className="text-sm text-ink-500">
              削除から30日以内なら、旅行の一覧の「最近削除したプラン」から復元できます。
            </p>
          </div>
        </Modal.Body>
        
        <Modal.Footer>
          <Button
            variant="outline"
            onClick={() => setShowDeleteModal(false)}
          >
            キャンセル
          </Button>
          <Button
            variant="danger"
            onClick={handleDeletePlan}
          >
            削除
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default PlanHeader;