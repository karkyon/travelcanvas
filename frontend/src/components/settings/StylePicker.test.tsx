/** [Gate G11] 設定の「見た目の系統」: 選ぶと端末に当て、会員はアカウントにも保存する。キーボードで選べる。 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import StylePicker from './StylePicker';
import { useThemeStore } from '@/hooks/useThemePreference';
import { useAuthStore } from '@/store/authStore';
import { api as apiService } from '@/services/api';

describe('StylePicker (Gate G11)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useThemeStore.setState({ style: 'standard' });
    useAuthStore.setState({ user: null, isGuest: false });
    vi.restoreAllMocks();
  });

  it('5つの系統を radio で示し、選ぶと端末に保存する(ゲスト・未ログインはアカウントに送らない)', async () => {
    const spy = vi.spyOn(apiService, 'updateProfile');
    render(<StylePicker />);
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.textContent?.split('—')[0])).toHaveLength(5);
    expect(screen.getByRole('radio', { name: /標準/ })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: /Atlas/ }));
    expect(useThemeStore.getState().style).toBe('atlas');
    expect(window.localStorage.getItem('tc.style')).toBe('atlas');
    expect(await screen.findByText(/この端末に当てました/)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it('会員はアカウントの preferences.ui_style にも保存し、失敗したら知らせる', async () => {
    useAuthStore.setState({ user: { id: 'u', email: 'a@example.com', username: 'a', preferences: { theme: 'dark' } } as never });
    const spy = vi.spyOn(apiService, 'updateProfile').mockResolvedValueOnce({ data: {} } as never);
    const onChange = vi.fn();
    render(<StylePicker onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: /Editorial/ }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ preferences: { ui_style: 'editorial' } }));
    expect(onChange).toHaveBeenCalledWith('editorial');
    expect(useAuthStore.getState().user?.preferences).toEqual({ theme: 'dark', ui_style: 'editorial' });
    expect(useAuthStore.getState().user?.ui_style).toBe('editorial');
    expect(await screen.findByText(/アカウントにも保存しました/)).toBeInTheDocument();
    spy.mockRejectedValueOnce(new Error('offline'));
    fireEvent.click(screen.getByRole('radio', { name: /Daylight/ }));
    expect(await screen.findByText(/アカウントへの保存に失敗しました/)).toBeInTheDocument();
    expect(useThemeStore.getState().style).toBe('daylight');
  });

  it('矢印キーで次の系統へ移る', () => {
    render(<StylePicker />);
    const group = screen.getByRole('radiogroup');
    act(() => { fireEvent.keyDown(group, { key: 'ArrowRight' }); });
    expect(useThemeStore.getState().style).toBe('atlas');
    act(() => { fireEvent.keyDown(group, { key: 'ArrowLeft' }); });
    act(() => { fireEvent.keyDown(group, { key: 'ArrowLeft' }); });
    expect(useThemeStore.getState().style).toBe('studio');
  });
});
