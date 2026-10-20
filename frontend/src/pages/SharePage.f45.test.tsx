/**
 * [Gate F45] FR-045 項目単位の共有の規則の画面(SharePage の「閲覧者に見せる項目」・共有前プレビュー、
 * PublicSharePage の住所・メモ・予約の概要)。応答は実backendから採取した fixture。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import fx from './../services/api/__fixtures__/backendContractResponses.json';

const m = vi.hoisted(() => ({
  getShareSettings: vi.fn(),
  getCollaborators: vi.fn(),
  resolvePublicShare: vi.fn(),
  createShareLink: vi.fn(),
  previewSharePolicy: vi.fn(),
  previewShareLink: vi.fn(),
}));

vi.mock('../services/api', () => ({
  ...m,
  revokeShareLink: vi.fn(),
  inviteCollaborator: vi.fn(),
  removeCollaborator: vi.fn(),
}));

import SharePage from './SharePage';
import PublicSharePage from './PublicSharePage';

const renderShare = () =>
  render(
    <MemoryRouter initialEntries={['/share/plan-1']}>
      <Routes>
        <Route path="/share/:planId" element={<SharePage />} />
      </Routes>
    </MemoryRouter>
  );

describe('SharePage 閲覧者に見せる項目 (Gate F45)', () => {
  beforeEach(() => {
    m.getShareSettings.mockReset().mockResolvedValue({ data: [fx.share_created_full] });
    m.getCollaborators.mockReset().mockResolvedValue({ data: [] });
    m.previewSharePolicy.mockReset().mockResolvedValue(fx.share_preview);
    m.previewShareLink.mockReset().mockResolvedValue(fx.share_preview_link);
    m.createShareLink.mockReset().mockResolvedValue({ data: fx.share_created });
  });

  it('標準の項目で発行前のプレビューを出し、見せない情報の件数と常に見せない項目を示す', async () => {
    renderShare();
    expect(await screen.findByRole('checkbox', { name: /旅行の説明/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /予定の住所\(機密\)/ })).not.toBeChecked();
    expect(m.previewSharePolicy).toHaveBeenCalledWith('plan-1', {
      fields: ['plan_description', 'day_titles', 'event_times'], acknowledge_confidential: undefined,
    });
    const section = screen.getByRole('region', { name: '閲覧者に見える内容' });
    expect(within(section).getByText(/今の設定で発行すると見える内容です/)).toBeInTheDocument();
    expect(within(section).getByText(/予約番号 1件/)).toBeInTheDocument();
    expect(within(section).getByRole('heading', { name: '京都の旅', level: 3 })).toBeInTheDocument();
    expect(screen.getByText(/どの設定でも見せない: 予約番号・PIN・チケット・QR・バーコード/)).toBeInTheDocument();
    // 発行済みリンクの項目の要約
    expect(screen.getByText('見せる項目: 予定の住所・予定のメモ・予約の概要')).toBeInTheDocument();
  });

  it('機密の項目は確認するまで発行できず、確認すると項目と確認を送る', async () => {
    renderShare();
    const address = await screen.findByRole('checkbox', { name: /予定の住所\(機密\)/ });
    await userEvent.click(address);
    const issue = screen.getByRole('button', { name: '共有リンクを発行' });
    expect(issue).toBeDisabled();
    expect(screen.getByText(/URLを知っている人なら誰でも「予定の住所」を見られます/)).toBeInTheDocument();
    expect(screen.getByText('機密の項目を見せることを確認すると、見える内容を表示します。')).toBeInTheDocument();
    const callsBefore = m.previewSharePolicy.mock.calls.length;
    await userEvent.click(screen.getByRole('checkbox', { name: '機密の項目を見せることを確認しました' }));
    await waitFor(() => expect(m.previewSharePolicy.mock.calls.length).toBeGreaterThan(callsBefore));
    expect(m.previewSharePolicy).toHaveBeenLastCalledWith('plan-1', {
      fields: ['plan_description', 'day_titles', 'event_times', 'event_address'], acknowledge_confidential: true,
    });
    expect(issue).toBeEnabled();
    await userEvent.click(issue);
    await waitFor(() => expect(m.createShareLink).toHaveBeenCalledTimes(1));
    expect(m.createShareLink.mock.calls[0]![1]).toMatchObject({
      fields: ['plan_description', 'day_titles', 'event_times', 'event_address'], acknowledge_confidential: true,
    });
  });

  it('機密の項目を外すと確認も外れ、「すべて(機密を除く)」は機密を選ばない', async () => {
    renderShare();
    const notes = await screen.findByRole('checkbox', { name: /予定のメモ\(機密\)/ });
    await userEvent.click(notes);
    await userEvent.click(screen.getByRole('checkbox', { name: '機密の項目を見せることを確認しました' }));
    await userEvent.click(screen.getByRole('button', { name: 'すべて(機密を除く)' }));
    expect(notes).not.toBeChecked();
    expect(screen.queryByRole('checkbox', { name: '機密の項目を見せることを確認しました' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '最小限' }));
    expect(screen.getByRole('checkbox', { name: /旅行の説明/ })).not.toBeChecked();
    await userEvent.click(notes);
    expect(screen.getByRole('checkbox', { name: '機密の項目を見せることを確認しました' })).not.toBeChecked();
  });

  it('発行済みリンクの見える内容をこの画面で確認する(実際のURLは開かない)', async () => {
    renderShare();
    await userEvent.click(await screen.findByRole('button', { name: `共有リンク「...${fx.share_created_full.token_prefix}」で見える内容を確認` }));
    await waitFor(() => expect(m.previewShareLink).toHaveBeenCalledWith('plan-1', fx.share_created_full.id));
    const section = screen.getByRole('region', { name: '閲覧者に見える内容' });
    expect(await within(section).findByText(`発行済みのリンク「...${fx.share_created_full.token_prefix}」で見える内容です。`, { exact: false })).toBeInTheDocument();
    expect(within(section).getByText('住所: 京都市東山区清水1')).toBeInTheDocument();
    expect(within(section).getByText('予約番号・予約者名・連絡先・金額は共有されません。')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '共有前プレビューを開く' })).toBeNull();
  });

  it('backend が拒んだ時はその理由を表示する', async () => {
    m.createShareLink.mockRejectedValue({ response: { status: 422, data: fx.share_policy_error } });
    renderShare();
    await screen.findByRole('checkbox', { name: /旅行の説明/ });
    await userEvent.click(screen.getByRole('button', { name: '共有リンクを発行' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('機密の項目を共有するには');
  });
});

describe('PublicSharePage 選ばれた項目の表示 (Gate F45)', () => {
  it('住所・メモ・予約の概要が届いた時だけ表示し、日程の見出しが無ければ日付で見出しを作る', async () => {
    m.resolvePublicShare.mockReset().mockResolvedValue({ data: fx.public_share_confidential });
    render(
      <MemoryRouter initialEntries={['/s/tok']}>
        <Routes>
          <Route path="/s/:token" element={<PublicSharePage />} />
        </Routes>
      </MemoryRouter>
    );
    expect(await screen.findByRole('heading', { name: '京都の旅', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('住所: 京都市東山区清水1')).toBeInTheDocument();
    expect(screen.getByText('メモ: 入口は仁王門')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '予約の概要', level: 2 })).toBeInTheDocument();
    expect(screen.getByText('祇園の宿 本館')).toBeInTheDocument();
    expect(screen.queryByText('1日目')).toBeNull(); // 日程の見出しは選ばれていない
    expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThanOrEqual(3);
  });

  it('標準の項目のリンクでは住所・予約の概要が出ない', async () => {
    m.resolvePublicShare.mockReset().mockResolvedValue({ data: fx.public_share });
    render(
      <MemoryRouter initialEntries={['/s/tok']}>
        <Routes>
          <Route path="/s/:token" element={<PublicSharePage />} />
        </Routes>
      </MemoryRouter>
    );
    expect(await screen.findByRole('heading', { name: '1日目', level: 2 })).toBeInTheDocument();
    expect(screen.queryByText(/住所:/)).toBeNull();
    expect(screen.queryByRole('heading', { name: '予約の概要' })).toBeNull();
  });
});
