/**
 * [Gate P10] AlertsPage / ReplanPage(SC-24 アラート・再計画)の画面テスト。
 *
 * - 一覧: 対応中・解決済み、検出した経路の遅延から登録欄へ入れる、閲覧者は登録・再計画できない
 * - 登録: 種類ごとの入力と送信内容、入力誤りの表示
 * - 再計画: 案A/Bの比較(変わる・外す・守る予定、費用、通知)、承認の確認→適用、古い案は適用できず作り直しを案内
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import type { AlertList, Replan } from '@/services/api';

const m = vi.hoisted(() => ({
  getPlanDetail: vi.fn(),
  getAlerts: vi.fn(),
  createAlert: vi.fn(),
  updateAlert: vi.fn(),
  createReplan: vi.fn(),
  getReplan: vi.fn(),
  applyReplan: vi.fn(),
  rejectReplan: vi.fn(),
}));

vi.mock('@/services/api', () => ({
  default: { getPlanDetail: m.getPlanDetail },
  getAlerts: m.getAlerts, createAlert: m.createAlert, updateAlert: m.updateAlert, createReplan: m.createReplan,
  getReplan: m.getReplan, applyReplan: m.applyReplan, rejectReplan: m.rejectReplan,
}));

import AlertsPage from './AlertsPage';
import ReplanPage from './ReplanPage';

const list = fx.alert_list as AlertList;
const created = fx.replan_created as Replan;
const closure = fx.replan_closure as Replan;
const DAY = list.alerts[0]!.day_id!;

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/planner/:planId/alerts" element={<AlertsPage />} />
        <Route path="/planner/:planId/replans/:replanId" element={<ReplanPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.getPlanDetail.mockResolvedValue({ success: true, message: '', data: { id: 'p1', title: '旅', revision: 8, days: [
    { id: DAY, local_date: '2026-11-01', timezone_id: 'Asia/Tokyo', sort_order: 0, events: [
      { id: 'e1', day_id: DAY, title: '新幹線', event_type: 'transport', local_start_time: '09:00', is_all_day: false, locked: false, sort_order: 0 },
      { id: 'e2', day_id: DAY, title: '終日の散策', event_type: 'sightseeing', local_start_time: null, is_all_day: true, locked: false, sort_order: 1 },
    ] },
  ] } });
  m.getAlerts.mockResolvedValue(list);
  m.createAlert.mockResolvedValue(fx.alert_created);
  m.createReplan.mockResolvedValue(closure);
  m.getReplan.mockResolvedValue(closure);
  window.confirm = vi.fn(() => true);
});

describe('AlertsPage (Gate P10)', () => {
  it('対応中・解決済みと、検出した経路の遅延を示す', async () => {
    renderAt('/planner/p1/alerts');
    const active = await screen.findByRole('list', { name: '対応中の状況' });
    expect(active).toHaveTextContent('休業・中止');
    expect(active).toHaveTextContent('庭園散策');
    expect(screen.getByRole('list', { name: '解決・取り下げた状況' })).toHaveTextContent('再計画: 適用済み');
    const detected = screen.getByRole('list', { name: '見つかった遅延・運休' });
    expect(detected).toHaveTextContent('料亭で昼食へ向かう経路が遅延');
    fireEvent.click(within(detected).getByRole('button', { name: '状況として登録' }));
    expect(await screen.findByText(/「料亭で昼食」の状況を下の欄に入れました/)).toBeInTheDocument();
    expect(screen.getByLabelText('情報源(任意)')).toHaveValue('登録済み経路の運行状態');
  });

  it('遅延を登録する: 時刻のある予定だけ選べ、送信内容を検証する', async () => {
    renderAt('/planner/p1/alerts');
    await screen.findByRole('list', { name: '対応中の状況' });
    const select = screen.getByLabelText('影響を受ける予定');
    expect(within(select).queryByText(/終日の散策/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '登録する' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('影響を受ける予定を選んでください');
    fireEvent.change(select, { target: { value: 'e1' } });
    fireEvent.change(screen.getByLabelText('遅れの見込み(分)'), { target: { value: '120' } });
    fireEvent.change(screen.getByLabelText('情報源(任意)'), { target: { value: '駅の掲示' } });
    fireEvent.click(screen.getByRole('radio', { name: '確認済み' }));
    fireEvent.click(screen.getByRole('button', { name: '登録する' }));
    await waitFor(() => expect(m.createAlert).toHaveBeenCalledWith('p1', {
      kind: 'delay', source: 'user_report', confidence: 'confirmed', event_id: 'e1', delay_minutes: 120, source_label: '駅の掲示',
    }));
    await waitFor(() => expect(m.getAlerts).toHaveBeenCalledTimes(2));
  });

  it('雨天は日を選ぶ。再計画案を作ると案の画面へ移る。取り下げはrevisionを送る', async () => {
    renderAt('/planner/p1/alerts');
    const active = await screen.findByRole('list', { name: '対応中の状況' });
    fireEvent.click(screen.getByRole('radio', { name: /雨天・警報/ }));
    expect(screen.getByLabelText('影響を受ける日')).toBeInTheDocument();
    expect(screen.queryByLabelText('遅れの見込み(分)')).not.toBeInTheDocument();
    m.updateAlert.mockResolvedValue({ ...list.alerts[0], status: 'dismissed' });
    fireEvent.click(within(active).getByRole('button', { name: '取り下げる' }));
    await waitFor(() => expect(m.updateAlert).toHaveBeenCalledWith('p1', list.alerts[0]!.id, { status: 'dismissed' }, 1));
    fireEvent.click(within(active).getByRole('button', { name: '再計画案を作る' }));
    expect(await screen.findByRole('heading', { name: '再計画案の比較' })).toBeInTheDocument();
    expect(m.createReplan).toHaveBeenCalledWith('p1', list.alerts[0]!.id);
  });

  it('閲覧者は登録・再計画できない', async () => {
    m.getAlerts.mockResolvedValue({ ...list, can_edit: false });
    renderAt('/planner/p1/alerts');
    await screen.findByRole('list', { name: '対応中の状況' });
    expect(screen.queryByRole('button', { name: '登録する' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '再計画案を作る' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '状況として登録' })).not.toBeInTheDocument();
  });
});

describe('ReplanPage (Gate P10)', () => {
  it('案A/Bを比べ、確認のうえ選んだ案を本案のrevisionで適用する', async () => {
    m.applyReplan.mockResolvedValue({ replan: { ...closure, status: 'applied', state: 'applied', applied_candidate: 'B', can_apply: false }, plan_revision: 9 });
    renderAt(`/planner/p1/replans/${closure.id}`);
    const a = await screen.findByRole('region', { name: '案A' });
    const b = screen.getByRole('region', { name: '案B' });
    expect(a).toHaveTextContent('予定を外す');
    expect(within(a).getByText('庭園散策')).toBeInTheDocument();
    expect(a).toHaveTextContent('12:00 料亭で昼食(予約あり)');
    expect(b).toHaveTextContent('庭園散策: 11/1 14:00 → 11/2 14:00');
    expect(b).toHaveTextContent('費用: 外す予定に支払い済みの費用はありません');
    expect(b).toHaveTextContent('通知する人:');
    fireEvent.click(within(b).getByRole('button', { name: '案Bで旅程を変更する' }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('案B「翌日へ移す」で旅程を変更します'));
    await waitFor(() => expect(m.applyReplan).toHaveBeenCalledWith('p1', closure.id, 'B', closure.plan_revision));
    expect(await screen.findByText(/案Bで旅程を変更しました/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '案Aで旅程を変更する' })).not.toBeInTheDocument();
  });

  it('確認で取り消すと適用しない。使えない案は理由を示す', async () => {
    m.getReplan.mockResolvedValue(fx.replan_weather_last_day);
    window.confirm = vi.fn(() => false);
    renderAt('/planner/p1/replans/r1');
    const b = await screen.findByRole('region', { name: '案B' });
    expect(b).toHaveTextContent('この案は使えません: 翌日の日程がないため使えません');
    expect(within(b).queryByRole('button')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '案Aで旅程を変更する' }));
    expect(m.applyReplan).not.toHaveBeenCalled();
  });

  it('古い案は適用できず作り直しを案内する。適用時の409も同じ', async () => {
    m.getReplan.mockResolvedValue(fx.replan_stale);
    renderAt('/planner/p1/replans/r1');
    expect(await screen.findByText(/この案を作った後に旅程が変わったため/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '案Aで旅程を変更する' })).not.toBeInTheDocument();
    m.createReplan.mockResolvedValue({ ...closure, id: 'r2' });
    fireEvent.click(screen.getByRole('button', { name: '案を作り直す' }));
    await waitFor(() => expect(m.createReplan).toHaveBeenCalledWith('p1', closure.alert_id));
  });

  it('適用で409(replan_stale)なら理由を示して読み直す。同じ結果の案はその旨を示す', async () => {
    m.getReplan.mockResolvedValue(created);
    m.applyReplan.mockRejectedValue({ response: { status: 409, data: fx.replan_stale_error } });
    renderAt('/planner/p1/replans/r1');
    expect(await screen.findByText('この状況では、案Aと案Bの結果は同じです。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '案Aで旅程を変更する' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('もう一度再計画案を作ってください');
    expect(m.getReplan).toHaveBeenCalledTimes(2);
  });

  it('どちらも採用しない', async () => {
    m.rejectReplan.mockResolvedValue({ ...closure, status: 'rejected', state: 'rejected', can_apply: false });
    renderAt('/planner/p1/replans/r1');
    fireEvent.click(await screen.findByRole('button', { name: 'どちらも採用しない' }));
    await waitFor(() => expect(m.rejectReplan).toHaveBeenCalledWith('p1', closure.id, closure.revision));
    expect(await screen.findByText(/状態: 採用せず/)).toBeInTheDocument();
  });
});
