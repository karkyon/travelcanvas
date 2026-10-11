/**
 * [Gate P6] DataPrivacyPage(FR-039 データの書き出しと保持期間)と、旅行の書き出し画面のJSONエクスポートの画面テスト。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';

const m = vi.hoisted(() => ({
  getRetentionInfo: vi.fn(),
  downloadAccountDataExport: vi.fn(),
  downloadPlanDataExport: vi.fn(),
  downloadItineraryExport: vi.fn(),
  // [Gate P9] 同意・アカウント削除のカード
  getConsents: vi.fn(),
  updateConsents: vi.fn(),
  getAccountDeletionPreview: vi.fn(),
  deleteAccount: vi.fn(),
}));
vi.mock('@/services/api', () => m);

import DataPrivacyPage from './DataPrivacyPage';
import ExportsPage from './ExportsPage';

const SHA = 'b'.repeat(64);
let clicked: string[] = [];

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/settings/data" element={<DataPrivacyPage />} />
        <Route path="/planner/:planId/exports" element={<ExportsPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.getRetentionInfo.mockResolvedValue(fx.retention_info);
  m.getConsents.mockResolvedValue(fx.privacy_consents_default);
  clicked = [];
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push(this.download);
  });
});

describe('DataPrivacyPage (Gate P6)', () => {
  it('保持期間の説明を表示する(削除の猶予日数は設定値)', async () => {
    renderAt('/settings/data');
    const list = await screen.findByTestId('retention-list');
    expect(within(list).getByText('削除した旅行')).toBeInTheDocument();
    expect(list).toHaveTextContent(`削除後${fx.retention_info.plan_delete_grace_days}日間は復元できます`);
    expect(list).toHaveTextContent('バックアップ');
    expect(list).toHaveTextContent('回収できません');
    expect(screen.queryByText(/準備中/)).toBeNull();
  });

  it('アカウントのデータを書き出し、ファイル名とハッシュを案内する。失敗はエラー表示', async () => {
    m.downloadAccountDataExport.mockResolvedValue({ blob: new Blob(['{}']), filename: 'travelcanvas-account-20261011.json', sha256: SHA });
    renderAt('/settings/data');
    fireEvent.click(screen.getByRole('button', { name: 'アカウントのデータを書き出す' }));
    expect(await screen.findByTestId('data-export-result')).toHaveTextContent(`travelcanvas-account-20261011.json を保存しました。内容の確認用ハッシュ(SHA-256): ${SHA}`);
    expect(clicked).toEqual(['travelcanvas-account-20261011.json']);
    m.downloadAccountDataExport.mockRejectedValue({ response: { data: { detail: '認証が必要です' } } });
    fireEvent.click(screen.getByRole('button', { name: 'アカウントのデータを書き出す' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('認証が必要です');
  });

  it('保持期間を取得できない時はその旨を出す', async () => {
    m.getRetentionInfo.mockRejectedValue(new Error('x'));
    renderAt('/settings/data');
    expect(await screen.findByRole('alert')).toHaveTextContent('保持期間の説明を取得できませんでした');
  });
});

describe('ExportsPage 旅行データ(JSON) (Gate P6)', () => {
  it('所有者は旅行データを書き出せる。所有者以外は理由を表示する', async () => {
    m.downloadPlanDataExport.mockResolvedValue({ blob: new Blob(['{}']), filename: 'travelcanvas-plan-20261011.json', sha256: null });
    renderAt('/planner/p1/exports');
    fireEvent.click(screen.getByRole('button', { name: '旅行データを書き出す' }));
    await waitFor(() => expect(m.downloadPlanDataExport).toHaveBeenCalledWith('p1'));
    expect(await screen.findByTestId('export-result')).toHaveTextContent('travelcanvas-plan-20261011.json を保存しました。');
    m.downloadPlanDataExport.mockRejectedValue({ response: { status: 403, data: { detail: { code: 'owner_only', message: '旅行全体のエクスポートは所有者だけが行えます。' } } } });
    fireEvent.click(screen.getByRole('button', { name: '旅行データを書き出す' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('所有者だけが行えます');
  });
});
