/** [Gate Remaining-5] FR-042 埋め込みのコード */
import { describe, it, expect } from 'vitest';
import { canEmbed, embedIframe, embedSnippet, shareTokenOf } from './embedModel';

describe('embedModel', () => {
  it('共有の URL から鍵を取り、コードを作る', () => {
    expect(shareTokenOf('https://tc.example/s/AbC_def-1234567')).toBe('AbC_def-1234567');
    expect(shareTokenOf('https://tc.example/x/abc')).toBeNull();
    expect(shareTokenOf(null)).toBeNull();
    expect(embedSnippet('tok12345', 'https://api.example/api/v1/')).toContain('src="https://api.example/api/v1/public/embed.js"');
    expect(embedIframe('tok12345', 'https://api.example/api/v1')).toContain('/public/embed/tok12345" ');
    expect(embedIframe('tok12345', 'x')).toContain('sandbox');
  });

  it('埋め込みを選んだ・閲覧のみ・合言葉なし・回数の制限なしだけ', () => {
    const base = { fields: ['embed'], permission: 'view', has_passcode: false, max_uses: null };
    expect(canEmbed(base)).toBe(true);
    expect(canEmbed({ ...base, fields: [] })).toBe(false);
    expect(canEmbed({ ...base, has_passcode: true })).toBe(false);
    expect(canEmbed({ ...base, max_uses: 3 })).toBe(false);
    expect(canEmbed({ ...base, permission: 'edit' })).toBe(false);
  });
});
