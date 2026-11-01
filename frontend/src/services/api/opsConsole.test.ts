/** [Gate SecretPolicy] 運用コンソールの decoder: backend が返す鍵の全ての状態を受け取れる(未知の状態は拒否)。 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock('./index', () => ({ api }));

import {
  OPS_SECRET_STATES, activateOpsSecret, getOpsProviders, getOpsSecrets, importOpsSecretFromEnv, verifyOpsSecret,
} from './opsConsole';

const provider = (secret: string) => ({
  name: 'openai', label: 'OpenAI', purpose: 'p', operations: ['ai.generate'], kind: 'paid', registered: false,
  suspended: false, suspended_reason: null, contract: 'unverified', secret, secret_setting: 'OPENAI_API_KEY',
  price_profile: 'known', policy_version: 'v', live_calls: 'disabled', month_usage: null, notes: '',
});

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});

describe('opsConsole decoder (Gate SecretPolicy)', () => {
  it.each(OPS_SECRET_STATES)('提供元の一覧は鍵の状態 %s を受け取れる(保管先が未接続でも画面が壊れない)', async (state) => {
    api.get.mockResolvedValue({ data: { as_of: 'x', rule: 'r', providers: [provider(state)] } });
    const out = await getOpsProviders();
    expect(out.providers[0]!.secret).toBe(state);
  });

  it('知らない鍵の状態は受け取らない', async () => {
    api.get.mockResolvedValue({ data: { as_of: 'x', rule: 'r', providers: [provider('ready_to_send')] } });
    await expect(getOpsProviders()).rejects.toThrow();
  });

  it('秘密情報: 保管先・旧 .env の有無を読む(値は無い)', async () => {
    api.get.mockResolvedValue({ data: { as_of: 'x', note: 'n', backend: 'unset', backend_note: '送りません', slots: [{
      slot: 'openai_api_key', label: 'l', providers: ['openai'], env: 'OPENAI_API_KEY', hint: 'h', status: 'backend_unavailable',
      source: null, version: null, last4: null, registered_at: null, history: [],
      env_legacy: { present: true, placeholder: true, importable: false } }] } });
    const out = await getOpsSecrets();
    expect(out.backend).toBe('unset');
    expect(out.slots[0]!.env_legacy).toEqual({ present: true, placeholder: true, importable: false });
  });

  it('旧 .env の取り込みは理由だけを送り、値を送らない', async () => {
    api.post.mockResolvedValue({ data: { slot: 'openai_api_key', status: 'configured', source: 'cms', version: 1, last4: 'ABCD',
      registered_at: null } });
    await importOpsSecretFromEnv('openai_api_key', '移行');
    expect(api.post).toHaveBeenCalledWith('/admin/ops/secrets/openai_api_key/import-env', { reason: '移行' }, expect.anything());
  });

  it('確認・有効化は版と理由だけを送る(鍵の値は送らない)', async () => {
    api.post.mockResolvedValueOnce({ data: { slot: 's', version: 2, provider_auth: 'rejected', code: 'invalid_key',
      results: [{ check: 'openai:ai.generate', code: 'invalid_key', label: 'キー無効' }], estimated_cost_jpy: '0.0300' } });
    const out = await verifyOpsSecret('openai_api_key', 2, '確認');
    expect(out.results[0]!.label).toBe('キー無効');
    expect(api.post).toHaveBeenLastCalledWith('/admin/ops/secrets/openai_api_key/verify', { version: 2, reason: '確認' },
      expect.anything());
    api.post.mockResolvedValueOnce({ data: { slot: 's', status: 'configured', source: 'cms', version: 2, last4: 'BBBB',
      registered_at: null, candidate: null } });
    await activateOpsSecret('openai_api_key', 2, 1, '切替');
    expect(api.post).toHaveBeenLastCalledWith('/admin/ops/secrets/openai_api_key/activate',
      { version: 2, expected_active_version: 1, reason: '切替' }, expect.anything());
  });
});
