/**
 * [UX-6] 飾りのアイコンは読み上げから外し、名前は文字で出す。旅程の中の移動に OS の絵文字を使わない。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { render, screen } from '@testing-library/react';
import { Sun } from 'lucide-react';
import UiIcon from './UiIcon';
import Button from './Button';

// 絵文字として表示される文字(Extended_Pictographic)と、絵文字の表示を求める異体字セレクタ(U+FE0F)。
// ✦ のような文字の記号(絵文字の表示にならない)は対象にしない
const EMOJI = /\p{Extended_Pictographic}|\u{FE0F}/u;

describe('UiIcon', () => {
  it('読み上げから外し、ボタンの名前は文字だけになる', () => {
    render(<Button icon={<UiIcon icon={Sun} />}>今日</Button>);
    const icon = screen.getByTestId('ui-icon');
    expect(icon.tagName.toLowerCase()).toBe('svg');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon).toHaveAttribute('width', '16');
    expect(screen.getByRole('button', { name: '今日' })).toBeInTheDocument();
  });

  it('旅程の中の移動・旅行の基本情報の画面の文字に OS の絵文字を使わない', () => {
    for (const rel of ['pages/PlannerPage.tsx', 'components/PlanHeader.tsx']) {
      const src = readFileSync(path.resolve(__dirname, '..', '..', rel), 'utf-8');
      // 注釈(// と {/* */})を除いた行だけを見る
      const lines = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\{\/\*|\/\*)/.test(l));
      const found = lines.filter((l) => EMOJI.test(l));
      expect(found, rel).toEqual([]);
    }
  });
});
