/**
 * [Gate G10-UX] UX-8 画面の地の色(明るい・暗い)だけを分けて置く。最初に読む JS に入る ThemeRoot が
 * `<meta name="theme-color">` に使うため、色の一覧(tokens.ts)の全体を最初の読み込みへ入れないようにする。
 * tokens.ts の `color.cloud0`・`darkColor.cloud0` はこの値を使う(正本は1か所)。
 */
export const PAGE_BACKGROUND = { light: '#ffffff', dark: '#0b1220' } as const;
