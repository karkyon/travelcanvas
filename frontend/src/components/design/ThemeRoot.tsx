/**
 * [Gate G10-UX] UX-8 選んだ見た目(明るい・暗い・端末に合わせる)を <html> に当てる(全ての画面に効く)。
 *
 * - `data-theme`: tokens.css(--tc-*)と theme-dark.css(今の画面の Tailwind の色の置き換え)が読む
 * - `color-scheme`: フォームの部品・スクロールバーなどブラウザが描く部分も暗くする
 * - `<meta name="theme-color">`: スマホのブラウザの帯の色
 * 何も描かない(副作用だけ)。App の根で1回だけ使う。
 */
import { useEffect } from 'react';
import { useSystemThemeListener, useThemePreference } from '@/hooks/useThemePreference';
import { PAGE_BACKGROUND } from '@/styles/themeColor';

export function ThemeRoot(): null {
  useSystemThemeListener();
  const { theme } = useThemePreference();
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
