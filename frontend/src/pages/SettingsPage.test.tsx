/**
 * [Gate S9] 設定画面の回帰試験。
 *
 * 以前は各タブを「描画のたびに作り直す部品(SettingsPage の中で定義した関数コンポーネント)」として
 * <ActiveTabComponent /> で描画していたため、入力のたびに親の状態が変わるとタブ全体が作り直され、
 * パスワード欄などは1文字ごとにフォーカスが外れて続けて入力できなかった(貼り付けや自動入力でしか入れられない)。
 * セキュリティのタブに「ログイン中の端末」を置いたため、作り直しのたびに一覧を読み直す問題も起きる。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const { getSessions, getCurrentUser } = vi.hoisted(() => ({
  getSessions: vi.fn(),
  getCurrentUser: vi.fn(),
}));

vi.mock('@/services/api', () => ({
  api: {
    getSessions, getCurrentUser, revokeSession: vi.fn(), updateProfile: vi.fn(), changePassword: vi.fn(),
    setGuestMode: vi.fn(), setMemberSession: vi.fn(), setAccessToken: vi.fn(), clearAccessToken: vi.fn(),
  },
  getOfflinePackKey: vi.fn(),
  rotateOfflinePackKey: vi.fn(),
}));
vi.mock('@/utils/offlinePack', () => ({
  listOfflinePacks: vi.fn(async () => []), deleteOfflinePack: vi.fn(), clearAllOfflinePacks: vi.fn(),
}));

import SettingsPage from './SettingsPage';

beforeEach(() => {
  getCurrentUser.mockResolvedValue({ data: { preferences: {} } });
  getSessions.mockReset();
  getSessions.mockResolvedValue([{
    id: 's1', device_label: 'Chrome / Windows', network_label: '203.0.113.x', ip_address: null,
    created_at: '2026-10-18T01:00:00+00:00', last_active_at: '2026-10-18T01:00:00+00:00',
    expires_at: '2026-11-18T01:00:00+00:00', is_current: true,
  }]);
});

function renderPage() {
  return render(<MemoryRouter><SettingsPage /></MemoryRouter>);
}

describe('SettingsPage (Gate S9)', () => {
  it('パスワード欄に続けて入力できる(1文字ごとにフォーカスが外れない)', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'セキュリティ' }));
    const field = screen.getByLabelText('現在のパスワード');
    await userEvent.type(field, 'abc123!');
    expect(screen.getByLabelText('現在のパスワード')).toHaveValue('abc123!');
    await userEvent.type(screen.getByLabelText('新しいパスワード'), 'Longer-Pass-9');
    expect(screen.getByLabelText('新しいパスワード')).toHaveValue('Longer-Pass-9');
    expect(screen.getByLabelText('新しいパスワード（確認）')).toHaveValue('');
  });

  it('セキュリティのタブにログイン中の端末を出し、入力しても読み直さない', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'セキュリティ' }));
    expect(await screen.findByRole('list', { name: 'ログイン中の端末' })).toHaveTextContent('Chrome / Windows');
    await userEvent.type(screen.getByLabelText('現在のパスワード'), 'abcdef');
    expect(getSessions).toHaveBeenCalledTimes(1);
  });
});
