/** [Gate G10-UX] UX-8 選んだ見た目を <html data-theme> と color-scheme・theme-color に当てる(全ての画面に効く)。 */
import { describe, it, expect, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';
import ThemeRoot from './ThemeRoot';
import { resolveTheme, useThemeStore } from '@/hooks/useThemePreference';
import { color, darkColor } from '@/styles/tokens';

describe('ThemeRoot (Gate G10-UX)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useThemeStore.setState({ preference: 'system', systemDark: false });
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
});
