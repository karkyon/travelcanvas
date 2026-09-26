/**
 * [Gate L3] 実行可能性チェック(FR-017、SC-15)の表示。
 *
 * - 未検証・結果が古い・検証失敗・問題あり・検証できない項目あり・問題なし を区別する
 * - 違反(エラー/警告)と「検証できなかった項目」を別の一覧にする(検証不能を問題なしにしない)
 * - 他のメンバーの秘匿制約に関する問題は、内容を出さずに存在だけ示す
 */
import React from 'react';
import { AlertTriangle, CheckCircle2, HelpCircle, Lock, RefreshCw, XCircle } from 'lucide-react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import type { ValidationIssue, ValidationRunDetail } from '@/services/api';
import {
  SEVERITY_LABEL, describeUnchecked, formatRunTime, runHeadline, splitIssues, type RunTone,
} from './validationModel';

const TONE_CLASS: Record<RunTone, string> = {
  error: 'bg-red-50 text-red-800 border-red-200',
  warning: 'bg-amber-50 text-amber-900 border-amber-200',
  unverified: 'bg-slate-50 text-slate-800 border-slate-300',
  ok: 'bg-green-50 text-green-800 border-green-200',
  failed: 'bg-red-50 text-red-800 border-red-200',
};

const SEVERITY_BADGE: Record<string, string> = {
  ERROR: 'bg-red-100 text-red-800',
  WARNING: 'bg-amber-100 text-amber-900',
  INFO: 'bg-slate-200 text-slate-800',
};

function IssueItem({ issue }: { issue: ValidationIssue }) {
  return (
    <li className="py-2 border-b last:border-b-0">
      <div className="flex items-start gap-2">
        <span className={`text-xs px-2 py-0.5 rounded shrink-0 ${SEVERITY_BADGE[issue.severity]}`}>
          {issue.kind === 'unverified' ? '検証不能' : SEVERITY_LABEL[issue.severity]}
        </span>
        <div className="min-w-0 text-sm">
          <div className="text-gray-900">{issue.message}</div>
          <div className="text-xs text-gray-600 mt-0.5 flex flex-wrap gap-x-3">
            {issue.entity_label && <span>対象: {issue.entity_label}</span>}
            {issue.constraint_title && <span>制約: {issue.constraint_title}</span>}
            {issue.is_masked && (
              <span className="inline-flex items-center gap-1">
                <Lock size={12} aria-hidden="true" />他のメンバーの秘匿制約(内容は表示されません)
              </span>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

function IssueSection({ id, title, issues }: { id: string; title: string; issues: ValidationIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <section aria-labelledby={id} className="mt-4">
      <h3 id={id} className="text-sm font-semibold text-gray-900 mb-1">{title} {issues.length}件</h3>
      <ul>{issues.map((i) => <IssueItem key={i.id} issue={i} />)}</ul>
    </section>
  );
}

export interface FeasibilityPanelProps {
  run: ValidationRunDetail | null;
  hasConstraints: boolean;
  isRunning: boolean;
  error: string | null;
  onRun: () => void;
}

const FeasibilityPanel: React.FC<FeasibilityPanelProps> = ({ run, hasConstraints, isRunning, error, onRun }) => {
  const headline = run ? runHeadline(run) : null;
  const split = run ? splitIssues(run.issues) : null;
  const unchecked = run ? describeUnchecked(run.unchecked) : [];
  const Icon = !headline ? HelpCircle
    : headline.tone === 'ok' ? CheckCircle2
      : headline.tone === 'unverified' ? HelpCircle
        : headline.tone === 'warning' ? AlertTriangle : XCircle;

  return (
    <Card padding="md" className="mb-6">
      <section aria-labelledby="feasibility-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="feasibility-heading" className="text-lg font-semibold text-gray-900">実行可能性チェック</h2>
            <p className="text-xs text-gray-600 mt-0.5">
              時間の重なり・移動時間・営業時間・予約との食い違いと、登録した制約を旅程と照らし合わせます。
            </p>
          </div>
          <Button variant="primary" icon={<RefreshCw size={16} />} onClick={onRun} loading={isRunning}>
            {run ? '再検証する' : '検証する'}
          </Button>
        </div>

        {error && <div className="mt-3 p-2 rounded bg-red-50 text-red-700 text-sm" role="alert">{error}</div>}

        {!run ? (
          <div className="mt-3 p-3 rounded-lg bg-blue-50 text-blue-800 text-sm" role="note">
            まだ検証していません。旅程が実行できるかは確認されていません。
            {!hasConstraints && ' 制約が無くても、時間の重なりや移動時間などは検証できます。'}
          </div>
        ) : (
          <div className="mt-3" data-testid="feasibility-result">
            {run.is_stale && (
              <div className="mb-3 p-2 rounded border border-amber-300 bg-amber-50 text-amber-900 text-sm" role="status">
                検証した後に旅程・制約・予約・移動のいずれかが変更されています。結果が古い可能性があるため、再検証してください。
              </div>
            )}
            <div className={`p-3 rounded-lg border text-sm flex items-start gap-2 ${TONE_CLASS[headline!.tone]}`} role="status">
              <Icon size={18} aria-hidden="true" className="shrink-0 mt-0.5" />
              <span>{headline!.text}</span>
            </div>
            {run.status === 'completed' && (
              <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
                <div className="rounded bg-red-50 p-2"><dt className="text-xs text-red-800">エラー</dt><dd className="text-lg font-semibold text-red-800">{run.counts.error}</dd></div>
                <div className="rounded bg-amber-50 p-2"><dt className="text-xs text-amber-900">警告</dt><dd className="text-lg font-semibold text-amber-900">{run.counts.warning}</dd></div>
                <div className="rounded bg-slate-100 p-2"><dt className="text-xs text-slate-800">検証できなかった</dt><dd className="text-lg font-semibold text-slate-800">{run.counts.unverified}</dd></div>
              </dl>
            )}
            {split && (
              <>
                <IssueSection id="feasibility-errors" title="エラー(このままでは実行できない)" issues={split.errors} />
                <IssueSection id="feasibility-warnings" title="警告(見直しを推奨)" issues={split.warnings} />
                <IssueSection id="feasibility-infos" title="情報" issues={split.infos} />
                <IssueSection id="feasibility-unverified" title="検証できなかった項目" issues={split.unverified} />
              </>
            )}
            {unchecked.length > 0 && (
              <p className="mt-3 text-xs text-gray-600">内訳: {unchecked.join(' / ')}</p>
            )}
            <p className="mt-3 text-xs text-gray-500">
              検証日時: {formatRunTime(run.finished_at ?? run.started_at)}{run.created_by_me ? '(自分が実行)' : '(他のメンバーが実行)'}
            </p>
          </div>
        )}
      </section>
    </Card>
  );
};

export default FeasibilityPanel;
