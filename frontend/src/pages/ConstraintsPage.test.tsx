/**
 * [Gate L2] ConstraintsPage(FR-016 制約)の画面テスト。
 *
 * - ハード/ソフトの区分表示、他人の秘匿制約は内容を出さない
 * - 「制約が無い」と「検証していない」を区別して表示する(SC-15)
 * - 追加フォームの入力がAPIへ正しい形で渡る(個人・秘匿・理由)
 * - 無効化/削除は制約のrevisionを使い、拒否(403)は理由を表示する
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import type { PlanConstraint } from '@/services/api';

const { getConstraints, createConstraint, updateConstraint, deleteConstraint, getPlanDetail } = vi.hoisted(() => ({
  getConstraints: vi.fn(),
  createConstraint: vi.fn(),
  updateConstraint: vi.fn(),
  deleteConstraint: vi.fn(),
  getPlanDetail: vi.fn(),
}));

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api');
  return {
    extractApiErrorDetailMessage: actual.extractApiErrorDetailMessage,
    getConstraints, createConstraint, updateConstraint, deleteConstraint,
    api: { getPlanDetail },
  };
});

import ConstraintsPage from './ConstraintsPage';

const shared = fx.constraint_shared as PlanConstraint;
const soft = fx.constraint_soft_between as PlanConstraint;
const masked = fx.constraint_masked as PlanConstraint;
const privateMine = fx.constraint_private_mine as PlanConstraint;

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/planner/p1/constraints']}>
      <Routes>
        <Route path="/planner/:planId/constraints" element={<ConstraintsPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  getConstraints.mockReset();
  createConstraint.mockReset();
  updateConstraint.mockReset();
  deleteConstraint.mockReset();
  getPlanDetail.mockReset().mockResolvedValue({
    success: true, message: '',
    data: { id: 'p1', title: 't', revision: 1, days: [{ id: 'd1', local_date: '2026-11-01', timezone_id: 'Asia/Tokyo', sort_order: 0, events: [] }] },
  });
});

describe('ConstraintsPage (Gate L2)', () => {
  it('ハード/ソフトに分けて表示し、他人の秘匿制約は内容を出さない', async () => {
    getConstraints.mockResolvedValue([shared, masked, soft]);
    renderPage();
    const hardSection = await screen.findByRole('region', { name: /ハード制約/ });
    const softSection = screen.getByRole('region', { name: /ソフト制約/ });
    expect(within(hardSection).getByText(shared.title as string)).toBeInTheDocument();
    expect(within(hardSection).getByText('上限 50000 円', { exact: false })).toBeInTheDocument();
    expect(within(hardSection).getByText('他のメンバーの秘匿制約')).toBeInTheDocument();
    expect(within(softSection).getByText(/重み 70/)).toBeInTheDocument();
    expect(within(softSection).getByText('適用範囲: 日: 2026-11-01')).toBeInTheDocument();
    // 他人の制約の理由・秘匿制約の中身はどこにも出ない
    expect(screen.queryByText(/家計の都合/)).toBeInTheDocument(); // 自分の共有制約の理由は本人に出る
    expect(document.body.textContent).not.toContain('えび');
    expect(screen.getByText(/検証\(実行可能性チェック\)はまだ行っていません/)).toBeInTheDocument();
  });

  it('制約ゼロの表示と、未検証の注記は別に出す', async () => {
    getConstraints.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/制約はまだ登録されていません/)).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('まだ行っていません');
  });

  it('自分の秘匿制約は内容と理由を表示し、秘匿であることを示す', async () => {
    getConstraints.mockResolvedValue([privateMine]);
    renderPage();
    expect(await screen.findByText('甲殻類は避ける')).toBeInTheDocument();
    expect(screen.getByText('自分だけ(秘匿)')).toBeInTheDocument();
    expect(screen.getByText(/理由\(自分だけに表示\): アレルギー/)).toBeInTheDocument();
  });

  it('追加フォームの入力をAPIの形で送り、一覧を読み直す', async () => {
    getConstraints.mockResolvedValueOnce([]).mockResolvedValueOnce([privateMine]);
    createConstraint.mockResolvedValue(privateMine);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /制約を追加/ }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('題名'), { target: { value: '甲殻類は避ける' } });
    fireEvent.change(within(dialog).getByLabelText('種類'), { target: { value: 'forbidden' } });
    fireEvent.change(within(dialog).getByLabelText('内容'), { target: { value: 'えび' } });
    fireEvent.change(within(dialog).getByLabelText('適用範囲'), { target: { value: 'member' } });
    fireEvent.click(within(dialog).getByLabelText(/自分だけ\(秘匿/));
    fireEvent.change(within(dialog).getByLabelText(/理由/), { target: { value: 'アレルギー' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));

    await waitFor(() => expect(createConstraint).toHaveBeenCalledTimes(1));
    expect(createConstraint).toHaveBeenCalledWith('p1', {
      title: '甲殻類は避ける', constraint_type: 'forbidden', hardness: 'hard', operator: 'avoid',
      value: { value: 'えび' }, scope_type: 'member', privacy_level: 'private', is_active: true, reason: 'アレルギー',
    });
    expect(await screen.findByText('甲殻類は避ける')).toBeInTheDocument();
    expect(getConstraints).toHaveBeenCalledTimes(2);
  });

  it('入力が不正なら送らずに理由を表示する', async () => {
    getConstraints.mockResolvedValue([]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /制約を追加/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('題名を入力してください');
    expect(createConstraint).not.toHaveBeenCalled();
  });

  it('無効化は制約のrevisionをIf-Matchに使い、権限エラーは理由を表示する', async () => {
    getConstraints.mockResolvedValue([shared]);
    updateConstraint.mockRejectedValueOnce({ response: { status: 403, data: { detail: '共有の制約を変更する権限がありません' } } });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '無効にする' }));
    await waitFor(() => expect(updateConstraint).toHaveBeenCalledWith('p1', shared.id, { is_active: false }, shared.revision));
    expect(await screen.findByRole('alert')).toHaveTextContent('共有の制約を変更する権限がありません');
  });

  it('編集は既存の内容を入れて開き、理由を空にすると削除として送る', async () => {
    getConstraints.mockResolvedValue([privateMine]);
    updateConstraint.mockResolvedValue(privateMine);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '甲殻類は避けるを編集' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('題名')).toHaveValue('甲殻類は避ける');
    expect(within(dialog).getByLabelText('内容')).toHaveValue('えび');
    fireEvent.change(within(dialog).getByLabelText(/理由/), { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(updateConstraint).toHaveBeenCalledTimes(1));
    const [, id, data, revision] = updateConstraint.mock.calls[0] as [string, string, Record<string, unknown>, number];
    expect(id).toBe(privateMine.id);
    expect(revision).toBe(privateMine.revision);
    expect(data).toMatchObject({ title: '甲殻類は避ける', privacy_level: 'private', reason: null });
  });

  it('削除は確認のうえrevisionを使って行う', async () => {
    getConstraints.mockResolvedValue([shared]);
    deleteConstraint.mockResolvedValue({ revision: 3 });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: `${shared.title}を削除` }));
    await waitFor(() => expect(deleteConstraint).toHaveBeenCalledWith('p1', shared.id, shared.revision));
    confirmSpy.mockRestore();
  });
});
