/**
 * [Gate V2] 保護エリア(この端末だけ。FR-051)。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MAX_ZONES, addZone, inProtectedZone, loadZones, removeZone } from './protectedZones';

const HOME = { latitude: 35.0, longitude: 135.7 };

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('protectedZones (Gate V2)', () => {
  it('追加・判定・削除ができ、端末にだけ保存する', () => {
    const r = addZone({ label: '  自宅  ', ...HOME, radius_m: 500 });
    expect(r.ok).toBe(true);
    expect(loadZones()).toHaveLength(1);
    expect(loadZones()[0]).toMatchObject({ label: '自宅', radius_m: 500 });
    expect(inProtectedZone({ latitude: 35.003, longitude: 135.7 }, loadZones())).toBe(true); // 約330m
    expect(inProtectedZone({ latitude: 35.006, longitude: 135.7 }, loadZones())).toBe(false); // 約670m
    expect(removeZone(loadZones()[0]!.id)).toEqual([]);
  });

  it('件数の上限・不正な値・壊れた保存内容を扱う', () => {
    for (let i = 0; i < MAX_ZONES; i += 1) expect(addZone({ label: `z${i}`, ...HOME, radius_m: 200 }).ok).toBe(true);
    expect(addZone({ label: 'over', ...HOME, radius_m: 200 })).toMatchObject({ ok: false, reason: '保護エリアは10件までです' });
    localStorage.clear();
    expect(addZone({ label: 'x', latitude: 120, longitude: 0, radius_m: 200 }).ok).toBe(false);
    localStorage.setItem('tc.protectedZones.v1', '{broken');
    expect(loadZones()).toEqual([]);
    localStorage.setItem('tc.protectedZones.v1', JSON.stringify([{ id: 'a' }, { id: 'b', label: 'ok', ...HOME, radius_m: 200 }]));
    expect(loadZones().map((z) => z.id)).toEqual(['b']);
  });

  it('ストレージが使えない環境でも止まらない', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(loadZones()).toEqual([]);
    expect(addZone({ label: '自宅', ...HOME, radius_m: 200 })).toMatchObject({ ok: false, reason: 'この端末に保存できませんでした' });
  });
});
