/**
 * [Gate L3] 実行可能性検証の表示整形(validationModel)の単体テスト。
 * 「検証不能を問題なしにしない」(FR-017)を表示の規則として固定する。
 */
import { describe, it, expect } from 'vitest';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import type { ValidationRunDetail } from '@/services/api';
import {
  CONSTRAINT_STATUS_LABEL, constraintStatus, describeUnchecked, formatRunTime, runHeadline, splitIssues,
} from './validationModel';

const created = fx.validation_run_created as ValidationRunDetail;
const clean = fx.validation_run_clean as ValidationRunDetail;

function withCounts(error: number, warning: number, unverified: number): ValidationRunDetail {
  return { ...clean, counts: { error, warning, info: 0, unverified } };
}

describe('結果の見出し (Gate L3)', () => {
  it('エラー > 警告 > 検証不能 > 問題なし の順に判定する', () => {
    expect(runHeadline(withCounts(2, 1, 1))).toMatchObject({ tone: 'error' });
    expect(runHeadline(withCounts(0, 1, 1))).toMatchObject({ tone: 'warning' });
    expect(runHeadline(withCounts(0, 0, 3)).tone).toBe('unverified');
    expect(runHeadline(withCounts(0, 0, 3)).text).toMatch(/問題が無いとは限りません/);
    expect(runHeadline(clean)).toEqual({ tone: 'ok', text: '検証した範囲では問題は見つかりませんでした。' });
  });

  it('検証失敗は件数が0でも問題なしと言わない', () => {
    const h = runHeadline({ ...clean, status: 'failed' });
    expect(h.tone).toBe('failed');
    expect(h.text).not.toMatch(/問題は見つかりませんでした/);
  });
});

describe('問題の分類と制約ごとの結果 (Gate L3)', () => {
  it('違反(エラー/警告)と検証不能を別の一覧にする', () => {
    const s = splitIssues(created.issues);
    expect(s.errors).toHaveLength(created.counts.error);
    expect(s.warnings).toHaveLength(created.counts.warning);
    expect(s.unverified).toHaveLength(created.counts.unverified);
    expect(s.unverified.every((i) => i.kind === 'unverified')).toBe(true);
  });

  it('結果に無い制約・結果が無い・検証失敗は「未検証」', () => {
    const first = created.constraint_results[0]!;
    expect(constraintStatus(created, first.constraint_id)).toBe(first.status);
    expect(constraintStatus(created, 'added-later')).toBe('not_checked');
    expect(constraintStatus(null, first.constraint_id)).toBe('not_checked');
    expect(constraintStatus({ ...created, status: 'failed' }, first.constraint_id)).toBe('not_checked');
    expect(CONSTRAINT_STATUS_LABEL.not_checked).toBe('未検証');
    expect(CONSTRAINT_STATUS_LABEL.unverified).toBe('検証できない');
  });

  it('検証できなかった内訳を読める文にし、0件や未知の値を扱える', () => {
    expect(describeUnchecked(created.unchecked)).toEqual(['開始時刻が未定の予定: 1件']);
    expect(describeUnchecked({ opening_hours_unknown: 2, stay_length_unknown: 0, other_key: 1, bad: 'x' })).toEqual([
      '営業時間が登録されていない場所: 2件', 'other_key: 1件',
    ]);
  });

  it('日時の整形は不正値で空文字', () => {
    expect(formatRunTime(null)).toBe('');
    expect(formatRunTime('not-a-date')).toBe('');
    expect(formatRunTime('2026-11-02T01:02:00+00:00')).toMatch(/^2026\/11\/0[12] \d{2}:02$/);
  });
});
