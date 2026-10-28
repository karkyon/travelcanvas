/**
 * [Gate G9] UX-1 デザインの決まり(design tokens)の正本。
 *
 * 色・面(surface)・角の丸み・影・余白・文字・動きを1か所で決め、tokens.css の CSS 変数(--tc-*)と同じ値にする
 * (試験 tokens.test.ts が一致を確かめる)。今の画面の見た目は変えない(新しい面の部品・デザインの一覧から使い始め、
 * UX-6 で既存の Card などを順に置き換える)。
 *
 * 色の考え方(再監査 §8「Cinematic Travel Workspace」):
 * - 基本は Ink(文字)・Cloud(地)・Sand(温かい地)・Mist(冷たい地)。旅行ごとの強調色(journey accent)は1色だけ
 * - 状態(成功・注意・危険・情報)は装飾の色と分け、必ず文字やアイコンと一緒に使う(色だけで伝えない)
 * - 文字と地の組み合わせは WCAG 2.1 AA(本文 4.5:1・大きい文字と部品 3:1)を満たす
 */
import { PAGE_BACKGROUND } from './themeColor';

export const color = {
  ink900: '#0f172a',
  ink700: '#334155',
  ink500: '#5b6b80',
  cloud0: PAGE_BACKGROUND.light,
  cloud50: '#f8fafc',
  cloud100: '#f1f5f9',
  cloud200: '#e2e8f0',
  sand50: '#fbf8f3',
  sand100: '#f5efe4',
  sand300: '#e3d5bb',
  mist50: '#f1f6f8',
  mist200: '#d5e3ea',
  accent: '#0f6e66',
  accentStrong: '#0b544e',
  accentSoft: '#e3f2ef',
  success: '#166534',
  successSoft: '#ecfdf3',
  warning: '#92400e',
  warningSoft: '#fff7e6',
  danger: '#b42318',
  dangerSoft: '#fef3f2',
  info: '#1d4ed8',
  infoSoft: '#eff4ff',
  focus: '#2563eb',
  /** [Gate G10-UX] UX-6 強調色の地の上の文字(主な操作のボタン)・危険の操作の地(暗い見た目でも同じ濃い赤に白い文字) */
  onAccent: '#ffffff',
  dangerSolid: '#b42318',
} as const;

/** 暗い見た目(data-theme="dark" の中だけ。今の画面には当てない) */
export const darkColor = {
  ink900: '#f1f5f9',
  ink700: '#cbd5e1',
  ink500: '#94a3b8',
  cloud0: PAGE_BACKGROUND.dark,
  cloud50: '#111a2b',
  cloud100: '#162236',
  cloud200: '#24324a',
  accent: '#5ec4b8',
  danger: '#fca5a5',
  warning: '#fcd34d',
  success: '#86efac',
  info: '#93c5fd',
  accentStrong: '#7fd6cb',
  accentSoft: '#0f2d2a',
  successSoft: '#0f2a1c',
  warningSoft: '#2e2208',
  dangerSoft: '#3b1219',
  infoSoft: '#13254a',
  onAccent: '#0b1220',
} as const;

export const radius = { sm: '4px', md: '8px', lg: '12px', xl: '16px', pill: '999px' } as const;
export const space = { 1: '4px', 2: '8px', 3: '12px', 4: '16px', 5: '24px', 6: '32px', 7: '48px' } as const;
export const shadow = {
  1: '0 1px 2px rgba(15, 23, 42, 0.06)',
  2: '0 4px 12px rgba(15, 23, 42, 0.08)',
  3: '0 12px 32px rgba(15, 23, 42, 0.12)',
} as const;
export const glass = {
  surface: 'rgba(255, 255, 255, 0.72)',
  border: 'rgba(15, 23, 42, 0.08)',
  blur: '16px',
  shadow: '0 8px 24px rgba(15, 23, 42, 0.10)',
} as const;
export const type = {
  display: "'Noto Serif JP', 'Hiragino Mincho ProN', 'Yu Mincho', serif",
  body: "Inter, 'Hiragino Sans', 'Noto Sans JP', 'Yu Gothic UI', sans-serif",
  sizes: { xs: '12px', sm: '14px', md: '16px', lg: '20px', xl: '24px', '2xl': '32px' },
} as const;
export const motion = { fast: '150ms', base: '220ms', easing: 'cubic-bezier(0.2, 0, 0, 1)' } as const;

/**
 * [Gate G9] UX-2 旅行の表紙(写真が無い時の生成グラデーション)。季節ごとに2つ。どれも白い文字が 4.5:1 以上になる
 * 濃さにする(tokens.test.ts で確かめる)。写真の読み込み・保存は別の Gate(ADR-design-tokens §4)。
 */
export const COVER_PALETTES = [
  { id: 'sakura', season: 'spring', from: '#8a2c55', to: '#b03a5b' },
  { id: 'wakaba', season: 'spring', from: '#2f6b3a', to: '#1f5b52' },
  { id: 'umi', season: 'summer', from: '#0b5a7a', to: '#1d4f91' },
  { id: 'natsuzora', season: 'summer', from: '#0f6e66', to: '#1e5aa8' },
  { id: 'momiji', season: 'autumn', from: '#9a2f1f', to: '#8a4b14' },
  { id: 'kogane', season: 'autumn', from: '#7a4a0b', to: '#8b3a1e' },
  { id: 'yuki', season: 'winter', from: '#33416b', to: '#4b3f7a' },
  { id: 'yoru', season: 'winter', from: '#1e2a4a', to: '#3b2f63' },
] as const;
export type CoverPalette = typeof COVER_PALETTES[number];
export type Season = CoverPalette['season'];

/** 月(1〜12)から季節(北半球。旅行先が南半球でも見た目の色だけの違い) */
export function seasonOf(month: number): Season {
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}

function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 旅行の表紙の色(決まった入力には必ず同じ色)。旅行先(無ければ題名)で選び、開始の日があればその季節の中から選ぶ。
 */
export function coverFor(seed: { destination?: string | null; title?: string | null; startDate?: string | null }): CoverPalette {
  const key = (seed.destination || seed.title || 'travelcanvas').trim().toLowerCase();
  const month = seed.startDate ? Number(seed.startDate.slice(5, 7)) : NaN;
  const pool = Number.isFinite(month) && month >= 1 && month <= 12
    ? COVER_PALETTES.filter((p) => p.season === seasonOf(month))
    : COVER_PALETTES;
  return pool[hashString(key) % pool.length]!;
}

/**
 * [Gate G11] 表紙の写真の上の暗い重ね(写真の色に関わらず白い文字を 4.5:1 以上にする)。上(top)・下(bottom)の不透明度。
 * 真っ白の写真でも、上の端の色(ink900 を top の割合で混ぜた色)と白の比が 4.5 以上(cover.test.ts で確かめる)。
 * tokens.css の .tc-cover[data-has-photo]::after と同じ値。
 */
export const COVER_PHOTO_SCRIM = { color: '#0f172a', top: 0.62, bottom: 0.8 } as const;

/** 下の色(bottom)に上の色(top)を不透明度 alpha で重ねた色 */
export function blend(top: string, bottom: string, alpha: number): string {
  const a = parseHex(top);
  const b = parseHex(bottom);
  return toHex([0, 1, 2].map((i) => b[i]! + (a[i]! - b[i]!) * alpha) as [number, number, number]);
}

export const SURFACES = ['glass', 'solid', 'quiet', 'critical'] as const;
export type SurfaceVariant = typeof SURFACES[number];

/** 文字と地の組み合わせ(この表の全てが AA を満たすことを試験で確かめる) */
export const TEXT_PAIRS: Array<{ name: string; fg: string; bg: string; min: number }> = [
  { name: '本文 / 白', fg: color.ink900, bg: color.cloud0, min: 4.5 },
  { name: '補足 / 白', fg: color.ink700, bg: color.cloud0, min: 4.5 },
  { name: '弱い文字 / 白', fg: color.ink500, bg: color.cloud0, min: 4.5 },
  { name: '本文 / Sand', fg: color.ink900, bg: color.sand100, min: 4.5 },
  { name: '補足 / Mist', fg: color.ink700, bg: color.mist50, min: 4.5 },
  { name: '強調色の文字 / 白', fg: color.accent, bg: color.cloud0, min: 4.5 },
  { name: '白文字 / 強調色', fg: color.cloud0, bg: color.accent, min: 4.5 },
  { name: '主な操作の文字 / 強調色', fg: color.onAccent, bg: color.accent, min: 4.5 },
  { name: '主な操作の文字 / 強い強調色(押した時)', fg: color.onAccent, bg: color.accentStrong, min: 4.5 },
  { name: '暗い: 主な操作の文字 / 強調色', fg: darkColor.onAccent, bg: darkColor.accent, min: 4.5 },
  { name: '暗い: 主な操作の文字 / 強い強調色', fg: darkColor.onAccent, bg: darkColor.accentStrong, min: 4.5 },
  { name: '危険の操作の白文字', fg: color.cloud0, bg: color.dangerSolid, min: 4.5 },
  { name: '暗い: 枠の強調色 / 弱い強調色', fg: darkColor.accent, bg: darkColor.accentSoft, min: 4.5 },
  { name: '強調色の文字 / 弱い強調色', fg: color.accentStrong, bg: color.accentSoft, min: 4.5 },
  { name: '成功', fg: color.success, bg: color.successSoft, min: 4.5 },
  { name: '注意', fg: color.warning, bg: color.warningSoft, min: 4.5 },
  { name: '危険', fg: color.danger, bg: color.dangerSoft, min: 4.5 },
  { name: '情報', fg: color.info, bg: color.infoSoft, min: 4.5 },
  { name: '暗い: 本文', fg: darkColor.ink900, bg: darkColor.cloud0, min: 4.5 },
  { name: '暗い: 補足', fg: darkColor.ink700, bg: darkColor.cloud50, min: 4.5 },
  { name: '暗い: 強調色', fg: darkColor.accent, bg: darkColor.cloud0, min: 4.5 },
  { name: 'フォーカスの枠 / 白', fg: color.focus, bg: color.cloud0, min: 3 },
  { name: '暗い: 弱い文字', fg: darkColor.ink500, bg: darkColor.cloud0, min: 4.5 },
  { name: '暗い: 弱い文字 / 面', fg: darkColor.ink500, bg: darkColor.cloud50, min: 4.5 },
  { name: '暗い: 危険', fg: darkColor.danger, bg: darkColor.cloud50, min: 4.5 },
  { name: '暗い: 注意', fg: darkColor.warning, bg: darkColor.cloud50, min: 4.5 },
  { name: '暗い: 成功', fg: darkColor.success, bg: darkColor.cloud50, min: 4.5 },
  { name: '暗い: 情報', fg: darkColor.info, bg: darkColor.cloud50, min: 4.5 },
  { name: '暗い: 成功 / 弱い成功', fg: darkColor.success, bg: darkColor.successSoft, min: 4.5 },
  { name: '暗い: 注意 / 弱い注意', fg: darkColor.warning, bg: darkColor.warningSoft, min: 4.5 },
  { name: '暗い: 危険 / 弱い危険', fg: darkColor.danger, bg: darkColor.dangerSoft, min: 4.5 },
  { name: '暗い: 情報 / 弱い情報', fg: darkColor.info, bg: darkColor.infoSoft, min: 4.5 },
  { name: '暗い: 強調色 / 弱い強調色', fg: darkColor.accentStrong, bg: darkColor.accentSoft, min: 4.5 },
  ...COVER_PALETTES.flatMap((c) => [
    { name: `表紙 ${c.id}(白い文字・始まり)`, fg: color.cloud0, bg: c.from, min: 4.5 },
    { name: `表紙 ${c.id}(白い文字・終わり)`, fg: color.cloud0, bg: c.to, min: 4.5 },
  ]),
];

// ===================================================================== コントラスト(WCAG 2.1)

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`色の形が正しくありません: ${hex}`);
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

function toHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
}

/**
 * 旅行ごとの強調色(表紙の写真から抽出・利用者が選ぶ)を、白い地の上で文字に使えるよう(4.5:1 以上)暗くする。
 * 形が正しくない色は既定の強調色にする(UX-2 の旅行の表紙で使う)。
 */
export function safeAccent(hex: string | null | undefined, background: string = color.cloud0, min = 4.5): string {
  let rgb: [number, number, number];
  try {
    rgb = parseHex(hex ?? '');
  } catch {
    return color.accent;
  }
  for (let i = 0; i < 40; i += 1) {
    const candidate = toHex(rgb);
    if (contrastRatio(candidate, background) >= min) return candidate;
    rgb = [rgb[0] * 0.9, rgb[1] * 0.9, rgb[2] * 0.9];
  }
  return color.ink900;
}


// ===================================================================== [Gate G11] 見た目の系統(仕様 §3.4)

export { STYLE_IDS, isStyleId, type StyleId } from './styleIds';
import type { StyleId } from './styleIds';

export const STYLE_META: Record<StyleId, { label: string; description: string }> = {
  standard: { label: '標準', description: 'これまでの見た目(青緑の強調色・白い地)' },
  atlas: { label: 'Atlas', description: '地図の紙のような落ち着いた地と、深い緑の強調色。角は大きめ' },
  editorial: { label: 'Editorial', description: '温かい紙の地と、こげ茶の強調色。見出しを明朝体にして読み物のように' },
  daylight: { label: 'Daylight', description: '明るい空色の地と青の強調色。文字を太め・ボタンを大きく(当日の画面向け)' },
  studio: { label: 'Studio', description: '静かな灰色の地と藍の強調色。地図の枠だけを軽いすりガラスに' },
};

interface StylePalette {
  accent: string;
  accentStrong: string;
  accentSoft: string;
  onAccent: string;
}

export interface StyleTokens {
  /** 明るい時のページの地(--tc-cloud-50)。面(カード)の地は白のまま */
  page: string;
  light: StylePalette;
  dark: StylePalette;
  radiusLg?: string;
  radiusXl?: string;
  /** 見出し(h1〜h3)を --tc-font-display にする */
  displayHeadings?: boolean;
  /** ボタン(.tc-btn)の最小の高さと、本文を太めにする */
  controlMin?: string;
  /** 地図の枠(.tc-map-frame)だけを軽いすりガラスの縁にする */
  glassMapFrame?: boolean;
}

export const STYLE_TOKENS: Record<Exclude<StyleId, 'standard'>, StyleTokens> = {
  atlas: {
    page: '#f5f4ee',
    light: { accent: '#385a55', accentStrong: '#2b4642', accentSoft: '#e6efec', onAccent: '#ffffff' },
    dark: { accent: '#8fc2b0', accentStrong: '#a9d4c5', accentSoft: '#142a24', onAccent: '#0b1220' },
    radiusLg: '16px',
    radiusXl: '20px',
  },
  editorial: {
    page: '#f7f3f0',
    light: { accent: '#65463a', accentStrong: '#4f362c', accentSoft: '#f3e9e3', onAccent: '#ffffff' },
    dark: { accent: '#e2b29c', accentStrong: '#ecc6b4', accentSoft: '#2e1d16', onAccent: '#0b1220' },
    displayHeadings: true,
  },
  daylight: {
    page: '#eef3f8',
    light: { accent: '#2451a4', accentStrong: '#1b3f82', accentSoft: '#e6eefb', onAccent: '#ffffff' },
    dark: { accent: '#9cc0f5', accentStrong: '#b8d2f8', accentSoft: '#13254a', onAccent: '#0b1220' },
    controlMin: '48px',
  },
  studio: {
    page: '#f4f6fa',
    light: { accent: '#4338ca', accentStrong: '#3730a3', accentSoft: '#eceafd', onAccent: '#ffffff' },
    dark: { accent: '#a5b4fc', accentStrong: '#c0cafd', accentSoft: '#1e1f4a', onAccent: '#0b1220' },
    radiusLg: '14px',
    glassMapFrame: true,
  },
};

/** 各系統 × 明暗の文字と地の組み合わせ(全て AA を満たすことを styles.test.ts で確かめる) */
export function styleTextPairs(): Array<{ name: string; fg: string; bg: string; min: number }> {
  const out: Array<{ name: string; fg: string; bg: string; min: number }> = [];
  for (const [id, t] of Object.entries(STYLE_TOKENS)) {
    const L = t.light;
    const D = t.dark;
    const add = (name: string, fg: string, bg: string, min = 4.5) => out.push({ name: `${id}: ${name}`, fg, bg, min });
    add('本文 / ページの地', color.ink900, t.page);
    add('補足 / ページの地', color.ink700, t.page);
    add('弱い文字 / ページの地', color.ink500, t.page);
    add('強調色の文字 / 白い面', L.accent, color.cloud0);
    add('強調色の文字 / ページの地', L.accent, t.page);
    add('主な操作の文字 / 強調色', L.onAccent, L.accent);
    add('主な操作の文字 / 強い強調色', L.onAccent, L.accentStrong);
    add('強い強調色 / 弱い強調色', L.accentStrong, L.accentSoft);
    add('フォーカスの枠 / ページの地', color.focus, t.page, 3);
    add('成功 / ページの地', color.success, t.page);
    add('注意 / ページの地', color.warning, t.page);
    add('危険 / ページの地', color.danger, t.page);
    add('情報 / ページの地', color.info, t.page);
    add('暗い: 強調色 / 地', D.accent, darkColor.cloud0);
    add('暗い: 強調色 / 面', D.accent, darkColor.cloud50);
    add('暗い: 主な操作の文字 / 強調色', D.onAccent, D.accent);
    add('暗い: 主な操作の文字 / 強い強調色', D.onAccent, D.accentStrong);
    add('暗い: 強い強調色 / 弱い強調色', D.accentStrong, D.accentSoft);
    add('暗い: 強調色 / 弱い強調色', D.accent, D.accentSoft);
  }
  return out;
}

export const STYLE_CSS_START = '/* generated:styles:start(tokens.ts の renderStyleCss が作る。手で直さず UPDATE_STYLE_CSS=1 で作り直す) */';
export const STYLE_CSS_END = '/* generated:styles:end */';

/** 系統ごとの CSS 変数の上書き(tokens.css の generated の部分と一致させる) */
export function renderStyleCss(): string {
  const lines: string[] = [STYLE_CSS_START];
  for (const [id, t] of Object.entries(STYLE_TOKENS)) {
    const sel = `html[data-style='${id}']`;
    lines.push(`${sel} {`);
    lines.push(`  --tc-cloud-50: ${t.page};`);
    lines.push(`  --tc-accent: ${t.light.accent};`);
    lines.push(`  --tc-accent-strong: ${t.light.accentStrong};`);
    lines.push(`  --tc-accent-soft: ${t.light.accentSoft};`);
    lines.push(`  --tc-on-accent: ${t.light.onAccent};`);
    if (t.radiusLg) lines.push(`  --tc-radius-lg: ${t.radiusLg};`);
    if (t.radiusXl) lines.push(`  --tc-radius-xl: ${t.radiusXl};`);
    if (t.controlMin) lines.push(`  --tc-control-min: ${t.controlMin};`);
    lines.push('}');
    lines.push('@media screen {');
    lines.push(`  ${sel}[data-theme='dark'] {`);
    lines.push(`    --tc-cloud-50: ${darkColor.cloud50};`);
    lines.push(`    --tc-accent: ${t.dark.accent};`);
    lines.push(`    --tc-accent-strong: ${t.dark.accentStrong};`);
    lines.push(`    --tc-accent-soft: ${t.dark.accentSoft};`);
    lines.push(`    --tc-on-accent: ${t.dark.onAccent};`);
    lines.push('  }');
    lines.push('}');
    if (t.displayHeadings) {
      lines.push(`${sel} :is(h1, h2, h3) {`);
      lines.push('  font-family: var(--tc-font-display);');
      lines.push('  letter-spacing: 0.01em;');
      lines.push('}');
    }
    if (t.controlMin) {
      lines.push(`${sel} body {`);
      lines.push('  font-weight: 500;');
      lines.push('}');
      lines.push(`${sel} .tc-btn {`);
      lines.push('  min-height: var(--tc-control-min);');
      lines.push('  font-weight: 700;');
      lines.push('}');
    }
    if (t.glassMapFrame) {
      lines.push(`${sel} .tc-map-frame {`);
      lines.push('  border-radius: var(--tc-radius-xl);');
      lines.push('  border: 1px solid var(--tc-glass-border);');
      lines.push('  box-shadow: var(--tc-glass-shadow);');
      lines.push('  overflow: hidden;');
      lines.push('}');
    }
  }
  lines.push(STYLE_CSS_END);
  return lines.join('\n');
}
