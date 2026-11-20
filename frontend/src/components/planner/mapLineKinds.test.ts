import { describe, it, expect } from 'vitest';
import { mapLineKinds } from './mapLineKinds';

describe('[Gate② UX P0] 地図の線の種類の凡例', () => {
  it('道の経路と直線の両方があれば両方を、どちらかだけならそれだけを出す', () => {
    expect(mapLineKinds(true, [true, false], 0).map((k) => [k.key, k.dashed])).toEqual([['road', false], ['straight', true]]);
    expect(mapLineKinds(true, [true, true], 0).map((k) => k.key)).toEqual(['road']);
    expect(mapLineKinds(true, [false], 0).map((k) => k.label)).toEqual(['直線(目安・道ではない)']);
  });
  it('区間の線を引かない時は予定の順の点線(直線)だけ。線が無ければ何も出さない', () => {
    expect(mapLineKinds(false, [], 3)).toEqual([{ key: 'straight', label: '予定の順(直線・道ではない)', dashed: true }]);
    expect(mapLineKinds(false, [], 1)).toEqual([]);
    expect(mapLineKinds(true, [], 0)).toEqual([]);
  });
});
