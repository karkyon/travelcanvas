import { describe, it, expect } from 'vitest';
import { code128Svg, code128Values, code128Widths, isLinearFormat } from './code128';

describe('Code 128(Gate Remaining-1)', () => {
  it('印字できる文字は 128B、偶数桁の数字は 128C。検査の値は規格どおり', () => {
    // 規格の例: "PJJ123C" → 開始B(104) P(48) J(42) J(42) 1(17) 2(18) 3(19) C(35) 検査 879 % 103 = 55 終了
    expect(code128Values('PJJ123C')).toEqual([104, 48, 42, 42, 17, 18, 19, 35, 55, 106]);
    expect(code128Values('123456')).toEqual([105, 12, 34, 56, (105 + 12 + 34 * 2 + 56 * 3) % 103, 106]);
    expect(code128Values('日本')).toBeNull();
    expect(code128Values('')).toBeNull();
  });

  it('各文字は 11 単位、終了は 13 単位。SVG を作る', () => {
    const w = code128Widths('AB')!;
    expect(w.reduce((a, b) => a + b, 0)).toBe(11 * 4 + 13);
    expect(code128Svg('AB')).toMatch(/^<svg/);
  });

  it('形式の名前で 1 次元のバーコードか QR かを決める', () => {
    expect(isLinearFormat('CODE_128')).toBe(true);
    expect(isLinearFormat('code128')).toBe(true);
    expect(isLinearFormat('QR')).toBe(false);
    expect(isLinearFormat(null)).toBe(false);
  });
});
