import { describe, expect, it } from 'vitest';
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
