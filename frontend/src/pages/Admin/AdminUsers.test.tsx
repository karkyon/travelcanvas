/**
 * [Gate M9-FE-B3] AdminUsers: 検索デバウンスの回帰テスト。
 *
 * 以前はfilters.searchがfetchUsersの依存にも含まれていたため、1文字入力ごとに
 * 即時fetchが走り、さらに500ms後のデバウンス処理でもう1回fetchしていた
 * (マウント時も2回)。修正後は「マウント時1回」「入力が500ms止まった後に1回」。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
// authStoreもapi(setGuestMode等)を参照するため、使われるメソッドだけを差し替える
vi.mock('../../services/api', () => ({ api: { get: apiGet, setGuestMode: vi.fn(), setAuthToken: vi.fn(), clearAuthToken: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import AdminUsers from './AdminUsers';
import { useAuthStore } from '../../store/authStore';
import type { User } from '../../types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('AdminUsers search debounce (Gate M9-FE-B3)', () => {
  beforeEach(() => {
    apiGet.mockReset().mockResolvedValue({
      data: {
        users: [],
        pagination: { page: 1, page_size: 20, total_count: 0, total_pages: 0, has_next: false, has_prev: false },
      },
    });
    useAuthStore.setState({
      isAuthenticated: true,
      user: { id: 'admin-1', username: 'root', email: 'r@example.com', user_type: 'admin' } as unknown as User,
    });
  });

  it('マウント時は1回だけ取得し、連続入力は500ms停止後に1回だけ取得する', async () => {
    render(
      <MemoryRouter>
        <AdminUsers />
      </MemoryRouter>
    );
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(1));
    await sleep(700); // デバウンス時間を超えて待っても追加取得しない
    expect(apiGet).toHaveBeenCalledTimes(1);

    const input = screen.getByPlaceholderText(/ユーザー名、メールアドレスで検索/);
    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.change(input, { target: { value: 'al' } });
    fireEvent.change(input, { target: { value: 'ali' } });
    // 入力直後(デバウンス中)は取得しない
    await sleep(100);
    expect(apiGet).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2), { timeout: 2000 });
    await sleep(700);
    expect(apiGet).toHaveBeenCalledTimes(2);
    const lastUrl = apiGet.mock.calls[1]![0] as string;
    expect(lastUrl).toContain('search=ali');
    expect(lastUrl).toContain('page=1');
  });
});
