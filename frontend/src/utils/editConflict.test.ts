import { describe, it, expect } from 'vitest';
import { detectConflict, mergeMine, type EditFields } from './editConflict';

const base: EditFields = { title: '清水寺', start_time: '10:00', location_name: '', notes: '' };

describe('予定の編集の競合 (Gate C1 FR-020)', () => {
  it('相手が変えた・自分が変えた・両方が変えた項目を分ける', () => {
    const mine = { ...base, notes: '朝一番', title: '清水寺へ' };
    const latest = { ...base, title: '清水寺(朝)', start_time: '09:00' };
    const c = detectConflict(base, mine, latest);
    expect(c.deleted).toBe(false);
    expect(c.theirs).toEqual(['title', 'start_time']);
    expect(c.mine).toEqual(['title', 'notes']);
    expect(c.both).toEqual(['title']);
  });

  it('相手が消したら deleted', () => {
    expect(detectConflict(base, base, null).deleted).toBe(true);
  });

  it('重ねる時は自分が変えた項目だけ(相手の変更は残す)', () => {
    const merged = mergeMine(base, { ...base, notes: '朝一番' }, { ...base, title: '清水寺(朝)', start_time: '09:00' });
    expect(merged).toEqual({ title: '清水寺(朝)', start_time: '09:00', location_name: '', notes: '朝一番' });
  });

  it('前後の空白だけの違いは変更にしない', () => {
    expect(detectConflict(base, { ...base, title: ' 清水寺 ' }, base).mine).toEqual([]);
  });
});
