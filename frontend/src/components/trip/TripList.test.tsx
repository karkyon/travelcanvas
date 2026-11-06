/** [Gate TripsWish] 旅行の一覧のカード: 日程(出発日・最終日・泊数)・人数・メンバー・予定と写真の数・備考、状態の切り替え。 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import fx from '@/services/api/__fixtures__/g9Responses.json';
import { decodeDashboard } from '@/services/api/decodersG9';

const g9 = vi.hoisted(() => ({ getDashboard: vi.fn() }));
vi.mock('@/services/api/g9', () => ({ getDashboard: g9.getDashboard }));

import TripList from './TripList';
import { dateWithDay, partySize, stayLabel } from './tripListModel';
import type { TravelPlan } from '@/types';

const base = fx.dashboard_upcoming;
const up = base.trips[0]!;
const plans = [
  { id: up.id, title: up.title, destination: '京都', start_date: up.start_date, end_date: up.end_date,
    description: '紅葉を見て、湯豆腐を食べる', preferences: { party_size: 3 } },
  { id: 'p-2', title: '日付のない旅', destination: null, start_date: null, end_date: null, description: null },
] as unknown as TravelPlan[];

beforeEach(() => {
  g9.getDashboard.mockReset();
  g9.getDashboard.mockResolvedValue(decodeDashboard({ ...base, trips: [{ ...up, shelf: 'planning', event_count: 4, photo_count: 2 }] }));
});

describe('tripListModel', () => {
  it('曜日つきの日付・泊数・人数', () => {
    expect(dateWithDay('2026-11-04')).toBe('2026/11/4(水)');
    expect(stayLabel(1)).toBe('日帰り');
    expect(stayLabel(3)).toBe('2泊3日');
    expect(stayLabel(null)).toBeNull();
    expect(partySize({ preferences: { party_size: 2 } } as unknown as TravelPlan)).toBe(2);
    expect(partySize({} as TravelPlan)).toBeNull();
  });
});

describe('TripList', () => {
  it('カードに日程・泊数・人数・メンバー・予定・写真・備考を出す', async () => {
    render(<TripList plans={plans} onOpen={vi.fn()} onClone={vi.fn()} onDelete={vi.fn()} cloningId={null} />);
    const card = await screen.findByRole('listitem', { name: up.title });
    await within(card).findByText('予定 4');
    expect(card).toHaveTextContent('2026/11/4(水)');
    expect(card).toHaveTextContent('2026/11/5(木)');
    expect(card).toHaveTextContent('1泊2日');
    expect(card).toHaveTextContent('3人');
    expect(card).toHaveTextContent('メンバー 1');
    expect(card).toHaveTextContent('写真 2');
    expect(card).toHaveTextContent('紅葉を見て、湯豆腐を食べる');
    const other = screen.getByRole('listitem', { name: '日付のない旅' });
    expect(other).toHaveTextContent('日付は未定');
    expect(other).toHaveTextContent('人数 未入力');
    expect(screen.getByTestId('trip-list-kpis')).toHaveTextContent('旅行2');
  });

  it('状態で切り替え、開く・複製・削除を呼ぶ', async () => {
    const onOpen = vi.fn(); const onClone = vi.fn(); const onDelete = vi.fn();
    render(<TripList plans={plans} onOpen={onOpen} onClone={onClone} onDelete={onDelete} cloningId={null} />);
    await screen.findByText('予定 4');
    fireEvent.click(screen.getByTestId('trip-tab-visited'));
    expect(screen.getByRole('status')).toHaveTextContent('この状態の旅行はありません');
    fireEvent.click(screen.getByTestId('trip-tab-planning'));
    expect(screen.getAllByRole('listitem', { name: up.title })).toHaveLength(1);
    expect(screen.queryByRole('listitem', { name: '日付のない旅' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: `「${up.title}」の旅程を開く` }));
    fireEvent.click(screen.getByRole('button', { name: `「${up.title}」を複製` }));
    fireEvent.click(screen.getByRole('button', { name: `「${up.title}」を削除` }));
    expect(onOpen).toHaveBeenCalledWith(up.id);
    expect(onClone).toHaveBeenCalledWith(up.id, up.title);
    expect(onDelete).toHaveBeenCalledWith(up.id);
  });

  it('集約を読めない時も旅行の一覧の値で出す', async () => {
    g9.getDashboard.mockRejectedValue(new Error('500'));
    render(<TripList plans={plans} onOpen={vi.fn()} onClone={vi.fn()} onDelete={vi.fn()} cloningId={null} />);
    const card = await screen.findByRole('listitem', { name: up.title });
    expect(card).toHaveTextContent('2026/11/4(水)');
    expect(card).toHaveTextContent('3人');
  });
});
