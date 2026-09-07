/**
 * [Gate R0-7] api.ts の旧itinerary変換に関する回帰テスト。
 *
 * planToApi()は以前、planData.daysが存在する場合にitinerary JSON blobへ
 * 包んで/travel-plans(metadata API)へ送信しようとしていたが、backend側は
 * Gate #34でitineraryフィールドの書込みを422で拒否するようになっており、
 * この変換は到達しても失敗するだけの契約違反コードだった(2026-09-07
 * 最新コード再監査報告書 追加技術欠陥#3)。Gate R0でこの変換を削除した。
 * 本テストは、daysを含むplanDataを渡してもitineraryキーが決して
 * 含まれないことを保証する回帰テストである。
 */
import { describe, it, expect } from 'vitest';
import { api } from './api';

describe('planToApi', () => {
  it('never emits an itinerary key, even when days is present', () => {
    const result = (api as any).planToApi({
      title: '旅行',
      days: [{ id: 'day-1', events: [] }],
    });
    expect(result).not.toHaveProperty('itinerary');
    expect(result).not.toHaveProperty('days');
    expect(result.title).toBe('旅行');
  });

  it('returns metadata unchanged when days is absent', () => {
    const result = (api as any).planToApi({ title: '旅行', destination: '京都' });
    expect(result).toEqual({ title: '旅行', destination: '京都' });
  });

  it('passes through null/undefined unchanged', () => {
    expect((api as any).planToApi(null)).toBeNull();
    expect((api as any).planToApi(undefined)).toBeUndefined();
  });
});
