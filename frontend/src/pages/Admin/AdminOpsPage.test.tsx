/** [Gate OpsCMS] 運用コンソール: 実データだけ・Fake と実の額を混ぜない・鍵の値を出さない・理由つきの操作・Fake の試験の結果。 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({
  getOpsOverview: vi.fn(), getOpsProviders: vi.fn(), getOpsLedger: vi.fn(), getOpsCloud: vi.fn(),
  runOpsFamilyFake: vi.fn(), setOpsProviderSuspended: vi.fn(), getOpsSecrets: vi.fn(), registerOpsSecret: vi.fn(), importOpsSecretFromEnv: vi.fn(), verifyOpsSecret: vi.fn(), activateOpsSecret: vi.fn(), discardOpsSecret: vi.fn(),
  disableOpsSecret: vi.fn(), getOpsTiers: vi.fn(), switchOpsTestTier: vi.fn(),
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
  free_usage: { providers: { overpass: { requests: 3, events: 3 }, nominatim: { requests: 2, events: 1 } }, requests: 5,
    label: '無料の provider へ送った回数' },
};
const providers = {
  as_of: 'x', rule: '揃うまで送らない',
  providers: [
    { name: 'openai', label: 'OpenAI · Responses API', purpose: '旅行相談', operations: ['ai.generate'], kind: 'paid',
      registered: false, suspended: false, suspended_reason: null, contract: 'unverified', secret: 'configured',
      secret_setting: 'OPENAI_API_KEY', price_profile: 'known', policy_version: '2026-10-29.1', live_calls: 'disabled',
      month_usage: null, notes: '', adapter: 'not_implemented', secret_storage: 'アプリの DB(provider_secrets 表・ENCRYPTION_KEY で暗号化)' },
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
    expect(screen.getByTestId('ops-free-usage')).toHaveTextContent('5回');
    expect(screen.getByTestId('ops-free-usage')).toHaveTextContent('overpass・nominatim · 0円 · 50円の枠の外');
  });

  it('提供元: 鍵は「設定あり」とだけ出し、止めるには理由が要る', async () => {
    api.setOpsProviderSuspended.mockResolvedValue(undefined);
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: 'API・契約と接続' }));
    const row = await screen.findByTestId('ops-provider-openai');
    expect(within(row).getByText('登録済み・提供元の認証は未確認(値は表示しない)')).toBeInTheDocument();
    expect(within(row).getByText('未実装(送らない)')).toBeInTheDocument();
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
    expect(api.runOpsFamilyFake).toHaveBeenCalledWith('家族旅行の Fake の試験', 'explorer');
  });

  it('読めない時は失敗を伝え、もう一度読める(作った値を出さない)', async () => {
    api.getOpsOverview.mockRejectedValueOnce(new Error('403')).mockResolvedValueOnce(overview);
    renderPage();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'もう一度読む' }));
    expect(await screen.findByText('今月の Fake の試験の額')).toBeInTheDocument();
  });

  it('秘密情報: 保管先が暫定・未接続を示し、状態を「鍵あり」とまとめず、旧 .env は明示の取り込みだけ', async () => {
    const base = { slot: 'openai_api_key', label: 'OpenAI の API キー', providers: ['openai'], env: 'OPENAI_API_KEY', hint: 'sk-',
      source: null, version: null, last4: null, registered_at: null, history: [], in_use: false };
    api.getOpsSecrets.mockResolvedValue({
      as_of: 'x', note: 'n', backend: 'db_encrypted', backend_note: '暫定: DB に暗号化。「高セキュリティ移行完了」ではありません',
      slots: [
        { ...base, status: 'disabled', env_legacy: { present: true, placeholder: false, importable: true } },
        { ...base, slot: 'google_maps_server_key', label: 'サーバー用', status: 'placeholder',
          env_legacy: { present: true, placeholder: true, importable: false } },
      ],
    });
    api.importOpsSecretFromEnv.mockResolvedValue({ slot: 'openai_api_key', status: 'configured', source: 'cms', version: 2,
      last4: 'BBBB', registered_at: null });
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: '秘密情報・権限' }));
    expect(await screen.findByTestId('ops-secret-backend')).toHaveTextContent('保管先: 暫定(DB に暗号化)');
    const a = screen.getByTestId('ops-secret-openai_api_key');
    expect(within(a).getByText('無効化済み(送らない)')).toBeInTheDocument();
    expect(screen.queryByText('鍵あり')).toBeNull();
    expect(within(screen.getByTestId('ops-secret-google_maps_server_key')).getByText('サンプル値(使えない)')).toBeInTheDocument();
    expect(screen.getByTestId('ops-secret-legacy-google_maps_server_key')).toHaveTextContent('サンプル値');
    expect(within(screen.getByTestId('ops-secret-google_maps_server_key'))
      .queryByRole('button', { name: '旧 .env から取り込む' })).toBeNull();
    fireEvent.click(within(a).getByRole('button', { name: '旧 .env から取り込む' }));
    const go = within(a).getByRole('button', { name: '取り込んで暗号化して保存' });
    expect(go).toBeDisabled();
    fireEvent.change(within(a).getByLabelText('理由(監査に残ります)'), { target: { value: '移行' } });
    fireEvent.click(go);
    await waitFor(() => expect(api.importOpsSecretFromEnv).toHaveBeenCalledWith('openai_api_key', '移行'));
  });

  it('秘密情報: 確認は明示の操作・候補は確認が通るまで有効にできない・有効な版は残る', async () => {
    const v = (state: string) => ({ state, provider_auth: state, code: null, verified_at: null,
      expires_at: state === 'accepted' ? '2026-11-04T00:00:00+00:00' : null, capabilities: {} });
    const slot = (candState: string) => ({ slot: 'openai_api_key', label: 'OpenAI の API キー', providers: ['openai'],
      env: 'OPENAI_API_KEY', hint: 'sk-', status: 'configured', source: 'cms', version: 1, last4: 'AAAA', registered_at: null,
      history: [], in_use: true, verify_supported: true, verification: v('accepted'),
      candidate: { version: 2, last4: 'BBBB', registered_at: null, format: 'acceptable', verification: v(candState) } });
    api.getOpsSecrets.mockResolvedValueOnce({ as_of: 'x', note: 'n', backend: 'db_encrypted', backend_note: '暫定', model: 'gpt-5-nano',
      verify_budget: { cap_jpy: '50.0000', used_jpy: '6.1000', remaining_jpy: '43.9000', day: '2026-11-01', note: 'n' },
      slots: [slot('unverified')] });
    api.getOpsSecrets.mockResolvedValue({ as_of: 'x', note: 'n', backend: 'db_encrypted', backend_note: '暫定',
      slots: [slot('accepted')] });
    api.verifyOpsSecret.mockResolvedValue({ slot: 'openai_api_key', version: 2, provider_auth: 'accepted', code: 'accepted',
      results: [{ check: 'openai:ai.generate', code: 'accepted', label: '利用可能(この操作で確認)' }], estimated_cost_jpy: '0.0300' });
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: '秘密情報・権限' }));
    expect(await screen.findByTestId('ops-verify-budget')).toHaveTextContent('6.1000円 / 50.0000円');
    expect(screen.getByTestId('ops-secret-verify-openai_api_key')).toHaveTextContent('確認済み(期限内)');
    const row = screen.getByTestId('ops-secret-openai_api_key');
    expect(screen.getByTestId('ops-secret-candidate-openai_api_key')).toHaveTextContent('候補: 版 2 · 末尾 BBBB');
    expect(within(row).queryByRole('button', { name: '候補を有効にする' })).toBeNull();
    expect(api.verifyOpsSecret).not.toHaveBeenCalled(); // 画面を開いただけでは確認しない
    fireEvent.click(within(row).getByRole('button', { name: '候補の有効性を確認' }));
    fireEvent.change(within(row).getByLabelText('理由(監査に残ります)'), { target: { value: '入れ替え' } });
    fireEvent.click(within(row).getByRole('button', { name: '提供元へ確認を送る' }));
    await waitFor(() => expect(api.verifyOpsSecret).toHaveBeenCalledWith('openai_api_key', 2, '入れ替え'));
    expect(await screen.findByRole('status')).toHaveTextContent('利用可能(この操作で確認)');
    api.activateOpsSecret.mockResolvedValue({ slot: 'openai_api_key', status: 'configured', source: 'cms', version: 2,
      last4: 'BBBB', registered_at: null });
    const row2 = await screen.findByTestId('ops-secret-openai_api_key');
    fireEvent.click(await within(row2).findByRole('button', { name: '候補を有効にする' }));
    fireEvent.change(within(row2).getByLabelText('理由(監査に残ります)'), { target: { value: '切替' } });
    fireEvent.click(within(row2).getByRole('button', { name: '有効にする' }));
    await waitFor(() => expect(api.activateOpsSecret).toHaveBeenCalledWith('openai_api_key', 2, 1, '切替'));
  });

  it('秘密情報: 保管先が未設定なら「未接続(送らない)」と出す', async () => {
    api.getOpsSecrets.mockResolvedValue({ as_of: 'x', note: 'n', backend: 'unset', backend_note: '未設定です。送りません', slots: [] });
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: '秘密情報・権限' }));
    expect(await screen.findByTestId('ops-secret-backend')).toHaveTextContent('保管先: 未接続(送らない)');
  });

  it('秘密情報: 鍵は password の欄で送り、保存の後は欄を空にして値を出さない。理由が無ければ送れない', async () => {
    const slots = {
      as_of: 'x', note: '鍵の値は出しません',
      storage: { location: 'アプリの DB(provider_secrets 表・ENCRYPTION_KEY で暗号化)', not_secret_manager: 'GCP Secret Manager には登録しません',
        backup: 'ENCRYPTION_KEY を失うと復号できない', rotation: '掛け直し', fallback: '.env へは戻らない' },
      slots: [{ slot: 'openai_api_key', label: 'OpenAI の API キー', providers: ['openai'], env: 'OPENAI_API_KEY', hint: 'sk-',
        status: 'missing', source: null, version: null, last4: null, registered_at: null, history: [], in_use: false,
        in_use_note: 'アプリはまだこの鍵を使いません' }],
    };
    api.getOpsSecrets.mockResolvedValue(slots);
    api.registerOpsSecret.mockResolvedValue({ slot: 'openai_api_key', status: 'configured', source: 'cms', version: 1,
      last4: '1234', registered_at: null });
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: '秘密情報・権限' }));
    const row = await screen.findByTestId('ops-secret-openai_api_key');
    expect(within(row).getByText('未設定')).toBeInTheDocument();
    expect(screen.getByTestId('ops-secret-use-openai_api_key')).toHaveTextContent('まだこの鍵を使いません');
    expect(screen.getByTestId('ops-secret-storage')).toHaveTextContent('GCP Secret Manager には登録しません');
    expect(screen.getByText('アプリの DB(provider_secrets 表・ENCRYPTION_KEY で暗号化)')).toBeInTheDocument();
    expect(screen.queryByText(/→ \.env/)).toBeNull(); // .env へ戻る順を書かない
    fireEvent.click(within(row).getByRole('button', { name: '鍵を登録する' }));
    const input = within(row).getByTestId('secret-openai_api_key-value') as HTMLInputElement;
    expect(input.type).toBe('password');
    fireEvent.change(input, { target: { value: 'sk-test-value-ABCD1234' } });
    const save = within(row).getByRole('button', { name: '暗号化して保存' });
    expect(save).toBeDisabled();
    fireEvent.change(within(row).getByLabelText('理由(監査に残ります)'), { target: { value: '初回の登録' } });
    fireEvent.click(save);
    await waitFor(() => expect(api.registerOpsSecret).toHaveBeenCalledWith('openai_api_key', 'sk-test-value-ABCD1234', '初回の登録'));
    expect(await screen.findByText(/版 1 · 末尾 1234/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('sk-test-value-ABCD1234');
    expect(screen.queryByTestId('secret-openai_api_key-value')).toBeNull();
  });

  it('[Gate FR059-Tiers] 会員クラス: 4つのクラスの比較・機能の表・試験の切り替え(理由つき)', async () => {
    const t = (key: string, label: string, subtitle: string, ops: string[], worst: string, monthly: string | null) => ({
      key, label, subtitle, summary: 's', operations: ops, ai: ops.some((o) => o.startsWith('ai.')), paid_api: ops.length > 0,
      profile: 'known', policy_version: '2026-10-31.1', plan_cap_jpy: '50.0000', monthly_cap_jpy: monthly,
      plans_per_month: monthly ? 5 : null, quotas: {}, worst_case_plan_jpy: worst, fits_plan_cap: true,
    });
    api.getOpsTiers.mockResolvedValue({
      as_of: 'x', policy_version: '2026-10-31.1', rule: 'どのクラスでも 1旅行の有料の原価は 50円まで',
      tiers: [t('free', 'Free', '自分でつくる', [], '0.0000', null),
        t('trip', 'Trip', '行先を見つける', ['places.search'], '28.2348', '150.0000'),
        t('journey', 'Journey', '計画を一緒に考える', ['places.search', 'ai.generate'], '29.6010', '150.0000'),
        t('explorer', 'Explorer', '比較して深掘りする', ['places.search', 'ai.generate', 'ai.web_search'], '49.5480', '250.0000')],
      features: [{ key: 'ai_planning', label: 'AI による旅程の案', free: '—', trip: '—', journey: '△', explorer: '△',
        enforcement: 'server', note: '明示の操作の時だけ' }],
      legacy: [{ legacy: 'Plus', rule: '一律に変えない' }],
      thresholds: { user_warning_jpy: '40.0000', ops_alert_jpy: '45.0000', hard_cap_jpy: '50.0000' },
      test_switch: { enabled: true, hours: 24, note: '開発環境の試験だけ' },
    });
    api.switchOpsTestTier.mockResolvedValue({ user_id: 'u', requested: 'journey', before: 'free',
      effective: { class: 'journey', class_label: 'Journey' }, revoked_test_grants: 0, expires_in_hours: 24,
      note: '新しいクラスの試験の付与は 24時間で切れます。' });
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: '会員クラス' }));
    const table = await screen.findByTestId('ops-tiers-table');
    expect(table).toHaveTextContent('なし(手入力・無料の検索だけ)');
    expect(table).toHaveTextContent('¥49.55');
    expect(within(table).getAllByText('50円以内')).toHaveLength(4);
    expect(screen.getByTestId('ops-tiers-features')).toHaveTextContent('サーバーが断る');
    expect(screen.getByText(/¥40 で利用者に警告 · ¥45 で運用に知らせ · ¥50 を越える見込み/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('理由(監査に残ります)'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: '切り替える' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('理由(監査に残ります)'), { target: { value: '家族旅行の確認' } });
    fireEvent.click(screen.getByRole('button', { name: '切り替える' }));
    expect(await screen.findByTestId('ops-tier-result')).toHaveTextContent('今のクラス: Journey(以前: free)');
    expect(api.switchOpsTestTier).toHaveBeenCalledWith('journey', '家族旅行の確認');
  });

  it('[Gate FR059-Tiers] Fake の試験はクラスを選んで実行する', async () => {
    api.runOpsFamilyFake.mockResolvedValue({ as_of: 'x', case: {}, note: 'Fake', steps: [{ n: 1, operation: 'ai.generate',
      label: 'AI の案の作成', units: {}, result: 'denied', reason: 'tier_feature_not_included', plan_total_jpy: '0.0000',
      state: 'ok' }],
    summary: { tier: 'trip', plan_id: 'p', class: 'trip', policy_version: '2026-10-31.1', plan_cap_jpy: '50.0000',
      final_total_jpy: '0.0000', never_over_cap: true, first_user_warning_step: null, first_ops_alert_step: null,
      first_denial: { n: 1, reason: 'tier_feature_not_included' }, settled_steps: 0, denied_steps: 1,
      idempotency_replay: {}, provider: 'fake', external_calls: 0 } });
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: 'テスト実行' }));
    fireEvent.change(await screen.findByLabelText('試験の利用者のクラス'), { target: { value: 'trip' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fake で原価の上限を試す' }));
    const summary = await screen.findByTestId('ops-run-summary');
    expect(summary).toHaveTextContent('Trip(行先を見つける)');
    expect(summary).toHaveTextContent('1回目 · クラスに含まない');
    expect(api.runOpsFamilyFake).toHaveBeenCalledWith('家族旅行の Fake の試験', 'trip');
  });
});
