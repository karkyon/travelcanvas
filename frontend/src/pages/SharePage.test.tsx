/**
 * [Gate M9-FE-B3] SharePage / PublicSharePage の読込effect発火回数を固定する回帰テスト。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fx from './../services/api/__fixtures__/backendContractResponses.json';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const { getShareSettings, getCollaborators, resolvePublicShare, removeCollaborator, previewSharePolicy } = vi.hoisted(() => ({
  getShareSettings: vi.fn(),
  getCollaborators: vi.fn(),
  resolvePublicShare: vi.fn(),
  removeCollaborator: vi.fn(),
  previewSharePolicy: vi.fn(),
}));

vi.mock('../services/api', () => ({
  getShareSettings,
  getCollaborators,
  resolvePublicShare,
  createShareLink: vi.fn(),
  revokeShareLink: vi.fn(),
  inviteCollaborator: vi.fn(),
  removeCollaborator,
  // [Gate F45] 共有前プレビュー
  previewSharePolicy,
  previewShareLink: vi.fn(),
  // [Gate G2] FR-045 参加者に見せない項目の設定(この画面の試験では閲覧者として何も出さない)
  getMemberPolicy: vi.fn().mockResolvedValue({
    plan_id: 'p', role: 'viewer', my_hidden: [], catalog: { version: 1, categories: [], presets: {} },
  }),
  putMemberPolicy: vi.fn(),
  putMemberOverride: vi.fn(),
  extractApiErrorDetailMessage: () => null,
}));

import SharePage from './SharePage';
import PublicSharePage from './PublicSharePage';

// [Gate G3] DEP-04 待つ間の画面の更新を act の中で行う
const sleep = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

beforeEach(() => {
  previewSharePolicy.mockReset().mockResolvedValue(fx.share_preview);
});

describe('SharePage (Gate M9-FE-B3)', () => {
  beforeEach(() => {
    getShareSettings.mockReset().mockResolvedValue({ data: [] });
    getCollaborators.mockReset().mockResolvedValue({ data: [] });
  });

  it('planIdごとに共有設定・コラボレーター一覧をそれぞれ1回だけ取得する', async () => {
    render(
      <MemoryRouter initialEntries={['/share/plan-1']}>
        <Routes>
          <Route path="/share/:planId" element={<SharePage />} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => expect(getCollaborators).toHaveBeenCalledTimes(1));
    await sleep(50);
    expect(getShareSettings).toHaveBeenCalledTimes(1);
    expect(getShareSettings).toHaveBeenCalledWith('plan-1');
    expect(getCollaborators).toHaveBeenCalledTimes(1);
    expect(getCollaborators).toHaveBeenCalledWith('plan-1');
  });
});

describe('PublicSharePage (Gate M9-FE-B3)', () => {
  beforeEach(() => {
    resolvePublicShare.mockReset();
  });

  it('tokenの解決はマウント時に1回だけ行う', async () => {
    resolvePublicShare.mockRejectedValue({ response: { status: 404 } });
    render(
      <MemoryRouter initialEntries={['/s/tok-1']}>
        <Routes>
          <Route path="/s/:token" element={<PublicSharePage />} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => expect(resolvePublicShare).toHaveBeenCalledTimes(1));
    await sleep(50);
    expect(resolvePublicShare).toHaveBeenCalledTimes(1);
    expect(resolvePublicShare).toHaveBeenCalledWith('tok-1', undefined);
  });
});

describe('SharePage コラボレーター削除 (Gate B-013)', () => {
  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    getShareSettings.mockReset().mockResolvedValue({ data: [] });
    getCollaborators.mockReset().mockResolvedValue({ data: [fx.collaborator_list[0]] });
    removeCollaborator.mockReset().mockResolvedValue({ success: true, data: fx.collaborator_removed });
  });

  it('チケット担当に割り当てられていても削除でき、割当を外したことを知らせる', async () => {
    render(
      <MemoryRouter initialEntries={['/share/plan-1']}>
        <Routes>
          <Route path="/share/:planId" element={<SharePage />} />
        </Routes>
      </MemoryRouter>
    );
    const email = fx.collaborator_list[0]!.email;
    await screen.findAllByText(email);
    await userEvent.click(screen.getByRole('button', { name: `${email} を削除` }));
    await waitFor(() => expect(removeCollaborator).toHaveBeenCalledWith('plan-1', fx.collaborator_list[0]!.id));
    expect(await screen.findByText(/チケット担当1件の割当を外しました/)).toBeInTheDocument();
  });
});
