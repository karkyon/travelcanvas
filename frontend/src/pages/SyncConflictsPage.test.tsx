/**
 * [Gate P11] SyncConflictsPage / SyncStatusBar(同期の競合の確認・解決、未同期の表示)の画面テスト。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import type { SyncConflictList } from '@/services/api';

const m = vi.hoisted(() => ({ getSyncConflicts: vi.fn(), resolveSyncConflict: vi.fn(), syncPending: vi.fn() }));
vi.mock('@/services/api', () => ({
  getSyncConflicts: m.getSyncConflicts, resolveSyncConflict: m.resolveSyncConflict,
  // planStore・authStoreが読み込み時に参照する
  api: { setGuestMode: vi.fn(), setAccessToken: vi.fn(), clearAccessToken: vi.fn() },
  travelAPI: {},
}));

import SyncConflictsPage from './SyncConflictsPage';
import SyncStatusBar from '@/components/planner/SyncStatusBar';
import { usePlanStore } from '@/store/planStore';
import { conflictRows, conflictSummary } from './sync/syncModel';

const list = fx.sync_conflicts as SyncConflictList;

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/planner/p1/sync']}>
      <Routes>
        <Route path="/planner/:planId/sync" element={<SyncConflictsPage />} />
        <Route path="/planner/:planId" element={<div>PLANNER</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
  for (const fn of Object.values(m)) fn.mockReset();
  m.getSyncConflicts.mockResolvedValue(list);
});

describe('syncModel (Gate P11)', () => {
  it('項目ごとの比較と案内文', () => {
    const [update, del] = list.conflicts;
    expect(conflictRows(update!)).toEqual([{ field: 'title', label: '予定名', mine: '金閣寺', server: '清水寺(朝)' }]);
    expect(conflictRows(del!)[0]).toMatchObject({ label: '開始時刻', mine: '(削除)', server: '12:30' });
    expect(conflictSummary(del!)).toContain('端末で削除しましたが');
    expect(conflictSummary({ ...update!, server_deleted: true })).toContain('サーバーで削除されたため');
  });
});

describe('SyncConflictsPage (Gate P11)', () => {
  it('自分の変更とサーバーの内容を比べて、自分の変更を使う(本案のrevisionを送る)', async () => {
    m.resolveSyncConflict.mockResolvedValue(fx.sync_resolved_mine);
    renderPage();
    const items = await screen.findByRole('list', { name: '競合している変更' });
    const first = within(items).getByRole('region', { name: '競合: 清水寺(朝)' });
    expect(within(first).getByRole('table')).toHaveTextContent('予定名金閣寺清水寺(朝)');
    m.getSyncConflicts.mockResolvedValue({ ...list, conflicts: list.conflicts.slice(1) });
    fireEvent.click(within(first).getByRole('button', { name: '自分の変更を使う' }));
    await waitFor(() => expect(m.resolveSyncConflict).toHaveBeenCalledWith('p1', list.conflicts[0]!.operation_id, 'use_mine', list.plan_revision));
    expect(await screen.findByText(/自分の変更を反映しました/)).toBeInTheDocument();
    expect(usePlanStore.getState().syncConflictCount).toBe(1);
  });

  it('削除の競合は「削除する」か「サーバーの内容を残す」。残すはrevisionを送らない', async () => {
    m.resolveSyncConflict.mockResolvedValue(fx.sync_resolved_server);
    renderPage();
    const del = await screen.findByRole('region', { name: '競合: 昼食' });
    expect(within(del).getByRole('button', { name: '削除する(自分の変更を使う)' })).toBeInTheDocument();
    m.getSyncConflicts.mockResolvedValue(fx.sync_conflicts_empty);
    fireEvent.click(within(del).getByRole('button', { name: 'サーバーの内容を残す' }));
    await waitFor(() => expect(m.resolveSyncConflict).toHaveBeenCalledWith('p1', list.conflicts[1]!.operation_id, 'keep_server', undefined));
    expect(await screen.findByText('競合している変更はありません。')).toBeInTheDocument();
    expect(usePlanStore.getState().syncConflictCount).toBe(0);
  });

  it('サーバーで削除された予定の変更は「自分の変更を使う」を出さない。失敗は理由を示す', async () => {
    const gone = { ...list, conflicts: [{ ...list.conflicts[0]!, server_deleted: true, current: null }] };
    m.getSyncConflicts.mockResolvedValue(gone);
    m.resolveSyncConflict.mockRejectedValue({ response: { data: { detail: { code: 'x', message: '解決できません' } } } });
    renderPage();
    const card = await screen.findByRole('region', { name: /競合:/ });
    expect(within(card).queryByRole('button', { name: '自分の変更を使う' })).not.toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: 'サーバーの内容を残す' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('解決できません');
  });
});

describe('SyncStatusBar (Gate P11)', () => {
  it('未同期・競合が無ければ何も出さない。あれば件数と操作を示し、通信回復で送る', async () => {
    usePlanStore.setState({ syncPending: m.syncPending });
    const view = render(<MemoryRouter><SyncStatusBar planId="p1" /></MemoryRouter>);
    expect(view.container).toBeEmptyDOMElement();
    view.unmount();
    localStorage.setItem('tc_sync_queue_p1', JSON.stringify([{ operation_id: 'o', entity_type: 'event', action: 'delete', label: 'x' }]));
    localStorage.setItem('tc_sync_conflicts_p1', '2');
    m.syncPending.mockResolvedValue(undefined);
    render(<MemoryRouter><SyncStatusBar planId="p1" /></MemoryRouter>);
    const bar = await screen.findByRole('region', { name: '同期の状態' });
    expect(bar).toHaveTextContent('未同期の変更 1件');
    expect(bar).toHaveTextContent('同期で競合した変更 2件');
    expect(m.syncPending).toHaveBeenCalledWith('p1');  // 通信できる状態で開いたら送る
    fireEvent.click(within(bar).getByRole('button', { name: '今すぐ同期' }));
    window.dispatchEvent(new Event('online'));
    expect(m.syncPending).toHaveBeenCalledTimes(3);
  });
});
