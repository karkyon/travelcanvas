/** [Gate G4] FC-097 濫用への対応の画面。 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const m = vi.hoisted(() => ({ getAbuseReports: vi.fn(), actOnAbuseReport: vi.fn() }));
vi.mock('@/services/api/g4', () => ({ ...m }));

import AdminAbuse from './AdminAbuse';

const report = (over: Record<string, unknown> = {}) => ({
  id: 'r1', source: 'report', reason: 'phishing', reason_label: '詐欺・なりすまし', note: 'ログインを求める', status: 'open',
  resolution: null, created_at: '2026-10-22T00:00:00Z', handled_at: null,
  plan: { id: 'p1', title: '京都', owner_user_id: '0123456789abcdef' },
  share: { id: 's1', token_prefix: 'abcd1234', plan_id: 'p1', revoked_at: null, revoked_reason: null, is_active: true,
    use_count: 3, has_passcode: false, accesses_24h: 12 },
  ...over,
});

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  window.confirm = vi.fn(() => true);
});

describe('AdminAbuse (Gate G4)', () => {
  it('未対応の通報を示し、共有を止める・絞り込みを変える', async () => {
    m.getAbuseReports.mockResolvedValue({ counts: { open: 1, dismissed: 0, actioned: 2 }, reports: [report()] });
    m.actOnAbuseReport.mockResolvedValue(undefined);
    render(<MemoryRouter><AdminAbuse /></MemoryRouter>);
    // 通報の一覧は取得の結果が入ってから見る(負荷の高い機械では、一覧の枠が先に出て中身が後から入ることがある)
    await screen.findByText(/24時間の閲覧 12回/, {}, { timeout: 5000 });
    const list = screen.getByRole('list', { name: '通報' });
    expect(list).toHaveTextContent('詐欺・なりすまし');
    expect(list).toHaveTextContent('24時間の閲覧 12回');
    expect(m.getAbuseReports).toHaveBeenCalledWith('open');
    fireEvent.change(within(list).getByLabelText('対応のメモ'), { target: { value: 'なりすましを確認' } });
    fireEvent.click(within(list).getByRole('button', { name: '共有を止める' }));
    await waitFor(() => expect(m.actOnAbuseReport).toHaveBeenCalledWith('r1', 'revoke_share', 'なりすましを確認'));
    expect(await screen.findByRole('status')).toHaveTextContent('共有を止めました');
    fireEvent.click(screen.getByRole('button', { name: /対応済み/ }));
    await waitFor(() => expect(m.getAbuseReports).toHaveBeenLastCalledWith('actioned'));
  });

  it('自動で止めた共有は戻せる', async () => {
    m.getAbuseReports.mockResolvedValue({ counts: { open: 1, dismissed: 0, actioned: 0 }, reports: [report({
      share: { ...report().share, is_active: false, revoked_reason: 'abuse_auto', revoked_at: '2026-10-22T00:00:00Z' } })] });
    m.actOnAbuseReport.mockResolvedValue(undefined);
    render(<MemoryRouter><AdminAbuse /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: '共有を戻す' }));
    await waitFor(() => expect(m.actOnAbuseReport).toHaveBeenCalledWith('r1', 'restore_share', undefined));
  });
});
