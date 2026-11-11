/**
 * [Gate G11] 旅程の画面: 移動手段の名前(UIX-M04)・現地時間と時差(UIX-M05)・全日程のチャート(UIX-M06)・営業時間の帯(UIX-M07)・
 * 触って使える並べ替えと再確認の知らせ(UIX-M03)。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { getHoursCheck, moveItemBy, handleKeyboardMove, reorderSchedule, reorderSpots, drag, deleteScheduleItem } = vi.hoisted(() => ({
  deleteScheduleItem: vi.fn(),
  getHoursCheck: vi.fn(), moveItemBy: vi.fn(), handleKeyboardMove: vi.fn(), reorderSchedule: vi.fn(), reorderSpots: vi.fn(),
  drag: { isDragging: false, sourceContainer: null as string | null },
}));
vi.mock('@/services/api/g11planner', () => ({ getHoursCheck }));
// [Gate G11] 段階3: 予定の写真・提供元の状態・編集できるか(この試験では写真なし・閲覧者)
vi.mock('@/services/api/g11discover', () => ({
  getEventImages: vi.fn().mockResolvedValue({}), getEventImageMedia: vi.fn(), getMediaProviderStatus: vi.fn(),
  setEventImage: vi.fn(), clearEventImage: vi.fn(),
}));
vi.mock('@/services/api/g11', () => ({ getPlanCover: vi.fn().mockResolvedValue({ cover: null, can_edit: false }) }));
vi.mock('@/hooks/useDragDrop', () => ({
  containerId: (p: string, d: string) => `${p}:${d}`,
  reorderArray: (a: string[], id: string, to: number) => { const n = a.filter((x) => x !== id); n.splice(to, 0, id); return n; },
  finalIndexForGap: (o: string[], id: string, gap: number) => (o.indexOf(id) >= 0 && gap > o.indexOf(id) ? gap - 1 : gap),
  useDragDrop: () => ({
    dragState: drag, handleDragStart: vi.fn(), handleDrop: vi.fn(), handleDragEnd: vi.fn(),
    handleKeyboardMove, moveItemBy, isItemDragged: () => false,
  }),
}));
vi.mock('@/hooks/usePlan', () => ({
  usePlan: () => ({ addNewScheduleItem: vi.fn(), deleteScheduleItem, reorderSchedule, reorderSpots }),
}));
vi.mock('@/components/common/toastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));

import DayView from '@/components/DayView';
import AllDaysChart from './AllDaysChart';
import {
  arrivalLeg, arrivalSegment, buildChart, estimateDetail, freeGaps, hoursBadge, kmText, insertIndexByTime, moveBlockedReason, shiftedEnd, snapMinutes, reorderImpact, segmentRow, titleOfEvent,
  unionMinutes, zoneOfEvent,
} from './plannerModel';
import { LEGEND_MODES } from '@/utils/transportModes';
import { transportMode, transportText, UNSET_LABEL } from '@/utils/transportModes';
import { dayShift, zonedParts } from '@/utils/zonedTime';
import type { TravelSegment } from '@/services/api/types/segments';
import type { EventHoursCheck } from '@/services/api/types/g11planner';
import type { DaySchedule } from '@/types';

const seg = (over: Partial<TravelSegment>): TravelSegment => ({
  id: 's1', plan_id: 'p', from_event_id: 'e1', from_place_id: null, to_event_id: 'e2', to_place_id: null, mode: 'walking',
  status: 'planned', planned_departure_at: null, planned_arrival_at: null, distance_km: 1.2, duration_minutes: 18,
  cost: null, currency: null, preparation_minutes: 0, buffer_before_minutes: 0, buffer_after_minutes: 0,
  transport_number: null, platform: null, transfer_count: null, luggage_note: null, reservation_id: null, is_estimate: true,
  provider: 'haversine_estimate', algorithm_version: 'v1', computed_at: '2026-10-28T00:00:00Z',
  recommended_departure_at: null, revision: 1, created_at: '2026-10-28T00:00:00Z', updated_at: null,
  ...over,
} as TravelSegment);

const hours = (over: Partial<EventHoursCheck>): EventHoursCheck => ({
  event_id: 'e1', place_id: 'pl', status: 'ok', reason: 'within_hours', local_date: '2026-11-14', window_label: '09:00〜18:00',
  windows: ['09:00〜18:00'], hours_source: 'weekly', last_entry: null, last_order: null, closes_at: '18:00',
  minutes_to_close: 120, estimated: false, stale: false,
  source: { label: 'OpenStreetMap', retrieved_at: '2026-10-26T07:10:00+00:00' }, ...over,
});

describe('移動手段の名前', () => {
  it('アイコンと名前を組にし、鉄道を新幹線と言わず、ヘリは要手配、不明は未設定', () => {
    expect(transportText('walking', 18)).toBe('徒歩 · 18分');
    expect(transportText('train', 75)).toBe('鉄道 · 1時間15分');
    expect(transportText('shinkansen', 135)).toBe('新幹線 · 2時間15分');
    expect(transportText('helicopter', null)).toBe('ヘリ(要手配) · 所要時間未確定');
    expect(transportText('bus', null)).toBe('路線バス · 所要時間未計算');
    expect(transportText('bus', 0)).toBe('路線バス · 0分');
    expect(transportText('express_bus', 150)).toBe('高速バス · 2時間30分');
    expect(transportText('driving', 40)).toBe('自家用車 · 40分');
    expect(LEGEND_MODES).toEqual(expect.arrayContaining(['bus', 'express_bus', 'bicycle']));
    expect(transportText(undefined, 10)).toBe(UNSET_LABEL);
    expect(transportText('rocket', 10)).toBe(UNSET_LABEL);
    expect(transportMode('car').label).toBe('自家用車');
    expect(transportMode('plane').mode).toBe('flight');
    expect(transportMode(null).mode).toBeNull();  // [Gate G11 段階9] 値が無ければアイコンを出さない(TransportIcon)
  });
});

describe('現地時間・時差', () => {
  it('JST 9/19 22:45 発・14時間30分 → EDT 9/20 00:15 着(同じ瞬間から両端へ変換)', () => {
    const dep = '2026-09-19T13:45:00Z';
    const arr = new Date(new Date(dep).getTime() + 870 * 60_000).toISOString();
    const a = zonedParts(dep, 'Asia/Tokyo')!;
    const b = zonedParts(arr, 'America/New_York')!;
    expect([a.date, a.time, a.offset]).toEqual(['2026-09-19', '22:45', 'UTC+9']);
    expect([b.date, b.time, b.offset]).toEqual(['2026-09-20', '00:15', 'UTC−4']);
    expect(dayShift(a, b)).toBe(1);
  });

  it('夏時間の終わり・日付変更線・無効な時刻帯', () => {
    expect(zonedParts('2026-11-01T05:30:00Z', 'America/New_York')!.offset).toBe('UTC−4');
    expect(zonedParts('2026-11-01T06:30:00Z', 'America/New_York')!.offset).toBe('UTC−5');
    // 東京 10:00 発 → ホノルルは前の日
    const t = zonedParts('2026-11-02T01:00:00Z', 'Asia/Tokyo')!;
    const h = zonedParts('2026-11-02T08:00:00Z', 'Pacific/Honolulu')!;
    expect(dayShift(t, h)).toBe(-1);
    expect(zonedParts('2026-11-02T01:00:00Z', 'Mars/Base')).toBeNull();
    expect(zonedParts('not-a-date', 'Asia/Tokyo')).toBeNull();
  });

  it('時差をまたぐ到着の区間は両端の現地の時刻、同じ時刻帯なら出さない', () => {
    const s = seg({ mode: 'flight', duration_minutes: 870, planned_departure_at: '2026-09-19T13:45:00Z', to_event_id: 'e2' });
    const leg = arrivalLeg(s, { e1: 'Asia/Tokyo', e2: 'America/New_York' }, 'America/New_York')!;
    expect(leg.text).toBe('飛行機 · 14時間30分');
    expect(leg.crossZone!.text).toBe('9/19 22:45 Tokyo(UTC+9)→ 9/20 00:15 New York(UTC−4)・翌日着');
    expect(arrivalLeg(seg({}), { e1: 'Asia/Tokyo' }, 'Asia/Tokyo')!.crossZone).toBeNull();
    expect(arrivalLeg(null, {}, 'Asia/Tokyo')).toBeNull();
    expect(arrivalSegment('e2', [seg({ id: 'a', status: 'cancelled' }), seg({ id: 'b' })])!.id).toBe('b');
    expect(arrivalSegment('e2', [seg({ status: 'cancelled' })])).toBeNull();
  });
});

describe('営業時間の帯', () => {
  it('状態ごとに記号と文字(色だけにしない)・出典と確認日', () => {
    const ok = hoursBadge(hours({}))!;
    expect([ok.symbol, ok.text, ok.tone]).toEqual(['✓', '営業時間内 · 09:00〜18:00', 'good']);
    expect(ok.sourceText).toBe('出典: OpenStreetMap・確認 2026/10/26');
    expect(hoursBadge(hours({ status: 'near_close', minutes_to_close: 20, last_entry: '17:30' }))!.text)
      .toBe('最終入場まで20分 · 09:00〜18:00');
    expect(hoursBadge(hours({ status: 'last_entry', last_entry: '17:30' }))!.text).toContain('最終入場 17:30');
    expect(hoursBadge(hours({ status: 'last_order', last_order: '17:30' }))!.tone).toBe('warn');
    expect(hoursBadge(hours({ status: 'closes_during', estimated: true }))!.text).toContain('見積もり');
    expect(hoursBadge(hours({ status: 'closed', reason: 'closed_special' }))!.text).toBe('この日は臨時休業');
    expect(hoursBadge(hours({ status: 'closed', reason: 'after_close', windows: ['17:00〜18:00'] }))!.text)
      .toBe('閉まった後に着く予定(17:00〜18:00)');
    expect(hoursBadge(hours({ status: 'unknown', reason: 'stale_source' }))!.text).toContain('古い');
    expect(hoursBadge(hours({ status: 'unknown', reason: 'no_hours' }))!.symbol).toBe('?');
    expect(hoursBadge(hours({ status: 'unknown', reason: 'no_place' }))).toBeNull();
    expect(hoursBadge(null, true)!.text).toBe('営業時間を確認中');
  });
});

const days = (): DaySchedule[] => [
  { id: 'd1', date: '2026-11-14', timezone_id: 'Asia/Tokyo', events: [
    { id: 'e1', title: '清水寺', category: 'sightseeing', start_time: '09:30', end_time: '11:00' },
    { id: 'e2', title: '錦市場', category: 'dining', start_time: '11:45', end_time: '12:45', locked: true },
    { id: 'e3', title: '未定の寄り道', category: 'other' },
  ] },
  { id: 'd2', date: '2026-11-15', timezone_id: 'Asia/Tokyo', events: [
    { id: 'e4', title: '渡月橋', category: 'sightseeing', start_time: '08:00' },
  ] },
];

describe('全日程のチャート', () => {
  it('重なりを二重に数えない合計・同じ物差し・要約', () => {
    expect(unionMinutes([[0, 60], [30, 90], [120, 150]])).toBe(120);
    expect(unionMinutes([])).toBe(0);
    const m = buildChart(days(), [seg({ to_event_id: 'e2', duration_minutes: 18 })], new Set(['e2']));
    // 物差しはいつも 6:00〜22:00 を含める(1 件ドラッグした直後に縮まない)
    expect([m.scaleStart, m.scaleEnd]).toEqual([6 * 60, 22 * 60]);
    const early = buildChart([{ id: 'x', date: '2026-11-14', timezone_id: 'Asia/Tokyo', events: [
      { id: 'x1', title: '早朝', category: 'other', start_time: '04:40', end_time: '23:10' }] }], [], new Set());
    expect([early.scaleStart, early.scaleEnd]).toEqual([4 * 60, 24 * 60]);
    const d1 = m.days[0]!;
    expect([d1.first, d1.last, d1.travelMinutes, d1.lockedCount]).toEqual(['09:30', '12:45', 18, 1]);
    expect(d1.freeMinutes).toBe(195 - 90 - 60 - 18 + 0); // 09:30〜12:45 のうち、予定と移動以外
    expect(d1.untimed.map((e) => e.title)).toEqual(['未定の寄り道']);
    expect(m.days[1]!.events[0]!.endKnown).toBe(false);
    expect(zoneOfEvent(days())).toMatchObject({ e1: 'Asia/Tokyo', e4: 'Asia/Tokyo' });
  });

  it('列を押すとその日へ戻る。4日を超えると横に流せる', () => {
    const onOpenDay = vi.fn();
    const { rerender } = render(<AllDaysChart days={days()} segments={[]} currentDay={0} onOpenDay={onOpenDay} />);
    expect(screen.getByTestId('chart-summary-0')).toHaveTextContent('予定 3件・09:30〜12:45・移動 0分');
    expect(screen.getByTestId('chart-summary-0')).toHaveTextContent('固定 1件');
    expect(within(screen.getByTestId('chart-day-1')).getByText('(終了未設定)')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('chart-event-e4'));
    expect(onOpenDay).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByTestId('chart-open-0'));
    expect(onOpenDay).toHaveBeenLastCalledWith(0);
    expect(screen.queryByTestId('all-days-scroll-hint')).toBeNull();
    const many = [...days(), ...days(), ...days()].map((d, i) => ({ ...d, id: `x${i}`,
      events: d.events.map((e) => ({ ...e, id: `${e.id}-${i}` })) }));
    rerender(<AllDaysChart days={many} segments={[]} currentDay={0} onOpenDay={onOpenDay} />);
    expect(screen.getByTestId('all-days-scroll-hint')).toBeInTheDocument();
  });

  it('[JourneyEnds][ChartHead] 列に出発・到着・宿を出し、時刻の線を物差しに引く(物差しは出発の時刻まで広げる)', () => {
    render(<AllDaysChart days={days()} segments={[]} currentDay={0} onOpenDay={vi.fn()} anchors={[
      { start: { kind: 'departure', place: '自宅', time: '05:30', continued: false },
        end: { kind: 'lodging-to', place: '京の宿', time: null, continued: false } },
      { start: { kind: 'lodging-from', place: '京の宿', time: null, continued: false },
        end: { kind: 'arrival', place: '自宅', time: '19:10', continued: false } },
    ]} />);
    const col0 = within(screen.getByTestId('chart-day-0'));
    // [AreaDrag] 出発・帰着の箱は時刻の線にくっつける(物差しの上の箱。列の上・下には出さない)
    expect(within(screen.getByTestId('chart-anchor-departure-0')).getByTestId('day-anchor-start')).toHaveTextContent('出発 自宅 · 05:30');
    expect(col0.getByTestId('day-anchor-end')).toHaveTextContent('今夜の宿京の宿');
    expect(screen.getByTestId('chart-anchor-departure-0')).toHaveTextContent('出発 05:30');
    expect(within(screen.getByTestId('chart-anchor-arrival-1')).getByTestId('day-anchor-end')).toHaveTextContent('帰着 自宅 · 19:10');
    // 物差しは出発の箱の分(1 時間)だけ前の 4:00 から。1 時間 44px で 05:30 は 66px
    expect(screen.getByTestId('chart-anchor-departure-0')).toHaveStyle({ top: '66px' });
    expect(screen.getByTestId('chart-head-0')).toHaveClass('tc-chart-dayhead');
  });

  it('[EventMoveDay] 予定を別の日の列へドラッグ&ドロップで移す。固定の予定・同じ日へは動かさない', () => {
    const onMove = vi.fn();
    render(<AllDaysChart days={days()} segments={[]} currentDay={0} onOpenDay={vi.fn()} onMoveEvent={onMove} />);
    const store: Record<string, string> = {};
    const dt = { setData: (k: string, v: string) => { store[k] = v; }, getData: (k: string) => store[k] ?? '',
      effectAllowed: '', dropEffect: '' };
    const e1 = screen.getByTestId('chart-event-e1');
    expect(e1).toHaveAttribute('draggable', 'true');
    expect(screen.getByTestId('chart-event-e2')).not.toHaveAttribute('draggable');  // 固定
    expect(screen.getByTestId('chart-event-e3')).toHaveAttribute('draggable', 'true');  // 時刻の無い予定も
    fireEvent.dragStart(e1, { dataTransfer: dt });
    fireEvent.dragOver(screen.getByTestId('chart-day-1'), { dataTransfer: dt });
    expect(screen.getByTestId('chart-day-1')).toHaveAttribute('data-drop', 'over');
    fireEvent.drop(screen.getByTestId('chart-day-1'), { dataTransfer: dt });
    expect(onMove).toHaveBeenCalledWith('e1', 0, 1);
    fireEvent.dragStart(e1, { dataTransfer: dt });
    fireEvent.drop(screen.getByTestId('chart-day-0'), { dataTransfer: dt });
    expect(onMove).toHaveBeenCalledTimes(1);  // 同じ日へは移さない
  });

  it('[TimelineDrag] 物差しの上に落とすと 15 分単位の時刻へ。同じ日でも動かせる。帯は種類の色', () => {
    const onMove = vi.fn();
    render(<AllDaysChart days={days()} segments={[]} currentDay={0} onOpenDay={vi.fn()} onMoveEvent={onMove} />);
    const store: Record<string, string> = {};
    const dt = { setData: (k: string, v: string) => { store[k] = v; }, getData: (k: string) => store[k] ?? '',
      effectAllowed: '', dropEffect: '' };
    const e1 = screen.getByTestId('chart-event-e1');
    expect(e1.className).toContain('tc-cat--');
    expect(screen.getByTestId('chart-legend')).toBeInTheDocument();
    const scale = screen.getByTestId('chart-scale-0');
    fireEvent.dragStart(e1, { dataTransfer: dt });
    // 物差しの上端から 44px(1 時間)+ 8px(約 11 分 → 15 分に丸め)
    const at = (type: 'dragOver' | 'drop', el: HTMLElement, y: number) => {
      const ev = createEvent[type](el, { dataTransfer: dt });
      Object.defineProperty(ev, 'clientY', { value: y });
      fireEvent(el, ev);
    };
    at('dragOver', scale, 52);
    expect(screen.getByTestId('chart-drop-0')).toHaveTextContent('から');
    at('drop', scale, 52);
    expect(onMove).toHaveBeenCalledTimes(1);
    const [id, from, to, start] = onMove.mock.calls[0]!;
    expect([id, from, to]).toEqual(['e1', 0, 0]);
    expect(start).toMatch(/^\d{2}:15$/);  // 9:00 の物差しなら 10:15(上端から 1 時間 12 分 → 15 分に丸め)
    // 別の日の物差しに落とすと日と時刻の両方
    fireEvent.dragStart(e1, { dataTransfer: dt });
    at('drop', screen.getByTestId('chart-scale-1'), 0);
    expect(onMove.mock.calls[1]!.slice(0, 3)).toEqual(['e1', 0, 1]);
    expect(onMove.mock.calls[1]![3]).toMatch(/^\d{2}:\d{2}$/);
  });

  it('[TimelineDrag] 時刻の丸めと長さを保った終わり', () => {
    expect(snapMinutes(9 * 60 + 7)).toBe(9 * 60);
    expect(snapMinutes(9 * 60 + 8)).toBe(9 * 60 + 15);
    expect(snapMinutes(-30)).toBe(0);
    expect(snapMinutes(24 * 60 + 10)).toBe(23 * 60 + 45);
    expect(shiftedEnd(10 * 60, 90)).toBe('11:30');
    expect(shiftedEnd(23 * 60, 120)).toBe('23:59');
    expect(shiftedEnd(10 * 60, null)).toBeNull();
  });

  it('[EventMoveDay] 移す先の位置は時刻の順', () => {
    const evs = [{ id: 'a', start_time: '09:00' }, { id: 'b', start_time: '12:00' }, { id: 'c' }];
    expect(insertIndexByTime(evs, '10:00')).toBe(1);
    expect(insertIndexByTime(evs, '13:00')).toBe(3);
    expect(insertIndexByTime(evs, null)).toBe(3);
    expect(insertIndexByTime(evs, '08:00', 'a')).toBe(0);
  });
});

describe('1日の画面(DayView)', () => {
  beforeEach(() => {
    getHoursCheck.mockReset();
    moveItemBy.mockReset();
    handleKeyboardMove.mockReset();
    reorderSchedule.mockReset();
    reorderSpots.mockReset().mockResolvedValue(true);
    drag.isDragging = false;
    drag.sourceContainer = null;
  });

  const day = (): DaySchedule => ({ id: 'd1', date: '2026-11-14', timezone_id: 'Asia/Tokyo', events: [
    { id: 'e1', title: '清水寺', category: 'sightseeing', start_time: '09:30', place_id: 'pl1' },
    { id: 'e2', title: '夕食', category: 'dining', start_time: '18:00', place_id: 'pl2' },
  ] });

  it('現地時間の時刻帯・移動手段の名前・営業時間の帯(確認中 → 結果)', async () => {
    let resolve: (v: unknown) => void = () => {};
    getHoursCheck.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<DayView day={day()} planId="p1" segments={[seg({ from_event_id: 'e1', to_event_id: 'e2', mode: 'taxi', duration_minutes: 12 })]}
      zones={{ e1: 'Asia/Tokyo', e2: 'Asia/Tokyo' }} />);
    expect(screen.getByTestId('day-timezone')).toHaveTextContent('現地時間 · Asia/Tokyo');
    // 移動はカードの中ではなく、タイムラインの独立した行(着く予定の前)
    // [Gate PlanSpotEdit] 区間の行は 2 つの予定の間にあるので「○○から」は出さない
    expect(screen.getByTestId('segment-row')).toHaveTextContent('タクシー · 12分· 1.2km(推定)');
    expect(screen.getByTestId('segment-row')).not.toHaveTextContent('から');
    expect(screen.getByTestId('segment-row')).toHaveAttribute('data-to-event', 'e2');
    expect(screen.getByTestId('segment-row')).toHaveAttribute('data-mismatch', 'false');
    expect(screen.queryAllByTestId('schedule-arrival')).toHaveLength(0);
    expect(screen.getAllByTestId('schedule-hours')[0]).toHaveTextContent('営業時間を確認中');
    resolve({ day_id: 'd1', local_date: '2026-11-14', timezone_id: 'Asia/Tokyo', near_minutes: 30, stale_days: 90, events: [
      hours({ event_id: 'e1' }),
      hours({ event_id: 'e2', status: 'closed', reason: 'after_close', windows: ['17:00〜18:00'] }),
    ] });
    await waitFor(() => expect(screen.getAllByTestId('schedule-hours')[1]).toHaveAttribute('data-tone', 'bad'));
    expect(screen.getAllByTestId('schedule-hours')[0]).toHaveTextContent('✓営業時間内 · 09:00〜18:00');
    expect(screen.getAllByTestId('schedule-hours')[1]).toHaveTextContent('閉まった後に着く予定');
    expect(getHoursCheck).toHaveBeenCalledWith('p1', 'd1');
  });

  it('上へ・下へ(端は押せない)は保存する前の案を作り、読み上げで知らせる。「やめる」で何も変えない', async () => {
    getHoursCheck.mockRejectedValue(new Error('offline'));
    render(<DayView day={day()} planId="p1" />);
    expect(screen.getByRole('button', { name: '「清水寺」を上へ移す' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '「夕食」を下へ移す' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '「清水寺」を下へ移す' }));
    expect(screen.getByTestId('reorder-status')).toHaveTextContent('「清水寺」を2番目へ動かす案にしました。まだ保存していません');
    const preview = screen.getByTestId('reorder-preview');
    expect(preview).toHaveTextContent('並べ替えの案(まだ保存していません)');
    expect(within(preview).getByTestId('reorder-preview-moves')).toHaveTextContent('「清水寺」 1番目 → 2番目');
    expect(screen.getAllByRole('listitem', { name: /上下矢印キー/ }).map((li) => li.getAttribute('aria-label')))
      .toEqual(['夕食(上下矢印キーで並べ替え)', '清水寺(上下矢印キーで並べ替え)']);  // 案の並びで見せる
    expect(reorderSchedule).not.toHaveBeenCalled();
    expect(moveItemBy).not.toHaveBeenCalled();
    fireEvent.click(within(preview).getByTestId('reorder-cancel'));
    expect(screen.queryByTestId('reorder-preview')).toBeNull();
    expect(screen.getByTestId('reorder-status')).toHaveTextContent('並べ替えの案をやめました(保存していません)');
    expect(screen.getAllByRole('listitem', { name: /上下矢印キー/ })[0]).toHaveAttribute('aria-label', '清水寺(上下矢印キーで並べ替え)');
    await waitFor(() => expect(screen.queryAllByTestId('schedule-hours')).toHaveLength(0));
    expect(reorderSchedule).not.toHaveBeenCalled();
  });

  it('[PlanSpotEdit] 案はスポットだけを入れ替え(時刻・移動手段は位置に残す)、「この並びにする」で1回に保存 → 実際の影響 → 「元に戻す」', async () => {
    const before = { day_id: 'd1', local_date: '2026-11-14', timezone_id: 'Asia/Tokyo', near_minutes: 30, stale_days: 90, events: [
      hours({ event_id: 'e1' }), hours({ event_id: 'e2', status: 'closed', reason: 'after_close', windows: ['17:00〜18:00'] }),
    ] };
    getHoursCheck.mockResolvedValue(before);
    const segs = [seg({ from_event_id: 'e1', to_event_id: 'e2', mode: 'express_bus', duration_minutes: 95 })];
    const { rerender } = render(<DayView day={day()} planId="p1" segments={segs} />);
    await waitFor(() => expect(screen.getAllByTestId('schedule-hours')[1]).toHaveAttribute('data-tone', 'bad'));
    expect(screen.getByTestId('segment-row')).toHaveTextContent('高速バス · 1時間35分');
    fireEvent.keyDown(screen.getByRole('listitem', { name: '清水寺(上下矢印キーで並べ替え)' }), { key: 'ArrowDown' });
    const preview = screen.getByTestId('reorder-preview');
    // 区間は位置に残る(1 番目 → 2 番目は高速バスのまま、端が 夕食 → 清水寺 になる)ため、前後は合う
    expect(within(preview).getByTestId('reorder-preview-segments')).toHaveTextContent('移動の区間は案の並びと合っています');
    expect(within(preview).getByTestId('reorder-preview-hours')).toHaveTextContent('スポットだけを入れ替えます');
    expect(screen.queryByTestId('segment-mismatch')).toBeNull();
    expect(screen.getByTestId('segment-row')).toHaveTextContent('高速バス · 1時間35分');
    expect(screen.getByTestId('segment-row')).toHaveAttribute('data-to-event', 'e1');
    // 時刻は位置に残る: 1 番目(夕食)は 09:30、2 番目(清水寺)は 18:00
    const rows = screen.getAllByRole('listitem', { name: /上下矢印キー/ });
    expect(rows[0]).toHaveTextContent('夕食');
    expect(rows[0]).toHaveTextContent('09:30');
    expect(rows[1]).toHaveTextContent('18:00');
    fireEvent.click(within(preview).getByTestId('reorder-apply'));
    await waitFor(() => expect(reorderSpots).toHaveBeenCalledWith('p1', 'd1', ['e2', 'e1'], true));
    expect(reorderSpots).toHaveBeenCalledTimes(1);
    expect(reorderSchedule).not.toHaveBeenCalled();
    // サーバーが入れ替えた: 夕食が 09:30、清水寺が 18:00。区間の端も付け替わった
    getHoursCheck.mockResolvedValue({ ...before, events: [hours({ event_id: 'e1', status: 'closed', reason: 'after_close' }), hours({ event_id: 'e2' })] });
    const d = day();
    const swapped = { ...d, events: [{ ...d.events[1]!, start_time: '09:30' }, { ...d.events[0]!, start_time: '18:00' }] };
    const moved = [seg({ from_event_id: 'e2', to_event_id: 'e1', mode: 'express_bus', duration_minutes: 95 })];
    rerender(<DayView day={swapped} planId="p1" segments={moved} />);
    const panel = await screen.findByTestId('reorder-impact');
    expect(screen.queryByTestId('reorder-preview')).toBeNull();
    expect(within(panel).getByTestId('reorder-impact-moves')).toHaveTextContent('「夕食」 2番目 → 1番目');
    await waitFor(() => expect(within(panel).getByTestId('reorder-impact-hours')).toHaveTextContent('営業時間の判定が変わった予定'));
    expect(within(panel).getByTestId('reorder-impact-segments')).toHaveTextContent('移動の区間は今の並びと合っています');
    expect(panel).toHaveTextContent('スポットだけを入れ替えました');
    expect(screen.getByTestId('reorder-status')).toHaveTextContent('この並びを保存しました');
    // 元に戻すも同じ規則で元の並びへ(時刻・移動手段も元の位置のまま戻る)
    fireEvent.click(within(panel).getByTestId('reorder-undo'));
    await waitFor(() => expect(reorderSpots).toHaveBeenLastCalledWith('p1', 'd1', ['e1', 'e2']));
    await waitFor(() => expect(screen.queryByTestId('reorder-impact')).toBeNull());
    expect(screen.getByTestId('reorder-status')).toHaveTextContent('元の並びに戻しました');
  });

  it('[PlanSpotEdit] 保存に失敗したら影響の欄を出さず、何も変えていないと伝える', async () => {
    getHoursCheck.mockRejectedValue(new Error('offline'));
    reorderSpots.mockResolvedValue(false);
    render(<DayView day={day()} planId="p1" />);
    fireEvent.click(screen.getByRole('button', { name: '「清水寺」を下へ移す' }));
    fireEvent.click(within(screen.getByTestId('reorder-preview')).getByTestId('reorder-apply'));
    await waitFor(() => expect(screen.getByTestId('reorder-status')).toHaveTextContent('並べ替えを保存できませんでした'));
    expect(screen.queryByTestId('reorder-impact')).toBeNull();
    expect(screen.queryByTestId('reorder-preview')).toBeNull();
  });

  it('[PlanSpotEdit] 予定の行の上でドラッグを受け、上半分なら前・下半分なら後ろに入れる線を出し、落とすと案にする', async () => {
    getHoursCheck.mockRejectedValue(new Error('offline'));
    drag.isDragging = true;
    drag.sourceContainer = 'p1:d1';
    render(<DayView day={day()} planId="p1" />);
    const target = screen.getByRole('listitem', { name: '夕食(上下矢印キーで並べ替え)' }).parentElement!;
    target.getBoundingClientRect = () => ({ top: 100, height: 40, bottom: 140, left: 0, right: 300, width: 300, x: 0, y: 100, toJSON: () => ({}) });
    const over = fireEvent.dragOver(target, { clientY: 130, dataTransfer: { dropEffect: 'none' } });
    expect(over).toBe(false); // 既定の処理(禁止の印)を止めた
    expect(screen.getAllByTestId('drop-line')).toHaveLength(1);
    fireEvent.drop(target, {
      clientY: 130,
      dataTransfer: { getData: () => JSON.stringify({ itemId: 'e1', sourceContainer: 'p1:d1' }) },
    });
    expect(screen.getByTestId('reorder-preview')).toHaveTextContent('「清水寺」 1番目 → 2番目');
    expect(screen.queryAllByTestId('drop-line')).toHaveLength(0);
    await waitFor(() => expect(getHoursCheck).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryAllByTestId('schedule-hours')).toHaveLength(0));
  });

  it('確定の予定と、それと入れ替わる移動は案にもしない(ボタンは押せず、矢印キー・ドラッグは理由を出す)。「このままにする」', async () => {
    getHoursCheck.mockRejectedValue(new Error('offline'));
    const three = (): DaySchedule => ({ id: 'd1', date: '2026-11-14', timezone_id: 'Asia/Tokyo', events: [
      { id: 'e1', title: '清水寺', category: 'sightseeing' },
      { id: 'e2', title: '夕食', category: 'dining' },
      { id: 'e3', title: '予約の宿', category: 'accommodation', locked: true },
    ] });
    const { rerender } = render(<DayView day={three()} planId="p1" />);
    expect(screen.getByRole('button', { name: '「夕食」を下へ移す' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '「予約の宿」を上へ移す' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('listitem', { name: '予約の宿(上下矢印キーで並べ替え)' }), { key: 'ArrowUp' });
    expect(screen.getByTestId('reorder-status')).toHaveTextContent('「予約の宿」は確定の予定のため動かせません');
    expect(screen.queryByTestId('reorder-preview')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '「清水寺」を下へ移す' }));
    fireEvent.click(within(screen.getByTestId('reorder-preview')).getByTestId('reorder-apply'));
    await waitFor(() => expect(reorderSpots).toHaveBeenCalledWith('p1', 'd1', ['e2', 'e1', 'e3'], true));
    const t = three();
    rerender(<DayView day={{ ...t, events: [t.events[1]!, t.events[0]!, t.events[2]!] }} planId="p1" />);
    const panel = await screen.findByTestId('reorder-impact');
    expect(within(panel).getByTestId('reorder-impact-hours')).toHaveTextContent('営業時間を照合できる場所の予定はありません');
    fireEvent.click(within(panel).getByTestId('reorder-keep'));
    expect(screen.queryByTestId('reorder-impact')).toBeNull();
    expect(screen.getByTestId('reorder-status')).toHaveTextContent('この並びのままにしました');
  });

  it('予定が変わると案を取り消す(保存していない)', async () => {
    getHoursCheck.mockRejectedValue(new Error('offline'));
    const { rerender } = render(<DayView day={day()} planId="p1" />);
    fireEvent.click(screen.getByRole('button', { name: '「清水寺」を下へ移す' }));
    expect(screen.getByTestId('reorder-preview')).toBeInTheDocument();
    rerender(<DayView day={{ ...day(), events: [day().events[0]!] }} planId="p1" />);
    expect(screen.queryByTestId('reorder-preview')).toBeNull();
    expect(screen.getByTestId('reorder-status')).toHaveTextContent('予定が変わったため、並べ替えの案を取り消しました');
    expect(reorderSchedule).not.toHaveBeenCalled();
    await waitFor(() => expect(getHoursCheck).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryAllByTestId('schedule-hours')).toHaveLength(0));
  });
});

describe('移動の区間の行・並べ替えの影響の計算', () => {
  const evs = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }];

  it('区間の出発の予定が直前でなければ合わない。日の最初は同じ日の中から出る時だけ合わない', () => {
    const toB = seg({ id: 's1', from_event_id: 'a', to_event_id: 'b' });
    const fromOtherDay = seg({ id: 's2', from_event_id: 'x', to_event_id: 'a' });
    const fromPlace = seg({ id: 's3', from_event_id: null, from_place_id: 'pl', to_event_id: 'c' });
    const titles = { ...titleOfEvent([{ id: 'd', date: '2026-11-14', events: evs.map((e) => ({ ...e, category: 'other' as const })) }]), x: '前の日の宿' };
    const segs = [toB, fromOtherDay, fromPlace];
    expect(segmentRow(evs, 1, segs, {}, 'Asia/Tokyo', titles)).toMatchObject({ fromTitle: 'A', mismatch: false });
    expect(segmentRow(evs, 0, segs, {}, 'Asia/Tokyo', titles)).toMatchObject({ fromTitle: '前の日の宿', mismatch: false });
    expect(segmentRow(evs, 2, segs, {}, 'Asia/Tokyo', titles)).toMatchObject({ fromTitle: null, mismatch: false });
    const moved = [evs[1]!, evs[0]!, evs[2]!];
    expect(segmentRow(moved, 0, segs, {}, 'Asia/Tokyo', titles)!.mismatch).toBe(true);  // A が同じ日の後ろにある
    expect(segmentRow(moved, 1, [], {}, undefined, titles)).toBeNull();
  });

  it('影響: 動いた予定だけ・営業時間の状態(未照合・確認中・比べられない・変化なし)・区間の数', () => {
    const segs = [seg({ from_event_id: 'a', to_event_id: 'b' })];
    const now = [evs[1]!, evs[0]!, evs[2]!];
    const m = reorderImpact(['a', 'b', 'c'], null, now, null, false, segs);
    expect(m.moves.map((x) => [x.title, x.from, x.to])).toEqual([['B', 1, 0], ['A', 0, 1]]);
    expect(m.hours.state).toBe('no_place');
    expect([m.mismatches, m.segmentCount]).toEqual([['B'], 1]);
    const placed = now.map((e) => ({ ...e, place_id: 'pl' }));
    expect(reorderImpact(['a', 'b', 'c'], {}, placed, null, true, []).hours.state).toBe('pending');
    expect(reorderImpact(['a', 'b', 'c'], null, placed, {}, false, []).hours.state).toBe('no_baseline');
    const same = { a: hours({ event_id: 'a' }) };
    expect(reorderImpact(['a', 'b', 'c'], same, placed, same, false, []).hours.state).toBe('unchanged');
    expect(reorderImpact(['a', 'b', 'c'], null, evs, null, false, []).moves).toEqual([]);
  });

  it('確定の予定は動かさず、確定の予定と入れ替わる移動もしない', () => {
    const list = [{ title: 'A' }, { title: 'B', locked: true }, { title: 'C' }];
    expect(moveBlockedReason(list, 0, 1)).toBe('確定の予定「B」と入れ替わるため動かせません');
    expect(moveBlockedReason(list, 1, -1)).toBe('「B」は確定の予定のため動かせません');
    expect(moveBlockedReason(list, 0, -1)).toBeNull();
    expect(moveBlockedReason([{ title: 'A' }, { title: 'C' }], 0, 1)).toBeNull();
  });
});

describe('[Gate TimelineDrag] 重なる予定を横に並べる', () => {
  it('重なる予定は別の列、重ならない予定は 1 列', async () => {
    const { overlapLanes } = await import('./plannerModel');
    const m = overlapLanes([
      { id: 'a', start: 700, end: 760 }, { id: 'b', start: 735, end: 780 }, { id: 'c', start: 770, end: 800 },
      { id: 'd', start: 900, end: 930 },
    ]);
    expect(m.get('a')).toEqual({ lane: 0, of: 2 });
    expect(m.get('b')).toEqual({ lane: 1, of: 2 });
    expect(m.get('c')).toEqual({ lane: 0, of: 2 });
    expect(m.get('d')).toEqual({ lane: 0, of: 1 });
  });
});

describe('[TravelEstimate] 区間の距離・内訳と全日程の移動の帯・空き時間', () => {
  it('距離の文字・内訳(車の下道/高速、電車の乗り換え)・計算のもと', () => {
    expect([kmText(0.42), kmText(3.456), kmText(12.6), kmText(null)]).toEqual(['420m', '3.5km', '13km', null]);
    const car = estimateDetail({ mode: 'driving', distance_km: 52.3, estimate_basis: '直線 40.0km をもとにした目安', estimate_variants: [
      { key: 'local', label: '下道', distance_km: 52, duration_minutes: 101, note: '平均 32km/h' },
      { key: 'highway', label: '高速利用', distance_km: 48, duration_minutes: 52, note: '高速 85km/h' }] });
    expect(car).toEqual({ distance: '52km', detail: '下道 1時間41分 / 高速利用 52分',
      basis: '直線 40.0km をもとにした目安。平均 32km/h。高速 85km/h' });
    const train = estimateDetail({ mode: 'train', distance_km: 30, estimate_basis: null, estimate_variants: [
      { key: 'recommended', label: '快速・急行・乗り換え 0 回', distance_km: 30, duration_minutes: 52 }] });
    expect(train.detail).toBe('快速・急行・乗り換え 0 回');
    expect(estimateDetail({ mode: 'walking', distance_km: 1.2, estimate_basis: null, estimate_variants: [
      { key: 'walk', label: '徒歩', distance_km: 1.2, duration_minutes: 15 }] }).detail).toBeNull();
  });

  it('空き時間は 15 分以上のあいだだけ。移動の帯と手段ごとの合計', () => {
    expect(freeGaps([[540, 600], [610, 660], [720, 780]])).toEqual([[660, 720]]);
    const m = buildChart(days(), [seg({ to_event_id: 'e2', mode: 'driving', duration_minutes: 20, distance_km: 8.4 })]);
    const d1 = m.days[0]!;
    expect(d1.travels).toEqual([{ eventId: 'e2', start: 11 * 60 + 25, end: 11 * 60 + 45, mode: 'driving', minutes: 20, km: 8.4 }]);
    expect(d1.gaps).toEqual([[11 * 60, 11 * 60 + 25]]);
    expect(d1.byMode).toEqual([{ mode: '自家用車', label: '自家用車', minutes: 20, km: 8.4 }]);
    render(<AllDaysChart days={days()} segments={[seg({ to_event_id: 'e2', mode: 'driving', duration_minutes: 20, distance_km: 8.4 })]}
      currentDay={0} onOpenDay={vi.fn()} />);
    expect(screen.getByTestId('chart-travel-e2')).toHaveTextContent('20分 · 8.4km');
    expect(screen.getByTestId('chart-gap-0')).toHaveTextContent('空き 25分');
    expect(screen.getByTestId('chart-summary-0')).toHaveTextContent('自家用車 20分・8.4km');
  });
});

// [Gate EventArea] エリアの中の予定(おかげ横丁の中の赤福・ダンデライオン)
describe('エリアの枠(DayView・全日程)', () => {
  const areaDay = (): DaySchedule => ({ id: 'd1', date: '2026-11-28', timezone_id: 'Asia/Tokyo', events: [
    { id: 'ise', title: '伊勢神宮', category: 'sightseeing', start_time: '10:00', end_time: '12:00' },
    { id: 'area', title: 'おかげ横丁', category: 'area', start_time: '13:45', end_time: '15:45' },
    { id: 'aka', title: '赤福', category: 'dining', start_time: '13:50', end_time: '14:20', parent_event_id: 'area' },
    { id: 'dan', title: 'ダンデライオン', category: 'dining', start_time: '14:30', end_time: '15:30', parent_event_id: 'area' },
    { id: 'toba', title: '鳥羽水族館', category: 'sightseeing', start_time: '16:30', end_time: '18:00' },
  ] });
  beforeEach(() => {
    getHoursCheck.mockReset();
    getHoursCheck.mockResolvedValue({ day_id: 'd1', local_date: '2026-11-28', timezone_id: 'Asia/Tokyo', near_minutes: 30, stale_days: 90, events: [] });
    reorderSpots.mockReset();
    reorderSpots.mockResolvedValue(true);
  });

  it('エリアを枠にし、見出しに滞在・中の予定・空き。中の移動は手段を選ばず数えない', async () => {
    render(<DayView day={areaDay()} planId="p1" segments={[]} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.getByTestId('area-summary-area')).toHaveTextContent('エリア内の滞在 2時間・中の予定 2件・空き 30分');
    const inner = screen.getAllByTestId('segment-inner');
    expect(inner.map((r) => r.getAttribute('data-to-event'))).toEqual(['aka', 'dan']);
    expect(inner[0]).toHaveTextContent('エリアの中 · 歩いて回る(移動として数えない)');
    // [AreaDrag] 枠: エリアの見出し(名前・時刻)の下に中の予定。ほかの予定は枠の外
    const block = screen.getByTestId('area-block-area');
    expect(block).toHaveTextContent('エリアおかげ横丁13:45〜15:45');
    expect(within(block).getAllByRole('listitem', { name: /上下矢印キー/ }).map((r) => r.getAttribute('aria-label')!.split(/[((]/)[0]))
      .toEqual(['エリア おかげ横丁', '赤福', 'ダンデライオン']);
    // エリアの詳細(写真・住所)は「エリアの詳細を開く」で出す
    expect(within(block).queryByText('おかげ横丁', { selector: '.tc-event-title' })).toBeNull();
    fireEvent.click(screen.getByTestId('area-toggle-area'));
    expect(screen.getByTestId('area-toggle-area')).toHaveAttribute('aria-expanded', 'true');
    expect(within(block).getAllByText('おかげ横丁').length).toBeGreaterThan(1);
    // エリアも中の予定もドラッグで動かせる
    expect(screen.getByRole('listitem', { name: '赤福(上下矢印キーで並べ替え)' })).toHaveAttribute('draggable', 'true');
    expect(screen.getByRole('listitem', { name: 'エリア おかげ横丁(上下矢印キーで並べ替え)' })).toHaveAttribute('draggable', 'true');
  });

  it('↑↓: 中の予定はエリアの中だけ。エリアはまとまりごと(時刻は予定に付いたまま)動かして 1 回に保存', async () => {
    render(<DayView day={areaDay()} planId="p1" segments={[]} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.getByTestId('move-up-aka')).toBeDisabled();  // エリアより前へは出ない
    expect(screen.getByTestId('move-down-dan')).toBeDisabled();  // エリアの後ろへは出ない
    expect(screen.getByTestId('move-up-dan')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('move-up-area'));
    const rows = screen.getAllByRole('listitem', { name: /上下矢印キー/ });
    expect(rows.map((r) => r.getAttribute('aria-label')!.split(/[((]/)[0])).toEqual(
      ['エリア おかげ横丁', '赤福', 'ダンデライオン', '伊勢神宮', '鳥羽水族館']);
    expect(rows[3]).toHaveTextContent('10:00');  // 時刻は予定に付いたまま
    fireEvent.click(within(screen.getByTestId('reorder-preview')).getByTestId('reorder-apply'));
    await waitFor(() => expect(reorderSpots).toHaveBeenCalledWith('p1', 'd1', ['area', 'aka', 'dan', 'ise', 'toba'], false));
  });

  /** 行の下半分へ落とす(jsdom のドラッグの出来事は clientY を持たないので、いつも下半分として扱われる) */
  const dropOn = (el: HTMLElement, item: string) => {
    el.getBoundingClientRect = () => ({ top: 100, height: 40, bottom: 140, left: 0, right: 300, width: 300, x: 0, y: 100, toJSON: () => ({}) });
    fireEvent.dragOver(el, { dataTransfer: { dropEffect: 'none' } });
    fireEvent.drop(el, { dataTransfer: { getData: () => JSON.stringify({ itemId: item, sourceContainer: 'p1:d1' }) } });
  };

  it('[AreaDrag] 外の予定をエリアの中へドラッグ: エリアに入れ、時刻を中の予定の後ろへ。はみ出したらエリアの終わりを延ばす', async () => {
    drag.isDragging = true;
    drag.sourceContainer = 'p1:d1';
    render(<DayView day={areaDay()} planId="p1" segments={[]} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    // 鳥羽水族館(1時間30分)を、ダンデライオンの下半分(エリアの中の最後)へ
    dropOn(screen.getByRole('listitem', { name: 'ダンデライオン(上下矢印キーで並べ替え)' }).parentElement!, 'toba');
    const preview = screen.getByTestId('reorder-preview');
    expect(screen.getByTestId('reorder-status')).toHaveTextContent('「鳥羽水族館」をエリア「おかげ横丁」へ入れる案にしました(エリアの時刻を 13:45〜17:00 に)');
    expect(screen.getByTestId('area-summary-area')).toHaveTextContent('中の予定 3件');
    fireEvent.click(within(preview).getByTestId('reorder-apply'));
    await waitFor(() => expect(reorderSpots).toHaveBeenCalledWith('p1', 'd1', ['ise', 'area', 'aka', 'dan', 'toba'], false, {
      parents: { toba: 'area' },
      times: { toba: { start: '15:30', end: '17:00' }, area: { start: '13:45', end: '17:00' } },
    }));
    drag.isDragging = false;
  });

  it('[AreaDrag] 中の予定をエリアの外へ・エリアの中で並べ替える(エリアの時間帯の中で時刻を配り直す)', async () => {
    drag.isDragging = true;
    drag.sourceContainer = 'p1:d1';
    render(<DayView day={areaDay()} planId="p1" segments={[]} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    // ダンデライオンをエリアの見出しの下半分へ(エリアの中の先頭へ。時刻は 13:50〜14:50・14:50〜15:20)
    dropOn(screen.getByRole('listitem', { name: 'エリア おかげ横丁(上下矢印キーで並べ替え)' }), 'dan');
    expect(screen.getByTestId('reorder-status')).toHaveTextContent('「ダンデライオン」をエリア「おかげ横丁」の中で動かす案にしました');
    fireEvent.click(within(screen.getByTestId('reorder-preview')).getByTestId('reorder-apply'));
    await waitFor(() => expect(reorderSpots).toHaveBeenCalledWith('p1', 'd1', ['ise', 'area', 'dan', 'aka', 'toba'], false, {
      times: { dan: { start: '13:50', end: '14:50' }, aka: { start: '14:50', end: '15:20' } },
    }));
    // 赤福を最後(エリアの外)へ: エリアから出し、前の予定(鳥羽水族館)の終わりから
    reorderSpots.mockClear();
    fireEvent.dragOver(screen.getByTestId('drop-tail'), { dataTransfer: { dropEffect: 'none' } });
    fireEvent.drop(screen.getByTestId('drop-tail'), { dataTransfer: { getData: () => JSON.stringify({ itemId: 'aka', sourceContainer: 'p1:d1' }) } });
    expect(screen.getByTestId('reorder-status')).toHaveTextContent('「赤福」をエリア「おかげ横丁」から出す案にしました');
    fireEvent.click(within(screen.getByTestId('reorder-preview')).getByTestId('reorder-apply'));
    await waitFor(() => expect(reorderSpots).toHaveBeenCalledWith('p1', 'd1', ['ise', 'area', 'dan', 'toba', 'aka'], false, {
      parents: { aka: null },
      times: { aka: { start: '18:00', end: '18:30' } },
    }));
    drag.isDragging = false;
  });

  it('全日程: エリアは帯、中の予定には移動の帯を出さない', () => {
    const segs = [seg({ from_event_id: 'area', to_event_id: 'aka', mode: 'walking', duration_minutes: 5 })];
    const model = buildChart([areaDay()], segs);
    const d = model.days[0]!;
    expect(d.areas?.map((a) => a.id)).toEqual(['area']);
    expect(d.events.map((e) => e.id)).toEqual(['ise', 'aka', 'dan', 'toba']);
    expect(d.events.filter((e) => e.inArea).map((e) => e.id)).toEqual(['aka', 'dan']);
    expect(d.travels ?? []).toEqual([]);
    render(<AllDaysChart days={[areaDay()]} segments={segs} currentDay={0} onOpenDay={() => {}} />);
    // [AreaDrag] エリアは枠: 見出しに「エリア 名前 時刻」、中の予定は枠の中
    const box = screen.getByTestId('chart-area-area');
    expect(box).toHaveTextContent('エリアおかげ横丁13:45〜15:45');
    expect(within(box).getByTestId('chart-event-aka')).toHaveTextContent('13:50 赤福');
    expect(within(box).getByTestId('chart-event-dan')).toBeInTheDocument();
    expect(within(box).queryByTestId('chart-event-ise')).toBeNull();
  });
});

// [Gate DeleteOnce] 予定の削除は 1 回だけ送る(以前は旅程の画面がもう一度消して 404「リソースが見つかりません」になった)
describe('予定の削除', () => {
  it('確かめて 1 回だけ消し、消した後に onItemDelete で知らせる', async () => {
    getHoursCheck.mockResolvedValue({ day_id: 'd1', local_date: '2026-11-29', timezone_id: 'Asia/Tokyo', near_minutes: 30, stale_days: 90, events: [] });
    deleteScheduleItem.mockReset();
    deleteScheduleItem.mockResolvedValue({ ok: true, note: null });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onItemDelete = vi.fn();
    render(<DayView day={{ id: 'd1', date: '2026-11-29', timezone_id: 'Asia/Tokyo', events: [
      { id: 'yoko', title: '横山展望台', category: 'sightseeing' }, { id: 'toba', title: '鳥羽マルシェ', category: 'shopping' }] }}
      planId="p1" onItemDelete={onItemDelete} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    fireEvent.click(within(screen.getByRole('listitem', { name: '鳥羽マルシェ(上下矢印キーで並べ替え)' })).getByRole('button', { name: '削除' }));
    await waitFor(() => expect(onItemDelete).toHaveBeenCalledWith('toba'));
    expect(deleteScheduleItem).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    confirmSpy.mockRestore();
  });
});
