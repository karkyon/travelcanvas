/**
 * [Gate Remaining-6] FR-003 パスワードを忘れた時・新しいパスワード・メールの確認の画面。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const m = vi.hoisted(() => ({
  requestPasswordReset: vi.fn(), resetPassword: vi.fn(), requestEmailVerification: vi.fn(), verifyEmail: vi.fn(),
}));
vi.mock('@/services/api/accountRecovery', () => m);

import ForgotPasswordPage from './ForgotPasswordPage';
import VerifyEmailPage from './VerifyEmailPage';
import EmailVerifySection from '@/components/settings/EmailVerifySection';
import { useAuthStore } from '@/store/authStore';

function at(path: string, el: React.ReactElement, route: string) {
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path={route} element={el} /><Route path="/login" element={<p>login-page</p>} />
  </Routes></MemoryRouter>);
}

beforeEach(() => { Object.values(m).forEach((f) => f.mockReset()); });

describe('ForgotPasswordPage', () => {
  it('メールを送ると、登録の有無に関わらず同じ案内を出す', async () => {
    m.requestPasswordReset.mockResolvedValue({ email_available: true, message: '登録があれば送りました' });
    at('/forgot-password', <ForgotPasswordPage />, '/forgot-password');
    fireEvent.change(screen.getByLabelText('メール'), { target: { value: ' a@example.com ' } });
    fireEvent.click(screen.getByRole('button', { name: 'リンクを送る' }));
    expect(await screen.findByRole('status')).toHaveTextContent('登録があれば送りました');
    expect(m.requestPasswordReset).toHaveBeenCalledWith('a@example.com');
  });

  it('token がある時は新しいパスワードを決める。2 つが違うと送らない', async () => {
    m.resetPassword.mockResolvedValue({ message: '変えました' });
    at('/reset-password?token=tk', <ForgotPasswordPage />, '/reset-password');
    fireEvent.change(screen.getByLabelText('新しいパスワード'), { target: { value: 'Abcdef12!x' } });
    fireEvent.change(screen.getByLabelText('もう一度'), { target: { value: 'other' } });
    fireEvent.click(screen.getByRole('button', { name: 'パスワードを変える' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('違います');
    expect(m.resetPassword).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('もう一度'), { target: { value: 'Abcdef12!x' } });
    fireEvent.click(screen.getByRole('button', { name: 'パスワードを変える' }));
    expect(await screen.findByRole('status')).toHaveTextContent('変えました');
    expect(m.resetPassword).toHaveBeenCalledWith('tk', 'Abcdef12!x');
    fireEvent.click(screen.getByRole('button', { name: 'ログインへ' }));
    expect(await screen.findByText('login-page')).toBeInTheDocument();
  });

  it('期限切れ等のエラーをそのまま知らせる', async () => {
    m.resetPassword.mockRejectedValue({ response: { status: 400, data: { detail: 'リンクの期限が切れています' } } });
    at('/reset-password?token=tk', <ForgotPasswordPage />, '/reset-password');
    fireEvent.change(screen.getByLabelText('新しいパスワード'), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText('もう一度'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'パスワードを変える' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('VerifyEmailPage', () => {
  it('開くと 1 回だけ確かめて結果を出す', async () => {
    m.verifyEmail.mockResolvedValue({ verified: true, message: '確認しました' });
    at('/verify-email?token=vt', <VerifyEmailPage />, '/verify-email');
    expect(await screen.findByText('確認しました')).toBeInTheDocument();
    expect(m.verifyEmail).toHaveBeenCalledTimes(1);
    expect(m.verifyEmail).toHaveBeenCalledWith('vt');
  });

  it('token が無い時は送らずに知らせる', async () => {
    at('/verify-email', <VerifyEmailPage />, '/verify-email');
    expect(await screen.findByRole('alert')).toHaveTextContent('リンクが正しくありません');
    expect(m.verifyEmail).not.toHaveBeenCalled();
  });
});

describe('EmailVerifySection', () => {
  it('未確認なら送るボタン。既に確認済みと返ると表示が変わる', async () => {
    useAuthStore.setState({ user: { id: 'u', email: 'a@example.com', username: 'a', is_verified: false } as never });
    m.requestEmailVerification.mockResolvedValue({ accepted: false, verified: true, email_available: true, message: '確認済みです' });
    render(<EmailVerifySection />);
    expect(screen.getByText(/まだ確認されていません/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '確認のメールを送る' }));
    await waitFor(() => expect(screen.getByText(/は確認済みです/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: '確認のメールを送る' })).toBeNull();
  });
});
