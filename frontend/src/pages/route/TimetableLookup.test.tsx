/** [Gate Remaining-2] 時刻表から探す(鍵が無い時は手入力の案内・候補を欄へ入れる) */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const m = vi.hoisted(() => ({ searchTimetable: vi.fn() }));
vi.mock('@/services/api/remaining2', () => ({ searchTimetable: m.searchTimetable }));

import TimetableLookup from './TimetableLookup';

beforeEach(() => m.searchTimetable.mockReset());

describe('TimetableLookup', () => {
  it('提供元が未設定なら手入力の案内', async () => {
    m.searchTimetable.mockResolvedValue({ configured: false, available: false, candidates: [], source: '駅すぱあと',
      message: '時刻表の提供元が未設定です。区間・時刻・運賃を手で入れてください' });
    render(<TimetableLookup planId="p" origin="東京" destination="新大阪" date="2026-11-20" onPick={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '時刻表から探す' }));
    expect(await screen.findByText(/提供元が未設定/)).toBeInTheDocument();
    expect(m.searchTimetable).toHaveBeenCalledWith('p', { origin: '東京', destination: '新大阪', date: '2026-11-20', time: '09:00' });
  });

  it('候補を選ぶと渡す', async () => {
    const cand = { total_duration_minutes: 155, transfer_count: 0, total_cost: 14720, currency: 'JPY', walking_minutes: 5,
      source: '駅すぱあと', legs: [{ mode: 'shinkansen', line: 'のぞみ1号', from_label: '東京', to_label: '新大阪',
        departure_at: '2026-11-20T09:00:00+09:00', arrival_at: '2026-11-20T11:30:00+09:00', duration_minutes: 150 }] };
    m.searchTimetable.mockResolvedValue({ configured: true, available: true, candidates: [cand], source: '駅すぱあと',
      message: null });
    const onPick = vi.fn();
    render(<TimetableLookup planId="p" origin="東京" destination="新大阪" date="2026-11-20" onPick={onPick} />);
    fireEvent.click(screen.getByRole('button', { name: '時刻表から探す' }));
    expect(await screen.findByText(/09:00 → 11:30 ・ 155分 ・ 乗り換え0回/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'この候補を入れる' }));
    expect(onPick).toHaveBeenCalledWith(cand);
  });
});
