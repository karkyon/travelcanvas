/** [Gate G5] BILL-02 設定 → 使用量。 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const g5 = vi.hoisted(() => ({ getMyUsage: vi.fn() }));
vi.mock('@/services/api/g5', () => ({ ...g5 }));

import UsageSection from './UsageSection';

describe('UsageSection (Gate G5)', () => {
  it('今月の使用量を示し、上限に達したものは止まることを示す', async () => {
    g5.getMyUsage.mockResolvedValue({ subject_type: 'user', subject_id: 'u', period: '2026-10', metrics: [
      { metric: 'share_links', label: '共有リンクの発行', used: 300, limit: 300, soft_limit: 240, remaining: 0,
        warning: true, exceeded: true, overridden: false, override_reason: null }] });
    render(<UsageSection />);
    expect(await screen.findByRole('heading', { name: '今月の使用量(2026-10)' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '共有リンクの発行の使用量' })).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByText(/上限に達しました/)).toBeInTheDocument();
  });

  it('取得できなければ案内する', async () => {
    g5.getMyUsage.mockRejectedValue(new Error('x'));
    render(<UsageSection />);
    expect(await screen.findByText(/使用量を取得できませんでした/)).toBeInTheDocument();
  });
});
