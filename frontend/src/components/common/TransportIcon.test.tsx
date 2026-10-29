/**
 * [Gate G11 段階9] 移動手段のアイコンは OS の絵文字に頼らない(lucide とヘリの形)。名前は文字で必ず出す。
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TransportIcon from './TransportIcon';
import { LEGEND_MODES, transportMode, transportText } from '@/utils/transportModes';

describe('移動手段のアイコン', () => {
  it('凡例の全ての手段に絵文字ではない SVG のアイコンがあり、読み上げから外す', () => {
    for (const mode of LEGEND_MODES) {
      const { container, unmount } = render(<TransportIcon mode={mode} />);
      const svg = container.querySelector('svg');
      expect(svg, mode).not.toBeNull();
      expect(svg).toHaveAttribute('aria-hidden', 'true');
      expect(svg).toHaveAttribute('data-mode', mode);
      unmount();
    }
  });

  it('古い値は正式な値のアイコン、値が無い・知らない値はアイコンを出さない', () => {
    render(<TransportIcon mode="car" />);
    expect(screen.getByTestId('transport-icon')).toHaveAttribute('data-mode', 'driving');
    const { container } = render(<><TransportIcon mode={null} /><TransportIcon mode="rocket" /></>);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('文字の表示に絵文字を使わない(全ての手段)', () => {
    for (const mode of [...LEGEND_MODES, 'mixed', 'ferry', 'subway', 'tram', 'transit', 'car', 'plane', 'boat', null]) {
      expect(transportText(mode, 30)).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(transportMode(mode).label).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});
