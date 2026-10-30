/** [Gate OpsCMS] 運用コンソール: 実データだけ・Fake と実の額を混ぜない・鍵の値を出さない・理由つきの操作・Fake の試験の結果。 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({
  getOpsOverview: vi.fn(), getOpsProviders: vi.fn(), getOpsLedger: vi.fn(), getOpsCloud: vi.fn(),
  runOpsFamilyFake: vi.fn(), setOpsProviderSuspended: vi.fn(),
}));
vi.mock('@/services/api/opsConsole', () => api);

import AdminOpsPage from './AdminOpsPage';

const overview = {
  as_of: '2026-10-30T09:00:00+00:00', environment: 'development', policy_version: '2026-10-29.1', month: '2026-10',
  thresholds: { user_warning_jpy: '40.0000', ops_alert_jpy: '45.0000', hard_cap_jpy: '50.0000' },
  fake_usage: { events: 12, estimated_jpy: '49.5500', actual_jpy: '0.0000', label: 'x' },
  live_usage: { providers: {}, estimated_jpy: '0.0000', label: 'y' },
  connected_paid_providers: [], suspended_providers: {}, plan_accounts: { total: 1, by_state: { ops_alert: 1 } },
  open_reservations: 0, cloud_billing: { status: 'unavailable', message: 'Cloud Billing の請求額・予算はアプリから取得していません' },
};
const providers = {
  as_of: 'x', rule: '揃うまで送らない',
  providers: [
    { name: 'openai', label: 'OpenAI · Responses API', purpose: '旅行相談', operations: ['ai.generate'], kind: 'paid',
      registered: false, suspended: false, suspended_reason: null, contract: 'unverified', secret: 'configured',
      secret_setting: 'OPENAI_API_KEY', price_profile: 'known', policy_version: '2026-10-29.1', live_calls: 'disabled',
      month_usage: null, notes: '' },
    { name: 'fake', label: 'Fake Provider', purpose: '試験', operations: ['ai.generate'], kind: 'fake', registered: true,
      suspended: false, suspended_reason: null, contract: 'not_billable', secret: 'not_needed', secret_setting: null,
      price_profile: 'known', policy_version: '2026-10-29.1', live_calls: 'test_only',
      month_usage: { events: 12, estimated_jpy: '49.5500', actual_jpy: '0.0000' }, notes: '' },
  ],
};

const renderPage = () => render(<MemoryRouter><AdminOpsPage /></MemoryRouter>);

describe('AdminOpsPage (Gate OpsCMS)', () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    api.getOpsOverview.mockResolvedValue(overview);
    api.getOpsProviders.mockResolvedValue(providers);
  });

  it('概要: Fake の額と実の提供元の見込みを別の欄に出し、Cloud の請求は取得していないと書く', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: '運用の状態を、ひと目で。' })).toBeInTheDocument();
    expect(await screen.findByText('今月の Fake の試験の額')).toBeInTheDocument();
    expect(screen.getByText('¥49.55')).toBeInTheDocument();
    expect(screen.getByText('今月の実の提供元の見込み')).toBeInTheDocument();
    expect(screen.getByText(/Cloud Billing の請求額・予算はアプリから取得していません/)).toBeInTheDocument();
    expect(screen.getByText(/課金を自動で止める上限ではありません/)).toBeInTheDocument();
    expect(screen.getByText('運用に知らせ(45円〜)')).toBeInTheDocument();
  });

  it('提供元: 鍵は「設定あり」とだけ出し、止めるには理由が要る', async () => {
    api.setOpsProviderSuspended.mockResolvedValue(undefined);
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: 'API・契約と接続' }));
    const row = await screen.findByTestId('ops-provider-openai');
    expect(within(row).getByText('設定あり(値は表示しない)')).toBeInTheDocument();
    expect(within(row).getByText('契約・課金は未確認')).toBeInTheDocument();
    expect(within(row).getByText('無効(送らない)')).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: '止める' }));
    const run = screen.getByRole('button', { name: '実行' });
    expect(run).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/止める理由/), { target: { value: '請求の確認' } });
    fireEvent.click(run);
    await waitFor(() => expect(api.setOpsProviderSuspended).toHaveBeenCalledWith('openai', true, '請求の確認'));
  });

  it('テスト実行: Fake の試験の結果(上限を越えない・40/45円の段・断った理由・外への送信 0回)を出す', async () => {
    api.runOpsFamilyFake.mockResolvedValue({
      as_of: 'x', case: {}, note: 'Fake の提供元の試験です',
      summary: { plan_id: 'p', class: 'free', policy_version: '2026-10-29.1', plan_cap_jpy: '50.0000',
        final_total_jpy: '49.5500', never_over_cap: true, first_user_warning_step: 7, first_ops_alert_step: 9,
        first_denial: { n: 13, reason: 'feature_quota_exceeded' }, settled_steps: 12, denied_steps: 7,
        idempotency_replay: { checked: true, double_counted: false }, provider: 'fake', external_calls: 0 },
      steps: [{ n: 1, operation: 'ai.generate', label: 'AI の案の作成', units: {}, result: 'settled', max_cost_jpy: '0.4554',
        plan_total_jpy: '0.4554', state: 'ok' }],
    });
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: 'テスト実行' }));
    expect(screen.getByText('大阪府枚方市 · 大人4人')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fake で原価の上限を試す' }));
    const summary = await screen.findByTestId('ops-run-summary');
    expect(within(summary).getByText('¥49.55 / ¥50')).toBeInTheDocument();
    expect(within(summary).getByText('7回目から')).toBeInTheDocument();
    expect(within(summary).getByText('13回目 · 回数の上限')).toBeInTheDocument();
    expect(within(summary).getByText('0回')).toBeInTheDocument();
    expect(within(summary).getByText('二重に数えない')).toBeInTheDocument();
    expect(api.runOpsFamilyFake).toHaveBeenCalledWith('家族旅行の Fake の試験');
  });

  it('読めない時は失敗を伝え、もう一度読める(作った値を出さない)', async () => {
    api.getOpsOverview.mockRejectedValueOnce(new Error('403')).mockResolvedValueOnce(overview);
    renderPage();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'もう一度読む' }));
    expect(await screen.findByText('今月の Fake の試験の額')).toBeInTheDocument();
  });
});
