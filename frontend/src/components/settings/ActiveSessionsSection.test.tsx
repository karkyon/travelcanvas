/**
 * [Gate S9] ログイン中の端末の一覧と、ほかの端末のログアウト。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ActiveSession } from '@/services/api';

const { getSessions, revokeSession } = vi.hoisted(() => ({ getSessions: vi.fn(), revokeSession: vi.fn() }));
vi.mock('@/services/api', () => ({ api: { getSessions, revokeSession } }));

import ActiveSessionsSection from './ActiveSessionsSection';

const current: ActiveSession = {
  id: 's-current', device_label: 'Chrome / Windows', network_label: '203.0.113.x', ip_address: '203.0.113.5',
  created_at: '2026-10-18T01:00:00+00:00', last_active_at: '2026-10-18T02:00:00+00:00',
  expires_at: '2026-11-17T01:00:00+00:00', is_current: true,
};
const other: ActiveSession = {
  ...current, id: 's-other', device_label: 'Firefox / Linux', network_label: '198.51.100.x', is_current: false,
};
const third: ActiveSession = { ...other, id: 's-third', device_label: 'Safari / iPhone' };

beforeEach(() => {
  getSessions.mockReset();
  revokeSession.mockReset();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('ActiveSessionsSection (Gate S9)', () => {
  it('端末・丸めた接続元・この端末の印を出し、この端末にはログアウトのボタンを出さない', async () => {
    getSessions.mockResolvedValue([current, other]);
    render(<ActiveSessionsSection />);
    const list = await screen.findByRole('list', { name: 'ログイン中の端末' });
    expect(list).toHaveTextContent('Chrome / Windows');
    expect(list).toHaveTextContent('この端末');
    expect(list).toHaveTextContent('接続元 198.51.100.x');
    expect(list).not.toHaveTextContent('203.0.113.5');
    const buttons = screen.getAllByRole('button', { name: /をログアウトさせる$/ });
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName(expect.stringContaining('Firefox / Linux'));
  });

  it('ほかの端末をログアウトさせ、一覧を読み直す', async () => {
    getSessions.mockResolvedValueOnce([current, other]).mockResolvedValueOnce([current]);
    revokeSession.mockResolvedValue(undefined);
    render(<ActiveSessionsSection />);
    await userEvent.click(await screen.findByRole('button', { name: /Firefox \/ Linux.*をログアウトさせる/ }));
    expect(revokeSession).toHaveBeenCalledWith('s-other');
    expect(await screen.findByRole('status')).toHaveTextContent('「Firefox / Linux」をログアウトさせました');
    await waitFor(() => expect(screen.queryByText('Firefox / Linux')).not.toBeInTheDocument());
  });

  it('確認で取り消せば何もしない', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    getSessions.mockResolvedValue([current, other]);
    render(<ActiveSessionsSection />);
    await userEvent.click(await screen.findByRole('button', { name: /Firefox \/ Linux.*をログアウトさせる/ }));
    expect(revokeSession).not.toHaveBeenCalled();
  });

  it('この端末以外をすべてログアウトさせる(失敗した数を伝える)', async () => {
    getSessions.mockResolvedValueOnce([current, other, third]).mockResolvedValue([current, third]);
    revokeSession.mockImplementation(async (id: string) => {
      if (id === 's-third') throw new Error('x');
    });
    render(<ActiveSessionsSection />);
    await userEvent.click(await screen.findByRole('button', { name: 'この端末以外をすべてログアウト' }));
    expect(revokeSession.mock.calls.map((c) => c[0])).toEqual(['s-other', 's-third']);
    expect(await screen.findByRole('alert')).toHaveTextContent('1 台はログアウトさせられませんでした');
  });

  it('読み込めなければ再読み込みを案内する', async () => {
    getSessions.mockRejectedValueOnce(new Error('x')).mockResolvedValue([current]);
    render(<ActiveSessionsSection />);
    await userEvent.click(await screen.findByRole('button', { name: '再読み込み' }));
    expect(await screen.findByText('Chrome / Windows')).toBeInTheDocument();
  });
});
