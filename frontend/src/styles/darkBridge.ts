/**
 * [Gate G10-UX] UX-8 暗い見た目を全ての画面へ広げる「橋渡し」(Tailwind の色のクラス → 暗い見た目の値)。
 *
 * 今の画面の多くは Tailwind の色(text-gray-700・bg-white・bg-red-50 など)を直に使う。1画面ずつ書き直す代わりに、
 * `[data-theme='dark']` の中だけで、使われている色のクラスを暗い地で読める値へ置き換える。
 *
 * - 地味な色(gray・slate 等)は明暗を反転する(文字は明るく、地は暗く)
 * - 色付きの淡い地(bg-red-50 など)は、暗い地にその色を少し混ぜた色にする。濃い文字(text-red-800 など)は淡い色にする
 * - 色の濃い地(bg-blue-600 + text-white のボタンなど)はそのまま(暗い地でも読める)
 * - 白い地(bg-white)は面の色(cloud-50)にする。白い文字(text-white)は変えない
 *
 * 出力は src/styles/theme-dark.css(この関数が作る。試験 darkBridge.test.ts が一致と、src の全ての色のクラスが
 * 置き換えか「そのままで良い」のどちらかに入ることを確かめる)。書き直し:
 *   UPDATE_DARK_CSS=1 npx vitest run src/styles/darkBridge.test.ts
 */
import { darkColor } from './tokens';

export const NEUTRALS = ['gray', 'slate', 'zinc', 'neutral', 'stone'] as const;
export const HUES = [
  'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo',
  'violet', 'purple', 'fuchsia', 'pink', 'rose',
] as const;
type Hue = typeof HUES[number];

/** 色ごとの基準(Tailwind の 500)と、暗い地で文字に使う淡い色(Tailwind の 300・200) */
const HUE: Record<Hue, { base: string; light: string; lighter: string }> = {
  red: { base: '#ef4444', light: '#fca5a5', lighter: '#fecaca' },
  orange: { base: '#f97316', light: '#fdba74', lighter: '#fed7aa' },
  amber: { base: '#f59e0b', light: '#fcd34d', lighter: '#fde68a' },
  yellow: { base: '#eab308', light: '#fde047', lighter: '#fef08a' },
  lime: { base: '#84cc16', light: '#bef264', lighter: '#d9f99d' },
  green: { base: '#22c55e', light: '#86efac', lighter: '#bbf7d0' },
  emerald: { base: '#10b981', light: '#6ee7b7', lighter: '#a7f3d0' },
  teal: { base: '#14b8a6', light: '#5eead4', lighter: '#99f6e4' },
  cyan: { base: '#06b6d4', light: '#67e8f9', lighter: '#a5f3fc' },
  sky: { base: '#0ea5e9', light: '#7dd3fc', lighter: '#bae6fd' },
  blue: { base: '#3b82f6', light: '#93c5fd', lighter: '#bfdbfe' },
  indigo: { base: '#6366f1', light: '#a5b4fc', lighter: '#c7d2fe' },
  violet: { base: '#8b5cf6', light: '#c4b5fd', lighter: '#ddd6fe' },
  purple: { base: '#a855f7', light: '#d8b4fe', lighter: '#e9d5ff' },
  fuchsia: { base: '#d946ef', light: '#f0abfc', lighter: '#f5d0fe' },
  pink: { base: '#ec4899', light: '#f9a8d4', lighter: '#fbcfe8' },
  rose: { base: '#f43f5e', light: '#fda4af', lighter: '#fecdd3' },
};

/** 暗い地(cloud-0)に色を割合 t で混ぜる */
export function mix(hex: string, t: number, onto: string = darkColor.cloud0): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const a = p(hex);
  const b = p(onto);
  return '#' + a.map((v, i) => Math.round(b[i]! + (v - b[i]!) * t).toString(16).padStart(2, '0')).join('');
}

/** 地味な色の置き換え(明暗の反転)。空の段は「そのまま」 */
const NEUTRAL_TEXT: Record<string, string> = {
  '900': darkColor.ink900, '800': '#e2e8f0', '700': darkColor.ink700, '600': '#b4c0cf', '500': darkColor.ink500,
  '400': '#8291a8', '300': '#8291a8',
};
const NEUTRAL_BG: Record<string, string> = {
  '50': '#0f1726', '100': darkColor.cloud100, '200': darkColor.cloud200, '300': '#33415c',
};
const NEUTRAL_BORDER: Record<string, string> = {
  '50': '#1a2538', '100': '#1c283c', '200': darkColor.cloud200, '300': '#33415c', '400': '#475569', '500': '#64748b',
};
/** 色付きの段: 地は暗い地に混ぜる割合、枠も同じ */
const TINT_BG: Record<string, number> = { '50': 0.16, '100': 0.22, '200': 0.3 };
const TINT_BORDER: Record<string, number> = { '100': 0.3, '200': 0.38, '300': 0.48, '400': 0.6 };
const TINT_TEXT_LIGHT = ['500', '600'];
const TINT_TEXT_LIGHTER = ['700', '800', '900', '950'];

export type Prop = 'text' | 'bg' | 'border' | 'from' | 'via' | 'to' | 'divide' | 'placeholder';

/** クラスの色の部分(例 "gray-700"・"white")を暗い見た目の値へ。置き換えない時は null */
export function darkValue(prop: Prop, color: string): string | null {
  if (color === 'white') {
    if (prop === 'bg' || prop === 'from' || prop === 'via' || prop === 'to') return darkColor.cloud50;
    return null; // 白い文字・白い枠はそのまま(色の濃い地の上で使う)
  }
  if (color === 'black') return prop === 'text' ? darkColor.ink900 : null;
  const m = /^([a-z]+)-(\d{2,3})$/.exec(color);
  if (!m) return null;
  const [, name, shade] = m as unknown as [string, string, string];
  if ((NEUTRALS as readonly string[]).includes(name)) {
    if (prop === 'text' || prop === 'placeholder') return NEUTRAL_TEXT[shade] ?? null;
    if (prop === 'bg' || prop === 'from' || prop === 'via' || prop === 'to') return NEUTRAL_BG[shade] ?? null;
    if (prop === 'border' || prop === 'divide') return NEUTRAL_BORDER[shade] ?? null;
    return null;
  }
  const hue = HUE[name as Hue];
  if (!hue) return null;
  if (prop === 'text' || prop === 'placeholder') {
    if (TINT_TEXT_LIGHT.includes(shade)) return hue.light;
    if (TINT_TEXT_LIGHTER.includes(shade)) return hue.lighter;
    return null;
  }
  if (prop === 'bg' || prop === 'from' || prop === 'via' || prop === 'to') {
    const t = TINT_BG[shade];
    return t == null ? null : mix(hue.base, t);
  }
  if (prop === 'border' || prop === 'divide') {
    const t = TINT_BORDER[shade];
    return t == null ? null : mix(hue.base, t);
  }
  return null;
}

/** 濃い地のまま変えない色(色の濃い地に白い文字のボタン・バッジ等)。試験で「漏れ」と区別する */
export function keptOnDark(prop: Prop, color: string): boolean {
  if (color === 'white' || color === 'black') return prop !== 'text' || color === 'white';
  const m = /^([a-z]+)-(\d{2,3})$/.exec(color);
  if (!m) return false;
  const shade = Number(m[2]);
  if (prop === 'bg' || prop === 'from' || prop === 'via' || prop === 'to') return shade >= 400;
  if (prop === 'border' || prop === 'divide') return shade >= 500 || shade === 50;
  if (prop === 'text' || prop === 'placeholder') return shade <= 400;
  return false;
}

const CSS_PROP: Record<Prop, string> = {
  text: 'color', bg: 'background-color', border: 'border-color', from: '--tw-gradient-from', via: '--tw-gradient-via',
  to: '--tw-gradient-to', divide: 'border-color', placeholder: 'color',
};

function escapeClass(cls: string): string {
  return cls.replace(/[:/[\].]/g, (c) => `\\${c}`);
}

/** 1つのクラス(例 "hover:bg-gray-100"・"bg-white/90")の暗い見た目の規則。置き換えない時は null */
export function ruleFor(cls: string): string | null {
  const m = /^(?:(hover|focus|disabled|placeholder):)?(text|bg|border|from|via|to|divide|placeholder)-(white|black|[a-z]+-\d{2,3})(?:\/(\d{1,3}))?$/.exec(cls);
  if (!m) return null;
  const [, variant, propRaw, color, alpha] = m as unknown as [string, string | undefined, Prop, string, string | undefined];
  const prop: Prop = variant === 'placeholder' && propRaw === 'text' ? 'placeholder' : propRaw;
  let value = darkValue(prop, color);
  if (!value) return null;
  if (alpha && /^#[0-9a-f]{6}$/.test(value)) {
    const n = [1, 3, 5].map((i) => parseInt(value!.slice(i, i + 2), 16));
    value = `rgba(${n.join(', ')}, ${Number(alpha) / 100})`;
  }
  const sel = `[data-theme='dark'] .${escapeClass(cls)}`;
  if (prop === 'divide') return `${sel} > :not(:last-child) { border-color: ${value}; }`;
  if (prop === 'placeholder') return `${sel}::placeholder { color: ${value}; }`;
  const pseudo = variant === 'hover' ? ':hover' : variant === 'focus' ? ':focus' : variant === 'disabled' ? ':disabled' : '';
  return `${sel}${pseudo} { ${CSS_PROP[prop]}: ${value}; }`;
}

/** 生成の対象(画面で使う色のクラス)。test が src を走査した結果と一致することを確かめる */
export function renderDarkBridgeCss(classes: Iterable<string>): string {
  const rules = [...new Set(classes)].sort().map(ruleFor).filter((r): r is string => r !== null);
  return [
    '/*',
    '  [Gate G10-UX] UX-8 暗い見た目の橋渡し(src/styles/darkBridge.ts が作る。手で直さない)。',
    '  書き直し: UPDATE_DARK_CSS=1 npx vitest run src/styles/darkBridge.test.ts',
    '*/',
    '@layer utilities {',
    '  /* 印刷(しおり・紙)は白い紙が前提のため、画面だけに当てる */',
    '  @media screen {',
    ...rules.map((r) => `    ${r}`),
    '  }',
    '}',
    '',
  ].join('\n');
}

/** src の中の色のクラスを拾う正規表現(試験と生成で同じものを使う) */
export const COLOR_CLASS_RE = /(?<![\w-])((?:hover|focus|disabled|placeholder):)?(?:text|bg|border|from|via|to|divide|placeholder)-(?:white|black|(?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})(?:\/\d{1,3})?(?![\w-])/g;
