/**
 * [Gate B-012] 最近削除したプラン(ゴミ箱)の画面テスト。
 * - 削除済みが無ければ何も表示しない
 * - 復元・完全削除(確認あり)を呼び、一覧から外し、結果を知らせる
 * - 期限切れ(410)などの失敗は理由を表示し、一覧を読み直す
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import type { DeletedPlanSummary } from '@/services/api';

const { getDeletedPlans, restorePlan, purgePlan } = vi.hoisted(() => ({
  getDeletedPlans: vi.fn(),
  restorePlan: vi.fn(),
  purgePlan: vi.fn(),
}));

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api');
  return { extractApiErrorDetailMessage: actual.extractApiErrorDetailMessage, getDeletedPlans, restorePlan, purgePlan };
});

import DeletedPlansSection from './DeletedPlansSection';

const list = fx.deleted_plan_list as DeletedPlanSummary[];
const kyoto = list.find((p) => p.title === '京都の旅')!;

beforeEach(() => {
  getDeletedPlans.mockReset();
  restorePlan.mockReset();
  purgePlan.mockReset();
});

async function openList() {
  fireEvent.click(await screen.findByRole('button', { name: '表示する' }));
  return screen.getByRole('list');
}

describe('DeletedPlansSection (Gate B-012)', () => {
  it('削除済みが無ければ何も表示しない', async () => {
    getDeletedPlans.mockResolvedValue([]);
    const { container } = render(<DeletedPlansSection />);
    await waitFor(() => expect(getDeletedPlans).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('件数と完全削除の予定を表示し、開閉できる', async () => {
    getDeletedPlans.mockResolvedValue(list);
    render(<DeletedPlansSection />);
    expect(await screen.findByRole('heading', { name: `最近削除したプラン ${list.length}件` })).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: '表示する' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const ul = await openList();
    expect(within(ul).getAllByRole('listitem')).toHaveLength(list.length);
    expect(within(ul).getByText('📍 京都')).toBeInTheDocument();
    expect(within(ul).getAllByText(/に完全に削除されます|まもなく完全に削除されます/)).toHaveLength(list.length);
    expect(screen.getByRole('button', { name: '閉じる' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('復元すると一覧から外し、共有リンクは再発行が必要と知らせて呼出元へ伝える', async () => {
    getDeletedPlans.mockResolvedValue(list);
    restorePlan.mockResolvedValue({ success: true, message: '', data: {} });
    const onRestored = vi.fn();
    render(<DeletedPlansSection onRestored={onRestored} />);
    await openList();
    fireEvent.click(screen.getByRole('button', { name: `${kyoto.title}を復元` }));
    await waitFor(() => expect(restorePlan).toHaveBeenCalledWith(kyoto.id));
    expect(await screen.findByText(/共有リンクは無効のまま/)).toHaveAttribute('role', 'status');
    expect(onRestored).toHaveBeenCalledWith(kyoto);
    expect(screen.queryByText(kyoto.title)).not.toBeInTheDocument();
  });

  it('完全削除は確認のうえで行い、キャンセルなら呼ばない', async () => {
    getDeletedPlans.mockResolvedValue(list);
    purgePlan.mockResolvedValue(fx.plan_purged);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<DeletedPlansSection />);
    await openList();
    const button = screen.getByRole('button', { name: `${kyoto.title}を完全に削除` });
    fireEvent.click(button);
    expect(purgePlan).not.toHaveBeenCalled();
    expect(confirmSpy.mock.calls[0]![0]).toMatch(/元に戻せません/);
    fireEvent.click(button);
    await waitFor(() => expect(purgePlan).toHaveBeenCalledWith(kyoto.id));
    expect(await screen.findByText(`「${kyoto.title}」を完全に削除しました。`)).toHaveAttribute('role', 'status');
    confirmSpy.mockRestore();
  });

  it('期限切れ(410)等の失敗は理由を表示し、一覧を読み直す', async () => {
    getDeletedPlans.mockResolvedValue(list);
    restorePlan.mockRejectedValue({ response: { status: 410, data: { detail: '復元できる期間を過ぎています' } } });
    render(<DeletedPlansSection />);
    await openList();
    fireEvent.click(screen.getByRole('button', { name: `${kyoto.title}を復元` }));
    expect(await screen.findByRole('alert')).toHaveTextContent('復元できる期間を過ぎています');
    expect(getDeletedPlans).toHaveBeenCalledTimes(2);
  });

  it('refreshKeyが変わると読み直す', async () => {
    getDeletedPlans.mockResolvedValue([]);
    const { rerender } = render(<DeletedPlansSection refreshKey={0} />);
    await waitFor(() => expect(getDeletedPlans).toHaveBeenCalledTimes(1));
    rerender(<DeletedPlansSection refreshKey={1} />);
    await waitFor(() => expect(getDeletedPlans).toHaveBeenCalledTimes(2));
  });
});
