/**
 * [Gate C1] FR-020 共同編集の知らせ: 間隔は backend の poll_seconds、編集する予定が変わるとすぐ知らせ、
 * 失敗しても続け、閉じると知らせを消す。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { api } from '@/services/api';
import type { PresenceState } from '@/services/api';
import { usePlanPresence } from './usePlanPresence';

const state = (over: Partial<PresenceState> = {}): PresenceState => ({
  plan_id: 'p1', revision: 3, viewers: [], changes: [], poll_seconds: 5, ttl_seconds: 40, ...over,
});

describe('usePlanPresence (Gate C1)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('知らせて結果を持ち、poll_seconds ごとに繰り返す。編集する予定が変わるとすぐ知らせる', async () => {
    const post = vi.spyOn(api, 'postPresence').mockResolvedValue(state({ revision: 4 }));
    const leave = vi.spyOn(api, 'leavePresence').mockResolvedValue(undefined);
    const { result, rerender, unmount } = renderHook(
      ({ editing }) => usePlanPresence('p1', 3, editing), { initialProps: { editing: null as string | null } },
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(post).toHaveBeenCalled();
    expect(post.mock.calls[0]![1]).toMatchObject({ known_revision: 3, editing: null });
    expect(result.current.remoteRevision).toBe(4);
    const n = post.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(post.mock.calls.length).toBe(n + 1);
    rerender({ editing: 'e1' });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(post.mock.calls[post.mock.calls.length - 1]![1]).toMatchObject({ editing: { kind: 'event', id: 'e1' } });
    unmount();
    expect(leave).toHaveBeenCalledWith('p1', expect.stringMatching(/^[A-Za-z0-9_-]{8,64}$/));
  });

  it('失敗しても止まらず「確認できない」を示し、成功すると戻る', async () => {
    const post = vi.spyOn(api, 'postPresence').mockRejectedValueOnce(new Error('offline')).mockResolvedValue(state());
    vi.spyOn(api, 'leavePresence').mockResolvedValue(undefined);
    const { result } = renderHook(() => usePlanPresence('p1', 3, null));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.offline).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(post.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(result.current.offline).toBe(false);
  });

  it('旅行が無い・止めている時は知らせない', async () => {
    const post = vi.spyOn(api, 'postPresence').mockResolvedValue(state());
    renderHook(() => usePlanPresence(null, undefined, null));
    renderHook(() => usePlanPresence('p1', 1, null, false));
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(post).not.toHaveBeenCalled();
  });
});
