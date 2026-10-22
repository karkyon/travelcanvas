/**
 * OptimizationPanel - この日の並べ替え(説明可能な最適化、SC-16 / FR-018)
 *
 * [Gate #33] 近傍法による並び順の提案(時刻は変えない、制約・検証を見ない)だった。
 * [Gate L4] backend/app/api/v1/optimization.py の候補へ置き換えた:
 * - 並び順と時刻をまとめて提案する(時刻の枠を早い順に割り当て直す)。確定・予約付き・終日・位置なしの予定は動かさない
 * - 「移動が最短の案」と「制約・検証を優先した案」を、元の順と比べて示す(距離・時間・検証のエラー/注意・守れていない制約)
 * - 順番・時刻の変化、新たに出る問題・解消する問題、理由の文を表示する。承認して初めて適用し、「元に戻す」で取り消せる
 * 距離・時間は直線距離による概算(外部の経路サービスは未接続)。
 */
import React, { useState } from 'react';
import { Route, Sparkles, Undo2, AlertTriangle, ShieldCheck } from 'lucide-react';
import LoadingSpinner from '../common/LoadingSpinner';
import { applyOptimizationCandidate, getOptimizationCandidates } from '../../services/api';
import { usePlanStore } from '../../store/planStore';
import type { TravelPlan } from '../../types';
import type { OptimizationCandidates, OptimizationCandidate } from '../../services/api';
import { TREND_TEXT, confirmApplyText, describeMove, metricRows, optimizationErrorMessage } from './optimizationModel';

interface OptimizationPanelProps {
  plan: TravelPlan;
  dayIndex: number;
  className?: string;
}

const TREND_CLASS = { better: 'text-green-800', worse: 'text-red-800', same: 'text-gray-700' } as const;

const CandidateView: React.FC<{
  data: OptimizationCandidates;
  c: OptimizationCandidate;
  applying: boolean;
  onApply: (c: OptimizationCandidate) => void;
}> = ({ data, c, applying, onApply }) => (
  <section aria-label={c.label} className="border border-gray-200 rounded-lg p-3 space-y-2">
    <h4 className="font-semibold text-gray-900">{c.label}</h4>
    <table className="w-full text-sm">
      <caption className="sr-only">{`${c.label}と今の順の比較`}</caption>
      <thead>
        <tr className="text-left text-gray-700">
          <th scope="col" className="font-medium">項目</th>
          <th scope="col" className="font-medium">今の順</th>
          <th scope="col" className="font-medium">この案</th>
          <th scope="col" className="font-medium">変化</th>
        </tr>
      </thead>
      <tbody>
        {metricRows(data.current.metrics, c.metrics).map((r) => (
          <tr key={r.label}>
            <th scope="row" className="font-normal text-gray-800">{r.label}</th>
            <td className="text-gray-900">{r.before}</td>
            <td className="text-gray-900">{r.after}</td>
            <td className={TREND_CLASS[r.trend]}>{TREND_TEXT[r.trend]}</td>
          </tr>
        ))}
      </tbody>
    </table>
    {c.explanations.length > 0 && (
      <ul className="text-sm text-gray-900 list-disc pl-5" aria-label={`${c.label}の理由`}>
        {c.explanations.map((s) => <li key={s}>{s}</li>)}
      </ul>
    )}
    <div>
      <h5 className="text-sm font-semibold text-gray-900">変わる予定</h5>
      <ul className="text-sm text-gray-900 list-disc pl-5">{c.changes.map((x) => <li key={x.event_id}>{describeMove(x)}</li>)}</ul>
    </div>
    {c.resolved_issues.length > 0 && (
      <div>
        <h5 className="text-sm font-semibold text-green-800">解消する問題</h5>
        <ul className="text-sm text-gray-900 list-disc pl-5">{c.resolved_issues.map((x, i) => <li key={`${x.code}-${i}`}>{x.message}</li>)}</ul>
      </div>
    )}
    {c.new_issues.length > 0 && (
      <div>
        <h5 className="text-sm font-semibold text-red-800">新たに出る問題</h5>
        <ul className="text-sm text-gray-900 list-disc pl-5">{c.new_issues.map((x, i) => <li key={`${x.code}-${i}`}>{x.message}</li>)}</ul>
      </div>
    )}
    {data.can_apply && (
      <button
        type="button"
        onClick={() => onApply(c)}
        disabled={applying}
        className="w-full px-4 py-2 bg-green-700 text-white rounded-lg hover:bg-green-800 disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {applying ? <LoadingSpinner size="sm" /> : null}
        {`「${c.label}」を適用`}
      </button>
    )}
  </section>
);

const OptimizationPanel: React.FC<OptimizationPanelProps> = ({ plan, dayIndex, className = '' }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [data, setData] = useState<OptimizationCandidates | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);

  const day = plan.days[dayIndex];

  const handleFetch = async () => {
    if (!day) return;
    setIsLoading(true);
    setError(null);
    setData(null);
    setApplied(null);
    try {
      setData(await getOptimizationCandidates(plan.id, day.id));
    } catch (e) {
      setError(optimizationErrorMessage(e));
    } finally {
      setIsLoading(false);
    }
  };

  const handleApply = async (c: OptimizationCandidate) => {
    if (!day || !data) return;
    if (!window.confirm(confirmApplyText(c))) return;
    setApplying(c.id);
    setError(null);
    try {
      await applyOptimizationCandidate(plan.id, day.id, c.id, data.input_fingerprint, data.base_revision, data.travel_mode);
      await usePlanStore.getState().loadPlan(plan.id);
      setData(null);
      setApplied(`「${c.label}」を適用しました。取り消す場合は「直前の変更を取り消す」を押してください。`);
    } catch (e) {
      setError(optimizationErrorMessage(e));
    } finally {
      setApplying(null);
    }
  };

  const handleUndo = async () => {
    await usePlanStore.getState().undoLastChange();
    setApplied(null);
  };

  if (!day) return null;

  return (
    <div className={`bg-white rounded-xl shadow-xs border border-gray-200 ${className}`}>
      <button
        type="button"
        className="w-full flex items-center justify-between p-4 text-left"
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded((prev) => !prev)}
      >
        <span className="flex items-center gap-2 font-medium text-gray-900">
          <Route size={18} className="text-blue-700" aria-hidden="true" />
          この日の並べ替え(検証つき)
        </span>
        <span className="text-gray-700 text-sm">{isExpanded ? '閉じる' : '開く'}</span>
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-gray-100 pt-4">
          <p className="text-sm text-gray-700">
            移動距離(直線距離による概算)と、制約・実行可能性の検証結果を比べて、並び順と時刻の候補を示します。
            確定・予約付きの予定は動かしません。適用するまで旅程は変わりません。
          </p>

          <button
            type="button"
            onClick={handleFetch}
            disabled={isLoading}
            className="w-full px-4 py-2 bg-blue-700 text-white rounded-lg hover:bg-blue-800 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isLoading ? <LoadingSpinner size="sm" /> : <Sparkles size={16} aria-hidden="true" />}
            並べ替え候補を計算する
          </button>

          {error && (
            <div role="alert" className="flex items-start gap-2 text-sm text-red-800 bg-red-50 rounded-lg p-3">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {applied && (
            <div className="space-y-2">
              <p className="text-sm text-green-900 bg-green-50 rounded-lg p-3">{applied}</p>
              <button
                type="button"
                onClick={handleUndo}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm text-gray-800 hover:text-gray-900"
              >
                <Undo2 size={14} aria-hidden="true" />
                直前の変更を取り消す
              </button>
            </div>
          )}

          {data && (
            <div className="space-y-3">
              {data.warnings.length > 0 && (
                <ul className="text-sm text-amber-900 bg-amber-50 rounded-lg p-3 space-y-1" aria-label="並べ替えの注意">
                  {data.warnings.map((w) => <li key={w}>{w}</li>)}
                </ul>
              )}
              {data.fixed.length > 0 && (
                <div className="text-sm text-gray-800">
                  <p className="font-medium flex items-center gap-1">
                    <ShieldCheck size={14} className="text-green-700" aria-hidden="true" />動かさない予定
                  </p>
                  <ul className="list-disc pl-5">{data.fixed.map((f) => <li key={f.event_id}>{`${f.title}(${f.reason})`}</li>)}</ul>
                </div>
              )}
              {data.candidates.map((c) => (
                <CandidateView key={c.id} data={data} c={c} applying={applying === c.id} onApply={handleApply} />
              ))}
              <p className="text-xs text-gray-700">{`方式: ${data.algorithm_version}・検証: ${data.validation_algorithm_version}`}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default OptimizationPanel;
