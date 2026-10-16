/**
 * [Gate L4] 説明可能な最適化(FR-018)の表示用の整形。
 *
 * backend(app/services/optimizer.py、explainable-opt-v1)の候補を、元の順との比較(距離・時間・検証の件数)、
 * 順番・時刻の変化、新たに出る問題・解消する問題として示す。
 */
import type { OptimizationCandidate, OptimizationMetrics } from '@/services/api';

export function describeMove(c: OptimizationCandidate['changes'][number]): string {
  const time = c.before_time !== c.after_time ? ` ${c.before_time ?? '時刻なし'} → ${c.after_time ?? '時刻なし'}` : '';
  const pos = c.before_index !== c.after_index ? `${c.before_index}番目 → ${c.after_index}番目` : '順番はそのまま';
  return `${c.title}: ${pos}${time}`;
}

export interface MetricRow {
  label: string;
  before: string;
  after: string;
  /** better: 良くなる / worse: 悪くなる / same: 変わらない */
  trend: 'better' | 'worse' | 'same';
}

const trendOf = (before: number, after: number, eps = 0): MetricRow['trend'] =>
  after < before - eps ? 'better' : after > before + eps ? 'worse' : 'same';

export function metricRows(before: OptimizationMetrics, after: OptimizationMetrics): MetricRow[] {
  return [
    { label: '移動距離(概算)', before: `${before.distance_km}km`, after: `${after.distance_km}km`,
      trend: trendOf(before.distance_km, after.distance_km, 0.01) },
    { label: '移動時間(概算)', before: `${Math.round(before.duration_minutes)}分`, after: `${Math.round(after.duration_minutes)}分`,
      trend: trendOf(before.duration_minutes, after.duration_minutes, 0.5) },
    { label: '検証のエラー', before: `${before.error}件`, after: `${after.error}件`, trend: trendOf(before.error, after.error) },
    { label: '検証の注意', before: `${before.warning}件`, after: `${after.warning}件`, trend: trendOf(before.warning, after.warning) },
    { label: '守れていない制約', before: `${before.constraints_violated}件`, after: `${after.constraints_violated}件`,
      trend: trendOf(before.constraints_violated, after.constraints_violated) },
    { label: '検証できない項目', before: `${before.unverified}件`, after: `${after.unverified}件`,
      trend: trendOf(before.unverified, after.unverified) },
  ];
}

export const TREND_TEXT: Record<MetricRow['trend'], string> = { better: '改善', worse: '悪化', same: '変化なし' };

export function confirmApplyText(c: OptimizationCandidate): string {
  const worse = c.new_issues.length > 0 ? `新たに出る問題が${c.new_issues.length}件あります。` : '';
  return `「${c.label}」で${c.changes.length}件の予定の順番・時刻を変更します。${worse}あとから「元に戻す」で取り消せます。よろしいですか?`;
}

export function optimizationErrorMessage(error: unknown): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } } | null)?.response?.data?.detail;
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    const message = (detail as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  if (status === 409) return '他の変更と競合しました。もう一度候補を計算してください。';
  if (typeof detail === 'string' && detail) return detail;
  return '処理に失敗しました';
}
