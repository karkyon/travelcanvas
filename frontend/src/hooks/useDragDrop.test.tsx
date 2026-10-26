/**
 * [Gate M9-FE-B3] useDragDrop: hook外へ移したhelperの挙動と、handlerの参照安定性。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type React from 'react';

const { reorderSchedule } = vi.hoisted(() => ({ reorderSchedule: vi.fn() }));
vi.mock('./usePlan', () => ({
  usePlan: () => ({ reorderSchedule }),
}));

import {
  useDragDrop, reorderArray, getCurrentItemOrder, moveItemBetweenDays, containerId, parseContainer, finalIndexForGap,
} from './useDragDrop';
import { usePlanStore } from '../store/planStore';
import type { TravelPlan, ScheduleItem } from '../types';

const plan = {
  id: 'plan-1',
  title: 't',
  days: [
    { id: 'day-a', events: [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }] },
    { id: 'day-b', events: [{ id: 'e4' }] },
  ],
} as unknown as TravelPlan;

describe('useDragDrop helpers (Gate M9-FE-B3)', () => {
  beforeEach(() => {
    reorderSchedule.mockReset().mockResolvedValue(undefined);
    usePlanStore.setState({ currentPlan: plan });
  });

  it('reorderArrayは指定位置へ移動し、存在しないidなら元配列を返す', () => {
    expect(reorderArray(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a']);
    const src = ['a', 'b'];
    expect(reorderArray(src, 'zz', 0)).toBe(src);
  });

  it('getCurrentItemOrderはstoreの現在プランからイベント順を返す', () => {
    expect(getCurrentItemOrder('plan-1', 'day-a')).toEqual(['e1', 'e2', 'e3']);
    expect(getCurrentItemOrder('other-plan', 'day-a')).toEqual([]);
    expect(getCurrentItemOrder('plan-1', 'missing')).toEqual([]);
  });

  it('moveItemBetweenDaysはdayIdをindexへ解決してstoreへ委譲する', async () => {
    const move = vi.fn().mockResolvedValue(undefined);
    usePlanStore.setState({ moveItemBetweenDays: move });
    await moveItemBetweenDays('e1', 'day-a', 'day-b', 0);
    expect(move).toHaveBeenCalledWith('e1', 0, 1, 0);
    await moveItemBetweenDays('e1', 'day-a', 'missing', 0);
    expect(move).toHaveBeenCalledTimes(1);
  });

  it('再描画してもhandleDrop/handleKeyboardMoveの参照は変わらない(drag handler再生成なし)', () => {
    const { result, rerender } = renderHook(() => useDragDrop());
    const first = result.current;
    rerender();
    expect(result.current.handleDrop).toBe(first.handleDrop);
    expect(result.current.handleKeyboardMove).toBe(first.handleKeyboardMove);
    expect(result.current.handleDragStart).toBe(first.handleDragStart);
  });

  it('handleKeyboardMove(ArrowDown)は隣と入れ替えた順序でreorderScheduleを呼ぶ', async () => {
    const { result } = renderHook(() => useDragDrop());
    const event = { key: 'ArrowDown', preventDefault: vi.fn() } as unknown as React.KeyboardEvent;
    await act(async () => {
      await result.current.handleKeyboardMove(event, { id: 'e1' } as ScheduleItem, 'plan-1', 'day-a');
    });
    expect(reorderSchedule).toHaveBeenCalledWith('plan-1', 'day-a', ['e2', 'e1', 'e3']);
  });
});

describe('[Gate G7] FR-005 ドラッグで並べ替え(UUID の旅行・日)', () => {
  const P = '6f1c2b0e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
  const D = '0d9e8f7a-6b5c-4d3e-9f2a-1b0c9d8e7f6a';
  beforeEach(() => {
    reorderSchedule.mockReset().mockResolvedValue(undefined);
    usePlanStore.setState({ currentPlan: { ...plan, id: P, days: [{ ...plan.days[0]!, id: D }] } as unknown as TravelPlan });
  });

  it('入れ物の ID は UUID の "-" で切れない', () => {
    expect(parseContainer(containerId(P, D))).toEqual({ planId: P, dayId: D });
    expect(parseContainer('壊れた値')).toEqual({ planId: '', dayId: '' });
  });

  it('落とした隙間を動かした後の位置にする(下へは1つ前)', () => {
    const order = ['e1', 'e2', 'e3'];
    expect(finalIndexForGap(order, 'e1', 2)).toBe(1);
    expect(finalIndexForGap(order, 'e1', 3)).toBe(2);
    expect(finalIndexForGap(order, 'e3', 0)).toBe(0);
  });

  it('1件目を3件目の前へ落とすと 2件目と入れ替わる', async () => {
    const { result } = renderHook(() => useDragDrop());
    const data = JSON.stringify({ itemId: 'e1', sourceContainer: containerId(P, D) });
    const drop = {
      preventDefault: vi.fn(), currentTarget: document.createElement('div'),
      dataTransfer: { getData: () => data },
    } as unknown as React.DragEvent;
    const onDone = vi.fn();
    await act(async () => {
      await result.current.handleDrop(drop, containerId(P, D), 2, onDone);
    });
    expect(reorderSchedule).toHaveBeenCalledWith(P, D, ['e2', 'e1', 'e3']);
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ success: true, action: 'reorder' }));
  });
});
