/**
 * [UX-6] 予定の行の印: カテゴリは OS の絵文字ではなく UiIcon(読み上げから外し、名前は文字で読み上げる)、
 * 確定の予定は「確定」の印を出す(並べ替えの知らせ「確定の予定のため動かせません」が指す印を画面に出す)。
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import ScheduleItem from './ScheduleItem';

const base = {
  id: 'e1', title: '清水寺', startTime: '09:00', endTime: '10:00', duration: 60, locationName: '', address: '',
  category: 'sightseeing', priority: 'medium' as const,
};

describe('ScheduleItem の印', () => {
  it('カテゴリの印は svg で読み上げから外し、カテゴリの名前を文字で読み上げる', () => {
    render(<ScheduleItem {...base} />);
    const mark = screen.getByTestId('schedule-category');
    expect(mark).toHaveAttribute('data-category', 'sightseeing');
    expect(within(mark).getByTestId('ui-icon')).toHaveAttribute('aria-hidden', 'true');
    expect(mark).toHaveTextContent('観光:');
    expect(screen.queryByTestId('schedule-locked')).toBeNull();
  });

  it('知らないカテゴリは「予定」、確定の予定には「確定」の印(文字と鍵のアイコン)', () => {
    render(<ScheduleItem {...base} category="unknown" locked />);
    expect(screen.getByTestId('schedule-category')).toHaveTextContent('予定:');
    const locked = screen.getByTestId('schedule-locked');
    expect(locked).toHaveTextContent('確定');
    expect(within(locked).getByTestId('ui-icon')).toHaveAttribute('aria-hidden', 'true');
  });
});
