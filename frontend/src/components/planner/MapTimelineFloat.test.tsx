import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import MapTimelineFloat from './MapTimelineFloat';
import type { TravelSegment } from '@/services/api/types/segments';

const seg = (from: string, to: string, mode: TravelSegment['mode'], minutes: number) => ({
  id: `${from}-${to}`, plan_id: 'p', from_event_id: from, from_place_id: null, to_event_id: to, to_place_id: null,
  mode, status: 'planned', planned_departure_at: null, planned_arrival_at: null, distance_km: null,
  duration_minutes: minutes, cost: null, currency: null,
}) as unknown as TravelSegment;

const events = [
  { id: 'a', title: '伊勢神宮 内宮', start_time: '09:00:00' },
  { id: 'area', title: 'おかげ横丁', start_time: '11:00', category: 'area' },
  { id: 'b', title: '赤福本店', start_time: '11:10', parent_event_id: 'area' },
  { id: 'c', title: 'メモ(位置なし)', start_time: null },
];

describe('[Gate MapFloatTimeline] 地図の最大化の時の小さな旅程', () => {
  it('出発・予定(時刻・番号・題名)・移動・帰着を順に出し、押すと選ぶ', () => {
    const onPick = vi.fn();
    render(<MapTimelineFloat dateLabel="11/28 土" events={events} numbers={{ a: 1, area: 2, b: 3 }}
      segments={[seg('a', 'area', 'walking', 12)]} selectedId="b" onPick={onPick}
      start={{ kind: 'departure', place: '自宅', time: '07:30', continued: false }}
      end={{ kind: 'lodging-to', place: '鳥羽の宿', time: null, continued: false }} />);
    expect(screen.getByTestId('map-timeline-start')).toHaveTextContent('07:30出発自宅');
    expect(screen.getByTestId('map-timeline-item-a')).toHaveTextContent('09:001伊勢神宮 内宮');
    expect(screen.getByText('徒歩 · 12分')).toBeInTheDocument();
    expect(screen.getByTestId('map-timeline-item-b')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('map-timeline-item-c')).toHaveTextContent('--:--–メモ(位置なし)');
    expect(screen.getByTestId('map-timeline-end')).toHaveTextContent('今夜の宿鳥羽の宿');
    fireEvent.click(screen.getByTestId('map-timeline-item-a'));
    expect(onPick).toHaveBeenCalledWith('a');
  });

  it('たたむと小さなボタンだけになり、押すと戻る', () => {
    render(<MapTimelineFloat dateLabel="11/28 土" events={events} numbers={{}} segments={[]} selectedId={null} onPick={() => {}} />);
    fireEvent.click(screen.getByTestId('map-timeline-fold'));
    expect(screen.queryByTestId('map-timeline')).toBeNull();
    fireEvent.click(screen.getByTestId('map-timeline-open'));
    expect(screen.getByTestId('map-timeline')).toBeInTheDocument();
  });
});
