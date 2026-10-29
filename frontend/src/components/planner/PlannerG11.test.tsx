/**
 * [Gate G11] 旅程の画面: 移動手段の名前(UIX-M04)・現地時間と時差(UIX-M05)・全日程のチャート(UIX-M06)・営業時間の帯(UIX-M07)・
 * 触って使える並べ替えと再確認の知らせ(UIX-M03)。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { getHoursCheck, moveItemBy, handleKeyboardMove, reorderSchedule } = vi.hoisted(() => ({
  getHoursCheck: vi.fn(), moveItemBy: vi.fn(), handleKeyboardMove: vi.fn(), reorderSchedule: vi.fn(),
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
    dragState: { isDragging: false }, handleDragStart: vi.fn(), handleDrop: vi.fn(), handleDragEnd: vi.fn(),
    handleKeyboardMove, moveItemBy, isItemDragged: () => false,
  }),
}));
vi.mock('@/hooks/usePlan', () => ({
  usePlan: () => ({ addNewScheduleItem: vi.fn(), deleteScheduleItem: vi.fn(), reorderSchedule }),
}));
vi.mock('@/components/common/toastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));

import DayView from '@/components/DayView';
import AllDaysChart from './AllDaysChart';
import {
  arrivalLeg, arrivalSegment, buildChart, hoursBadge, moveBlockedReason, reorderImpact, segmentRow, titleOfEvent,
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
    expect(transportText('walking', 18)).toBe('🚶 徒歩 · 18分');
    expect(transportText('train', 75)).toBe('🚃 鉄道 · 1時間15分');
    expect(transportText('shinkansen', 135)).toBe('🚄 新幹線 · 2時間15分');
    expect(transportText('helicopter', null)).toBe('🚁 ヘリ(要手配) · 所要時間未確定');
    expect(transportText('bus', null)).toBe('🚌 路線バス · 所要時間未計算');
    expect(transportText('bus', 0)).toBe('🚌 路線バス · 0分');
    expect(transportText('express_bus', 150)).toBe('🚍 高速バス · 2時間30分');
    expect(transportText('driving', 40)).toBe('🚗 自家用車 · 40分');
    expect(LEGEND_MODES).toEqual(expect.arrayContaining(['bus', 'express_bus', 'bicycle']));
    expect(transportText(undefined, 10)).toBe(UNSET_LABEL);
    expect(transportText('rocket', 10)).toBe(UNSET_LABEL);
    expect(transportMode('car').label).toBe('自家用車');
    expect(transportMode('plane').mode).toBe('flight');
    expect(transportMode(null).icon).toBeNull();
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
    expect(leg.text).toBe('✈️ 飛行機 · 14時間30分');
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
    expect([m.scaleStart, m.scaleEnd]).toEqual([8 * 60, 13 * 60]);
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
});

describe('1日の画面(DayView)', () => {
  beforeEach(() => {
    getHoursCheck.mockReset();
    moveItemBy.mockReset();
    handleKeyboardMove.mockReset();
    reorderSchedule.mockReset();
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
    expect(screen.getByTestId('segment-row')).toHaveTextContent('🚕 タクシー · 12分(推定)「清水寺」から');
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
    expect(screen.getAllByRole('listitem').map((li) => li.getAttribute('aria-label')).filter(Boolean))
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

  it('案で前後が合わなくなる区間を先に示し、「この並びにする」で1回に保存 → 実際の影響 → 「元に戻す」', async () => {
    const before = { day_id: 'd1', local_date: '2026-11-14', timezone_id: 'Asia/Tokyo', near_minutes: 30, stale_days: 90, events: [
      hours({ event_id: 'e1' }), hours({ event_id: 'e2', status: 'closed', reason: 'after_close', windows: ['17:00〜18:00'] }),
    ] };
    getHoursCheck.mockResolvedValue(before);
    reorderSchedule.mockResolvedValue(undefined);
    const segs = [seg({ from_event_id: 'e1', to_event_id: 'e2', mode: 'express_bus', duration_minutes: 95 })];
    const { rerender } = render(<DayView day={day()} planId="p1" segments={segs} />);
    await waitFor(() => expect(screen.getAllByTestId('schedule-hours')[1]).toHaveAttribute('data-tone', 'bad'));
    expect(screen.getByTestId('segment-row')).toHaveTextContent('🚍 高速バス · 1時間35分');
    fireEvent.keyDown(screen.getByRole('listitem', { name: '清水寺(上下矢印キーで並べ替え)' }), { key: 'ArrowDown' });
    const preview = screen.getByTestId('reorder-preview');
    expect(within(preview).getByTestId('reorder-preview-segments'))
      .toHaveTextContent('前後が合わなくなる移動の区間が1件あります(「夕食」へ着く区間)');
    expect(within(preview).getByTestId('reorder-preview-hours')).toHaveTextContent('営業時間の判定は変わりません');
    expect(screen.getByTestId('segment-mismatch')).toHaveTextContent('区間は自動では直しません');  // 案の並びで先に見える
    fireEvent.click(within(preview).getByTestId('reorder-apply'));
    await waitFor(() => expect(reorderSchedule).toHaveBeenCalledWith('p1', 'd1', ['e2', 'e1']));
    expect(reorderSchedule).toHaveBeenCalledTimes(1);
    // store が並びを保存した。営業時間の読み直しで、夕食の判定が変わった
    getHoursCheck.mockResolvedValue({ ...before, events: [hours({ event_id: 'e1' }), hours({ event_id: 'e2' })] });
    const swapped = { ...day(), events: [day().events[1]!, day().events[0]!] };
    rerender(<DayView day={swapped} planId="p1" segments={segs} />);
    const panel = await screen.findByTestId('reorder-impact');
    expect(screen.queryByTestId('reorder-preview')).toBeNull();
    expect(within(panel).getByTestId('reorder-impact-moves')).toHaveTextContent('「夕食」 2番目 → 1番目');
    await waitFor(() => expect(within(panel).getByTestId('reorder-impact-hours'))
      .toHaveTextContent('「夕食」: ✕ 閉まった後に着く予定(17:00〜18:00) → ✓ 営業時間内 · 09:00〜18:00'));
    expect(within(panel).getByTestId('reorder-impact-segments')).toHaveTextContent('前後が合わなくなった移動の区間が1件あります');
    expect(screen.getByTestId('reorder-status')).toHaveTextContent('この並びを保存しました');
    fireEvent.click(within(panel).getByTestId('reorder-undo'));
    await waitFor(() => expect(reorderSchedule).toHaveBeenLastCalledWith('p1', 'd1', ['e1', 'e2']));
    await waitFor(() => expect(screen.queryByTestId('reorder-impact')).toBeNull());
    expect(screen.getByTestId('reorder-status')).toHaveTextContent('元の並びに戻しました');
  });

  it('確定(🔒)の予定と、それと入れ替わる移動は案にもしない(ボタンは押せず、矢印キー・ドラッグは理由を出す)。「このままにする」', async () => {
    getHoursCheck.mockRejectedValue(new Error('offline'));
    reorderSchedule.mockResolvedValue(undefined);
    const three = (): DaySchedule => ({ id: 'd1', date: '2026-11-14', timezone_id: 'Asia/Tokyo', events: [
      { id: 'e1', title: '清水寺', category: 'sightseeing' },
      { id: 'e2', title: '夕食', category: 'dining' },
      { id: 'e3', title: '予約の宿', category: 'accommodation', locked: true },
    ] });
    const { rerender } = render(<DayView day={three()} planId="p1" />);
    expect(screen.getByRole('button', { name: '「夕食」を下へ移す' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '「予約の宿」を上へ移す' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('listitem', { name: '予約の宿(上下矢印キーで並べ替え)' }), { key: 'ArrowUp' });
    expect(screen.getByTestId('reorder-status')).toHaveTextContent('「予約の宿」は確定(🔒)の予定のため動かせません');
    expect(screen.queryByTestId('reorder-preview')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '「清水寺」を下へ移す' }));
    fireEvent.click(within(screen.getByTestId('reorder-preview')).getByTestId('reorder-apply'));
    await waitFor(() => expect(reorderSchedule).toHaveBeenCalledWith('p1', 'd1', ['e2', 'e1', 'e3']));
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
    expect(moveBlockedReason(list, 0, 1)).toBe('確定(🔒)の予定「B」と入れ替わるため動かせません');
    expect(moveBlockedReason(list, 1, -1)).toBe('「B」は確定(🔒)の予定のため動かせません');
    expect(moveBlockedReason(list, 0, -1)).toBeNull();
    expect(moveBlockedReason([{ title: 'A' }, { title: 'C' }], 0, 1)).toBeNull();
  });
});
