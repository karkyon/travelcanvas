/** [Gate G10-UX] UX-8 選んだ見た目を <html data-theme> と color-scheme・theme-color に当てる(全ての画面に効く)。 */
import { describe, it, expect, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';
import ThemeRoot from './ThemeRoot';
import { resolveTheme, useThemeStore } from '@/hooks/useThemePreference';
import { useAuthStore } from '@/store/authStore';
import { color, darkColor } from '@/styles/tokens';

describe('ThemeRoot (Gate G10-UX)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useThemeStore.setState({ preference: 'system', systemDark: false, style: 'standard' });
    useAuthStore.setState({ user: null, isGuest: false });
  });

  it('暗いを選ぶと html に data-theme="dark"・color-scheme・暗い theme-color を当て、明るいに戻せる', () => {
    render(<ThemeRoot />);
    const html = document.documentElement;
    expect(html.getAttribute('data-theme')).toBe('light');
    act(() => useThemeStore.getState().setPreference('dark'));
    expect(html.getAttribute('data-theme')).toBe('dark');
    expect(html.style.colorScheme).toBe('dark');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(darkColor.cloud0);
    act(() => useThemeStore.getState().setPreference('light'));
    expect(html.getAttribute('data-theme')).toBe('light');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(color.cloud0);
  });

  it('端末に合わせる: 端末が暗ければ暗い', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('[Gate G11] 見た目の系統を <html data-style> に当て、端末に保存する(標準は保存を消す)', () => {
    render(<ThemeRoot />);
    const html = document.documentElement;
    expect(html.getAttribute('data-style')).toBe('standard');
    act(() => useThemeStore.getState().setStyle('atlas'));
    expect(html.getAttribute('data-style')).toBe('atlas');
    expect(window.localStorage.getItem('tc.style')).toBe('atlas');
    act(() => useThemeStore.getState().setPreference('dark'));
    expect(html.getAttribute('data-theme')).toBe('dark');
    expect(html.getAttribute('data-style')).toBe('atlas');
    act(() => useThemeStore.getState().setStyle('standard'));
    expect(window.localStorage.getItem('tc.style')).toBeNull();
  });

  it('[Gate G11] 会員はアカウントに保存した系統を優先し、形の違う値は無視する。ゲストには当てない', () => {
    window.localStorage.setItem('tc.style', 'studio');
    useThemeStore.setState({ style: 'studio' });
    render(<ThemeRoot />);
    const html = document.documentElement;
    const user = { id: 'u1', email: 'a@example.com', username: 'a', is_active: true } as never;
    act(() => useAuthStore.setState({ user: { ...(user as object), preferences: { ui_style: 'editorial' } } as never }));
    expect(html.getAttribute('data-style')).toBe('editorial');
    act(() => useAuthStore.setState({ user: { ...(user as object), preferences: { ui_style: 'neon' } } as never }));
    expect(html.getAttribute('data-style')).toBe('editorial');
    act(() => useAuthStore.setState({ isGuest: true, user: { ...(user as object), preferences: { ui_style: 'daylight' } } as never }));
    expect(html.getAttribute('data-style')).toBe('editorial');
    // ログイン・refresh の応答(preferences を持たない)の ui_style でも当てる
    act(() => useAuthStore.setState({ isGuest: false, user: { ...(user as object), ui_style: 'daylight' } as never }));
    expect(html.getAttribute('data-style')).toBe('daylight');
  });
});
