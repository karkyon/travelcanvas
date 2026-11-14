/** [Gate Remaining-6] 写真の地図の印のまとめ */
import { describe, it, expect } from 'vitest';
import { clusterPoints } from './clusterModel';

describe('clusterPoints', () => {
  it('近い点をまとめ、遠い点は分ける', () => {
    const c = clusterPoints([{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 10, y: 10 }, { id: 'c', x: 200, y: 0 }], 48);
    expect(c.map((x) => x.ids)).toEqual([['a', 'b'], ['c']]);
    expect(c[0]).toMatchObject({ x: 5, y: 5 });
  });
  it('点が無ければ空', () => {
    expect(clusterPoints([])).toEqual([]);
  });
});
