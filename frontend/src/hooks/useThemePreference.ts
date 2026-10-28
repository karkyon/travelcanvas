/**
 * [Gate G9] 明るい・暗い・端末に合わせる の見た目の選択(この端末だけ。保存できない環境でも動く)。
 * [Gate G10-UX] UX-8 選択をアプリの全体で共有する(以前はダッシュボードの中だけで、他の画面は明るいままだった)。
 * 当てる場所は <html data-theme>(components/design/ThemeRoot.tsx)。今の画面の Tailwind の色は
 * src/styles/theme-dark.css が暗い地で読める色に置き換える。
 */
import { useEffect } from 'react';
import { create } from 'zustand';

export type ThemePreference = 'system' | 'light' | 'dark';
export const THEME_KEY = 'tc.theme';

function read(): ThemePreference {
  try {
    const v = window.localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function systemDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

interface ThemeState {
  preference: ThemePreference;
  systemDark: boolean;
  setPreference: (p: ThemePreference) => void;
  setSystemDark: (dark: boolean) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  preference: typeof window === 'undefined' ? 'system' : read(),
  systemDark: typeof window === 'undefined' ? false : systemDark(),
  setPreference: (p) => {
    set({ preference: p });
    try {
      if (p === 'system') window.localStorage.removeItem(THEME_KEY);
      else window.localStorage.setItem(THEME_KEY, p);
    } catch {
      // 保存できない環境(プライベートの窓など)では、この画面を開いている間だけ有効
    }
  },
  setSystemDark: (dark) => set({ systemDark: dark }),
}));

export function resolveTheme(preference: ThemePreference, dark: boolean): 'light' | 'dark' {
  return preference === 'system' ? (dark ? 'dark' : 'light') : preference;
}

/** 端末の明暗の変化を追う(アプリの根で1回だけ使う) */
export function useSystemThemeListener(): void {
  const setSystemDark = useThemeStore((s) => s.setSystemDark);
  useEffect(() => {
    let mq: MediaQueryList | null = null;
    try {
      mq = window.matchMedia('(prefers-color-scheme: dark)');
    } catch {
      return undefined;
    }
    setSystemDark(mq.matches);
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener?.('change', on);
    return () => mq?.removeEventListener?.('change', on);
  }, [setSystemDark]);
}

export function useThemePreference(): { preference: ThemePreference; theme: 'light' | 'dark'; setPreference: (p: ThemePreference) => void } {
  const preference = useThemeStore((s) => s.preference);
  const dark = useThemeStore((s) => s.systemDark);
  const setPreference = useThemeStore((s) => s.setPreference);
  return { preference, theme: resolveTheme(preference, dark), setPreference };
}
