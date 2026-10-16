import { describe, it, expect } from 'vitest';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import type { Booklet } from '@/services/api';
import { EXCLUDED_NOTE, buildCard, fileName } from './imageCards';

const b = fx.booklet_preview as unknown as Booklet;

describe('imageCards (Gate P16)', () => {
  it('旅行全体: 日ごとに予定と移動を載せ、機密を含めない旨と版を書く', () => {
    const c = buildCard(b, 'trip');
    expect(c.title).toBe('京都しおり');
    expect(c.subtitle).toBe('京都・2026-11-01');
    expect(c.sections).toHaveLength(1);
    expect(c.sections[0]!.heading).toBe('2026-11-01(日) 東山');
    expect(c.sections[0]!.lines).toEqual(['10:00  清水寺', '14:30  バス 清水寺 → 宿にチェックイン・30分', '16:00  宿にチェックイン']);
    expect(c.footer[0]).toMatch(/旅程の版 r5\(最新\)$/);
    expect(c.footer[1]).toBe(EXCLUDED_NOTE);
    expect(c.warning).toBeNull();
    expect(JSON.stringify(c)).not.toContain('4567'); // 予約番号の一部も載せない
  });

  it('1日だけ・古い投影には警告', () => {
    const c = buildCard({ ...b, is_stale: true }, '2026-11-01');
    expect(c.subtitle).toBe('京都・2026-11-01(日) 東山');
    expect(c.warning).toMatch(/作り直してください/);
    expect(c.footer[0]).toMatch(/\(古い\)$/);
    expect(buildCard(b, '2030-01-01').sections).toEqual([]);
  });

  it('保存するファイル名', () => {
    expect(fileName('京都 しおり', 'trip', 1, 1)).toBe('京都_しおり_trip.png');
    expect(fileName('京都', '2026-11-01', 2, 3)).toBe('京都_2026-11-01_2of3.png');
  });
});
