/**
 * [Gate G9] 明るい・暗い・端末に合わせる の見た目の選択(この端末だけ。保存できない環境でも動く)。
 * 暗い見た目は、デザインの決まり(tokens)で作った画面(ダッシュボード・旅行の見出し)にだけ当てる。今の画面の全体へは
 * UX-8 で広げる(Tailwind の色を直に使う画面が暗い地で読めなくなるため)。
 */
import { useCallback, useEffect, useState } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
const KEY = 'tc.theme';

function read(): ThemePreference {
  try {
    const v = window.localStorage.getItem(KEY);
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

export function useThemePreference(): { preference: ThemePreference; theme: 'light' | 'dark'; setPreference: (p: ThemePreference) => void } {
  const [preference, setPref] = useState<ThemePreference>(read);
  const [dark, setDark] = useState<boolean>(systemDark);

  useEffect(() => {
    let mq: MediaQueryList | null = null;
    try {
      mq = window.matchMedia('(prefers-color-scheme: dark)');
    } catch {
      return undefined;
    }
    const on = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener?.('change', on);
    return () => mq?.removeEventListener?.('change', on);
  }, []);

  const setPreference = useCallback((p: ThemePreference) => {
    setPref(p);
    try {
      if (p === 'system') window.localStorage.removeItem(KEY);
      else window.localStorage.setItem(KEY, p);
    } catch {
      // 保存できない環境(プライベートの窓など)では、この画面を開いている間だけ有効
    }
  }, []);

  const theme = preference === 'system' ? (dark ? 'dark' : 'light') : preference;
  return { preference, theme, setPreference };
}
