/** [Gate G4] COL-03 通知の設定・まとめ・旅行ごとの設定。 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const m = vi.hoisted(() => ({
  getNotificationSettings: vi.fn(), getNotificationDigest: vi.fn(), putNotificationSettings: vi.fn(),
  deletePlanNotificationLevel: vi.fn(), putPlanNotificationLevel: vi.fn(),
}));
vi.mock('@/services/api/g4', () => ({ ...m }));

import NotificationSettingsPanel from './NotificationSettingsPanel';
import PlanNotificationLevel from './PlanNotificationLevel';

const prefs = { level: 'all', email_digest: 'off', email_available: false, has_email: true,
  plans: [{ plan_id: 'p1', plan_title: '京都', level: 'none' }] };

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.getNotificationSettings.mockResolvedValue(prefs);
  m.getNotificationDigest.mockResolvedValue({ total: 3, groups: [{ plan_id: 'p1', plan_title: '京都', total: 3, latest_at: null, types: [] }] });
});

describe('通知の設定 (Gate G4)', () => {
  it('量を変えて保存し、メールが使えない環境では選ばせない。まとめを示す', async () => {
    m.putNotificationSettings.mockResolvedValue({ ...prefs, level: 'mentions' });
    m.deletePlanNotificationLevel.mockResolvedValue({ ...prefs, plans: [] });
    render(<NotificationSettingsPanel />);
    fireEvent.click(await screen.findByLabelText(/自分あてだけ/));
    await waitFor(() => expect(m.putNotificationSettings).toHaveBeenCalledWith({ level: 'mentions' }));
    expect(screen.getByLabelText('毎日まとめて送る')).toBeDisabled();
    expect(screen.getByText('この環境ではメールを送れません(管理者の設定が必要です)。')).toBeInTheDocument();
    expect(screen.getByLabelText('読んでいない通知のまとめ')).toHaveTextContent('京都: 3 件');
    fireEvent.click(screen.getByRole('button', { name: '京都の設定を外す' }));
    await waitFor(() => expect(m.deletePlanNotificationLevel).toHaveBeenCalledWith('p1'));
  });

  it('旅行ごとの設定は押した時だけ読み、変える', async () => {
    m.putPlanNotificationLevel.mockResolvedValue(prefs);
    render(<PlanNotificationLevel planId="p1" />);
    expect(m.getNotificationSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'この旅行の通知を設定' }));
    const select = await screen.findByLabelText('この旅行の通知');
    expect(select).toHaveValue('none');
    fireEvent.change(select, { target: { value: 'mentions' } });
    await waitFor(() => expect(m.putPlanNotificationLevel).toHaveBeenCalledWith('p1', 'mentions'));
  });
});
