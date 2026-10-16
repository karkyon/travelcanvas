/**
 * [Gate L4] 説明可能な最適化の表示(optimizationModel)。
 */
import { describe, it, expect } from 'vitest';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import type { OptimizationCandidates } from '@/services/api';
import { confirmApplyText, describeMove, metricRows, optimizationErrorMessage } from './optimizationModel';

const data = fx.optimization_candidates as OptimizationCandidates;

describe('optimizationModel (Gate L4)', () => {
  it('順番・時刻の変化を文にする', () => {
    expect(describeMove({ event_id: 'e', title: '地点C', before_index: 2, after_index: 4, before_time: '10:00', after_time: '12:00' }))
      .toBe('地点C: 2番目 → 4番目 10:00 → 12:00');
    expect(describeMove({ event_id: 'e', title: '地点B', before_index: 3, after_index: 2, before_time: null, after_time: null }))
      .toBe('地点B: 3番目 → 2番目');
  });

  it('今の順との比較: 制約を優先した案は守れていない制約が改善する', () => {
    const best = data.candidates.find((c) => c.kinds.includes('constraints'))!;
    const rows = metricRows(data.current.metrics, best.metrics);
    expect(rows.find((r) => r.label === '守れていない制約')).toMatchObject({ before: '1件', after: '0件', trend: 'better' });
    expect(rows.find((r) => r.label === '検証のエラー')?.trend).toBe('better');
    const shortest = data.candidates.find((c) => c.kinds.includes('shortest'))!;
    expect(metricRows(data.current.metrics, shortest.metrics).find((r) => r.label === '移動距離(概算)')?.trend).toBe('better');
  });

  it('適用の確認文と409の文言', () => {
    const c = data.candidates[0]!;
    expect(confirmApplyText(c)).toContain(`「${c.label}」で${c.changes.length}件の予定の順番・時刻を変更します。`);
    expect(optimizationErrorMessage({ response: { status: 409, data: fx.optimization_stale_error } }))
      .toContain('もう一度候補を計算してください');
    expect(optimizationErrorMessage({ response: { status: 409, data: { detail: 'x' } } })).toBe('他の変更と競合しました。もう一度候補を計算してください。');
    expect(optimizationErrorMessage(new Error('x'))).toBe('処理に失敗しました');
  });
});
