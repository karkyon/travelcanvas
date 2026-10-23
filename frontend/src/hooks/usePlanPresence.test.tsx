/**
 * [Gate C1] FR-020 共同編集の知らせ: 間隔は backend の poll_seconds、編集する予定が変わるとすぐ知らせ、
 * 失敗しても続け、閉じると知らせを消す。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { api } from '@/services/api';
import type { PresenceState } from '@/services/api';
import { usePlanPresence } from './usePlanPresence';

const state = (over: Partial<PresenceState> = {}): PresenceState => ({
  plan_id: 'p1', revision: 3, viewers: [], changes: [], poll_seconds: 5, ttl_seconds: 40, ...over,
});

describe('usePlanPresence (Gate C1)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // [Gate G2] 既定は即時の通知を使わない(ポーリングの試験)。即時の通知は下の試験で個別に確かめる
    vi.spyOn(api, 'streamPlanEvents').mockResolvedValue('unsupported');
  });
  afterEach(() => {
    // [Gate G3] DEP-04 差し替えを戻す前に閉じる(閉じる時の知らせ(leavePresence)が本物の通信にならない)
    cleanup();
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

  it('[Gate G2] 即時の通知: ready でつながり、revision・presence を受けたらすぐ知らせ直す。閉じられたらつなぎ直す', async () => {
    const post = vi.spyOn(api, 'postPresence').mockResolvedValue(state({ revision: 4, poll_seconds: 5 }));
    vi.spyOn(api, 'leavePresence').mockResolvedValue(undefined);
    type OnEvent = Parameters<typeof api.streamPlanEvents>[2];
    let emit: OnEvent = () => undefined;
    let finish: (end: 'closed') => void = () => undefined;
    const stream = vi.spyOn(api, 'streamPlanEvents').mockImplementation((_p, _k, onEvent) => {
      emit = onEvent;
      return new Promise((resolve) => { finish = resolve; });
    });
    const { result, unmount } = renderHook(() => usePlanPresence('p1', 3, null));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(stream).toHaveBeenCalledTimes(1);
    expect(stream.mock.calls[0]![1]).toBe(3);
    act(() => emit({ type: 'ready', id: '4', data: { revision: 4 } }));
    expect(result.current.live).toBe(true);
    const n = post.mock.calls.length;
    await act(async () => { emit({ type: 'revision', id: '5', data: { revision: 5 } }); await vi.advanceTimersByTimeAsync(0); });
    expect(post.mock.calls.length).toBe(n + 1);
    await act(async () => { emit({ type: 'presence', id: '5', data: { people: 2 } }); await vi.advanceTimersByTimeAsync(0); });
    expect(post.mock.calls.length).toBe(n + 2);
    // つながっている間は知らせの間隔を伸ばす(5秒では送らない)
    const m = post.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(post.mock.calls.length).toBe(m);
    // サーバーが閉じた → 最後に受け取った版でつなぎ直す
    await act(async () => { finish('closed'); await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.live).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(stream.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(stream.mock.calls[1]![1]).toBe(5);
    unmount();
  });

  it('[Gate G2] 即時の通知が断られた(未対応・権限)時はポーリングだけで続ける', async () => {
    const post = vi.spyOn(api, 'postPresence').mockResolvedValue(state({ poll_seconds: 5 }));
    vi.spyOn(api, 'leavePresence').mockResolvedValue(undefined);
    const stream = vi.spyOn(api, 'streamPlanEvents').mockResolvedValue('refused');
    const { result } = renderHook(() => usePlanPresence('p1', 3, null));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(stream).toHaveBeenCalledTimes(1);
    expect(result.current.live).toBe(false);
    expect(post.mock.calls.length).toBeGreaterThanOrEqual(5);
  });
});
