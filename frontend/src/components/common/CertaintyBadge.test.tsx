/** [Gate② UX P0] 確からしさの印(共通の部品と語彙) */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CertaintyBadge from './CertaintyBadge';
import { CERTAINTY_WORD, certaintyLabel, certaintyNeedsCheck, type CertaintyKind } from './certainty';

const ALL: CertaintyKind[] = ['live', 'manual', 'registered', 'estimate', 'unknown', 'unqueried', 'unconnected', 'failed'];

describe('確からしさの語彙', () => {
  it('8 つの状態に語がある(DOC-13 §16・§3 と同じ語)', () => {
    expect(ALL.map((k) => CERTAINTY_WORD[k])).toEqual(['実データ', '手入力', '登録した値', '概算', '不明', '未照会', '未接続', '取得失敗']);
  });
  it('そのまま信じてよいのは実データ・手入力・登録した値だけ', () => {
    expect(ALL.filter((k) => !certaintyNeedsCheck(k))).toEqual(['live', 'manual', 'registered']);
  });
  it('読み上げの文に出どころと取得時刻', () => {
    expect(certaintyLabel('live', undefined, '10:05')).toBe('出どころ: 実データ(10:05 取得)');
    expect(certaintyLabel('estimate', '距離からの概算')).toBe('出どころ: 距離からの概算');
  });
});

describe('CertaintyBadge', () => {
  it('語を文字で出し(色だけに頼らない)、1 文字の印は読み上げない', () => {
    render(<CertaintyBadge kind="failed" testId="b" />);
    const b = screen.getByTestId('b');
    expect(b).toHaveAttribute('data-cert', 'failed');
    expect(b).toHaveTextContent('取得失敗');
    expect(b.querySelector('i')).toHaveAttribute('aria-hidden', 'true');
    expect(b).toHaveAttribute('title', '出どころ: 取得失敗');
  });
  it('画面の言い方と取得時刻を出せる', () => {
    render(<CertaintyBadge kind="live" word="実時刻" at="10:05" testId="b" />);
    expect(screen.getByTestId('b')).toHaveTextContent('実時刻 10:05 取得');
  });
});
