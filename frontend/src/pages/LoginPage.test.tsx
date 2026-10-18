/** [Gate S11] ログイン画面の2段目(認証アプリの確認コード)。 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));

import LoginPage from './LoginPage';

beforeEach(() => {
  useAuthStore.setState({ isLoading: false, error: null, pendingMfa: null, isAuthenticated: false });
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard" element={<p>ダッシュボード</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('LoginPage 多要素認証 (Gate S11)', () => {
  it('パスワードの後に確認コードを求め、通ればダッシュボードへ', async () => {
    const login = vi.fn(async () => {
      useAuthStore.setState({ pendingMfa: { token: 't', expiresAt: Date.now() + 60_000 } });
      return 'mfa' as const;
    });
    const verifyMfa = vi.fn(async () => undefined);
    useAuthStore.setState({ login, verifyMfa });
    renderPage();
    await userEvent.type(screen.getByLabelText('Email'), 'a@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'secret-pass');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    const codeInput = await screen.findByLabelText('確認コード');
    expect(codeInput).toHaveAttribute('autocomplete', 'one-time-code');
    expect(screen.queryByLabelText('Password')).toBeNull();
    await userEvent.type(codeInput, '123456');
    await userEvent.click(screen.getByRole('button', { name: '確認してログイン' }));
    expect(verifyMfa).toHaveBeenCalledWith('123456');
    expect(await screen.findByText('ダッシュボード')).toBeInTheDocument();
  });

  it('別のアカウントでログインし直せる', async () => {
    useAuthStore.setState({ pendingMfa: { token: 't', expiresAt: Date.now() + 60_000 } });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: '別のアカウントでログインする' }));
    expect(await screen.findByLabelText('Password')).toBeInTheDocument();
  });
});
