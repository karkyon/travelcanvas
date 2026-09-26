/**
 * [Gate L3] 実行可能性検証(FR-017)の表示整形。ConstraintsPage/FeasibilityPanelから分離した純粋関数。
 *
 * 「検証不能を問題なしにしない」(FR-017): 違反が0件でも検証できなかった項目があれば
 * 「問題なし」とは表示しない。未検証(結果が無い)・結果が古い・検証失敗も区別する。
 */
import type {
  ConstraintCheckStatus, ValidationIssue, ValidationRunDetail, ValidationSeverity,
} from '@/services/api';

export type RunTone = 'error' | 'warning' | 'unverified' | 'ok' | 'failed';

export interface RunHeadline {
  tone: RunTone;
  text: string;
}

export function runHeadline(run: ValidationRunDetail): RunHeadline {
  if (run.status === 'failed') {
    return { tone: 'failed', text: '検証に失敗しました。問題が無いとは限りません。時間をおいて再度検証してください。' };
  }
  const { error, warning, unverified } = run.counts;
  if (error > 0) {
    return { tone: 'error', text: `このままでは実行できない問題が${error}件あります。` };
  }
  if (warning > 0) {
    return { tone: 'warning', text: `注意が必要な点が${warning}件あります。` };
  }
  if (unverified > 0) {
    return {
      tone: 'unverified',
      text: `違反は見つかりませんでしたが、検証できなかった項目が${unverified}件あります(問題が無いとは限りません)。`,
    };
  }
  return { tone: 'ok', text: '検証した範囲では問題は見つかりませんでした。' };
}

export const SEVERITY_LABEL: Record<ValidationSeverity, string> = {
  ERROR: 'エラー',
  WARNING: '警告',
  INFO: '情報',
};

export const CONSTRAINT_STATUS_LABEL: Record<ConstraintCheckStatus | 'not_checked', string> = {
  satisfied: '満たしている',
  violated: '満たしていない',
  unverified: '検証できない',
  not_applicable: '対象の予定なし',
  not_checked: '未検証',
};

export interface SplitIssues {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  infos: ValidationIssue[];
  unverified: ValidationIssue[];
}

export function splitIssues(issues: ValidationIssue[]): SplitIssues {
  const out: SplitIssues = { errors: [], warnings: [], infos: [], unverified: [] };
  for (const i of issues) {
    if (i.kind === 'unverified') out.unverified.push(i);
    else if (i.severity === 'ERROR') out.errors.push(i);
    else if (i.severity === 'WARNING') out.warnings.push(i);
    else out.infos.push(i);
  }
  return out;
}

/** 制約ごとの検証結果。結果に含まれない(検証後に追加・有効化された)制約は 'not_checked'。 */
export function constraintStatus(
  run: ValidationRunDetail | null, constraintId: string
): ConstraintCheckStatus | 'not_checked' {
  if (!run || run.status !== 'completed') return 'not_checked';
  return run.constraint_results.find((r) => r.constraint_id === constraintId)?.status ?? 'not_checked';
}

/** 画面の見出し用: 検証できなかった件数の内訳を読める形にする */
const UNCHECKED_LABEL: Record<string, string> = {
  event_time_unknown: '開始時刻が未定の予定',
  stay_length_unknown: '終了時刻が未定で移動に間に合うか分からない予定',
  segment_duration_unknown: '所要時間が不明な移動',
  opening_hours_unknown: '営業時間が登録されていない場所',
};

export function describeUnchecked(unchecked: Record<string, unknown>): string[] {
  return Object.entries(unchecked)
    .filter(([, n]) => typeof n === 'number' && n > 0)
    .map(([key, n]) => `${UNCHECKED_LABEL[key] ?? key}: ${n}件`);
}

export function formatRunTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
