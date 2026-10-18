/** [Gate S11] 管理者の画面の前の多要素認証(SEC-06)。確認の前に管理者の画面を出さない。 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';

const m = vi.hoisted(() => ({ getMfaStatus: vi.fn(), stepUpMfa: vi.fn() }));
vi.mock('@/services/api', () => ({
  api: m,
  AuthApiError: class AuthApiError extends Error {},
}));

import AdminMfaGate from './AdminMfaGate';

const admin = { ...fx.mfa_status_enabled, is_admin: true, required: true };

function renderGate() {
  return render(<MemoryRouter><AdminMfaGate><p>管理者の画面</p></AdminMfaGate></MemoryRouter>);
}

beforeEach(() => {
  m.getMfaStatus.mockReset();
  m.stepUpMfa.mockReset();
});

describe('AdminMfaGate (Gate S11)', () => {
  it('未設定なら設定への案内だけを出す', async () => {
    m.getMfaStatus.mockResolvedValue({ ...fx.mfa_status_disabled, is_admin: true, required: true });
    renderGate();
    expect(await screen.findByRole('link', { name: '多要素認証を設定する' })).toHaveAttribute('href', '/settings?tab=security');
    expect(screen.queryByText('管理者の画面')).toBeNull();
  });

  it('確認がまだなら確認コードを求め、通れば表示する', async () => {
    m.getMfaStatus.mockResolvedValue({ ...admin, session_verified: false });
    m.stepUpMfa.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(admin);
    renderGate();
    const input = await screen.findByLabelText('確認コード');
    expect(screen.queryByText('管理者の画面')).toBeNull();
    await userEvent.type(input, '000000');
    await userEvent.click(screen.getByRole('button', { name: '確認する' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('確認コード'), '123456');
    await userEvent.click(screen.getByRole('button', { name: '確認する' }));
    expect(await screen.findByText('管理者の画面')).toBeInTheDocument();
    expect(m.stepUpMfa).toHaveBeenLastCalledWith('123456');
  });

  it('確認済みならそのまま表示する', async () => {
    m.getMfaStatus.mockResolvedValue(admin);
    renderGate();
    expect(await screen.findByText('管理者の画面')).toBeInTheDocument();
  });
});
