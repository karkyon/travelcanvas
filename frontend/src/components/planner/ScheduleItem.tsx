import React, { useState } from 'react';
import { safeExternalUrl, safeTelHref } from '@/utils/safeNavigation';
import { transportText } from '@/utils/transportModes';
import TransportIcon from '../common/TransportIcon';
import type { ArrivalLeg, HoursBadge } from './plannerModel';
import { 
  MapPin, Edit3, Trash2, Share2, 
  Star, Phone, ExternalLink, AlertTriangle, MessageSquare,
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
  /** [Gate MockScreens] 選んでいる予定(地図と選んだ予定の欄と同じ予定) */
  selected?: boolean;
}

const CATEGORY_MARKS: Record<string, [LucideIcon, string]> = {
  sightseeing: [IcLandmark, '観光'],
  food: [IcUtensils, '食事'],
  shopping: [IcShopping, '買い物'],
  accommodation: [IcHotel, '宿泊'],
  transport: [IcTrain, '交通'],
  activity: [IcTarget, 'アクティビティ'],
  entertainment: [IcDrama, 'エンターテイメント'],
  default: [IcMapPin, '予定'],
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
  onUpdate,
  onDelete,
  onComment,
  onEdit: _onEdit,
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
}) => {
  void _onEdit;
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({
    title,
    startTime,
    endTime,
    notes: notes || ''
  });

  // [UX-6] カテゴリの印は読み上げから外し、名前を読み上げ用の文字で出す(以前は OS の絵文字の名前が読まれていた)
  const categoryMark = (cat: string) => {
    const [icon, label] = CATEGORY_MARKS[cat] ?? CATEGORY_MARKS.default!;
    return (
      <span data-testid="schedule-category" data-category={cat || 'default'}>
        <UiIcon icon={icon} size={18} className="mr-1 align-[-3px]" />
        <span className="sr-only">{`${label}: `}</span>
      </span>
    );
  };

  const formatCurrency = (amount?: number) => {
    if (!amount) return '';
    return new Intl.NumberFormat('ja-JP', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const formatTime = (time: string) => {
    return time.substring(0, 5); // HH:MM format
  };

  const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) {
      return mins > 0 ? `${hours}時間${mins}分` : `${hours}時間`;
    }
    return `${minutes}分`;
  };

  const handleSaveEdit = () => {
    if (onUpdate) {
      onUpdate(id, editData);
    }
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditData({ title, startTime, endTime, notes: notes || '' });
    setIsEditing(false);
  };

  const subParts = [
    locationName || null,
    duration > 0 ? `滞在 ${formatDuration(duration)}` : null,
    cost ? formatCurrency(cost) : null,
  ].filter(Boolean);
  const timeText = formatTime(startTime) || '未定';
  const endText = endTime
    ? `〜${formatTime(endTime)}${endDayOffset ? (endDayOffset === 1 ? '(翌日)' : `(${endDayOffset}日後)`) : ''}`
    : '';
  const iconBtn = 'tc-focus-ring tc-event-icon';

  return (
    <div
      ref={dragRef}
      className={`tc-event${selected ? ' is-selected' : ''}${isNext ? ' is-next' : ''}${isDragging ? ' is-dragging' : ''}`
        + `${isCompleted ? ' is-done' : ''}${isDelayed ? ' is-delayed' : ''}${isEditing ? ' is-editing' : ''}`}
      style={style}
      data-priority={priority}
      onClick={() => setIsExpanded(!isExpanded)}
    >
      {/* [Gate MockScreens] モックの event-row: 時刻・点と線・予定の中身 */}
      <div className="tc-event-time">
        <span>{timeText}</span>
        {endText && <small>{endText}</small>}
      </div>
      <div className="tc-event-dot" aria-hidden="true" />
      <div className="tc-event-info">
        <div className="tc-event-topline">
          <div className="tc-event-title">
            {categoryMark(category)}{isEditing ? (
              <input
                type="text"
                value={editData.title}
                onChange={(e) => setEditData({ ...editData, title: e.target.value })}
                className="border-b border-blue-400 bg-transparent focus:outline-hidden"
                onClick={(e) => e.stopPropagation()}
                aria-label="予定の題"
              />
            ) : title}
            {locked && (
              <span data-testid="schedule-locked" className="tc-event-lock">
                <UiIcon icon={IcLock} size={12} />確定
              </span>
            )}
          </div>
          {isNext && <span className="tc-pill tc-pill--live tc-event-next">NEXT</span>}
          {isDelayed && (
            <span className="tc-pill tc-pill--warn"><AlertTriangle size={12} aria-hidden="true" />遅れ</span>
          )}
        </div>
        {subParts.length > 0 && <small className="tc-event-sub">{subParts.join(' · ')}</small>}
        {rating && (
          <small className="tc-event-sub"><Star size={11} className="text-yellow-400 fill-current inline align-[-1px]" /> {rating}</small>
        )}

        {/* [Gate G11] この予定へ着く移動(アイコンと名前・所要時間・推定か・時差)。区間が無ければ以前の移動の値 */}
        {arrival ? (
          <div className="tc-event-mode" data-testid="schedule-arrival">
            <TransportIcon mode={arrival.mode} />
            <span>{arrival.text}</span>
            {arrival.isEstimate && <span>(推定)</span>}
            {arrival.status === 'confirmed' && <span>・確定</span>}
            {arrival.crossZone && <span data-testid="schedule-cross-zone">{arrival.crossZone.text}</span>}
            {arrival.zoneUnknown && <span>・時刻帯未確認</span>}
          </div>
        ) : travelMethod ? (
          <div className="tc-event-mode" data-testid="schedule-arrival">
            <TransportIcon mode={travelMethod} />
            <span>{transportText(travelMethod, travelTime ?? null)}</span>
            {travelCost ? <span>• {formatCurrency(travelCost)}</span> : null}
          </div>
        ) : null}

        {/* [Gate G11] 営業時間の照合(記号と文字。色だけで伝えない) */}
        {hours && (
          <p className={`tc-event-hours is-${hours.tone}`} data-testid="schedule-hours" data-tone={hours.tone}>
            <span aria-hidden="true">{hours.symbol}</span>
            <span>{hours.text}</span>
            {hours.sourceText && <span className="opacity-90">({hours.sourceText})</span>}
          </p>
        )}

        {description && !isExpanded && (
          <p className="tc-event-desc">{description}</p>
        )}

        {/* [Gate G11] 予定のカードの写真(非公開の記録を権限付きで読んだ一時の URL) */}
        {image && (
          <figure className="tc-event-photo" data-testid="schedule-image">
            <img src={image.src} alt="" />
            {image.credit && <figcaption>{image.credit}</figcaption>}
          </figure>
        )}

        {/* 操作(名前は読み上げにも出す)。[Gate MockScreens] 押しても何も起きない「共有」は、共有の先がある時だけ出す */}
        <div className="tc-event-tools">
          <button type="button" onClick={(e) => { e.stopPropagation(); setIsEditing(true); }}
            className={iconBtn} title="編集" aria-label={`「${title}」をこの場で編集`}>
            <Edit3 size={14} aria-hidden="true" />
          </button>
          {onPhoto && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onPhoto(id); }}
              className={iconBtn} title="写真" aria-label="この予定の写真を選ぶ" data-testid={`schedule-photo-${id}`}>
              <UiIcon icon={IcImage} size={14} />
            </button>
          )}
          {onComment && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onComment(id); }}
              className={iconBtn} title="コメント" aria-label="この予定へのコメント">
              <MessageSquare size={14} aria-hidden="true" />
            </button>
          )}
          {onShare && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onShare(id); }}
              className={iconBtn} title="共有" aria-label={`「${title}」を共有`}>
              <Share2 size={14} aria-hidden="true" />
            </button>
          )}
          <button type="button" onClick={(e) => { e.stopPropagation(); onDelete?.(id); }}
            className={`${iconBtn} is-danger`} title="削除" aria-label={`「${title}」を削除`}>
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </div>
      {/* Expanded Content */}
      {isExpanded && (
        <div className="tc-event-expanded" onClick={(e) => e.stopPropagation()}>
          {/* Description */}
          {description && (
            <div className="mb-3">
              <p className="text-sm text-ink-700">{description}</p>
            </div>
          )}

          {/* Address。[Gate C1] 押しても何も起きない「経路」ボタン(名前も無い)を外した */}
          {address && (
            <div className="mb-3">
              <div className="flex items-center gap-2 text-sm">
                <MapPin size={14} className="text-gray-400" aria-hidden="true" />
                <span className="text-ink-700">{address}</span>
              </div>
            </div>
          )}

          {/* Notes */}
          {(notes || isEditing) && (
            <div className="mb-3">
              <label className="block text-xs font-medium text-ink-500 mb-1">メモ</label>
              {isEditing ? (
                <textarea
                  value={editData.notes}
                  onChange={(e) => setEditData({ ...editData, notes: e.target.value })}
                  className="w-full p-2 text-sm border border-gray-300 rounded-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  rows={2}
                  placeholder="メモを追加..."
                />
              ) : (
                <p className="text-sm text-ink-700">{notes}</p>
              )}
            </div>
          )}

          {/* Contact & Booking Info */}
          {(contactInfo || bookingInfo) && (
            <div className="flex flex-wrap gap-4 mb-3">
              {safeExternalUrl(contactInfo?.website) && (
                <a
                  href={safeExternalUrl(contactInfo?.website) ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-sm text-blue-500 hover:text-blue-700"
                >
                  <ExternalLink size={14} />
                  公式サイト
                </a>
              )}
              {contactInfo?.phone && safeTelHref(contactInfo.phone) && (
                <a
                  href={safeTelHref(contactInfo.phone) ?? undefined}
                  className="flex items-center gap-1 text-sm text-green-500 hover:text-green-700"
                >
                  <Phone size={14} />
                  {contactInfo.phone}
                </a>
              )}
              {safeExternalUrl(bookingInfo?.url) && (
                <a
                  href={safeExternalUrl(bookingInfo?.url) ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-sm text-purple-500 hover:text-purple-700"
                >
                  <ExternalLink size={14} />
                  予約
                </a>
              )}
            </div>
          )}

          {/* Edit Actions */}
          {isEditing && (
            <div className="flex gap-2 mt-4">
              <button
                onClick={handleSaveEdit}
                className="px-3 py-1 bg-blue-500 text-white text-sm rounded-sm hover:bg-blue-600"
              >
                保存
              </button>
              <button
                onClick={handleCancelEdit}
                className="px-3 py-1 bg-gray-500 text-white text-sm rounded-sm hover:bg-gray-600"
              >
                キャンセル
              </button>
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