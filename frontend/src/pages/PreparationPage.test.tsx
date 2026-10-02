/**
 * [Gate P1] PreparationPage(FR-025 持ち物 / FR-026 準備タスク・レディネス)の画面テスト。
 *
 * - 準備状況: 「残りあり」「準備完了」を区別し、項目をタスクにする・タスクで対応済みにする
 * - 持ち物: 自分だけの持ち物の表示、状態の切替はrevision付き、候補(条件・天候未判定の明示・追加・数量変更)
 * - タスク: 閲覧者には追加ボタンを出さない、完了の切替はrevision付き、拒否は理由を表示する
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import type { PackingItem, PackingSuggestions, PlanMember, PreparationTask, Readiness } from '@/services/api';

const m = vi.hoisted(() => ({
  getPlanMembers: vi.fn(),
  getPackingItems: vi.fn(),
  getPreparationTasks: vi.fn(),
  getReadiness: vi.fn(),
  getPackingSuggestions: vi.fn(),
  createPackingItem: vi.fn(),
  updatePackingItem: vi.fn(),
  deletePackingItem: vi.fn(),
  createPreparationTask: vi.fn(),
  updatePreparationTask: vi.fn(),
  deletePreparationTask: vi.fn(),
}));

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api');
  return { extractApiErrorDetailMessage: actual.extractApiErrorDetailMessage, ...m };
});

import PreparationPage from './PreparationPage';

const members = fx.plan_members as PlanMember[];
const attention = fx.readiness_attention as Readiness;
const ready = fx.readiness_ready as Readiness;
const items = fx.packing_item_list as PackingItem[];
const tasks = fx.preparation_task_list as PreparationTask[];
const suggestions = fx.packing_suggestions as PackingSuggestions;

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/planner/p1/preparation']}>
      <Routes>
        <Route path="/planner/:planId/preparation" element={<PreparationPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.getPlanMembers.mockResolvedValue(members);
  m.getPackingItems.mockResolvedValue(items);
  m.getPreparationTasks.mockResolvedValue(tasks);
  m.getReadiness.mockResolvedValue(attention);
  m.getPackingSuggestions.mockResolvedValue(suggestions);
});

describe('PreparationPage (Gate P1)', () => {
  it('準備状況: 残りの件数と項目を表示し、タスク化済みの項目を対応済みにできる', async () => {
    m.updatePreparationTask.mockResolvedValue(fx.preparation_task_done);
    renderPage();
    const summary = await screen.findByTestId('readiness-summary');
    expect(summary).toHaveTextContent(`${attention.counts.total}件の準備が残っています`);
    const list = screen.getByRole('list', { name: '準備が残っている項目' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(attention.items.length);
    expect(screen.getByRole('tab', { name: /準備状況\(5\)/ })).toHaveAttribute('aria-selected', 'true');

    const unreserved = attention.items.find((i) => i.code === 'unreserved')!;
    expect(screen.getByTestId(`readiness-task-${unreserved.key}`)).toHaveTextContent('タスクにしました');
    fireEvent.click(screen.getByRole('button', { name: '対応済みにする' }));
    await waitFor(() => expect(m.updatePreparationTask).toHaveBeenCalledWith(
      'p1', unreserved.task!.id, { status: 'done' }, unreserved.task!.revision,
    ));
    await waitFor(() => expect(m.getReadiness).toHaveBeenCalledTimes(2));
  });

  it('準備状況: 項目をタスクにすると題名を引き継ぎ、readiness_keyを付けて作成する', async () => {
    m.createPreparationTask.mockResolvedValue(fx.preparation_task_from_readiness);
    renderPage();
    await screen.findByTestId('readiness-summary');
    const unpaid = attention.items.find((i) => i.code === 'reservation_unpaid')!;
    fireEvent.click(screen.getAllByRole('button', { name: 'タスクにする' })[0]!);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('題名')).toHaveValue(unpaid.title);
    fireEvent.change(within(dialog).getByLabelText('担当'), { target: { value: members[1]!.user_id } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(m.createPreparationTask).toHaveBeenCalledWith('p1', {
      title: unpaid.title, assignee_user_id: members[1]!.user_id, readiness_key: unpaid.key,
    }));
  });

  it('準備状況: 項目が無ければ準備完了と表示する(未取得と区別する)', async () => {
    m.getReadiness.mockResolvedValue(ready);
    renderPage();
    expect(await screen.findByTestId('readiness-summary')).toHaveTextContent('出発前に対応が必要な項目はありません');
    expect(screen.queryByRole('list', { name: '準備が残っている項目' })).toBeNull();
  });

  it('持ち物: 自分だけの持ち物を示し、状態の変更は持ち物のrevisionで送る', async () => {
    m.updatePackingItem.mockResolvedValue(fx.packing_item_updated);
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: '持ち物' }));
    expect(await screen.findByLabelText('自分だけの持ち物')).toBeInTheDocument();
    expect(screen.getByTestId('packing-progress')).toHaveTextContent('梱包済み 1/4 件(必須で未準備 1 件)');
    const underwear = items.find((i) => i.name === '下着')!;
    fireEvent.change(screen.getByLabelText('下着の状態'), { target: { value: 'packed' } });
    await waitFor(() => expect(m.updatePackingItem).toHaveBeenCalledWith('p1', underwear.id, { status: 'packed' }, underwear.revision));
  });

  it('持ち物の候補: 条件を送り、天候を判定していないことを示し、追加と数量変更ができる', async () => {
    m.createPackingItem.mockResolvedValue(fx.packing_item_suggested);
    m.updatePackingItem.mockResolvedValue(fx.packing_item_updated);
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: '持ち物' }));
    fireEvent.click(await screen.findByLabelText('海外旅行'));
    fireEvent.click(screen.getByRole('button', { name: '候補を表示' }));
    await waitFor(() => expect(m.getPackingSuggestions).toHaveBeenCalledWith('p1', { overseas: true }));
    const box = await screen.findByTestId('packing-suggestions');
    expect(within(box).getByText(/天気予報の取得元が未接続/)).toBeInTheDocument();
    expect(within(box).getByRole('list', { name: '不要かもしれない持ち物' })).toHaveTextContent('水着');

    fireEvent.click(within(box).getByRole('button', { name: 'パスポートを持ち物に追加' }));
    await waitFor(() => expect(m.createPackingItem).toHaveBeenCalledWith('p1', {
      name: 'パスポート', category: 'documents', quantity: 1, is_required: true, scope: 'personal',
      suggestion_key: 'passport',
    }));

    const change = suggestions.change[0]!;
    const target = items.find((i) => i.id === change.item_id)!;
    fireEvent.click(within(await screen.findByTestId('packing-suggestions')).getByRole('button', { name: `数量を${change.suggested_quantity}にする` }));
    await waitFor(() => expect(m.updatePackingItem).toHaveBeenCalledWith(
      'p1', change.item_id, { quantity: change.suggested_quantity }, target.revision,
    ));
  });

  it('タスク: 閲覧者には追加ボタンを出さず、担当分の完了だけ切り替えられる。拒否は理由を表示する', async () => {
    m.getPlanMembers.mockResolvedValue(members.map((x) => ({ ...x, is_me: !x.is_me })));
    m.getPreparationTasks.mockResolvedValue(fx.preparation_task_list_assignee);
    m.updatePreparationTask.mockRejectedValue({ response: { data: { detail: 'タスクを変更する権限がありません' } } });
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: 'タスク' }));
    expect(await screen.findByText(/未完了 \d+ 件/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'タスクを追加' })).toBeNull();
    const assigned = (fx.preparation_task_list_assignee as PreparationTask[]).find((t) => t.can_complete)!;
    const other = (fx.preparation_task_list_assignee as PreparationTask[]).find((t) => !t.can_complete)!;
    expect(screen.getByLabelText(other.title)).toBeDisabled();
    fireEvent.click(screen.getByLabelText(assigned.title));
    await waitFor(() => expect(m.updatePreparationTask).toHaveBeenCalledWith('p1', assigned.id, { status: 'open' }, assigned.revision));
    expect(await screen.findByRole('alert')).toHaveTextContent('タスクを変更する権限がありません');
  });
});
