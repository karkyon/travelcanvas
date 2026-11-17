/**
 * [Gate Hardening-A・監査 G-07] 当日の地図の線の凡例。線は地点を直線で結んだ目安で道順ではなく、
 * 位置の記録を使わない時の済んだ予定の線を「足跡」と呼ばない。
 */
import { describe, expect, it } from 'vitest';
import { mapLineLegend, trailInUse } from './mapFilters';

describe('trailInUse', () => {
  it('設定が ON で点が 2 つ以上ある時だけ、端末の位置の記録を足跡に使う', () => {
    expect(trailInUse(true, 2)).toBe(true);
    expect(trailInUse(true, 1)).toBe(false);
    expect(trailInUse(false, 50)).toBe(false);
  });
});

describe('mapLineLegend', () => {
  it('位置の記録を使わない時は「足跡」と呼ばず、直線で道順ではないと書く', () => {
    const l = mapLineLegend(false);
    expect(l.walked).not.toContain('足跡');
    expect(l.walked).toContain('直線');
    expect(l.ahead).toContain('直線');
    expect(l.note).toContain('道順');
    expect(l.note).toContain('位置の記録をONにした時だけ');
  });

  it('位置の記録を使う時は足跡と書くが、予定の線は道順ではないと書く', () => {
    const l = mapLineLegend(true);
    expect(l.walked).toContain('足跡');
    expect(l.ahead).toContain('直線');
    expect(l.ahead).not.toContain('道のり');
    expect(l.note).toContain('道順ではありません');
  });
});
