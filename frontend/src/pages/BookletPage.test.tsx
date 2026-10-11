/**
 * [Gate P4] BookletPage / BookletPrintPage(SC-25・SC-26 しおり・印刷)の画面テスト。
 *
 * - 設定: 章・テーマを変えてプレビュー、機密項目は所有者だけが選べ、選ぶと警告と有効期限が出る
 * - 版の作成: 送信内容(機密を含む版は有効期限付き)と印刷画面への移動
 * - 一覧: 状態・失効
 * - 印刷画面: 版情報・透かし・旅程更新の注意・印刷ボタン、失効した版はエラー表示
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import type { BookletExport, PlanMember } from '@/services/api';

const m = vi.hoisted(() => ({
  getPlanMembers: vi.fn(),
  previewBooklet: vi.fn(),
  getBookletExports: vi.fn(),
  createBookletExport: vi.fn(),
  getBookletExport: vi.fn(),
  revokeBookletExport: vi.fn(),
}));

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api');
  return { extractApiErrorDetailMessage: actual.extractApiErrorDetailMessage, ...m };
});

import BookletPage from './BookletPage';
import BookletPrintPage from './BookletPrintPage';

const owner: PlanMember[] = [{ user_id: 'me', name: '自分', role: 'owner', is_me: true }];
const editor: PlanMember[] = [{ user_id: 'me', name: '自分', role: 'editor', is_me: true }];

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/planner/:planId/booklet" element={<BookletPage />} />
        <Route path="/planner/:planId/booklet/:exportId" element={<BookletPrintPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.getPlanMembers.mockResolvedValue(owner);
  m.previewBooklet.mockResolvedValue(fx.booklet_preview);
  m.getBookletExports.mockResolvedValue(fx.booklet_export_list);
  m.createBookletExport.mockResolvedValue(fx.booklet_export_sensitive);
  m.getBookletExport.mockResolvedValue(fx.booklet_export_sensitive);
  m.revokeBookletExport.mockResolvedValue(fx.booklet_export_revoked.export);
  window.confirm = vi.fn(() => true);
  window.print = vi.fn();
});

describe('BookletPage (Gate P4)', () => {
  it('プレビュー: 既定設定で表示し、予約番号は伏字、QRを含めない注意を出す', async () => {
    renderAt('/planner/p1/booklet');
    const view = await screen.findByTestId('booklet');
    expect(m.previewBooklet).toHaveBeenCalledWith('p1', expect.objectContaining({ theme: 'simple', format: 'print' }));
    expect(view).toHaveTextContent('京都しおり');
    expect(view).toHaveTextContent('******4567');
    expect(view).toHaveTextContent('(一部を伏せています)');
    expect(view).toHaveTextContent('チケット・QRコードは含めていません');
    expect(within(view).getByTestId('booklet-stamp')).toHaveTextContent('プレビュー(保存されていません)');
    expect(within(view).getByRole('link', { name: '日程' })).toHaveAttribute('href', '#booklet-sec-schedule');
    // 費用はカテゴリの超過を文字で示す
    expect(within(view).getByRole('region', { name: '費用' })).toHaveTextContent('【超過】');
  });

  it('章とテーマを変えてプレビューを更新する', async () => {
    renderAt('/planner/p1/booklet');
    await screen.findByTestId('booklet');
    fireEvent.click(screen.getByRole('checkbox', { name: '費用' }));
    fireEvent.click(screen.getByRole('radio', { name: /白黒/ }));
    fireEvent.click(screen.getByRole('button', { name: 'プレビューを更新' }));
    await waitFor(() => expect(m.previewBooklet).toHaveBeenCalledTimes(2));
    const opts = m.previewBooklet.mock.calls[1]![1];
    expect(opts.theme).toBe('mono');
    expect(opts.sections).not.toContain('costs');
    expect(opts.sections[0]).toBe('cover');
  });

  it('機密項目: 選ぶと警告と有効期限が出て、版は有効期限付きで作成し印刷画面へ移る', async () => {
    renderAt('/planner/p1/booklet');
    await screen.findByTestId('booklet');
    expect(screen.queryByTestId('sensitive-warning')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: /予約番号/ }));
    expect(screen.getByTestId('sensitive-warning')).toHaveTextContent('透かしと有効期限');
    fireEvent.change(screen.getByLabelText('有効期限(90日以内)'), { target: { value: '2000-01-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'この内容で版を作成' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('今日以降');
    expect(m.createBookletExport).not.toHaveBeenCalled();
    const d = new Date(Date.now() + 5 * 86_400_000);
    const dateText = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    fireEvent.change(screen.getByLabelText('有効期限(90日以内)'), { target: { value: dateText } });
    fireEvent.click(screen.getByRole('button', { name: 'この内容で版を作成' }));
    await waitFor(() => expect(m.createBookletExport).toHaveBeenCalledTimes(1));
    const body = m.createBookletExport.mock.calls[0]![1];
    expect(body.includes.confirmation_numbers).toBe(true);
    expect(new Date(body.valid_until).getTime()).toBe(new Date(`${dateText}T23:59:59`).getTime());
    // 印刷画面(作成した版)へ移る
    expect(await screen.findByTestId('booklet-watermark')).toHaveAttribute('data-text', expect.stringMatching(/専用・持出注意$/));
  });

  it('編集者は機密項目を選べない。機密を含まない版は有効期限なしで作成できる', async () => {
    m.getPlanMembers.mockResolvedValue(editor);
    m.createBookletExport.mockResolvedValue(fx.booklet_export_created);
    m.getBookletExport.mockResolvedValue(fx.booklet_export_created);
    renderAt('/planner/p1/booklet');
    await screen.findByTestId('booklet');
    expect(screen.getByRole('checkbox', { name: /予約番号/ })).toBeDisabled();
    expect(screen.getByText('機密情報を含めた出力は旅行の所有者だけが作成できます。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'この内容で版を作成' }));
    await waitFor(() => expect(m.createBookletExport).toHaveBeenCalledTimes(1));
    expect(m.createBookletExport.mock.calls[0]![1]).not.toHaveProperty('valid_until');
  });

  it('作成した版: 状態と機密項目を表示し、失効できる', async () => {
    renderAt('/planner/p1/booklet');
    const list = await screen.findByRole('list', { name: '作成した版' });
    const versions = (fx.booklet_export_list as BookletExport[]).map((x) => x.version_no);
    expect(within(list).getByTestId(`booklet-export-${versions[0]}`)).toHaveTextContent('失効');
    const sens = within(list).getByTestId(`booklet-export-${versions[1]}`);
    expect(sens).toHaveTextContent('含む機密項目: 予約番号');
    expect(within(list).getByTestId(`booklet-export-${versions[2]}`)).toHaveTextContent('旅程が更新済み');
    fireEvent.click(within(sens).getByRole('button', { name: '失効' }));
    await waitFor(() => expect(m.revokeBookletExport).toHaveBeenCalledWith('p1', (fx.booklet_export_list as BookletExport[])[1]!.id));
  });

  it('閲覧者には作成画面を出さない', async () => {
    m.getPlanMembers.mockResolvedValue([{ user_id: 'me', name: '自分', role: 'viewer', is_me: true }]);
    renderAt('/planner/p1/booklet');
    expect(await screen.findByText('しおりの作成は編集者以上が行えます。')).toBeInTheDocument();
    expect(m.previewBooklet).not.toHaveBeenCalled();
  });
});

describe('BookletPrintPage (Gate P4)', () => {
  it('版情報・透かし・有効期限を印字し、印刷ボタンでブラウザの印刷を開く', async () => {
    renderAt('/planner/p1/booklet/e1');
    const stamp = await screen.findByTestId('booklet-stamp');
    expect(stamp).toHaveTextContent(`第${fx.booklet_export_sensitive.export.version_no}版`);
    expect(stamp).toHaveTextContent('有効期限');
    expect(stamp).toHaveTextContent('紛失・置き忘れに注意');
    expect(screen.getByTestId('booklet')).toHaveTextContent('ABC1234567');
    fireEvent.click(screen.getByRole('button', { name: '印刷 / PDFで保存' }));
    expect(window.print).toHaveBeenCalled();
  });

  it('旅程が更新された版は注意を出す', async () => {
    m.getBookletExport.mockResolvedValue(fx.booklet_export_stale);
    renderAt('/planner/p1/booklet/e1');
    expect(await screen.findByTestId('booklet-stale')).toHaveTextContent('新しい版を作成');
    expect(screen.queryByTestId('booklet-watermark')).toBeNull();
  });

  it('失効した版は表示しない', async () => {
    m.getBookletExport.mockRejectedValue({ response: { status: 410, data: { detail: { code: 'revoked', message: 'この版は失効しています' } } } });
    renderAt('/planner/p1/booklet/e1');
    expect(await screen.findByRole('alert')).toHaveTextContent('この版は失効しています');
    expect(screen.queryByTestId('booklet')).toBeNull();
    expect(screen.queryByRole('button', { name: '印刷 / PDFで保存' })).toBeNull();
  });
});
