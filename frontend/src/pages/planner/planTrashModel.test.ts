/**
 * [Gate B-012] 削除済みプランの表示整形(planTrashModel)の単体テスト。
 */
import { describe, it, expect } from 'vitest';
import { daysUntilPurge, formatDate, purgeNotice } from './planTrashModel';

const NOW = new Date('2026-09-26T12:00:00Z');

describe('完全削除までの表示 (Gate B-012)', () => {
  it('残り日数は切り上げ、期限切れは0、不正な日時はnull', () => {
    expect(daysUntilPurge('2026-10-26T12:00:00Z', NOW)).toBe(30);
    expect(daysUntilPurge('2026-09-26T13:00:00Z', NOW)).toBe(1);
    expect(daysUntilPurge('2026-09-25T12:00:00Z', NOW)).toBe(0);
    expect(daysUntilPurge('not-a-date', NOW)).toBeNull();
  });

  it('予定日と残り日数、期限間近、不明を区別して表示する', () => {
    expect(purgeNotice('2026-10-26T12:00:00Z', NOW)).toMatch(/^2026\/10\/2[67]に完全に削除されます\(あと30日\)$/);
    expect(purgeNotice('2026-09-20T12:00:00Z', NOW)).toBe('まもなく完全に削除されます(復元できません)');
    expect(purgeNotice('x', NOW)).toBe('完全削除の予定日時が不明です');
    expect(formatDate(null)).toBe('');
    expect(formatDate('bad')).toBe('');
  });
});
