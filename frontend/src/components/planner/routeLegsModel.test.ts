import { describe, expect, it } from 'vitest';
import { buildMapLegs, legsSignature, straightKm } from './routeLegsModel';

const ev = (id: string, lat: number | null, lng: number | null, extra: Record<string, unknown> = {}) => ({ id, latitude: lat, longitude: lng, ...extra });

describe('[Gate RoadRoute] 地図の線の区間', () => {
  it('位置のある予定だけを順に2点ずつ結ぶ(位置の無い予定は飛ばす)', () => {
    const legs = buildMapLegs([ev('a', 34.45, 136.72), ev('x', null, null), ev('b', 34.46, 136.72), ev('c', 34.49, 136.84)]);
    expect(legs.map((l) => l.key)).toEqual(['a>b', 'b>c']);
    expect(legs[0]!.from).toEqual([34.45, 136.72]);
  });

  it('区間の手段 > エリアの中は歩き > 距離で推測(1.2km 以内は歩き・遠ければ車)', () => {
    const events = [
      ev('area', 34.462, 136.723, { category: 'area' }),
      ev('in1', 34.4625, 136.7232, { parent_event_id: 'area' }),
      ev('in2', 34.4630, 136.7235, { parent_event_id: 'area' }),
      ev('far', 34.487, 136.843),
      ev('kyoto', 35.0116, 135.7681),
    ];
    const segs = [
      { from_event_id: 'far', to_event_id: 'kyoto', mode: 'train', status: 'planned' },
      { from_event_id: 'in2', to_event_id: 'far', mode: 'bus', status: 'cancelled' },
    ];
    const legs = buildMapLegs(events, segs);
    expect(legs.map((l) => [l.mode, l.source])).toEqual([
      ['walking', 'area'], ['walking', 'area'], ['driving', 'guess'], ['train', 'segment'],
    ]);
  });

  it('エリアの中でも遠い場所(エリアに入れ間違えた場所)は歩きと決めつけない', () => {
    const legs = buildMapLegs([
      ev('area', 34.4622, 136.7232, { category: 'area' }),
      ev('geku', 34.4874, 136.7036, { parent_event_id: 'area' }),
    ]);
    expect(legs[0]!.source).toBe('guess');
    expect(legs[0]!.mode).toBe('driving');
  });

  it('近い2点は歩きと推測する', () => {
    const legs = buildMapLegs([ev('a', 34.4551, 136.7258), ev('b', 34.4600, 136.7258)]);
    expect(straightKm(legs[0]!.from, legs[0]!.to)).toBeLessThan(1.2);
    expect(legs[0]!.mode).toBe('walking');
  });

  it('印は座標と手段が変わった時だけ変わる', () => {
    const a = legsSignature(buildMapLegs([ev('a', 34.45, 136.72), ev('b', 34.5, 136.8)]));
    const b = legsSignature(buildMapLegs([ev('a2', 34.45, 136.72), ev('b2', 34.5, 136.8)]));
    const c = legsSignature(buildMapLegs([ev('a', 34.45, 136.72), ev('b', 34.5, 136.81)]));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
