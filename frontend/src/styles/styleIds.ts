/**
 * [Gate G11] 見た目の系統(data-style)の名前だけ。ThemeRoot が最初の読み込みで使うため、色の一覧(tokens.ts)とは分けて置く
 * (docs/ux/G11_UIUX全範囲_実装仕様.md §3.4)。明るい・暗い・端末に合わせる とは別の軸(組み合わせ 5×3)。
 */
export const STYLE_IDS = ['standard', 'atlas', 'editorial', 'daylight', 'studio'] as const;
export type StyleId = typeof STYLE_IDS[number];
export const STYLE_KEY = 'tc.style';
/** アカウントに保存する時の users.preferences の項目名(migration なし) */
export const STYLE_PREF_KEY = 'ui_style';

export function isStyleId(value: unknown): value is StyleId {
  return typeof value === 'string' && (STYLE_IDS as readonly string[]).includes(value);
}

/** [Gate MockScreens] 既定の系統は UI/UX モックと同じ Atlas(標準は設定で選べる) */
export const DEFAULT_STYLE: StyleId = 'atlas';
