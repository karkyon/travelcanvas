/** [Gate OpsCMS] 運用コンソール: 実データだけ・Fake と実の額を混ぜない・鍵の値を出さない・理由つきの操作・Fake の試験の結果。 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({
  getOpsOverview: vi.fn(), getOpsProviders: vi.fn(), getOpsLedger: vi.fn(), getOpsCloud: vi.fn(),
  runOpsFamilyFake: vi.fn(), setOpsProviderSuspended: vi.fn(), getOpsSecrets: vi.fn(), registerOpsSecret: vi.fn(), importOpsSecretFromEnv: vi.fn(), verifyOpsSecret: vi.fn(), activateOpsSecret: vi.fn(), discardOpsSecret: vi.fn(),
  disableOpsSecret: vi.fn(), getOpsTiers: vi.fn(), switchOpsTestTier: vi.fn(), getOpsUatReadiness: vi.fn(),
}));
vi.mock('@/services/api/opsConsole', () => api);

import AdminOpsPage from './AdminOpsPage';

const overview = {
  as_of: '2026-10-30T09:00:00+00:00', environment: 'development', policy_version: '2026-10-29.1', month: '2026-10',
  thresholds: { user_warning_jpy: '40.0000', ops_alert_jpy: '45.0000', hard_cap_jpy: '50.0000' },
  fake_usage: { events: 12, estimated_jpy: '49.5500', actual_jpy: '0.0000', label: 'x' },
  live_usage: { providers: {}, estimated_jpy: '8.0500', label: 'y' },
  key_verification_usage: { checks: 2, estimated_jpy: '9.1144', daily_cap_jpy: '50.0000', label: 'z' },
  provider_invoice: { status: 'not_reconciled', label: '未照合' },
  price_basis: { status: 'known', policy_version: '2026-11-02.1', checked_at: '2026-11-02', fx_rate: '180',
    tax_factor: '1.10', safety_factor: '1.15', jpy_per_usd: '227.7000', sources: {}, note: '請求額ではない',
    rows: [{ operation: 'places.search', label: '場所の検索', sku: 'places-text-search-pro', unit: 'requests',
      usd: '0.032', jpy: '7.2864', field_mask: 'places.id,places.displayName', basis: 'Text Search Pro' }] },
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

const uat = (ready: boolean) => ({
  as_of: 'x', account: 'admin@example.test', class: ready ? 'journey' : 'free', ready, model: 'gpt-5-nano',
  consult_path: '/trip-consult', note: 'この表示は送信しません',
  checks: [
    { key: 'class', label: '会員クラス', value: ready ? 'Journey' : 'Free', ok: ready, need: 'Journey・Explorer',
      where: '運用コンソール › 会員クラス › 試験のためにクラスを切り替える(開発環境・24時間)' },
    { key: 'consent', label: 'AI の利用の同意', value: ready ? '同意済み' : '未同意', ok: ready, need: '同意',
      where: '旅行相談の画面 › 「AI で読み取る」の同意のチェック' },
    { key: 'ai.generate', label: 'AI の読み取り(OpenAI)', value: '使える', ok: true, need: '鍵', where: null },
  ],
});

const renderPage = () => render(<MemoryRouter><AdminOpsPage /></MemoryRouter>);

describe('AdminOpsPage (Gate OpsCMS)', () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    api.getOpsOverview.mockResolvedValue(overview);
    api.getOpsProviders.mockResolvedValue(providers);
    api.getOpsUatReadiness.mockResolvedValue(uat(false));
  });

  it('概要: Fake の額と実の提供元の見込みを別の欄に出し、Cloud の請求は取得していないと書く', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: '運用の状態を、ひと目で。' })).toBeInTheDocument();
    expect(await screen.findByText('今月の Fake の試験の額')).toBeInTheDocument();
    expect(screen.getByText('¥49.55')).toBeInTheDocument();
    // [Gate SearchUAT-S3] 利用枠の計上・管理者の鍵の確認・提供元の請求(未照合)を分ける。¥8.05 と ¥9.11 を混ぜない
    expect(screen.getByTestId('ops-allowance-usage')).toHaveTextContent('今月の利用枠の計上(見込み)¥8.05');
    expect(screen.getByTestId('ops-allowance-usage')).toHaveTextContent('提供元の請求額ではありません');
    expect(screen.getByTestId('ops-verify-usage')).toHaveTextContent('¥9.11');
    expect(screen.getByTestId('ops-verify-usage')).toHaveTextContent('旅行の枠とは別');
    expect(screen.getByTestId('ops-provider-invoice')).toHaveTextContent('未照合');
    expect(screen.getByTestId('ops-price-basis')).toHaveTextContent('places-text-search-pro');
    expect(screen.getByTestId('ops-price-basis')).toHaveTextContent('227.7000 円');
    expect(screen.queryByText('今月の実の提供元の見込み')).toBeNull();
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
    expect(within(row).getByText('登録済み・接続は未確認(送らない)')).toBeInTheDocument();
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
    fireEvent.click(await screen.findByRole('tab', { name: 'テスト実行(Fake)' }));
    expect(screen.getByText('大阪府枚方市 · 大人4人')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fake で原価の上限を試す' }));
    const summary = await screen.findByTestId('ops-run-summary');
    expect(within(summary).getByText('¥49.55 / ¥50')).toBeInTheDocument();
    expect(within(summary).getByText('7回目から')).toBeInTheDocument();
    expect(within(summary).getByText('13回目 · 回数の上限')).toBeInTheDocument();
    expect(within(summary).getByText('0回(実 AI の確認ではない)')).toBeInTheDocument();
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
    expect(screen.getByTestId('ops-secret-legacy-google_maps_server_key')).toHaveTextContent('まだ登録されていません');
    expect(screen.getByTestId('ops-secret-legacy-detail-google_maps_server_key')).toHaveTextContent('サンプル値');
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
    expect(within(screen.getByTestId('ops-secret-openai_api_key')).getByTestId('ops-secret-status'))
      .toHaveTextContent('登録済み・接続確認済み');
    expect(screen.getByTestId('ops-secret-detail-openai_api_key')).toHaveTextContent(/確認期限：2026年11月4日 \d+時00分/);
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
    expect(within(row).getByText('未登録(必要)')).toBeInTheDocument();
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
    fireEvent.click(await screen.findByRole('tab', { name: 'テスト実行(Fake)' }));
    expect(screen.getByTestId('ops-run-fake-note')).toHaveTextContent('実 AI の接続の確認にはなりません');
    fireEvent.change(await screen.findByLabelText(/試験用の利用者のクラス/), { target: { value: 'trip' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fake で原価の上限を試す' }));
    const summary = await screen.findByTestId('ops-run-summary');
    expect(summary).toHaveTextContent('Trip(行先を見つける)');
    expect(summary).toHaveTextContent('1回目 · クラスに含まない');
    expect(api.runOpsFamilyFake).toHaveBeenCalledWith('家族旅行の Fake の試験', 'trip');
  });

  it('[Gate AdminUAT] DB 登録済み + 旧 .env にサンプル値 + 接続確認済み: 矛盾も再登録の案内も出さない', async () => {
    api.getOpsSecrets.mockResolvedValue({ as_of: 'x', note: 'n', backend: 'db_encrypted', backend_note: '暫定',
      slots: [{ slot: 'openai_api_key', label: 'OpenAI の API キー', providers: ['openai'], env: 'OPENAI_API_KEY', hint: 'sk-',
        status: 'configured', source: 'cms', version: 3, last4: 'AAAA', registered_at: '2026-11-01T05:00:00+00:00', history: [],
        in_use: true, required: true, suspended_providers: [], verify_supported: true, in_use_note: '使っている提供元: openai',
        env_legacy: { present: true, placeholder: true, importable: false },
        verification: { state: 'accepted', provider_auth: 'accepted', code: 'accepted', verified_at: '2026-11-01T06:00:00+00:00',
          expires_at: '2026-11-04T06:00:00+00:00', capabilities: {} } },
      { slot: 'google_maps_browser_key', label: 'Google Maps のブラウザ用キー', providers: ['google_maps_js'],
        env: 'GOOGLE_MAPS_API_KEY', hint: 'OSM', status: 'missing', source: null, version: null, last4: null, registered_at: null,
        history: [], in_use: false, required: false, suspended_providers: [],
        in_use_note: '現在の構成では使用しません。設定不要', env_legacy: { present: true, placeholder: true, importable: false } }],
    });
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: '秘密情報・権限' }));
    const row = await screen.findByTestId('ops-secret-openai_api_key');
    const status = within(row).getAllByTestId('ops-secret-status');
    expect(status).toHaveLength(1);
    expect(status[0]).toHaveTextContent('登録済み・接続確認済み');
    expect(status[0]?.className).toContain('tc-pill--good');
    expect(row).toHaveTextContent('CMSで登録したキーをDBから取得します。確認期限：');
    expect(row.textContent).not.toMatch(/未確認|本物の鍵を登録|鍵を登録してください/);
    expect(screen.queryByTestId('ops-secret-legacy-openai_api_key')).toBeNull();
    const legacy = screen.getByTestId('ops-secret-legacy-detail-openai_api_key');
    expect(legacy.tagName).toBe('DETAILS');
    expect(legacy).toHaveTextContent('旧設定の詳細');
    expect(legacy).toHaveTextContent('旧.envにサンプル値が残っていますが、使用していません。現在のDB登録キーの利用には影響しません。');
    expect(screen.getByTestId('ops-secret-restrict-openai_api_key')).toHaveTextContent('提供元の停止: なし');
    expect(within(row).getByRole('button', { name: '確認し直す(期限内は不要)' })).toBeInTheDocument();
    // 使わない鍵は「設定不要」(警告の色にしない・登録を促さない)
    const browser = screen.getByTestId('ops-secret-google_maps_browser_key');
    const pill = within(browser).getByTestId('ops-secret-status');
    expect(pill).toHaveTextContent('現在の構成では使用しません。設定不要');
    expect(pill.className).not.toMatch(/warn|bad/);
    expect(screen.queryByTestId('ops-secret-legacy-google_maps_browser_key')).toBeNull();
  });

  it('[Gate AdminUAT] 提供元を止めている時は、鍵の確認とは別に制限として出す', async () => {
    api.getOpsSecrets.mockResolvedValue({ as_of: 'x', note: 'n', backend: 'db_encrypted', backend_note: '暫定',
      slots: [{ slot: 'openai_api_key', label: 'OpenAI', providers: ['openai'], env: 'OPENAI_API_KEY', hint: '',
        status: 'configured', source: 'cms', version: 1, last4: 'AAAA', registered_at: null, history: [], required: true,
        suspended_providers: ['openai'], verification: { state: 'accepted', provider_auth: 'accepted', code: null,
          verified_at: null, expires_at: '2026-11-04T06:00:00+00:00', capabilities: {} } }],
    });
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: '秘密情報・権限' }));
    expect(await screen.findByTestId('ops-secret-restrict-openai_api_key')).toHaveTextContent('提供元を止めています: openai');
    expect(within(screen.getByTestId('ops-secret-openai_api_key')).getByTestId('ops-secret-status'))
      .toHaveTextContent('登録済み・接続確認済み');
  });

  it('[Gate AdminUAT] 提供元の表: 使わない鍵は「設定不要」、確認済みは「接続確認済み」', async () => {
    api.getOpsProviders.mockResolvedValue({ ...providers, providers: [
      { ...providers.providers[0], adapter: 'implemented', secret_verification: 'accepted', secret_required: true, live_calls: 'ready' },
      { ...providers.providers[0], name: 'google_maps_js', label: 'Google Maps JavaScript API', secret: 'missing',
        secret_required: false, secret_verification: null },
    ] });
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: 'API・契約と接続' }));
    expect(await screen.findByTestId('ops-provider-secret-openai')).toHaveTextContent('登録済み・接続確認済み');
    const js = screen.getByTestId('ops-provider-secret-google_maps_js');
    expect(js).toHaveTextContent('現在の構成では使用しません。設定不要');
    expect(js.className).not.toMatch(/warn|bad/);
  });

  it('[Gate AdminUAT] 概要: このアカウントの UAT の準備を、今の値と変える場所つきで出す', async () => {
    renderPage();
    const panel = await screen.findByTestId('ops-uat-readiness');
    expect(within(panel).getByTestId('ops-uat-ready')).toHaveTextContent('足りない項目があります');
    expect(within(panel).getByTestId('ops-uat-class')).toHaveTextContent('Free');
    expect(within(panel).getByTestId('ops-uat-class')).toHaveTextContent('運用コンソール › 会員クラス');
    expect(within(panel).getByTestId('ops-uat-consent')).toHaveTextContent('未同意');
    expect(within(panel).getByRole('link', { name: '旅行相談を開く' })).toHaveAttribute('href', '/trip-consult');
    api.getOpsUatReadiness.mockResolvedValue(uat(true));
    fireEvent.click(within(panel).getByRole('button', { name: '読み直す' }));
    expect(await within(panel).findByText('実 AI で相談できます')).toBeInTheDocument();
  });
});
