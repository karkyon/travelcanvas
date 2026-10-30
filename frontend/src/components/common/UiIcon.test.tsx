/**
 * [UX-6] 飾りのアイコンは読み上げから外し、名前は文字で出す。旅程の中の移動に OS の絵文字を使わない。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { render, screen } from '@testing-library/react';
import { Sun } from 'lucide-react';
import UiIcon from './UiIcon';
import Button from './Button';

// OS のカラー絵文字として表示される文字: Emoji_Presentation、絵文字の表示を求める異体字セレクタ(U+FE0F)、
// U+1F000 以上の絵文字の文字(🖼 のように既定が「文字」でも、多くの OS で絵文字の字形で描かれる)。
// ✓・✕・⚠・♥・★ のような文字の記号(文字と組で状態を示す。色だけで伝えないための印)は対象にしない
const EMOJI = /\p{Emoji_Presentation}|\u{FE0F}|(?=\p{Extended_Pictographic})[\u{1F000}-\u{1FAFF}]/u;

// 除外(理由つき)。docs/trace/gate-ux6-icons2-trace.md
const EXCLUDED: Record<string, string> = {
  'components/layout/Header.tsx': 'どこからも使われていない部品(画面に出ない)',
  'components/Navbar.tsx': 'どこからも使われていない部品(画面に出ない)',
  'components/common/MapView.tsx': 'どこからも使われていない部品(画面に出ない)',
  'utils/index.ts': '参照の無い対応表(categoryIcons・getCategoryIcon。画面に出ない)',
  'config/constants.ts': '参照の無い対応表(CATEGORY_ICONS・TRANSPORT_ICONS・PRIORITY_ICONS。画面に出ない)',
};

describe('UiIcon', () => {
  it('読み上げから外し、ボタンの名前は文字だけになる', () => {
    render(<Button icon={<UiIcon icon={Sun} />}>今日</Button>);
    const icon = screen.getByTestId('ui-icon');
    expect(icon.tagName.toLowerCase()).toBe('svg');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon).toHaveAttribute('width', '16');
    expect(screen.getByRole('button', { name: '今日' })).toBeInTheDocument();
  });

  it('画面に出る文字に OS のカラー絵文字を使わない(src 全体。理由のある除外だけ)', () => {
    const root = path.resolve(__dirname, '..', '..');
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!/\.(tsx|ts)$/.test(name) || /\.test\./.test(name)) continue;
        const rel = path.relative(root, full).split(path.sep).join('/');
        if (EXCLUDED[rel]) continue;
        readFileSync(full, 'utf-8').split('\n').forEach((line, i) => {
          if (/^\s*(\/\/|\*|\{\/\*|\/\*)/.test(line)) return;  // 注釈
          if (/console\.(log|warn|error|info|group)/.test(line)) return;  // 開発者の console の出力(画面に出ない)
          if (EMOJI.test(line)) found.push(`${rel}:${i + 1}`);
        });
      }
    };
    walk(root);
    expect(found).toEqual([]);
  });
});
