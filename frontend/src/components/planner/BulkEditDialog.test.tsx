/**
 * [Gate② FC-012] まとめて編集: 選んだ予定だけを 1 回で変える。鍵・エリアは選べない。何も選ばない・何も変えない時は送らない。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DaySchedule } from '@/types';

const m = vi.hoisted(() => ({ bulk: vi.fn() }));
vi.mock('@/services/api/bulkEdit', () => ({ bulkUpdateEvents: m.bulk }));

import BulkEditDialog from './BulkEditDialog';

const days: DaySchedule[] = [
  { id: 'd1', date: '2026-12-05', events: [
    { id: 'a', title: 'A', category: 'activity', start_time: '09:00' },
    { id: 'b', title: 'B', category: 'activity' },
    { id: 'l', title: '鍵', category: 'activity', locked: true },
    { id: 'z', title: 'エリア', category: 'area' },
  ] as DaySchedule['events'] },
  { id: 'd2', date: '2026-12-06', events: [] },
];
const cats: Array<[string, string]> = [['activity', '体験'], ['dining', '食事'], ['area', 'エリア']];
const renderDialog = (onDone = vi.fn()) => render(
  <BulkEditDialog isOpen onClose={vi.fn()} planId="p1" revision={7} days={days} dayIndex={0} categories={cats} onDone={onDone} />);

beforeEach(() => { m.bulk.mockReset(); });

describe('まとめて編集 (FC-012)', () => {
  it('選んだ予定の種類を変え、別の日へ移す(選んだ順で、版を付けて 1 回で送る)', async () => {
    m.bulk.mockResolvedValue({ updated: 2, revision: 8 });
    const onDone = vi.fn();
    renderDialog(onDone);
    fireEvent.click(screen.getByTestId('bulk-pick-b'));
    fireEvent.click(screen.getByTestId('bulk-pick-a'));
    fireEvent.change(screen.getByTestId('bulk-type'), { target: { value: 'dining' } });
    fireEvent.change(screen.getByTestId('bulk-day'), { target: { value: 'd2' } });
    fireEvent.click(screen.getByTestId('bulk-apply'));
    await waitFor(() => expect(m.bulk).toHaveBeenCalledWith('p1', ['b', 'a'], { event_type: 'dining', day_id: 'd2' }, 7));
    expect(onDone).toHaveBeenCalledWith(2);
  });

  it('鍵・エリアの予定は選べない。種類の候補に「エリア」は無く、今の日は移す先に出ない', () => {
    renderDialog();
    expect(screen.getByTestId('bulk-pick-l')).toBeDisabled();
    expect(screen.getByTestId('bulk-pick-z')).toBeDisabled();
    expect(screen.getByTestId('bulk-type')).not.toHaveTextContent('エリア');
    expect(screen.getByTestId('bulk-day')).not.toHaveTextContent('1 日目');
  });

  it('何も選ばない・何も変えない時は送らずに知らせる', () => {
    renderDialog();
    fireEvent.click(screen.getByTestId('bulk-apply'));
    expect(screen.getByRole('alert')).toHaveTextContent('予定を選んでください');
    fireEvent.click(screen.getByTestId('bulk-pick-a'));
    fireEvent.click(screen.getByTestId('bulk-apply'));
    expect(screen.getByRole('alert')).toHaveTextContent('種類か移す日を選んでください');
    expect(m.bulk).not.toHaveBeenCalled();
  });
});
