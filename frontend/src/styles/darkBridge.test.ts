/**
 * [Gate G10-UX] UX-8 暗い見た目の橋渡し: 生成した theme-dark.css が最新であること、src の全ての色のクラスが
 * 「置き換え」か「暗い地でもそのままで良い」のどちらかに入ること(漏れの無いこと)、置き換えた文字の色が AA を満たすこと。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { COLOR_CLASS_RE, HUES, darkValue, keptOnDark, mix, renderDarkBridgeCss, ruleFor, type Prop } from './darkBridge';
import { contrastRatio, darkColor } from './tokens';

const SRC = resolve(__dirname, '..');
const CSS = resolve(__dirname, 'theme-dark.css');
/** [Gate G10-UX] UX-6 画面に直に書いた Tailwind の色のクラスの数の上限(増やさない) */
const MAX_DIRECT_COLOR_CLASSES = 1632;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== '__fixtures__' && name !== 'test') walk(p, out);
    } else if (/\.(tsx|ts)$/.test(name) && !/\.test\.tsx?$/.test(name) && !p.endsWith('darkBridge.ts')) {
      out.push(p);
    }
  }
  return out;
}

function usedClasses(): Set<string> {
  const found = new Set<string>();
  for (const f of walk(SRC)) {
    for (const m of readFileSync(f, 'utf8').matchAll(COLOR_CLASS_RE)) found.add(m[0]);
  }
  return found;
}

function split(cls: string): { prop: Prop; color: string } {
  const bare = cls.replace(/^(hover|focus|disabled|placeholder):/, '').replace(/\/\d+$/, '');
  const i = bare.indexOf('-');
  return { prop: bare.slice(0, i) as Prop, color: bare.slice(i + 1) };
}

describe('暗い見た目の橋渡し(theme-dark.css)', () => {
  const classes = usedClasses();

  it('src の色のクラスから作った内容と一致する(手で直さない)', () => {
    const css = renderDarkBridgeCss(classes);
    if (process.env.UPDATE_DARK_CSS === '1') writeFileSync(CSS, css, 'utf8');
    expect(readFileSync(CSS, 'utf8')).toBe(css);
  });

  it('全ての色のクラスが、置き換えか「暗い地でもそのまま」のどちらかに入る(漏れが無い)', () => {
    expect(classes.size).toBeGreaterThan(50);
    const missing = [...classes].filter((c) => {
      if (ruleFor(c)) return false;
      const { prop, color } = split(c);
      return !keptOnDark(prop, color);
    });
    expect(missing).toEqual([]);
  });

  it('置き換えた文字の色は、暗い地・面・同じ色の淡い地のどれでも 4.5:1 以上', () => {
    const grounds = [darkColor.cloud0, darkColor.cloud50, darkColor.cloud100];
    for (const shade of ['300', '400', '500', '600', '700', '800', '900']) {
      const v = darkValue('text', `gray-${shade}`)!;
      for (const g of grounds) expect(contrastRatio(v, g), `gray-${shade} on ${g}`).toBeGreaterThanOrEqual(4.5);
    }
    for (const hue of HUES) {
      for (const shade of ['500', '600', '700', '800', '900']) {
        const v = darkValue('text', `${hue}-${shade}`)!;
        const tints = ['50', '100', '200'].map((s) => darkValue('bg', `${hue}-${s}`)!);
        for (const g of [...grounds, ...tints]) {
          expect(contrastRatio(v, g), `${hue}-${shade} on ${g}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('[UX-6] 画面に直に書いた色のクラスは増やさない(基準 MAX_DIRECT_COLOR_CLASSES。減らしたら基準も下げる)', () => {
    let n = 0;
    for (const f of walk(SRC)) n += [...readFileSync(f, 'utf8').matchAll(COLOR_CLASS_RE)].length;
    // G10-UX の前は 3,338 件。共通の部品(Button・Card・Input・Modal・Toast・LoadingSpinner)・当日の画面・見出しの
    // メニュー・Layout と、全ての画面の文字の灰色(text-gray-500〜900 → ink)・白い面(bg-white → surface)を
    // デザインの決まりへ置き換えて 1,632 件。残りは状態の色・淡い地など(暗い見た目は上の橋渡しで読める)
    expect(n).toBeLessThanOrEqual(MAX_DIRECT_COLOR_CLASSES);
  });

  it('白い地は面の色、白い文字はそのまま、濃い地のボタンはそのまま', () => {
    expect(darkValue('bg', 'white')).toBe(darkColor.cloud50);
    expect(darkValue('text', 'white')).toBeNull();
    expect(darkValue('bg', 'blue-600')).toBeNull();
    expect(keptOnDark('bg', 'blue-600')).toBe(true);
    expect(ruleFor('hover:bg-gray-100')).toBe(`[data-theme='dark'] .hover\\:bg-gray-100:hover { background-color: ${darkColor.cloud100}; }`);
    expect(ruleFor('bg-white/90')).toContain('rgba(17, 26, 43, 0.9)');
    expect(ruleFor('divide-gray-200')).toContain('> :not(:last-child)');
    expect(mix('#ffffff', 0)).toBe(darkColor.cloud0);
  });
});
