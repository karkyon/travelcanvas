/**
 * [Gate G4] COL-05 ゲストの閲覧: 確認(使用回数を使わない)→ 開く → 一時トークンで最新を読み込む・複製 / FC-097 問題を報告。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const m = vi.hoisted(() => ({
  resolvePublicShare: vi.fn(), getShareInfo: vi.fn(), getShareView: vi.fn(), cloneShare: vi.fn(), reportShare: vi.fn(),
}));
vi.mock('../services/api', () => ({ resolvePublicShare: m.resolvePublicShare }));
vi.mock('../services/api/g4', () => ({
  getShareInfo: m.getShareInfo, getShareView: m.getShareView, cloneShare: m.cloneShare, reportShare: m.reportShare,
}));

import PublicSharePage from './PublicSharePage';

const explained = { always: ['旅行名', '予定名'], shown: [{ key: 'event_times', label: '予定の時刻' }],
  hidden: [{ key: 'event_notes', label: '予定のメモ' }], never: ['予約番号・PIN'] };
const view = { plan_id: 'p', title: '京都の旅', days: [{ date: '2026-11-03', title: null, events: [{ title: '清水寺', event_type: 'activity', local_start_time: '10:00', is_all_day: false }] }],
  permission: 'view', can_edit: false, fields: ['event_times'], allow_clone: true, policy_explained: explained,
  view_token: 'vt1', view_expires_in: 7200 };

const renderAt = () => render(
  <MemoryRouter initialEntries={['/s/tok1']}><Routes><Route path="/s/:token" element={<PublicSharePage />} /></Routes></MemoryRouter>,
);

beforeEach(() => {
  for (const f of [m.resolvePublicShare, m.getShareInfo, m.getShareView, m.cloneShare, m.reportShare]) f.mockReset();
});

describe('PublicSharePage (Gate G4)', () => {
  it('合言葉が要る時は、開く前に確認だけ読み、見える項目を示す(開かない)', async () => {
    m.getShareInfo.mockResolvedValue({ needs_passcode: true, expires_at: null, remaining_uses: 3, allow_clone: false,
      policy_explained: explained });
    renderAt();
    expect(await screen.findByText('パスコードが必要です')).toBeInTheDocument();
    expect(screen.getByText(/共有されていない項目: 予定のメモ/)).toBeInTheDocument();
    expect(m.resolvePublicShare).not.toHaveBeenCalled();
  });

  it('開いた後は一時トークンで最新を読み込み、複製・報告ができる', async () => {
    m.getShareInfo.mockResolvedValue({ needs_passcode: false, expires_at: null, remaining_uses: null, allow_clone: true,
      policy_explained: explained });
    m.resolvePublicShare.mockResolvedValue({ success: true, data: view });
    m.getShareView.mockResolvedValue({ ...view, title: '京都の旅(更新)' });
    m.cloneShare.mockResolvedValue({ plan_id: 'n1', link: '/planner/n1', message: '自分の旅行として複製しました' });
    m.reportShare.mockResolvedValue(undefined);
    renderAt();
    expect(await screen.findByText('清水寺')).toBeInTheDocument();
    expect(m.resolvePublicShare).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '最新を読み込む' }));
    await waitFor(() => expect(m.getShareView).toHaveBeenCalledWith('tok1', 'vt1'));
    expect(await screen.findByText('京都の旅(更新)')).toBeInTheDocument();
    expect(m.resolvePublicShare).toHaveBeenCalledTimes(1); // 見直しで使用回数を使わない
    fireEvent.click(screen.getByRole('button', { name: '自分の旅行として複製' }));
    await waitFor(() => expect(m.cloneShare).toHaveBeenCalledWith('tok1', 'vt1'));
    expect(await screen.findByRole('status')).toHaveTextContent('複製しました');
    fireEvent.click(screen.getByRole('button', { name: '問題を報告' }));
    fireEvent.change(screen.getByLabelText('問題の種類'), { target: { value: 'spam' } });
    fireEvent.click(screen.getByRole('button', { name: '報告する' }));
    await waitFor(() => expect(m.reportShare).toHaveBeenCalledWith('tok1', 'spam', undefined));
  });

  it('ログインしていない人の複製は案内を出す。無効なリンクは開かない', async () => {
    m.cloneShare.mockRejectedValue({ response: { status: 401 } });
    m.getShareInfo.mockResolvedValue({ needs_passcode: false, expires_at: null, remaining_uses: null, allow_clone: true,
      policy_explained: explained });
    m.resolvePublicShare.mockResolvedValue({ success: true, data: view });
    const { unmount } = renderAt();
    fireEvent.click(await screen.findByRole('button', { name: '自分の旅行として複製' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ログインしてからこのリンクを開き直してください');
    unmount();
    m.getShareInfo.mockRejectedValue({ response: { status: 404 } });
    m.resolvePublicShare.mockClear();
    renderAt();
    expect(await screen.findByText('このリンクは無効です')).toBeInTheDocument();
    expect(m.resolvePublicShare).not.toHaveBeenCalled();
  });
});
