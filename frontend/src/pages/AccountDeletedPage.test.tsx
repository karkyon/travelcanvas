/**
 * [Gate P9] AccountDeletedPage: 端末のオフラインデータを消し、通信せずにログイン状態を消す。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const m = vi.hoisted(() => ({ clearAllOfflinePacks: vi.fn(), clearLocalSession: vi.fn(), logout: vi.fn() }));
vi.mock('@/utils/offlinePack', () => ({ clearAllOfflinePacks: m.clearAllOfflinePacks }));
const order = vi.hoisted(() => [] as string[]);
vi.mock('@/services/api', () => ({ api: { suppressAuthRedirect: (on?: boolean) => order.push(`suppress:${String(on)}`) } }));
vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: { clearLocalSession: () => void; logout: () => void }) => unknown) =>
    sel({ clearLocalSession: m.clearLocalSession, logout: m.logout }),
}));

import AccountDeletedPage from './AccountDeletedPage';

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  order.length = 0;
  m.clearLocalSession.mockImplementation(() => { order.push('clear'); });
});

describe('AccountDeletedPage (Gate P9)', () => {
  it('ログイン状態を消し、オフラインデータを消す(サーバーのログアウトは呼ばない)', async () => {
    m.clearAllOfflinePacks.mockResolvedValue(undefined);
    render(<MemoryRouter><AccountDeletedPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'アカウントを削除しました' })).toBeInTheDocument();
    expect(await screen.findByText('この端末に保存したオフラインデータも消しました。')).toBeInTheDocument();
    await waitFor(() => expect(m.clearLocalSession).toHaveBeenCalledTimes(1));
    expect(m.logout).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'トップページへ' })).toHaveAttribute('href', '/');
  });

  it('[Gate G10-Q] ログイン状態はオフラインデータの消去を待たずに最初に消す(失効したトークンで要求を送らない)', () => {
    m.clearAllOfflinePacks.mockReturnValue(new Promise(() => undefined)); // 消去が終わらない
    render(<MemoryRouter><AccountDeletedPage /></MemoryRouter>);
    expect(m.clearLocalSession).toHaveBeenCalledTimes(1);
    // ログイン状態を消して定期の取得が止まってから、/login への強制の移動を戻す
    expect(order).toEqual(['clear', 'suppress:false']);
    expect(screen.getByText('この端末に保存したオフラインデータを消しています…')).toBeInTheDocument();
  });

  it('オフラインデータを消せなくても、ログイン状態は消して案内する', async () => {
    m.clearAllOfflinePacks.mockRejectedValue(new Error('blocked'));
    render(<MemoryRouter><AccountDeletedPage /></MemoryRouter>);
    expect(await screen.findByText(/ブラウザのサイトデータを削除してください/)).toBeInTheDocument();
    await waitFor(() => expect(m.clearLocalSession).toHaveBeenCalledTimes(1));
  });
});
