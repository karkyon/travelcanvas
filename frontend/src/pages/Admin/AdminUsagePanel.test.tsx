/** [Gate G5] BILL-02 管理者の使用量の確認と上限の上書き。 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { UsageSummary } from '@/services/api/types/g5';

const g5 = vi.hoisted(() => ({ adminGetUsage: vi.fn(), adminOverrideUsage: vi.fn() }));
vi.mock('@/services/api/g5', () => ({ ...g5 }));

import AdminUsagePanel from './AdminUsagePanel';

const ID = '7d3f6c1e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
const summary: UsageSummary = { subject_type: 'user', subject_id: ID, period: '2026-10', metrics: [
  { metric: 'imports', label: '取込', used: 300, limit: 300, soft_limit: 240, remaining: 0, warning: true, exceeded: true,
    overridden: false, override_reason: null }] };

beforeEach(() => {
  g5.adminGetUsage.mockReset().mockResolvedValue(summary);
  g5.adminOverrideUsage.mockReset();
});

describe('AdminUsagePanel (Gate G5)', () => {
  it('ID で使用量を見て、理由つきで上限を上書きする・既定に戻す', async () => {
    render(<AdminUsagePanel />);
    const look = screen.getByRole('button', { name: '使用量を見る' });
    expect(look).toBeDisabled();
    fireEvent.change(screen.getByLabelText('ID'), { target: { value: ID } });
    fireEvent.click(look);
    await waitFor(() => expect(g5.adminGetUsage).toHaveBeenCalledWith('user', ID));
    expect(await screen.findByText(/上限に達しました/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('指標'), { target: { value: 'imports' } });
    fireEvent.change(screen.getByLabelText('今月の上限(空欄は既定)'), { target: { value: '500' } });
    const save = screen.getByRole('button', { name: '上限を保存' });
    expect(save).toBeDisabled(); // 理由が無い
    g5.adminOverrideUsage.mockResolvedValue({ ...summary, metrics: [{ ...summary.metrics[0]!, limit: 500, exceeded: false,
      warning: false, overridden: true, override_reason: '団体' }] });
    fireEvent.change(screen.getByLabelText('理由'), { target: { value: '団体' } });
    fireEvent.click(save);
    await waitFor(() => expect(g5.adminOverrideUsage).toHaveBeenCalledWith({
      subject_type: 'user', subject_id: ID, metric: 'imports', limit: 500, reason: '団体' }));
    expect(await screen.findByRole('status')).toHaveTextContent('今月の上限を上書きしました');
    g5.adminOverrideUsage.mockResolvedValue(summary);
    fireEvent.change(screen.getByLabelText('今月の上限(空欄は既定)'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('理由'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '上限を保存' }));
    await waitFor(() => expect(g5.adminOverrideUsage).toHaveBeenLastCalledWith({
      subject_type: 'user', subject_id: ID, metric: 'imports', limit: null }));
  });

  it('失敗したら理由を出す', async () => {
    g5.adminGetUsage.mockRejectedValue({ response: { data: { detail: '管理者の確認が必要です' } } });
    render(<AdminUsagePanel />);
    fireEvent.change(screen.getByLabelText('ID'), { target: { value: ID } });
    fireEvent.click(screen.getByRole('button', { name: '使用量を見る' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('管理者の確認が必要です');
  });
});
