/** [Gate G9] UX-1 デザインの決まり: tokens.ts と tokens.css の一致、文字と地のコントラスト(AA)、強調色の補正。 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  TEXT_PAIRS, color, contrastRatio, darkColor, glass, motion, parseHex, radius, safeAccent, shadow, space, type,
} from './tokens';

const css = readFileSync(resolve(__dirname, 'tokens.css'), 'utf8');

function kebab(k: string): string {
  return k.replace(/([a-z])([0-9A-Z])/g, '$1-$2').toLowerCase();
}

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = css.indexOf('}', start);
  const out: Record<string, string> = {};
  for (const m of css.slice(start, end).matchAll(/(--tc-[a-z0-9-]+):\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

describe('tokens.ts と tokens.css は同じ値', () => {
  const root = block(':root');
  const dark = block("[data-theme='dark']");

  it('色(明るい・暗い)', () => {
    for (const [k, v] of Object.entries(color)) expect(root[`--tc-${kebab(k)}`], k).toBe(v);
    for (const [k, v] of Object.entries(darkColor)) expect(dark[`--tc-${kebab(k)}`], k).toBe(v);
  });

  it('角の丸み・余白・影・すりガラス・文字・動き', () => {
    for (const [k, v] of Object.entries(radius)) expect(root[`--tc-radius-${k}`]).toBe(v);
    for (const [k, v] of Object.entries(space)) expect(root[`--tc-space-${k}`]).toBe(v);
    for (const [k, v] of Object.entries(shadow)) expect(root[`--tc-shadow-${k}`]).toBe(v);
    expect(root['--tc-surface-glass']).toBe(glass.surface);
    expect(root['--tc-glass-border']).toBe(glass.border);
    expect(root['--tc-glass-blur']).toBe(glass.blur);
    expect(root['--tc-glass-shadow']).toBe(glass.shadow);
    expect(root['--tc-font-display']).toBe(type.display);
    expect(root['--tc-font-body']).toBe(type.body);
    for (const [k, v] of Object.entries(type.sizes)) expect(root[`--tc-text-${k}`]).toBe(v);
    expect(root['--tc-motion-fast']).toBe(motion.fast);
    expect(root['--tc-motion-base']).toBe(motion.base);
    expect(root['--tc-motion-easing']).toBe(motion.easing);
  });

  it('すりガラスを使えない環境・動きを減らす設定の逃げ道がある', () => {
    expect(css).toContain('@supports not ((backdrop-filter: blur(1px))');
    expect(css).toContain('prefers-reduced-transparency: reduce');
    expect(css).toContain('forced-colors: active');
    expect(css).toContain('prefers-reduced-motion: reduce');
    expect(css).toContain('.tc-surface--glass .tc-surface--glass');
  });
});

describe('コントラスト', () => {
  it('WCAG の計算(白と黒は 21:1、同じ色は 1:1)', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBe(21);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
    expect(parseHex('0f6e66')).toEqual([15, 110, 102]);
    expect(() => parseHex('red')).toThrow();
  });

  it('決めた文字と地の組み合わせはすべて AA を満たす', () => {
    for (const p of TEXT_PAIRS) expect(contrastRatio(p.fg, p.bg), p.name).toBeGreaterThanOrEqual(p.min);
  });

  it('旅行ごとの強調色は白い地で 4.5:1 以上に補正し、形が違えば既定の色', () => {
    for (const hex of ['#7dd3c8', '#ffff00', '#ffffff', '#f97316', '#0f6e66']) {
      const a = safeAccent(hex);
      expect(contrastRatio(a, color.cloud0), hex).toBeGreaterThanOrEqual(4.5);
    }
    expect(safeAccent('#0f6e66')).toBe('#0f6e66');
    expect(safeAccent('not-a-color')).toBe(color.accent);
    expect(safeAccent(null)).toBe(color.accent);
  });
});
