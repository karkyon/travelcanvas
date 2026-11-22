/** [FR-062] 旅の記録の「また行きたい」: エリア・行った場所の ♡・行けなかった場所のまとめての移し(外す行を選べる) */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const m = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));
vi.mock('@/services/api/again', () => ({ getAgainCandidates: m.get, saveAgain: m.save }));

import AgainPanel from './AgainPanel';

const data = {
  areas: [{ key: 'ka', title: 'おかげ横丁', lat: 34.46, lng: 136.72, radius_m: 400, walked_min: 130, visited_count: 6, saved_spot_id: null }],
  places: [
    { key: 'k1', name: '内宮', genre: 'sightseeing', lat: 34.45, lng: 136.72, visited_at: '2026-11-28T04:31:00Z', photo_count: 3,
      thumb_memory_id: 'm1', saved_spot_id: null, saved_kind: null, sources: ['visit'] },
    { key: 'k2', name: '赤福 本店', genre: 'restaurant', lat: 34.46, lng: 136.72, visited_at: null, photo_count: 0,
      thumb_memory_id: null, saved_spot_id: 's2', saved_kind: 'again', sources: ['spot_mode'] },
  ],
  missed: [{ key: 'm1', candidate_id: 'c1', title: '伊勢うどん', lat: null, lng: null },
    { key: 'm2', candidate_id: 'c2', title: '夫婦岩', lat: null, lng: null }],
};

beforeEach(() => { m.get.mockReset().mockResolvedValue(data); m.save.mockReset().mockResolvedValue({ saved: [{ key: 'x', spot_id: 's' }], merged: [] }); });

describe('また行きたい (FR-062)', () => {
  it('エリアの文と、行った場所の ♡(残した場所は押した状態)', async () => {
    render(<AgainPanel planId="p1" />);
    expect(await screen.findByText(/おかげ横丁\(半径 400m\)/)).toBeTruthy();
    expect(screen.getByText(/自由に歩いた 2時間10分/)).toBeTruthy();
    expect(screen.getByText(/着いた 6 か所/)).toBeTruthy();
    const buttons = screen.getAllByRole('button', { name: /また行きたい/ });
    expect(buttons[0]!.getAttribute('aria-pressed')).toBe('false');
    expect(buttons[1]!.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/写真 3/)).toBeTruthy();
    fireEvent.click(buttons[0]!);
    await waitFor(() => expect(m.save).toHaveBeenCalledWith('p1', [{ key: 'k1', kind: 'place', wish_kind: 'again' }]));
    fireEvent.click(screen.getByRole('button', { name: 'エリアを残す' }));
    await waitFor(() => expect(m.save).toHaveBeenCalledWith('p1', [{ key: 'ka', kind: 'area', wish_kind: 'again' }]));
  });

  it('行けなかった場所をまとめて今度行きたいへ(外した行は送らない)', async () => {
    render(<AgainPanel planId="p1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'まとめて今度行きたいへ' }));
    const dlg = await screen.findByRole('dialog');
    fireEvent.click(within(dlg).getByLabelText('夫婦岩'));
    fireEvent.click(within(dlg).getByRole('button', { name: '1 件を移す' }));
    await waitFor(() => expect(m.save).toHaveBeenCalledWith('p1', [{ key: 'm1', kind: 'missed', wish_kind: 'next' }]));
  });
});
