/**
 * [Gate AppShell][Gate MockScreens] 旅程の3列の右: 選んだ予定(UI/UX モックの detail-card)。
 *
 * 予定の実際の値(時刻・場所・メモ・確定)と、この画面で照合した結果(営業時間の照合・この予定へ着く移動の区間)だけを出す。
 * 照合していない値・推定でない値を作らない(営業時間が登録されていなければ「未登録」、区間が無ければ「区間なし」)。
 * 地図は、座標がある時だけ外の地図を開く(押した時だけ。自動では送らない)。
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Luggage, MessageSquare, Lock, MapPinned } from 'lucide-react';
import Landscape from '@/components/shell/Landscape';
import TransportIcon from '@/components/common/TransportIcon';
import { safeExternalUrl } from '@/utils/safeNavigation';
import type { HoursBadge, ArrivalLeg } from './plannerModel';
import type { ScheduleItem } from '@/types';

interface Props {
  planId: string;
  dayNumber: number;
  event: ScheduleItem | null;
  onEdit: (item: ScheduleItem) => void;
  /** この予定の営業時間の照合(DayView と同じ結果) */
  hours?: HoursBadge | null;
  /** この予定へ着く移動の区間 */
  arrival?: ArrivalLeg | null;
  /** 予定の写真(あれば絵の代わりに出す) */
  imageSrc?: string | null;
}

function mapUrl(e: ScheduleItem): string | null {
  if (typeof e.latitude !== 'number' || typeof e.longitude !== 'number') return null;
  return safeExternalUrl(`https://www.openstreetmap.org/?mlat=${e.latitude}&mlon=${e.longitude}#map=17/${e.latitude}/${e.longitude}`);
}

const SelectedEventCard: React.FC<Props> = ({ planId, dayNumber, event, onEdit, hours = null, arrival = null, imageSrc = null }) => {
  const map = event ? mapUrl(event) : null;
  return (
    <aside className="tc-card tc-detail-card" aria-labelledby="selected-event-title" data-testid="selected-event">
      <div className="tc-detail-art">
        {imageSrc ? <img src={imageSrc} alt="" /> : <Landscape />}
        <span className="tc-photo-source">{imageSrc ? '予定の写真' : '場所画像のイメージ'}</span>
      </div>
      <p className="tc-label">{`選択中の予定 · DAY ${String(dayNumber).padStart(2, '0')}`}</p>
      {event ? (
        <>
          <h2 id="selected-event-title">{event.title}</h2>
          <p>
            {[event.location_name || event.address, event.start_time ? `${event.start_time}から` : '時刻は未定',
              event.duration ? `滞在 ${event.duration}分` : null].filter(Boolean).join(' · ')}
          </p>
          <div className="tc-detail-actions">
            {map ? (
              <a href={safeExternalUrl(map) ?? undefined} target="_blank" rel="noopener noreferrer" className="tc-focus-ring tc-mbtn tc-mbtn--sm">
                <MapPinned size={14} aria-hidden="true" />↗ 地図<span className="sr-only">(外の地図を新しいタブで開く)</span>
              </a>
            ) : (
              <span className="tc-mbtn tc-mbtn--sm is-disabled" aria-disabled="true" title="位置が登録されていません">
                <MapPinned size={14} aria-hidden="true" />地図(位置なし)
              </span>
            )}
            <Link to={`/planner/${planId}/reservations`} className="tc-focus-ring tc-mbtn tc-mbtn--sm">
              <Luggage size={14} aria-hidden="true" />予約
            </Link>
            <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={() => onEdit(event)}
              aria-label={`「${event.title}」を編集`}>
              <Pencil size={14} aria-hidden="true" />編集
            </button>
            <Link to={`/planner/${planId}/discussion?target=event&id=${event.id}`} className="tc-focus-ring tc-mbtn tc-mbtn--sm">
              <MessageSquare size={14} aria-hidden="true" />相談
            </Link>
          </div>
          <div className="tc-detail-facts">
            <span><b>時刻</b><small>{event.start_time ? `${event.start_time}${event.end_time ? `〜${event.end_time}` : ''}` : '未定'}</small></span>
            <span data-testid="selected-hours">
              <b>予定との照合</b>
              <small className={hours ? `is-${hours.tone}` : undefined}>
                {hours ? `${hours.symbol} ${hours.text}` : '営業時間は未登録'}
              </small>
            </span>
            <span><b>出典・確認</b><small>{hours?.sourceText ?? '—'}</small></span>
            <span data-testid="selected-arrival">
              <b>移動</b>
              <small className="inline-flex items-center gap-1 justify-end">
                {arrival ? (
                  <><TransportIcon mode={arrival.mode} />{arrival.text}{arrival.isEstimate ? '(推定)' : ''}</>
                ) : '区間なし'}
              </small>
            </span>
            <span><b>場所</b><small>{event.address || event.location_name || '未設定'}</small></span>
            {event.notes && <span><b>メモ</b><small>{event.notes}</small></span>}
            {event.locked && (
              <span><b>確定</b><small className="inline-flex items-center gap-1"><Lock size={12} aria-hidden="true" />並べ替え・最適化で動かさない</small></span>
            )}
          </div>
        </>
      ) : (
        <>
          <h2 id="selected-event-title">予定を選んでください</h2>
          <p>日程の予定か地図の印を選ぶと、ここに時刻・場所・営業時間の照合・移動が出ます。</p>
        </>
      )}
    </aside>
  );
};

export default SelectedEventCard;
