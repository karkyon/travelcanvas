/** [Gate G11] 見た目の系統: 系統 × 明暗の AA、tokens.css の生成の部分の一致(UPDATE_STYLE_CSS=1 で書き直す)。 */
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  STYLE_CSS_END, STYLE_CSS_START, STYLE_IDS, STYLE_META, STYLE_TOKENS, contrastRatio, isStyleId, renderStyleCss,
  styleTextPairs,
} from './tokens';

const cssPath = resolve(__dirname, 'tokens.css');

describe('見た目の系統(Gate G11 §3.4)', () => {
  it('標準と4つの系統があり、名前と説明がある', () => {
    expect(STYLE_IDS).toEqual(['standard', 'atlas', 'editorial', 'daylight', 'studio']);
    for (const id of STYLE_IDS) {
      expect(STYLE_META[id].label.length).toBeGreaterThan(0);
      expect(STYLE_META[id].description.length).toBeGreaterThan(0);
    }
    expect(Object.keys(STYLE_TOKENS).sort()).toEqual(['atlas', 'daylight', 'editorial', 'studio']);
    expect(isStyleId('atlas')).toBe(true);
    expect(isStyleId('neon')).toBe(false);
    expect(isStyleId(undefined)).toBe(false);
  });

  it('全ての系統 × 明暗で文字と地の組み合わせが AA(本文 4.5:1・部品 3:1)を満たす', () => {
    const pairs = styleTextPairs();
    expect(pairs.length).toBe(4 * 19);
    for (const p of pairs) expect(contrastRatio(p.fg, p.bg), p.name).toBeGreaterThanOrEqual(p.min);
  });

  it('tokens.css の生成の部分が tokens.ts と同じ', () => {
    const css = readFileSync(cssPath, 'utf8');
    const start = css.indexOf(STYLE_CSS_START);
    const end = css.indexOf(STYLE_CSS_END);
    expect(start, '生成の部分が無い').toBeGreaterThanOrEqual(0);
    const current = css.slice(start, end + STYLE_CSS_END.length);
    const expected = renderStyleCss();
    if (process.env.UPDATE_STYLE_CSS === '1' && current !== expected) {
      writeFileSync(cssPath, css.slice(0, start) + expected + css.slice(end + STYLE_CSS_END.length));
      return;
    }
    expect(current).toBe(expected);
  });

  it('暗い見た目ではページの地を暗い面の色に戻す(明るい地が残らない)', () => {
    const css = renderStyleCss();
    for (const id of Object.keys(STYLE_TOKENS)) {
      expect(css).toContain(`html[data-style='${id}'][data-theme='dark'] {\n    --tc-cloud-50: #111a2b;`);
    }
  });
});
