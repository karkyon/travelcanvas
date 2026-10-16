/**
 * [Gate P14] JourneyPage(旅の振り返り、FR-054・FR-053)の画面テスト。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import type { JourneyReview } from '@/services/api';

const m = vi.hoisted(() => ({
  getJourney: vi.fn(), putEventActual: vi.fn(), deleteEventActual: vi.fn(), carryOverEvent: vi.fn(),
  getPlans: vi.fn(), getPlanDetail: vi.fn(),
}));
vi.mock('@/services/api', () => ({
  default: { getPlans: m.getPlans, getPlanDetail: m.getPlanDetail },
  getJourney: m.getJourney, putEventActual: m.putEventActual, deleteEventActual: m.deleteEventActual,
  carryOverEvent: m.carryOverEvent,
}));

import JourneyPage from './JourneyPage';

const suggested = fx.journey_with_suggestions as JourneyReview;
const recorded = fx.journey_recorded as JourneyReview;
const [temple, lunch, museum] = recorded.days[0]!.events;

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/planner/p1/journey']}>
      <Routes>
        <Route path="/planner/:planId/journey" element={<JourneyPage />} />
      </Routes>
    </MemoryRouter>
  );
}

const card = (name: RegExp) => screen.getByText(name).closest('li')!;

beforeEach(() => {
  localStorage.clear();
  for (const fn of Object.values(m)) fn.mockReset();
  m.putEventActual.mockResolvedValue(fx.event_actual_visited);
});

describe('JourneyPage (Gate P14)', () => {
  it('軌跡からの提案を日程のタイムゾーンで示し、使うと提案の時刻で記録する(初回はrevisionを送らない)', async () => {
    m.getJourney.mockResolvedValue(suggested);
    renderPage();
    await screen.findByRole('region', { name: '2026-11-01' });
    const t = card(/10:00 清水寺/);
    expect(within(t).getByText(/提案: 到着 10:20・出発 11:15\(あなたの位置の軌跡から\)/)).toBeInTheDocument();
    fireEvent.click(within(t).getByRole('button', { name: '提案を使う' }));
    const s = suggested.days[0]!.events[0]!.suggestion!;
    await waitFor(() => expect(m.putEventActual).toHaveBeenCalledWith('p1', temple!.event_id, {
      status: 'visited', actual_start_at: s.actual_start_at, actual_end_at: s.actual_end_at, source: 'suggested', note: null,
    }, undefined));
    expect(within(card(/15:00 美術館/)).getByText(/記録の日時から/)).toBeInTheDocument();
  });

  it('記録済みの実績・予定との差・指標を表示し、数値は隠せる(端末に覚える)', async () => {
    m.getJourney.mockResolvedValue(recorded);
    renderPage();
    const metrics = await screen.findByRole('region', { name: '達成指標' });
    expect(within(metrics).getByText('計画達成率').nextSibling).toHaveTextContent('33%');
    expect(within(metrics).getByText('写真付き訪問率').nextSibling).toHaveTextContent('0%');
    const t = card(/10:00 清水寺/);
    expect(within(t).getByTestId('actual-status')).toHaveTextContent('行った');
    expect(within(t).getByText('予定より20分遅れ')).toBeInTheDocument();
    expect(within(t).getByText(/到着 10:20・出発 11:15\(提案から\)/)).toBeInTheDocument();
    fireEvent.click(within(metrics).getByRole('button', { name: '数値を隠す' }));
    expect(within(metrics).getByText('数値は隠しています。')).toBeInTheDocument();
    expect(localStorage.getItem('tc_journey_hide_metrics')).toBe('1');
  });

  it('到着・出発を日程のタイムゾーンで入力して保存する(変更は実績のrevisionを送る)', async () => {
    m.getJourney.mockResolvedValue(recorded);
    renderPage();
    await screen.findByRole('region', { name: '2026-11-01' });
    const t = card(/10:00 清水寺/);
    fireEvent.change(within(t).getByLabelText('到着'), { target: { value: '10:05' } });
    fireEvent.change(within(t).getByLabelText('出発'), { target: { value: '09:00' } });
    fireEvent.click(within(t).getByRole('button', { name: '時刻を保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('出発は到着より後に');
    fireEvent.change(within(t).getByLabelText('出発'), { target: { value: '11:30' } });
    fireEvent.click(within(t).getByRole('button', { name: '時刻を保存' }));
    await waitFor(() => expect(m.putEventActual).toHaveBeenCalledWith('p1', temple!.event_id, {
      status: 'visited', actual_start_at: '2026-11-01T01:05:00.000Z', actual_end_at: '2026-11-01T02:30:00.000Z', note: null,
    }, temple!.actual!.revision));
  });

  it('行かなかった予定を別の旅行の日へ戻す', async () => {
    m.getJourney.mockResolvedValue(recorded);
    m.getPlans.mockResolvedValue({ success: true, data: [{ id: 'p1', title: '今の旅行' }, { id: 'p2', title: '次の京都' }] });
    m.getPlanDetail.mockResolvedValue({ success: true, data: { id: 'p2', title: '次の京都', revision: 1, days: [
      { id: 'd2', local_date: '2027-04-01', timezone_id: 'Asia/Tokyo', sort_order: 0 }] } });
    m.carryOverEvent.mockResolvedValue(fx.event_carry_over);
    renderPage();
    await screen.findByRole('region', { name: '2026-11-01' });
    const l = card(/12:00 昼食/);
    expect(within(l).getByTestId('actual-status')).toHaveTextContent('行かなかった');
    expect(within(card(/10:00 清水寺/)).queryByRole('button', { name: '次の旅行の候補に戻す' })).toBeNull();
    fireEvent.click(within(l).getByRole('button', { name: '次の旅行の候補に戻す' }));
    const select = await within(l).findByLabelText('旅行');
    expect(within(select).queryByText('今の旅行')).toBeNull(); // 同じ旅行は選べない
    fireEvent.change(select, { target: { value: 'p2' } });
    await waitFor(() => expect(within(l).getByLabelText('日')).toHaveValue('d2'));
    fireEvent.click(within(l).getByRole('button', { name: '戻す' }));
    await waitFor(() => expect(m.carryOverEvent).toHaveBeenCalledWith('p1', lunch!.event_id, 'p2', 'd2'));
    expect(await screen.findByText(/次の旅行に予定として戻しました/)).toBeInTheDocument();
    expect(museum!.actual).toBeNull();
  });

  it('閲覧者には記録の操作を出さない', async () => {
    m.getJourney.mockResolvedValue({ ...recorded, can_edit: false });
    renderPage();
    await screen.findByRole('region', { name: '2026-11-01' });
    expect(screen.queryByRole('button', { name: '行った' })).toBeNull();
    expect(screen.queryByRole('button', { name: '提案を使う' })).toBeNull();
  });
});
