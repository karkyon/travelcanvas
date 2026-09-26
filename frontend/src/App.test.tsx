/**
 * [Gate A1] 認証の通信中(isLoading)にアプリ全体を起動中表示へ差し替えないことの回帰テスト。
 *
 * 以前のApp.tsxは `!isInitialized || isLoading` の間RouterProviderを描画せず、ログイン・登録・
 * ゲスト開始/昇格のたびに画面全体が作り直されていた(ログイン失敗後に入力内容が消える実害、
 * browser E2E e2e/auth-flows.spec.ts で発覚)。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';

vi.mock('@/router', async () => {
  const { createMemoryRouter } = await import('react-router-dom');
  function Form() {
    const [email, setEmail] = useState('');
    return <input aria-label="email" value={email} onChange={(e) => setEmail(e.target.value)} />;
  }
  return { router: createMemoryRouter([{ path: '/', element: <Form /> }]) };
});

vi.mock('@/styles/globals.css', () => ({}));

import App from './App';
import { useAuthStore } from '@/store/authStore';

beforeEach(() => {
  useAuthStore.setState({ isInitialized: true, isLoading: false, initialize: () => undefined });
});

describe('App (Gate A1)', () => {
  it('認証の通信中(isLoading)も画面を作り直さず、入力内容を保つ', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('email'), { target: { value: 'user@example.com' } });

    act(() => useAuthStore.setState({ isLoading: true }));
    expect(screen.queryByText('TravelCanvas を起動中...')).toBeNull();
    expect(screen.getByLabelText('email')).toHaveValue('user@example.com');

    act(() => useAuthStore.setState({ isLoading: false, error: 'メールアドレスまたはパスワードが正しくありません' }));
    expect(screen.getByLabelText('email')).toHaveValue('user@example.com');
  });

  it('起動時の初期化が終わるまでは起動中表示を出す', () => {
    useAuthStore.setState({ isInitialized: false });
    render(<App />);
    expect(screen.getByText('TravelCanvas を起動中...')).toBeInTheDocument();
    expect(screen.queryByLabelText('email')).toBeNull();
  });
});
