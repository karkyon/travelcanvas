/**
 * [Gate TimelineRedesign] 旅程のタイムラインの予定のカード。
 * - 上の段: 地図のピンと同じ番号 · 種類の印 · 題 · 確定/NEXT/遅れ · 操作(編集・リンク・共有・削除) · 予約のカレンダー＋
 *   (相談は「詳細を見る」の中だけ)
 * - 中の段: 横長の写真(押すと写真を選ぶ) · 予約の札と一言 · 営業時間の照合 · 場所・滞在・費用 · 電話 · 並べ替え(↑↓)
 * - 「詳細を見る」: 以前の右の「選んだ予定」の欄の中身(時刻・照合・出典・移動・場所・連絡先・メモ・確定・食事の情報)
 *   地図のピンを押した時は、このカードまで送って詳細を開く(focusSignal)。
 */
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { safeExternalUrl, safeTelHref } from '@/utils/safeNavigation';
import { transportText } from '@/utils/transportModes';
import TransportIcon from '../common/TransportIcon';
import type { ArrivalLeg, HoursBadge } from './plannerModel';
import type { EventUrl } from '@/types';
import type { DiningInfo } from '@/components/dining/diningModel';
import DiningSummary from '@/components/dining/DiningSummary';
import SpotLinks from './SpotLinks';
import {
  MapPin, Edit3, Trash2, Share2, Star, Phone, ExternalLink, AlertTriangle, MessageSquare, ChevronDown, ChevronUp,
  MapPinned, Luggage,
} from 'lucide-react';
import UiIcon from '@/components/common/UiIcon';
import type { LucideIcon } from 'lucide-react';
import { IcDrama, IcHotel, IcImage, IcLandmark, IcLock, IcMapPin, IcShopping, IcTarget, IcTrain, IcUtensils } from '@/components/common/uiIcons';

interface ScheduleItemProps {
  id: string;
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
  /** [Gate G7] FR-005 終了が翌日以降なら日数 */
  endDayOffset?: number;
  duration: number;
  locationName: string;
  address: string;
  cost?: number;
  currency?: string;
  category: string;
  priority: 'low' | 'medium' | 'high';
  travelMethod?: string;
  travelTime?: number;
  travelCost?: number;
  notes?: string;
  rating?: number;
  isNext?: boolean;
  isCompleted?: boolean;
  isDelayed?: boolean;
  bookingInfo?: {
    url?: string;
    phone?: string;
  };
  contactInfo?: {
    website?: string;
    phone?: string;
  };
  /** [Gate SpotLinks] 場所の URL(公式サイト・予約・SNS など) */
  links?: EventUrl[];
  onUpdate?: (id: string, data: { title: string; startTime: string; endTime: string; notes: string }) => void;
  onDelete?: (id: string) => void;
  onEdit?: (id: string) => void;
  onShare?: (id: string) => void;
  /** [Gate G4] COL-03 この予定へのコメントを開く */
  onComment?: (id: string) => void;
  isDragging?: boolean;
  dragRef?: React.RefObject<HTMLDivElement>;
  style?: React.CSSProperties;
  /** [Gate G11] この予定へ着く移動区間(移動手段の名前・所要時間・時差) */
  arrival?: ArrivalLeg | null;
  /** [Gate G11] 営業時間の照合の帯 */
  hours?: HoursBadge | null;
  /** [Gate G11] 予定のカードの写真(一時の URL)と出典 */
  image?: { src: string; credit: string | null } | null;
  /** [Gate G11] 予定の写真を選ぶ(編集できる人だけ) */
  onPhoto?: (id: string) => void;
  /** [UX-6] 確定の予定(並べ替えで位置を変えない)。行に「確定」の印を出す */
  locked?: boolean;
  /** [Gate MockScreens] 選んでいる予定(地図と同じ予定) */
  selected?: boolean;
  /** [Gate BookingBadge] 予約の札(予約済み・要確認・まだ)。カードの中の段に出す */
  badge?: React.ReactNode;
  /** [Gate TimelineRedesign] 予約の操作(カレンダー＋)。カードの上の段の右に出す */
  bookingAction?: React.ReactNode;
  /** [Gate TimelineRedesign] 地図のピンと同じ番号(位置の無い予定は無し) */
  mapNumber?: number;
  /** [Gate TimelineRedesign] 番号を押した時(地図でこの予定を選ぶ) */
  onPickMap?: (id: string) => void;
  /** [Gate TimelineRedesign] 並べ替えのボタン(↑↓)。カードの中の右に出す */
  reorder?: React.ReactNode;
  /** [Gate TimelineRedesign] 地図のピンから選ばれた時に増える数(このカードまで送って詳細を開く) */
  focusSignal?: number;
  /** [Gate TimelineRedesign] 詳細の「予約」の行き先に使う */
  planId?: string;
  /** [Gate BookingJump] この予定の予約(あればその予約を開く。無ければ予約の一覧) */
  reservationId?: string | null;
  latitude?: number;
  longitude?: number;
  /** 食事の予定の情報(ジャンル・価格帯など) */
  dining?: DiningInfo | null;
}

const CATEGORY_MARKS: Record<string, [LucideIcon, string]> = {
  sightseeing: [IcLandmark, '観光'],
  food: [IcUtensils, '食事'],
  dining: [IcUtensils, '食事'],
  shopping: [IcShopping, '買い物'],
  accommodation: [IcHotel, '宿泊'],
  transport: [IcTrain, '交通'],
  transportation: [IcTrain, '交通'],
  activity: [IcTarget, 'アクティビティ'],
  entertainment: [IcDrama, 'エンターテイメント'],
  area: [IcMapPin, 'エリア'],
  default: [IcMapPin, '予定'],
};

const formatTime = (time: string) => time.substring(0, 5);

const formatDuration = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return m > 0 ? `${h}時間${m}分` : `${h}時間`;
  return `${minutes}分`;
};

const ScheduleItem: React.FC<ScheduleItemProps> = ({
  id,
  title,
  description,
  startTime,
  endTime,
  endDayOffset,
  duration,
  locationName,
  address,
  cost,
  currency = 'JPY',
  category,
  priority,
  travelMethod,
  travelTime,
  travelCost,
  notes,
  rating,
  isNext = false,
  isCompleted = false,
  isDelayed = false,
  bookingInfo,
  contactInfo,
  links,
  onUpdate,
  onDelete,
  onComment,
  onEdit,
  onShare,
  isDragging = false,
  dragRef,
  style,
  arrival,
  hours,
  image,
  onPhoto,
  locked = false,
  selected = false,
  badge,
  bookingAction,
  mapNumber,
  onPickMap,
  reorder,
  focusSignal = 0,
  planId,
  reservationId = null,
  latitude,
  longitude,
  dining,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({ title, startTime, endTime, notes: notes || '' });
  const rootRef = useRef<HTMLDivElement | null>(null);

  // [Gate TimelineRedesign] 地図のピンから選ばれた時: このカードまで送り、詳細を開く(右の欄の代わり)
  useEffect(() => {
    if (!focusSignal) return;
    setIsExpanded(true);
    const el = rootRef.current;
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focusSignal]);

  // [UX-6] カテゴリの印は読み上げから外し、名前を読み上げ用の文字で出す
  const categoryMark = (cat: string) => {
    const [icon, label] = CATEGORY_MARKS[cat] ?? CATEGORY_MARKS.default!;
    return (
      <span className="tc-event-cat" data-testid="schedule-category" data-category={cat || 'default'}>
        <UiIcon icon={icon} size={17} />
        <span className="sr-only">{`${label}: `}</span>
      </span>
    );
  };

  const formatCurrency = (amount?: number) => {
    if (!amount) return '';
    return new Intl.NumberFormat('ja-JP', { style: 'currency', currency, minimumFractionDigits: 0 }).format(amount);
  };

  const handleSaveEdit = () => {
    onUpdate?.(id, editData);
    setIsEditing(false);
  };
  const handleCancelEdit = () => {
    setEditData({ title, startTime, endTime, notes: notes || '' });
    setIsEditing(false);
  };

  const subParts = [
    locationName && locationName !== title ? locationName : null,
    duration > 0 ? `滞在 ${formatDuration(duration)}` : null,
    cost ? formatCurrency(cost) : null,
  ].filter(Boolean);
  const timeText = formatTime(startTime) || '未定';
  const endText = endTime
    ? `〜${formatTime(endTime)}${endDayOffset ? (endDayOffset === 1 ? '(翌日)' : `(${endDayOffset}日後)`) : ''}`
    : '';
  const phone = contactInfo?.phone && safeTelHref(contactInfo.phone) ? contactInfo.phone : null;
  const website = safeExternalUrl(contactInfo?.website) ?? (links ?? []).map((u) => safeExternalUrl(u.url)).find(Boolean) ?? null;
  const mapHref = typeof latitude === 'number' && typeof longitude === 'number'
    ? safeExternalUrl(`https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=17/${latitude}/${longitude}`) : null;
  const iconBtn = 'tc-focus-ring tc-event-icon';
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  // 写真: あれば横長で出す(押すと選び直す)。無くて編集できる人には「写真を追加」の枠
  const photo = image ? (
    onPhoto ? (
      <button type="button" className="tc-focus-ring tc-event-photo is-btn" data-testid={`schedule-photo-${id}`}
        aria-label="この予定の写真を選び直す" title="写真(選ぶ・ファイルやドラッグ&ドロップで入れる)"
        onClick={(e) => { e.stopPropagation(); onPhoto(id); }}>
        <span className="tc-event-photo-img" data-testid="schedule-image"><img src={image.src} alt="" />
          {image.credit && <span className="tc-event-photo-credit">{image.credit}</span>}</span>
      </button>
    ) : (
      <span className="tc-event-photo" data-testid="schedule-image">
        <span className="tc-event-photo-img"><img src={image.src} alt="" />
          {image.credit && <span className="tc-event-photo-credit">{image.credit}</span>}</span>
      </span>
    )
  ) : onPhoto ? (
    <button type="button" className="tc-focus-ring tc-event-photo is-empty" data-testid={`schedule-photo-${id}`}
      aria-label="この予定の写真を選ぶ" title="写真(選ぶ・ファイルやドラッグ&ドロップで入れる)"
      onClick={(e) => { e.stopPropagation(); onPhoto(id); }}>
      <UiIcon icon={IcImage} size={18} /><span>写真を追加</span>
    </button>
  ) : null;

  return (
    <div
      ref={(el) => {
        rootRef.current = el;
        if (dragRef && 'current' in dragRef) (dragRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
      }}
      className={`tc-event${selected ? ' is-selected' : ''}${isNext ? ' is-next' : ''}${isDragging ? ' is-dragging' : ''}`
        + `${isCompleted ? ' is-done' : ''}${isDelayed ? ' is-delayed' : ''}${isEditing ? ' is-editing' : ''}${isExpanded ? ' is-open' : ''}`}
      style={style}
      data-priority={priority}
      data-event-id={id}
    >
      {/* 時刻・点と線・予定のカード */}
      <div className="tc-event-time">
        <span>{timeText}</span>
        {endText && <small>{endText}</small>}
      </div>
      <div className="tc-event-dot" aria-hidden="true" />
      <div className="tc-event-info">
        <div className="tc-event-topline">
          {mapNumber !== undefined && (
            <button type="button" className="tc-focus-ring tc-event-num" onClick={(e) => { e.stopPropagation(); onPickMap?.(id); }}
              aria-label={`地図で見る(${mapNumber}番)`} title="地図でこの予定を見る" data-testid={`schedule-num-${id}`}>
              {mapNumber}
            </button>
          )}
          <div className="tc-event-title">
            {categoryMark(category)}{isEditing ? (
              <input
                type="text"
                value={editData.title}
                onChange={(e) => setEditData({ ...editData, title: e.target.value })}
                className="border-b border-blue-400 bg-transparent focus:outline-hidden"
                onClick={stop}
                aria-label="予定の題"
              />
            ) : <span className="tc-event-title-text">{title}</span>}
            {locked && (
              <span data-testid="schedule-locked" className="tc-event-lock">
                <UiIcon icon={IcLock} size={12} />確定
              </span>
            )}
            {isNext && <span className="tc-pill tc-pill--live tc-event-next">NEXT</span>}
            {isDelayed && (
              <span className="tc-pill tc-pill--warn"><AlertTriangle size={12} aria-hidden="true" />遅れ</span>
            )}
          </div>
          {/* 操作(名前は読み上げにも出す)。写真は写真の枠から、予約はカレンダー＋から */}
          <div className="tc-event-tools" onClick={stop}>
            <button type="button" onClick={(e) => { e.stopPropagation(); if (onEdit) onEdit(id); else { setIsEditing(true); setIsExpanded(true); } }}
              className={iconBtn} title="編集" aria-label={`「${title}」を編集`} data-testid={`schedule-edit-${id}`}>
              <Edit3 size={14} aria-hidden="true" />
            </button>
            {website && (
              <a href={safeExternalUrl(website) ?? undefined} target="_blank" rel="noopener noreferrer" className={iconBtn} title="公式サイト・リンクを開く"
                aria-label={`「${title}」のリンクを開く(新しいタブ)`} onClick={stop}>
                <ExternalLink size={14} aria-hidden="true" />
              </a>
            )}
            {onShare && (
              <button type="button" onClick={(e) => { e.stopPropagation(); onShare(id); }}
                className={iconBtn} title="共有" aria-label="共有">
                <Share2 size={14} aria-hidden="true" />
              </button>
            )}
            <button type="button" onClick={(e) => { e.stopPropagation(); onDelete?.(id); }}
              className={`${iconBtn} is-danger`} title="削除" aria-label="削除">
              <Trash2 size={14} aria-hidden="true" />
            </button>
          </div>
          {bookingAction && <div className="tc-event-book" onClick={stop}>{bookingAction}</div>}
        </div>

        <div className={`tc-event-body${photo ? '' : ' is-nophoto'}${reorder ? '' : ' is-noreorder'}`}>
          {photo}
          <div className="tc-event-main">
            {(badge || description) && (
              <div className="tc-event-line">
                {badge}
                {description && <p className="tc-event-desc">{description}</p>}
              </div>
            )}
            {/* [Gate G11] 営業時間の照合(記号と文字。色だけで伝えない) */}
            {hours && (
              <p className={`tc-event-hours is-${hours.tone}`} data-testid="schedule-hours" data-tone={hours.tone}>
                <span aria-hidden="true">{hours.symbol}</span>
                <span>{hours.text}</span>
                {hours.sourceText && <span className="opacity-90">({hours.sourceText})</span>}
              </p>
            )}
            {(subParts.length > 0 || rating) && (
              <small className="tc-event-sub">
                {subParts.join(' · ')}
                {rating ? <span className="ml-1"><Star size={11} className="text-yellow-500 fill-current inline align-[-1px]" aria-hidden="true" /> {rating}</span> : null}
              </small>
            )}
            {address && (
              <small className="tc-event-sub tc-event-addr"><MapPin size={12} aria-hidden="true" />{address}</small>
            )}
            {phone && (
              <a href={safeTelHref(phone) ?? undefined} className="tc-event-tel" onClick={stop}>
                <Phone size={13} aria-hidden="true" />{phone}
              </a>
            )}
            <button type="button" className="tc-focus-ring tc-event-more" aria-expanded={isExpanded}
              data-testid={`schedule-more-${id}`}
              onClick={(e) => { e.stopPropagation(); setIsExpanded((v) => !v); }}>
              {isExpanded ? '詳細を閉じる' : '詳細を見る'}
              {isExpanded ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
            </button>
          </div>
          {reorder && <div className="tc-event-reorder" onClick={stop}>{reorder}</div>}
        </div>

        {/* [Gate TimelineRedesign] 詳細(以前の右の「選んだ予定」の欄の中身) */}
        {isExpanded && (
          <div className="tc-event-expanded" onClick={stop} data-testid={`schedule-detail-${id}`}>
            <div className="tc-event-detail-actions">
              {mapHref ? (
                <a href={safeExternalUrl(mapHref) ?? undefined} target="_blank" rel="noopener noreferrer" className="tc-focus-ring tc-mbtn tc-mbtn--sm">
                  <MapPinned size={14} aria-hidden="true" />地図 <span aria-hidden="true">↗</span><span className="sr-only">(外の地図を新しいタブで開く)</span>
                </a>
              ) : (
                <span className="tc-mbtn tc-mbtn--sm is-disabled" aria-disabled="true" title="位置が登録されていません">
                  <MapPinned size={14} aria-hidden="true" />地図(位置なし)
                </span>
              )}
              {planId && (
                <Link to={reservationId ? `/planner/${planId}/reservations?open=${encodeURIComponent(reservationId)}`
                  : `/planner/${planId}/reservations`} className="tc-focus-ring tc-mbtn tc-mbtn--sm"
                  data-testid={`schedule-reservation-${id}`}
                  title={reservationId ? 'この予定の予約を開く' : '予約の一覧を開く'}>
                  <Luggage size={14} aria-hidden="true" />予約
                </Link>
              )}
              {onComment && (
                <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={() => onComment(id)}
                  title="メンバーと相談(コメント)。予定のメモとは別に、話し合いを残します" aria-label="この予定についてメンバーと相談する(コメント)">
                  <MessageSquare size={14} aria-hidden="true" />相談
                </button>
              )}
            </div>
            <dl className="tc-event-facts">
              <dt>時刻</dt>
              <dd>{startTime ? `${formatTime(startTime)}${endTime ? `〜${formatTime(endTime)}` : ''}` : '未定'}</dd>
              <dt>予定との照合</dt>
              <dd className={hours ? `is-${hours.tone}` : undefined}>
                {hours ? `${hours.symbol} ${hours.text}` : startTime ? '営業時間は未登録' : '時刻を決めると照合します(任意)'}
              </dd>
              <dt>出典・確認</dt>
              <dd>{hours?.sourceText ?? '—'}</dd>
              <dt>移動</dt>
              <dd data-testid="schedule-arrival">
                {arrival ? (
                  <span className="inline-flex flex-wrap items-center gap-1">
                    <TransportIcon mode={arrival.mode} />{arrival.text}{arrival.isEstimate ? '(推定)' : ''}
                    {arrival.status === 'confirmed' && '・確定'}
                    {arrival.crossZone && <span data-testid="schedule-cross-zone">{arrival.crossZone.text}</span>}
                    {arrival.zoneUnknown && '・時刻帯未確認'}
                  </span>
                ) : travelMethod ? (
                  <span className="inline-flex items-center gap-1">
                    <TransportIcon mode={travelMethod} />{transportText(travelMethod, travelTime ?? null)}
                    {travelCost ? ` · ${formatCurrency(travelCost)}` : ''}
                  </span>
                ) : '区間なし'}
              </dd>
              <dt>場所</dt>
              <dd>{address || locationName || '未設定'}</dd>
              {(phone || links?.length || website || safeExternalUrl(bookingInfo?.url)) && (
                <>
                  <dt>連絡先</dt>
                  <dd>
                    <SpotLinks phone={phone} urls={links} />
                    {safeExternalUrl(contactInfo?.website) && !(links ?? []).length && (
                      <a href={safeExternalUrl(contactInfo?.website) ?? undefined} target="_blank" rel="noopener noreferrer"
                        className="tc-event-link"><ExternalLink size={12} aria-hidden="true" />公式サイト</a>
                    )}
                    {safeExternalUrl(bookingInfo?.url) && (
                      <a href={safeExternalUrl(bookingInfo?.url) ?? undefined} target="_blank" rel="noopener noreferrer"
                        className="tc-event-link"><ExternalLink size={12} aria-hidden="true" />予約のページ</a>
                    )}
                  </dd>
                </>
              )}
              {cost ? (<><dt>費用</dt><dd>{formatCurrency(cost)}</dd></>) : null}
              {(notes || isEditing) && (
                <>
                  <dt>メモ</dt>
                  <dd>
                    {isEditing ? (
                      <textarea
                        value={editData.notes}
                        onChange={(e) => setEditData({ ...editData, notes: e.target.value })}
                        className="w-full p-2 text-sm border border-gray-300 rounded-sm"
                        rows={2}
                        placeholder="メモを追加..."
                        aria-label="メモ"
                      />
                    ) : notes}
                  </dd>
                </>
              )}
              {locked && (<><dt>確定</dt><dd className="inline-flex items-center gap-1"><UiIcon icon={IcLock} size={12} />並べ替え・最適化で動かさない</dd></>)}
            </dl>
            {dining && (
              <section className="tc-event-dining" aria-label="食事の情報" data-testid="schedule-dining">
                <h4>食事の情報</h4>
                <DiningSummary dining={dining} />
              </section>
            )}
            {isEditing && (
              <div className="flex gap-2 mt-3">
                <button type="button" onClick={handleSaveEdit} className="tc-focus-ring tc-mbtn tc-mbtn--sm tc-mbtn--primary">保存</button>
                <button type="button" onClick={handleCancelEdit} className="tc-focus-ring tc-mbtn tc-mbtn--sm">キャンセル</button>
              </div>
            )}
          </div>
        )}

        {isCompleted && <span className="tc-pill tc-pill--good tc-event-done">✓ 済</span>}
      </div>
    </div>
  );
};

export default ScheduleItem;
