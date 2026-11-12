/**
 * [Gate MapFloatTimeline] 地図を最大化した時、地図の左に重ねて出す小さな旅程(この日の予定の順)。
 *
 * - 出発・宿 → 予定(時刻・地図の番号・題名)→ 帰着・宿。予定の間に移動(手段・所要時間)
 * - エリアの中の予定は字下げ。位置の無い予定は番号の代わりに「–」(地図には出ない)
 * - 予定を押すと選ぶ(地図の印と番号が赤くなり、印が見えていなければ地図をそこへ動かす)
 * - たためる(地図を広く見たい時)。値は画面にある値だけから作る(新しく取りにいかない)
 */
import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ListOrdered } from 'lucide-react';
import TransportIcon from '@/components/common/TransportIcon';
import { transportText } from '@/utils/transportModes';
import { anchorText, type DayAnchor } from './journeyModel';
import { arrivalSegment } from './plannerModel';
import type { TravelSegment } from '@/services/api/types/segments';

export interface FloatEvent {
  id: string;
  title: string;
  start_time?: string | null;
  category?: string | null;
  parent_event_id?: string | null;
}

interface Props {
  dateLabel: string;
  events: ReadonlyArray<FloatEvent>;
  numbers: Record<string, number>;
  segments: TravelSegment[];
  selectedId: string | null;
  onPick: (id: string) => void;
  start?: DayAnchor | null;
  end?: DayAnchor | null;
}

const AnchorLine: React.FC<{ a: DayAnchor; testid: string }> = ({ a, testid }) => {
  const { label, body } = anchorText({ ...a, time: null });
  return (
    <li className="tc-mtl-anchor" data-kind={a.kind} data-testid={testid}>
      <span className="tc-mtl-time">{a.time ?? ''}</span>
      <span className="tc-mtl-anchortext"><b>{label}</b>{body}</span>
    </li>
  );
};

const MapTimelineFloat: React.FC<Props> = ({ dateLabel, events, numbers, segments, selectedId, onPick, start, end }) => {
  const [open, setOpen] = useState(true);
  const listRef = useRef<HTMLOListElement | null>(null);
  useEffect(() => {
    if (!selectedId || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-mtl-id="${CSS.escape(selectedId)}"]`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedId]);

  if (!open) {
    return (
      <button type="button" className="tc-focus-ring tc-mapov tc-mtl-pill" onClick={() => setOpen(true)}
        aria-expanded={false} data-testid="map-timeline-open">
        <ListOrdered size={15} aria-hidden="true" />旅程を表示<span className="tc-mtl-count">{events.length}</span>
      </button>
    );
  }
  return (
    <aside className="tc-mapov tc-mtl" aria-label={`${dateLabel}の旅程`} data-testid="map-timeline">
      <div className="tc-mtl-head">
        <ListOrdered size={15} aria-hidden="true" />
        <b>旅程</b><span className="tc-mtl-date">{dateLabel}</span>
        <button type="button" className="tc-focus-ring tc-mapov-fold" onClick={() => setOpen(false)} aria-expanded={true}
          aria-label="旅程をたたむ" data-testid="map-timeline-fold">
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
      </div>
      <ol className="tc-mtl-list" ref={listRef}>
        {start && <AnchorLine a={start} testid="map-timeline-start" />}
        {events.map((e) => {
          const seg = arrivalSegment(e.id, segments);
          const num = numbers[e.id];
          const sel = e.id === selectedId;
          const inner = Boolean(e.parent_event_id);
          return (
            <React.Fragment key={e.id}>
              {seg && (
                <li className={`tc-mtl-move${inner ? ' is-inner' : ''}`} aria-hidden="true">
                  <TransportIcon mode={seg.mode} size={12} />{transportText(seg.mode, seg.duration_minutes)}
                </li>
              )}
              <li className={`tc-mtl-item${inner ? ' is-inner' : ''}${e.category === 'area' ? ' is-area' : ''}`} data-mtl-id={e.id}>
                <button type="button" className={`tc-focus-ring tc-mtl-btn${sel ? ' is-selected' : ''}`} aria-pressed={sel}
                  onClick={() => onPick(e.id)} data-testid={`map-timeline-item-${e.id}`}>
                  <span className="tc-mtl-time">{e.start_time ? e.start_time.slice(0, 5) : '--:--'}</span>
                  <span className={`tc-mtl-num${num === undefined ? ' is-none' : ''}`}
                    title={num === undefined ? '位置が無いので地図に出ません' : undefined}>{num ?? '–'}</span>
                  <span className="tc-mtl-title">{e.title}</span>
                </button>
              </li>
            </React.Fragment>
          );
        })}
        {end && <AnchorLine a={end} testid="map-timeline-end" />}
      </ol>
    </aside>
  );
};

export default MapTimelineFloat;
