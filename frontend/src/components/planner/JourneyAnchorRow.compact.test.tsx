import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import JourneyAnchorRow from './JourneyAnchorRow';

describe('[Gate ChartAlign] 全日程の表の宿の行(列の幅いっぱい)', () => {
  it('compact の時は時刻の列と点を出さない', () => {
    const { container } = render(<JourneyAnchorRow compact position="end"
      anchor={{ kind: 'lodging-to', place: '鳥羽の宿', time: null, continued: false }} />);
    const row = screen.getByTestId('day-anchor-end');
    expect(row).toHaveClass('is-compact');
    expect(row).toHaveTextContent('今夜の宿鳥羽の宿');
    expect(container.querySelector('.tc-anchor-time')).toBeNull();
    expect(container.querySelector('.tc-anchor-dot')).toBeNull();
  });

  it('通常は時刻の列と点を出す(旅程の日の表示)', () => {
    const { container } = render(<JourneyAnchorRow position="start"
      anchor={{ kind: 'departure', place: '自宅', time: '07:30', continued: false }} />);
    expect(container.querySelector('.tc-anchor-time')).toHaveTextContent('07:30');
    expect(container.querySelector('.tc-anchor-dot')).not.toBeNull();
  });
});

describe('[Gate HomePlace] 出発・帰着の行の「自宅の場所」', () => {
  it('出発が自宅(または未入力)の時だけ出す', () => {
    const fn = vi.fn();
    const { rerender } = render(<JourneyAnchorRow anchor={{ kind: 'departure', place: '自宅', time: '08:00', continued: false }} position="start" onEditHome={fn} />);
    screen.getByTestId('day-anchor-home-departure').click();
    expect(fn).toHaveBeenCalledTimes(1);
    rerender(<JourneyAnchorRow anchor={{ kind: 'departure', place: '東京駅', time: null, continued: false }} position="start" onEditHome={fn} />);
    expect(screen.queryByTestId('day-anchor-home-departure')).toBeNull();
  });
});
