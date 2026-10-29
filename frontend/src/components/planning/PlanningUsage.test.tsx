/**
 * [FR059-B] この旅行の AI・外部検索の利用枠(FC-184)・クラスの表示(FC-181)・管理の二者の承認(FC-185)の画面。
 * docs/spec/FR-059_旅程相談API原価上限_利用者クラス別Quota_v5.1.md §6。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const api = vi.hoisted(() => ({
  getPlanningUsage: vi.fn(), getMyEntitlements: vi.fn(), adminListEntitlements: vi.fn(),
  adminRequestEntitlement: vi.fn(), adminApproveEntitlement: vi.fn(), adminRevokeEntitlement: vi.fn(),
}));
vi.mock('@/services/api/planningUsage', () => api);

import PlanningUsageMeter from './PlanningUsageMeter';
import PlanningClassSummary from './PlanningClassSummary';
import { classLine, usageMessage } from './planningUsageModel';
import AdminEntitlementsPanel from '@/pages/Admin/AdminEntitlementsPanel';
import type { MyEntitlements, PlanningUsage } from '@/services/api/types/planningUsage';

const usage = (over: Partial<PlanningUsage> = {}): PlanningUsage => ({
  plan_id: 'p1', class: 'free', class_label: 'Free', class_source: 'default', policy_version: '2026-10-29.1',
  currency: 'JPY', plan_cap_jpy: '50.0000', plan_used_jpy: '0.0000', plan_reserved_jpy: '0.0000',
  plan_remaining_jpy: '50.0000', plan_used_yen_ceil: 0, plan_cap_yen: 50, warn_at_jpy: '40.0000', state: 'ok',
  monthly_cap_jpy: '50.0000', monthly_used_jpy: '0.0000', plans_per_month: 1, plans_used_this_month: 0,
  counted_this_month: false, reset_at: '2026-11-01T00:00:00+00:00',
  calls: [{ operation: 'ai.generate', label: 'AI の案の作成', feature: 'trip_planning.ai_calls_per_plan', limit: 5, used: 0,
    remaining: 5 }],
  connected_operations: [], providers_connected: false, fallbacks: ['USE_SAVED_CANDIDATES', 'CONTINUE_MANUALLY'],
  ...over,
});

const mine = (over: Partial<MyEntitlements> = {}): MyEntitlements => ({
  class: 'plus', class_label: 'Plus', class_source: 'admin', profile_key: 'plus', policy_version: '2026-10-29.1',
  currency: 'JPY', plan_cap_jpy: '50.0000', monthly_cap_jpy: '250.0000', monthly_used_jpy: '12.3000',
  plans_per_month: 5, plans_used_this_month: 2, reset_at: '2026-11-01T00:00:00+00:00', features: [],
  providers_connected: false, as_of: '2026-10-29T10:00:00+00:00', ...over,
});

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
});

describe('この旅行の利用枠', () => {
  it('旅行の予算と別に 0円 / 50円・クラス・月の枠・未接続を出す', async () => {
    api.getPlanningUsage.mockResolvedValue(usage());
    render(<PlanningUsageMeter planId="p1" />);
    expect(await screen.findByTestId('planning-usage-amount')).toHaveTextContent('0円 / 50円');
    const box = screen.getByTestId('planning-usage');
    expect(box).toHaveTextContent('クラス: Free · 月の枠 0円 / 50円 · 今月の旅行 0 / 1 · 旅行の費用(予算)には足しません');
    expect(screen.getByTestId('planning-usage-unconnected')).toHaveTextContent('未接続です(0円)');
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '0');
    expect(screen.queryByTestId('planning-usage-message')).toBeNull();
    expect(within(screen.getByTestId('planning-usage-calls')).getByText('AI の案の作成: 残り 5 / 5')).toBeInTheDocument();
    expect(api.getPlanningUsage).toHaveBeenCalledWith('p1');
  });

  it('80% で残りが少ない、上限・月の上限で止まった理由と手で続ける方法を出す(色だけにしない)', () => {
    expect(usageMessage(usage({ state: 'warning', plan_remaining_jpy: '9.5000' }))).toMatchObject({
      symbol: '⚠', tone: 'warn', text: expect.stringContaining('残り 10円'),
    });
    const stop = usageMessage(usage({ state: 'limit_reached', plan_used_yen_ceil: 50 }))!;
    expect(stop.text).toContain('利用枠(50円)に達したため');
    expect(stop.text).toContain('作った案と予定はそのまま残ります');
    expect(stop.text).toContain('手での編集・保存した候補');
    expect(usageMessage(usage({ state: 'monthly_plans_reached' }))!.text).toContain('次のリセットは 2026/11/1');
    expect(usageMessage(usage({ state: 'guest' }))!.text).toContain('ゲスト');
    expect(usageMessage(usage())).toBeNull();
  });

  it('上限に達した時は alert、読めない時は呼ばないと知らせる', async () => {
    api.getPlanningUsage.mockResolvedValueOnce(usage({ state: 'limit_reached', plan_used_yen_ceil: 50, providers_connected: true }));
    const { unmount } = render(<PlanningUsageMeter planId="p1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('外部の AI・有料の検索を止めました');
    expect(screen.queryByTestId('planning-usage-unconnected')).toBeNull();
    expect(screen.getByTestId('planning-usage')).toHaveAttribute('data-state', 'limit_reached');
    unmount();
    api.getPlanningUsage.mockRejectedValueOnce(new Error('offline'));
    render(<PlanningUsageMeter planId="p2" />);
    expect(await screen.findByTestId('planning-usage-error')).toHaveTextContent('呼びません');
  });

  it('旅行相談の入口: クラスと今月の枠', async () => {
    expect(classLine(mine())).toBe('クラス: Plus · 1旅行 50円まで · 今月 13円 / 250円 · 今月の旅行 2 / 5');
    expect(classLine(mine({ class: 'guest' }))).toContain('ゲスト');
    api.getMyEntitlements.mockResolvedValue(mine());
    render(<PlanningClassSummary />);
    expect(await screen.findByTestId('planning-class-summary')).toHaveTextContent('外部の有料の提供元は未接続(0円)');
  });
});

describe('管理: 二者の承認', () => {
  it('申請 → 承認 → 取り消し(理由が要る)', async () => {
    const pending = { id: 'g1', subject_type: 'user' as const, subject_id: '11111111-1111-4111-8111-111111111111',
      feature_key: 'trip_planning.class.plus', status: 'pending' as const, quota: null, source: 'admin', reason: '契約',
      starts_at: null, ends_at: null, requested_by: 'a', approved_by: null, approved_at: null };
    api.adminListEntitlements.mockResolvedValueOnce({ grants: [], effective: mine({ class: 'free', class_label: 'Free' }) })
      .mockResolvedValueOnce({ grants: [pending] })
      .mockResolvedValueOnce({ grants: [{ ...pending, status: 'active' }] })
      .mockResolvedValue({ grants: [{ ...pending, status: 'revoked' }] });
    api.adminRequestEntitlement.mockResolvedValue(pending);
    api.adminApproveEntitlement.mockResolvedValue({ ...pending, status: 'active' });
    api.adminRevokeEntitlement.mockResolvedValue({ ...pending, status: 'revoked' });
    render(<AdminEntitlementsPanel />);
    fireEvent.change(screen.getByLabelText('ID'), { target: { value: pending.subject_id } });
    fireEvent.click(screen.getByRole('button', { name: '表示' }));
    expect(await screen.findByTestId('ent-effective')).toHaveTextContent('今のクラス: Free');
    fireEvent.change(screen.getByLabelText('付与する内容'), { target: { value: 'trip_planning.class.plus' } });
    expect(screen.getByRole('button', { name: '申請する' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('理由(申請・取り消しに必須)'), { target: { value: '年間の契約' } });
    fireEvent.click(screen.getByRole('button', { name: '申請する' }));
    expect(await screen.findByRole('status')).toHaveTextContent('別の管理者の承認で有効になります');
    expect(api.adminRequestEntitlement).toHaveBeenCalledWith({ subject_type: 'user', subject_id: pending.subject_id,
      feature_key: 'trip_planning.class.plus', reason: '年間の契約' });
    fireEvent.click(await screen.findByRole('button', { name: '承認' }));
    await waitFor(() => expect(api.adminApproveEntitlement).toHaveBeenCalledWith('g1'));
    fireEvent.click(await screen.findByRole('button', { name: '取り消す' }));
    await waitFor(() => expect(api.adminRevokeEntitlement).toHaveBeenCalledWith('g1', '年間の契約'));
    expect(await screen.findByText('取り消し')).toBeInTheDocument();
  });

  it('失敗(同じ管理者の承認など)を画面に出す', async () => {
    const pending = { id: 'g1', subject_type: 'user' as const, subject_id: '11111111-1111-4111-8111-111111111111',
      feature_key: 'trip_planning.class.plus', status: 'pending' as const, quota: null, source: 'admin', reason: '契約',
      starts_at: null, ends_at: null, requested_by: 'a', approved_by: null, approved_at: null };
    api.adminListEntitlements.mockResolvedValue({ grants: [pending] });
    api.adminApproveEntitlement.mockRejectedValue({ response: { status: 409, data: { detail: {
      code: 'two_person_required', message: '申請した管理者とは別の管理者が承認してください' } } } });
    render(<AdminEntitlementsPanel />);
    fireEvent.change(screen.getByLabelText('ID'), { target: { value: pending.subject_id } });
    fireEvent.click(screen.getByRole('button', { name: '表示' }));
    fireEvent.click(await screen.findByRole('button', { name: '承認' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('別の管理者が承認してください');
  });
});
