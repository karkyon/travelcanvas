/**
 * [Gate AppShell] 旅程の3列の右: 選んだ予定(UI/UX モックの detail-card)。
 * 予定の実際の値(時刻・場所・メモ・確定)だけを出す。営業時間・移動の時間のように、この画面で確かめていない値は出さない。
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Luggage, MessageSquare, Lock } from 'lucide-react';
import Landscape from '@/components/shell/Landscape';
import type { ScheduleItem } from '@/types';

interface Props {
  planId: string;
  dayNumber: number;
  event: ScheduleItem | null;
  onEdit: (item: ScheduleItem) => void;
}

const SelectedEventCard: React.FC<Props> = ({ planId, dayNumber, event, onEdit }) => (
  <aside className="tc-card tc-detail-card" aria-labelledby="selected-event-title" data-testid="selected-event">
    <div className="tc-detail-art"><Landscape /></div>
    <p className="tc-label">{`選択中の予定 · DAY ${String(dayNumber).padStart(2, '0')}`}</p>
    {event ? (
      <>
        <h2 id="selected-event-title">{event.title}</h2>
        <p>
          {[event.location_name || event.address, event.start_time ? `${event.start_time}から` : '時刻は未定'].filter(Boolean).join(' · ')}
        </p>
        <div className="tc-detail-actions">
          <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={() => onEdit(event)}
            aria-label={`「${event.title}」を編集`}>
            <Pencil size={14} aria-hidden="true" />編集
          </button>
          <Link to={`/planner/${planId}/reservations`} className="tc-focus-ring tc-mbtn tc-mbtn--sm">
            <Luggage size={14} aria-hidden="true" />予約
          </Link>
          <Link to={`/planner/${planId}/discussion?target=event&id=${event.id}`} className="tc-focus-ring tc-mbtn tc-mbtn--sm">
            <MessageSquare size={14} aria-hidden="true" />相談
          </Link>
        </div>
        <div className="tc-detail-facts">
          <span><b>時刻</b><small>{event.start_time ? `${event.start_time}${event.end_time ? `〜${event.end_time}` : ''}` : '未定'}</small></span>
          <span><b>場所</b><small>{event.address || event.location_name || '未設定'}</small></span>
          {event.notes && <span><b>メモ</b><small>{event.notes}</small></span>}
          {event.locked && (
            <span><b>確定</b><small className="inline-flex items-center gap-1"><Lock size={12} aria-hidden="true" />最適化で動かさない</small></span>
          )}
        </div>
      </>
    ) : (
      <>
        <h2 id="selected-event-title">予定を選んでください</h2>
        <p>日程の予定か地図の印を選ぶと、ここに時刻・場所・メモが出ます。</p>
      </>
    )}
  </aside>
);

export default SelectedEventCard;
