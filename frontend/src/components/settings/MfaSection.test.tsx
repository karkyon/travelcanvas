/** [Gate S11] 設定 → セキュリティ「多要素認証」。 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';

const m = vi.hoisted(() => ({
  getMfaStatus: vi.fn(), setupMfa: vi.fn(), enableMfa: vi.fn(), disableMfa: vi.fn(), regenerateRecoveryCodes: vi.fn(),
}));

vi.mock('@/services/api', () => ({
  api: m,
  AuthApiError: class AuthApiError extends Error {},
}));

import MfaSection from './MfaSection';

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.getMfaStatus.mockResolvedValue(fx.mfa_status_disabled);
});

describe('MfaSection (Gate S11)', () => {
  it('設定: パスワード → QR と手入力用のキー → 確認コード → 回復コードを1回だけ表示', async () => {
    m.setupMfa.mockResolvedValue(fx.mfa_setup);
    m.enableMfa.mockResolvedValue(fx.mfa_recovery_codes);
    render(<MfaSection />);
    expect(await screen.findByTestId('mfa-state')).toHaveTextContent('未設定');
    await userEvent.click(screen.getByRole('button', { name: '多要素認証を設定する' }));
    await userEvent.type(screen.getByLabelText('確認のため、現在のパスワードを入力してください'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: '次へ' }));
    expect(m.setupMfa).toHaveBeenCalledWith('pw');
    expect(await screen.findByTestId('mfa-secret')).toHaveTextContent('JBSW Y3DP');
    expect(await screen.findByRole('img', { name: '認証アプリに登録する QR コード' })).toBeInTheDocument();

    m.getMfaStatus.mockResolvedValue(fx.mfa_status_enabled);
    await userEvent.type(screen.getByLabelText('確認コード(6桁)'), '123456');
    await userEvent.click(screen.getByRole('button', { name: '有効にする' }));
    expect(m.enableMfa).toHaveBeenCalledWith('123456');
    const list = await screen.findByTestId('mfa-recovery-codes');
    expect(list.querySelectorAll('li')).toHaveLength(10);
    expect(screen.queryByTestId('mfa-secret')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '保存しました' }));
    expect(screen.queryByTestId('mfa-recovery-codes')).toBeNull();
    expect(screen.getByTestId('mfa-state')).toHaveTextContent('有効');
  });

  it('無効化にはパスワードと確認コードが要る。失敗は読み上げる', async () => {
    m.getMfaStatus.mockResolvedValue(fx.mfa_status_enabled);
    m.disableMfa.mockRejectedValueOnce(new Error('確認コードが正しくないか、すでに使われています'));
    render(<MfaSection />);
    await userEvent.click(await screen.findByRole('button', { name: '多要素認証を無効にする' }));
    await userEvent.type(screen.getByLabelText('現在のパスワード'), 'pw');
    await userEvent.type(screen.getByLabelText('確認コード(または回復コード)'), '000000');
    await userEvent.click(screen.getByRole('button', { name: '無効にする' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('確認コードが正しくない');
    expect(m.disableMfa).toHaveBeenCalledWith('pw', '000000');
  });

  it('管理者で未設定なら、設定が必要なことを示す', async () => {
    m.getMfaStatus.mockResolvedValue({ ...fx.mfa_status_disabled, is_admin: true, required: true });
    render(<MfaSection />);
    expect(await screen.findByRole('status')).toHaveTextContent('管理者のアカウントです');
  });
});
