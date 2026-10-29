/**
 * [Gate G10-UX] UX-8 選んだ見た目(明るい・暗い・端末に合わせる)を <html> に当てる(全ての画面に効く)。
 *
 * - `data-theme`: tokens.css(--tc-*)と theme-dark.css(今の画面の Tailwind の色の置き換え)が読む
 * - `color-scheme`: フォームの部品・スクロールバーなどブラウザが描く部分も暗くする
 * - `<meta name="theme-color">`: スマホのブラウザの帯の色
 * - [Gate G11] `data-style`: 見た目の系統(tokens.css の generated:styles の部分が読む)。ログインした会員は、
 *   アカウントに保存した系統(users.preferences.ui_style)を優先して当てる(別の端末で選んだ系統が続く)
 * 何も描かない(副作用だけ)。App の根で1回だけ使う。
 */
import { useEffect } from 'react';
import { useStylePreference, useSystemThemeListener, useThemePreference, useThemeStore } from '@/hooks/useThemePreference';
import { useAuthStore } from '@/store/authStore';
import { STYLE_PREF_KEY, isStyleId } from '@/styles/styleIds';
import { PAGE_BACKGROUND } from '@/styles/themeColor';

export function ThemeRoot(): null {
  useSystemThemeListener();
  const { theme } = useThemePreference();
  const { style } = useStylePreference();
  const accountStyle = useAuthStore((s) => (s.isGuest ? undefined : s.user?.preferences?.[STYLE_PREF_KEY] ?? s.user?.ui_style));
  useEffect(() => {
    if (isStyleId(accountStyle)) useThemeStore.getState().setStyle(accountStyle);
  }, [accountStyle]);
  useEffect(() => {
    document.documentElement.setAttribute('data-style', style);
  }, [style]);
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = PAGE_BACKGROUND[theme];
  }, [theme]);
  return null;
}

export default ThemeRoot;
