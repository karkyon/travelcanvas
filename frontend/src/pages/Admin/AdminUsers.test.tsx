/**
 * [Gate M9-FE-B3] AdminUsers: 検索デバウンスの回帰テスト。
 *
 * 以前はfilters.searchがfetchUsersの依存にも含まれていたため、1文字入力ごとに
 * 即時fetchが走り、さらに500ms後のデバウンス処理でもう1回fetchしていた
 * (マウント時も2回)。修正後は「マウント時1回」「入力が500ms止まった後に1回」。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
// [Gate A2] 一覧の取得(getAdminUsers)だけを差し替え、残りは本物を使う。以前は api を一部(のちに空の関数)だけで
// 差し替えていたため、authStore の再水和(タイマー)の restoreMemberSession が、差し替えに無い AuthApiError を
// instanceof に使って未処理の例外になり、vitest が「Errors 1」で失敗した(CI の frontend ジョブ)
vi.mock('../../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/api')>()),
  getAdminUsers: apiGet,
}));
vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import AdminUsers from './AdminUsers';
import { useAuthStore } from '../../store/authStore';
import { api, AuthApiError } from '../../services/api';
import type { User } from '../../types';

// [Gate G3] DEP-04 待つ間のデバウンス・取得の結果の反映を act の中で行う(以前は act の外で、React の警告が出ていた)
const sleep = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

describe('AdminUsers search debounce (Gate M9-FE-B3)', () => {
  beforeEach(() => {
    apiGet.mockReset().mockResolvedValue({
      users: [],
      pagination: { page: 1, page_size: 20, total_count: 0, total_pages: 0, has_next: false, has_prev: false },
    });
    // [Gate G3] 再水和のタイマー(onRehydrateStorage の setTimeout 0)が、この状態を入れた後に動くと、トークンの無い会員として
    // cookie での取り直し(POST /auth/refresh)を本物の通信で行い、afterEach の「差し替えていない通信」で落ちていた
    // (読み込みの速さで順序が変わるため、omega でだけ起きた)。トークンを入れ、取り直しも差し替えて、順序に依らないようにする
    vi.spyOn(api, 'refreshSession').mockRejectedValue(new AuthApiError('expired', 401));
    useAuthStore.setState({
      isAuthenticated: true,
      token: 'test-admin-token',
      user: { id: 'admin-1', username: 'root', email: 'r@example.com', user_type: 'admin' } as unknown as User,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

    const input = screen.getByPlaceholderText(/ユーザー名、メールアドレス、IDで検索/);
    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.change(input, { target: { value: 'al' } });
    fireEvent.change(input, { target: { value: 'ali' } });
    // 入力直後(デバウンス中)は取得しない
    await sleep(100);
    expect(apiGet).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2), { timeout: 2000 });
    await sleep(700);
    expect(apiGet).toHaveBeenCalledTimes(2);
    expect(apiGet.mock.calls[1]![0]).toMatchObject({ search: 'ali', page: 1 });
  });

  it('ログイン状態の復元(再水和のタイマーと同じ処理)が、差し替えの中でも例外を出さない (Gate A2)', async () => {
    useAuthStore.setState({ token: null } as never);
    // cookie での復元は「ログインが切れている」(401)として答える(本物の通信をしない)
    const refresh = vi.spyOn(api, 'refreshSession').mockRejectedValue(new AuthApiError('expired', 401));
    await expect(useAuthStore.getState().initialize()).resolves.toBeUndefined();
    expect(refresh).toHaveBeenCalled();
  });
});
