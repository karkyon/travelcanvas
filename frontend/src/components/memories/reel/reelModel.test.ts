/** [Gate MemoryReel] 思い出リールの表示の計算 */
import { describe, expect, it } from 'vitest';
import type { MemoryReelData } from '@/services/api/memoryReel';
import {
  currentPoint, formatWhen, framesOf, monthLabel, recapStats, reelDateRange, replanQuery, routeOf, stayText,
} from './reelModel';

const base: MemoryReelData = {
  plan_id: 'p1', title: '伊勢・鳥羽 家族旅行', destination: '三重県鳥羽市', start_date: '2025-08-09', end_date: '2025-08-10',
  day_count: 2, photo_count: 3, note_count: 1, place_count: 2, member_count: 4, quote: 'また来たいね',
  slides: [
    { memory_id: 'm1', title: '夫婦岩', place_name: '夫婦岩', local_at: '2025-08-09T06:12', body: null, latitude: 34.51, longitude: 136.79 },
    { memory_id: 'm2', title: 'おかげ横丁', place_name: '伊勢市', local_at: '2025-08-09T11:20', body: '赤福', latitude: null, longitude: null },
    { memory_id: 'm3', title: null, place_name: null, local_at: null, body: null, latitude: 34.48, longitude: 136.84 },
  ],
  fallback_events: [],
};

describe('reelModel', () => {
  it('日時と期間の言い方', () => {
    expect(formatWhen('2025-08-09T06:12')).toBe('8/9(土) 6:12');
    expect(formatWhen('2025-08-09', '10:05')).toBe('8/9(土) 10:05');
    expect(formatWhen('2025-08-09')).toBe('8/9(土)');
    expect(formatWhen(null)).toBeNull();
    expect(reelDateRange('2025-08-09', '2025-08-10')).toBe('2025年8月9日〜10日');
    expect(reelDateRange('2025-08-30', '2025-09-01')).toBe('2025年8月30日〜9月1日');
    expect(reelDateRange('2025-12-31', '2026-01-01')).toBe('2025年12月31日〜2026年1月1日');
    expect(reelDateRange('2025-08-09', null)).toBe('2025年8月9日');
    expect(monthLabel('2025-08-09')).toBe('2025年8月');
    expect(stayText(1)).toBe('日帰り');
    expect(stayText(2)).toBe('1泊2日');
    expect(stayText(0)).toBeNull();
  });

  it('コマ: 写真は撮った順。場所の名前が題と同じなら繰り返さない', () => {
    const f = framesOf(base);
    expect(f.map((x) => x.title)).toEqual(['夫婦岩', 'おかげ横丁', '3枚目の写真']);
    expect(f[0]!.sub).toBe('8/9(土) 6:12');
    expect(f[1]!.sub).toBe('8/9(土) 11:20 · 伊勢市');
    expect(f[1]!.body).toBe('赤福');
    expect(f[2]!.sub).toBeNull();
    expect(f.map((x) => x.photoIndex)).toEqual([0, 1, 2]);
  });

  it('コマ: 写真が無ければ予定の名前、それも無ければ旅行名', () => {
    const ev = framesOf({ ...base, slides: [], fallback_events: [{ title: '鳥羽水族館', local_date: '2025-08-10', local_time: '10:00' }] });
    expect(ev).toEqual([expect.objectContaining({ title: '鳥羽水族館', sub: '8/10(日) 10:00', memoryId: null })]);
    const none = framesOf({ ...base, slides: [], fallback_events: [] });
    expect(none).toEqual([expect.objectContaining({ title: base.title, sub: '2025年8月9日〜10日' })]);
  });

  it('道すじ: 位置のある写真だけを箱に収め、今の点は位置の無い写真なら前の点', () => {
    const r = routeOf(base.slides)!;
    expect(r.points.map((p) => p.photoIndex)).toEqual([0, 2]);
    for (const p of r.points) {
      expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(100);
      expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(62);
    }
    // 北(緯度が大きい)が上
    expect(r.points[0]!.y).toBeLessThan(r.points[1]!.y);
    expect(currentPoint(r, 1).photoIndex).toBe(0);
    expect(currentPoint(r, 2).photoIndex).toBe(2);
    expect(currentPoint(r, null).photoIndex).toBe(0);
    expect(routeOf([base.slides[0]!])).toBeNull();
    expect(routeOf([base.slides[0]!, { ...base.slides[0]!, memory_id: 'x' }])).toBeNull();  // 同じ場所だけ
  });

  it('終わりの画面の数と、もう一度計画する時の行き先', () => {
    expect(recapStats(base)).toEqual([
      { label: '写真', value: '3' }, { label: '行った場所', value: '2' }, { label: 'メモ', value: '1' }, { label: '一緒に', value: '4人' },
    ]);
    expect(recapStats({ ...base, photo_count: 0, place_count: 0, note_count: 0, member_count: 1 })).toEqual([]);
    expect(replanQuery(base)).toBe('&destination=%E4%B8%89%E9%87%8D%E7%9C%8C%E9%B3%A5%E7%BE%BD%E5%B8%82');
    expect(replanQuery({ destination: '  ' })).toBe('');
  });
});
