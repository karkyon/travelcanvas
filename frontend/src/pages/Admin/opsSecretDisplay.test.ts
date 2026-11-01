/** [Gate AdminUAT] 鍵の表示の組み合わせ(登録 × 確認 × 旧 .env × 使うか)。食い違い・再登録の案内を出さない。 */
import { describe, it, expect } from 'vitest';
import type { OpsSecretSlot, OpsVerifyState } from '@/services/api/opsConsole';
import { formatJaDateTime, legacyDisplay, secretDisplay } from './opsSecretDisplay';

const slot = (over: Partial<OpsSecretSlot>): OpsSecretSlot => ({
  slot: 'openai_api_key', label: 'OpenAI', providers: ['openai'], env: 'OPENAI_API_KEY', hint: '', status: 'configured',
  source: 'cms', version: 1, last4: 'AAAA', registered_at: null, history: [], required: true, ...over,
});
const v = (state: OpsVerifyState, expires: string | null = null) => ({
  state, provider_auth: state, code: null, verified_at: null, expires_at: expires, capabilities: {} });

describe('secretDisplay', () => {
  it.each([
    ['accepted', '登録済み・接続確認済み', 'tc-pill--good'],
    ['unverified', '登録済み・接続は未確認(送らない)', 'tc-pill--warn'],
    ['rejected', '登録済み・提供元が拒否(送らない)', 'tc-pill--bad'],
    ['inconclusive', '登録済み・確認は未判定(到達できない・混雑)', 'tc-pill--warn'],
    ['expired', '登録済み・確認の期限切れ(確認し直す)', 'tc-pill--warn'],
    ['stale', '登録済み・設定変更後(確認し直す)', 'tc-pill--warn'],
  ] as const)('登録済み × %s は1つの表示', (state, text, tone) => {
    const d = secretDisplay(slot({ verification: v(state, '2026-11-04T06:00:00Z') }));
    expect(d.text).toBe(text);
    expect(d.tone).toBe(tone);
    if (state === 'accepted') expect(d.detail).toMatch(/^CMSで登録したキーをDBから取得します。確認期限：2026年11月4日/);
    else expect(d.detail).not.toContain('確認期限');
  });

  it('確認の記録が無い登録済みは未確認(成功に寄せない)', () => {
    expect(secretDisplay(slot({ verification: null })).text).toBe('登録済み・接続は未確認(送らない)');
  });

  it('未登録: 使う鍵は「未登録(必要)」、使わない鍵は「設定不要」(警告にしない)', () => {
    expect(secretDisplay(slot({ status: 'missing', source: null })).text).toBe('未登録(必要)');
    const d = secretDisplay(slot({ status: 'missing', source: null, required: false }));
    expect(d.text).toBe('現在の構成では使用しません。設定不要');
    expect(d.tone).toBe('');
  });
});

describe('legacyDisplay(旧 .env)', () => {
  const placeholder = { present: true, placeholder: true, importable: false };
  it('DB 登録済みなら、再登録を促さず詳細に畳む', () => {
    for (const state of ['accepted', 'unverified', 'expired'] as const) {
      const l = legacyDisplay(slot({ env_legacy: placeholder, verification: v(state) }));
      expect(l.prominent).toBeNull();
      expect(l.detail).toBe('旧.envにサンプル値が残っていますが、使用していません。現在のDB登録キーの利用には影響しません。');
    }
    const imp = legacyDisplay(slot({ env_legacy: { present: true, placeholder: false, importable: true } }));
    expect(imp.prominent).toBeNull();
  });
  it('DB 未登録で必要な時だけ、CMS からの登録を案内する(.env へ書かせない)', () => {
    const l = legacyDisplay(slot({ status: 'missing', source: null, env_legacy: placeholder }));
    expect(l.prominent).toContain('この画面の「鍵を登録する」');
    expect(l.prominent).not.toContain('.env に');
    expect(legacyDisplay(slot({ status: 'missing', source: null, required: false, env_legacy: placeholder })).prominent).toBeNull();
  });
  it('旧 .env に何も無ければ何も出さない', () => {
    expect(legacyDisplay(slot({ env_legacy: { present: false, placeholder: false, importable: false } })))
      .toEqual({ prominent: null, detail: null });
  });
});

it('formatJaDateTime: 読めない値は null', () => {
  expect(formatJaDateTime(null)).toBeNull();
  expect(formatJaDateTime('not-a-date')).toBeNull();
});
