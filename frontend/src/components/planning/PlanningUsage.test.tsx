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
import { classLine, tierName, usageMessage } from './planningUsageModel';
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

  it('[G11-Layout] 読み込み中も読めない時も、同じ見出し・帯の枠で場所を確保し、もう一度読める', async () => {
    let resolve: (u: PlanningUsage) => void = () => undefined;
    api.getPlanningUsage.mockReturnValueOnce(new Promise<PlanningUsage>((r) => { resolve = r; }));
    const { unmount } = render(<PlanningUsageMeter planId="p1" />);
    const loading = screen.getByTestId('planning-usage-loading');
    expect(loading).toHaveAttribute('aria-busy', 'true');
    expect(within(loading).getByRole('heading', { name: 'この旅行の AI・外部検索の利用枠' })).toBeInTheDocument();
    expect(within(loading).getByRole('status')).toHaveTextContent('利用枠を読み込んでいます');
    // 読み終わる前に値(金額・残り)を作らない
    expect(screen.queryByRole('meter')).toBeNull();
    resolve(usage());
    expect(await screen.findByTestId('planning-usage')).toBeInTheDocument();
    expect(screen.queryByTestId('planning-usage-loading')).toBeNull();
    unmount();

    api.getPlanningUsage.mockRejectedValueOnce(new Error('offline'));
    render(<PlanningUsageMeter planId="p2" />);
    const failed = await screen.findByTestId('planning-usage-failed');
    expect(failed).toHaveAttribute('aria-busy', 'false');
    expect(within(failed).getByRole('heading', { name: 'この旅行の AI・外部検索の利用枠' })).toBeInTheDocument();
    expect(failed).toHaveTextContent('予定の編集・保存はそのまま使えます');
    api.getPlanningUsage.mockResolvedValueOnce(usage());
    fireEvent.click(within(failed).getByRole('button', { name: 'もう一度読む' }));
    expect(await screen.findByTestId('planning-usage-amount')).toHaveTextContent('0円 / 50円');
    expect(api.getPlanningUsage).toHaveBeenCalledTimes(3);
  });

  it('[G11-UsageLayout] 全ての状態で同じ行の並び(見出し・帯・クラス 1行・知らせ 2行分・詳しく)。全文は「詳しく」と読み上げで読める', async () => {
    const rows = (box: HTMLElement) => Array.from(box.children).map((el) => el.className.split(' ')
      .filter((c) => /^(mt-\d|h-\d+)$/.test(c)).join(' '));
    const shape: string[][] = [];
    const states: Array<Partial<PlanningUsage>> = [
      {}, { state: 'warning', plan_remaining_jpy: '9.0000', providers_connected: true },
      { state: 'limit_reached', plan_used_yen_ceil: 50, providers_connected: true },
      { state: 'monthly_plans_reached', providers_connected: true },
      { state: 'guest', class: 'guest', class_label: 'Guest' },
    ];
    for (const over of states) {
      api.getPlanningUsage.mockResolvedValueOnce(usage(over));
      const { unmount } = render(<PlanningUsageMeter planId="p1" />);
      const box = await screen.findByTestId('planning-usage');
      shape.push(rows(box));
      expect(screen.getByTestId('planning-usage-class').className).toContain('truncate');
      const msg = screen.queryByTestId('planning-usage-message');
      if (msg) {
        // 見た目は 2行まで。全文は要素の中(読み上げ)と「詳しく」の中にある
        expect(msg.className).toContain('h-10');
        expect(within(screen.getByTestId('planning-usage-details')).getByText(usageMessage(usage(over))!.text)).toBeInTheDocument();
      }
      unmount();
    }
    let resolve: (u: PlanningUsage) => void = () => undefined;
    api.getPlanningUsage.mockReturnValueOnce(new Promise<PlanningUsage>((r) => { resolve = r; }));
    const { unmount } = render(<PlanningUsageMeter planId="p1" />);
    shape.push(rows(screen.getByTestId('planning-usage-loading')));
    resolve(usage());
    await screen.findByTestId('planning-usage');
    unmount();
    api.getPlanningUsage.mockRejectedValueOnce(new Error('offline'));
    render(<PlanningUsageMeter planId="p2" />);
    shape.push(rows(await screen.findByTestId('planning-usage-failed')));
    // 7 つの状態の全てで、行の数・高さ・余白が同じ
    expect(new Set(shape.map((x) => x.join('|'))).size).toBe(1);
    expect(shape[0]).toEqual(['h-5', 'mt-2 h-2', 'mt-1 h-4', 'mt-2 h-10', 'mt-2']);
  });

  it('旅行相談の入口: クラスと今月の枠', async () => {
    expect(classLine(mine())).toBe('クラス: Plus · 1旅行 50円まで · 今月 13円 / 250円 · 今月の旅行 2 / 5');
    expect(classLine(mine({ class: 'guest' }))).toContain('ゲスト');
    api.getMyEntitlements.mockResolvedValue(mine());
    render(<PlanningClassSummary />);
    expect(await screen.findByTestId('planning-class-summary')).toHaveTextContent('外部の有料の提供元は未接続(0円)');
  });
});

describe('[Gate FR059-Tiers] 会員の機能クラス', () => {
  const tier = (key: 'free' | 'trip' | 'journey' | 'explorer', subtitle: string, operations: string[]) => ({
    key, label: key.charAt(0).toUpperCase() + key.slice(1), subtitle, summary: 's', operations,
    ai: operations.some((o) => o.startsWith('ai.')), paid_api: operations.length > 0,
  });

  it('Free は手で作るクラスとして案内し、0円・外部の AI なしと出す(上限に達したとは言わない)', async () => {
    const free = usage({ state: 'manual_only', policy_version: '2026-10-31.1', monthly_cap_jpy: null,
      monthly_used_jpy: null, plans_per_month: null, tier: tier('free', '自分でつくる', []),
      calls: [{ operation: 'ai.generate', label: 'AI の案の作成', feature: 'trip_planning.ai_calls_per_plan', limit: 0,
        used: 0, remaining: 0, included: false }] });
    const m = usageMessage(free)!;
    expect(m.tone).toBe('muted');
    expect(m.text).toContain('外部の AI・有料の検索を使いません(0円)');
    expect(m.text).toContain('手入力・保存・無料の地図と検索');
    api.getPlanningUsage.mockResolvedValue(free);
    render(<PlanningUsageMeter planId="p1" />);
    expect(await screen.findByTestId('planning-usage')).toHaveAttribute('data-state', 'manual_only');
    expect(screen.getByTestId('planning-usage-class')).toHaveTextContent('クラス: Free(自分でつくる)');
    expect(screen.getByTestId('planning-usage-message')).toHaveAttribute('role', 'status');
    expect(within(screen.getByTestId('planning-usage-calls')).getByText('AI の案の作成: このクラスに含まない'))
      .toBeInTheDocument();
  });

  it('クラスの名前に日本語の副題を付け、旧クラスはそのまま', () => {
    expect(tierName({ class_label: 'Journey', tier: tier('journey', '計画を一緒に考える', ['ai.generate']) }))
      .toBe('Journey(計画を一緒に考える)');
    expect(tierName({ class_label: 'Plus', tier: { ...tier('free', 'x', []), key: null, subtitle: null } })).toBe('Plus');
    expect(tierName({ class_label: 'Plus' })).toBe('Plus');
    expect(classLine(mine({ class: 'free', class_label: 'Free', monthly_cap_jpy: null, plans_per_month: null,
      tier: tier('free', '自分でつくる', []) }))).toBe('クラス: Free(自分でつくる) · 外部の AI・有料の検索なし(0円)');
    expect(classLine(mine({ class: 'explorer', class_label: 'Explorer',
      tier: tier('explorer', '比較して深掘りする', ['ai.generate', 'ai.web_search']) })))
      .toBe('クラス: Explorer(比較して深掘りする) · 1旅行 50円まで · 今月 13円 / 250円 · 今月の旅行 2 / 5');
  });

  it('含む操作は残りの回数を出す', async () => {
    api.getPlanningUsage.mockResolvedValue(usage({ class: 'trip', class_label: 'Trip',
      tier: tier('trip', '行先を見つける', ['places.search']),
      calls: [
        { operation: 'places.search', label: '場所の検索', feature: 'f', limit: 2, used: 1, remaining: 1, included: true },
        { operation: 'ai.generate', label: 'AI の案の作成', feature: 'g', limit: 0, used: 0, remaining: 0, included: false },
      ] }));
    render(<PlanningUsageMeter planId="p1" />);
    const calls = await screen.findByTestId('planning-usage-calls');
    expect(within(calls).getByText('場所の検索: 残り 1 / 2')).toBeInTheDocument();
    expect(within(calls).getByText('AI の案の作成: このクラスに含まない')).toBeInTheDocument();
  });

  it('管理の付与に 4つのクラスを出す(旧クラスと分ける)', async () => {
    api.adminListEntitlements.mockResolvedValue({ grants: [] });
    render(<AdminEntitlementsPanel />);
    fireEvent.change(screen.getByLabelText('ID'), { target: { value: '11111111-1111-4111-8111-111111111111' } });
    fireEvent.click(screen.getByRole('button', { name: '表示' }));
    const select = await screen.findByLabelText('付与する内容');
    const values = Array.from((select as HTMLSelectElement).options).map((o) => o.value);
    expect(values).toEqual(expect.arrayContaining(['trip_planning.class.trip', 'trip_planning.class.journey',
      'trip_planning.class.explorer']));
    expect(screen.getByText(/旧クラス Plus/)).toBeInTheDocument();
    expect(screen.getByText(/会員は Free: 外部の AI・有料の検索なし/)).toBeInTheDocument();
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
