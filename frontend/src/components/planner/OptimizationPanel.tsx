/**
 * OptimizationPanel - この日の並べ替え(説明可能な最適化、SC-16 / FR-018)
 *
 * [Gate #33] 近傍法による並び順の提案(時刻は変えない、制約・検証を見ない)だった。
 * [Gate L4] backend/app/api/v1/optimization.py の候補へ置き換えた:
 * - 並び順と時刻をまとめて提案する(時刻の枠を早い順に割り当て直す)。確定・予約付き・終日・位置なしの予定は動かさない
 * - 「移動が最短の案」と「制約・検証を優先した案」を、元の順と比べて示す(距離・時間・検証のエラー/注意・守れていない制約)
 * - 順番・時刻の変化、新たに出る問題・解消する問題、理由の文を表示する。承認して初めて適用し、「元に戻す」で取り消せる
 * 距離・時間は直線距離による概算(外部の経路サービスは未接続)。
 * [Gate G7] MOVE-04:
 * - 目的の内訳: 案ごとに「移動距離・検証と制約・疲れ・公平さ」の値・重み・点を表で示す(点の作り方も書く)
 * - 条件を変える: 重み(0〜5)を選んで計算し直すと「条件に合わせた案」が加わる
 * - 部分の採用: 案の中から動かす予定を選び、選んだ予定だけの結果を確かめてから適用できる
 */
import React, { useState } from 'react';
import { Route, Sparkles, Undo2, AlertTriangle, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import LoadingSpinner from '../common/LoadingSpinner';
import { applyCandidateG7, getCandidatesG7, previewPartial } from '../../services/api/g7';
import { usePlanStore } from '../../store/planStore';
import type { TravelPlan } from '../../types';
import type { G7Candidate, G7Candidates, Objective, PartialPreview, WeightKey, Weights } from '../../services/api/types/g7';
import { TREND_TEXT, confirmApplyText, describeMove, metricRows, optimizationErrorMessage } from './optimizationModel';

interface OptimizationPanelProps {
  plan: TravelPlan;
  dayIndex: number;
  className?: string;
}

const TREND_CLASS = { better: 'text-green-800', worse: 'text-red-800', same: 'text-ink-700' } as const;
const WEIGHT_KEYS: WeightKey[] = ['distance', 'constraints', 'fatigue', 'fairness'];
const DEFAULT_WEIGHTS: Weights = { distance: 1, constraints: 3, fatigue: 1, fairness: 1 };

const ObjectiveTable: React.FC<{ label: string; objective: Objective; current: Objective }> = ({ label, objective, current }) => (
  <div>
    <h5 className="text-sm font-semibold text-ink-900">目的の内訳(点は小さいほど良い。かっこは今の順)</h5>
    {/* 比較の表(table)と区別するため、一覧で示す */}
    <ul className="text-sm text-ink-900" aria-label={`${label}の目的の内訳`}>
      {objective.terms.map((t) => {
        const before = current.terms.find((x) => x.key === t.key);
        const value = t.value === null ? '—' : `${t.value}${t.unit}`;
        return (
          <li key={t.key} title={t.rule}>
            {`${t.label}: ${value}・重み${t.weight}・${t.weighted}点(${before?.weighted ?? '—'}点)`}
          </li>
        );
      })}
      <li className="font-medium">{`合計: ${objective.total}点(${current.total}点)`}</li>
    </ul>
  </div>
);

const CandidateView: React.FC<{
  data: G7Candidates;
  c: G7Candidate;
  applying: boolean;
  onApply: (c: G7Candidate, eventIds?: string[]) => void;
  onPreview: (c: G7Candidate, eventIds: string[]) => Promise<PartialPreview | null>;
}> = ({ data, c, applying, onApply, onPreview }) => {
  const [picked, setPicked] = useState<string[]>([]);
  const [partial, setPartial] = useState<PartialPreview | null>(null);
  const toggle = (id: string) => {
    setPartial(null);
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };
  return (
    <section aria-label={c.label} className="border border-gray-200 rounded-lg p-3 space-y-2">
      <h4 className="font-semibold text-ink-900">{c.label}</h4>
      <table className="w-full text-sm">
        <caption className="sr-only">{`${c.label}と今の順の比較`}</caption>
        <thead>
          <tr className="text-left text-ink-700">
            <th scope="col" className="font-medium">項目</th>
            <th scope="col" className="font-medium">今の順</th>
            <th scope="col" className="font-medium">この案</th>
            <th scope="col" className="font-medium">変化</th>
          </tr>
        </thead>
        <tbody>
          {metricRows(data.current.metrics, c.metrics).map((r) => (
            <tr key={r.label}>
              <th scope="row" className="font-normal text-ink-900">{r.label}</th>
              <td className="text-ink-900">{r.before}</td>
              <td className="text-ink-900">{r.after}</td>
              <td className={TREND_CLASS[r.trend]}>{TREND_TEXT[r.trend]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ObjectiveTable label={c.label} objective={c.objective} current={data.current.objective} />
      {c.explanations.length > 0 && (
        <ul className="text-sm text-ink-900 list-disc pl-5" aria-label={`${c.label}の理由`}>
          {c.explanations.map((s) => <li key={s}>{s}</li>)}
        </ul>
      )}
      <fieldset>
        <legend className="text-sm font-semibold text-ink-900">変わる予定{data.can_apply ? '(一部だけ動かす時は選ぶ)' : ''}</legend>
        <ul className="text-sm text-ink-900 pl-1">
          {c.changes.map((x) => (
            <li key={x.event_id}>
              {data.can_apply ? (
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={picked.includes(x.event_id)} onChange={() => toggle(x.event_id)} />
                  {describeMove(x)}
                </label>
              ) : describeMove(x)}
            </li>
          ))}
        </ul>
      </fieldset>
      {c.resolved_issues.length > 0 && (
        <div>
          <h5 className="text-sm font-semibold text-green-800">解消する問題</h5>
          <ul className="text-sm text-ink-900 list-disc pl-5">{c.resolved_issues.map((x, i) => <li key={`${x.code}-${i}`}>{x.message}</li>)}</ul>
        </div>
      )}
      {c.new_issues.length > 0 && (
        <div>
          <h5 className="text-sm font-semibold text-red-800">新たに出る問題</h5>
          <ul className="text-sm text-ink-900 list-disc pl-5">{c.new_issues.map((x, i) => <li key={`${x.code}-${i}`}>{x.message}</li>)}</ul>
        </div>
      )}
      {data.can_apply && (
        <>
          {picked.length > 0 && (
            <div className="space-y-2 rounded-lg bg-slate-50 p-2" aria-label={`${c.label}の一部だけ`}>
              <button
                type="button"
                onClick={async () => setPartial(await onPreview(c, picked))}
                disabled={applying}
                className="w-full px-3 py-1.5 text-sm border border-blue-700 text-blue-800 rounded-lg hover:bg-blue-50"
              >
                {`選んだ${picked.length}件だけ動かした結果を確かめる`}
              </button>
              {partial && (
                <div className="text-sm text-ink-900 space-y-1" role="status">
                  <p>{`選んだ予定だけ: 移動距離${partial.metrics.distance_km}km・検証のエラー${partial.metrics.error}件・注意${partial.metrics.warning}件・目的の合計${partial.objective.total}`}</p>
                  {partial.new_issues.length > 0 && (
                    <ul className="list-disc pl-5 text-red-800" aria-label="一部だけの時に新たに出る問題">
                      {partial.new_issues.map((x, i) => <li key={`${x.code}-${i}`}>{x.message}</li>)}
                    </ul>
                  )}
                  <button
                    type="button"
                    onClick={() => onApply(c, picked)}
                    disabled={applying}
                    className="w-full px-4 py-2 bg-green-700 text-white rounded-lg hover:bg-green-800 disabled:opacity-50"
                  >
                    選んだ予定だけ適用
                  </button>
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={() => onApply(c)}
            disabled={applying}
            className="w-full px-4 py-2 bg-green-700 text-white rounded-lg hover:bg-green-800 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {applying ? <LoadingSpinner size="sm" /> : null}
            {`「${c.label}」を適用`}
          </button>
        </>
      )}
    </section>
  );
};

const OptimizationPanel: React.FC<OptimizationPanelProps> = ({ plan, dayIndex, className = '' }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [data, setData] = useState<G7Candidates | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const [showWeights, setShowWeights] = useState(false);
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [usedWeights, setUsedWeights] = useState<Weights | null>(null);

  const day = plan.days[dayIndex];

  const handleFetch = async (w: Weights | null) => {
    if (!day) return;
    setIsLoading(true);
    setError(null);
    setData(null);
    setApplied(null);
    try {
      setData(await getCandidatesG7(plan.id, day.id, 'walking', w));
      setUsedWeights(w);
    } catch (e) {
      setError(optimizationErrorMessage(e));
    } finally {
      setIsLoading(false);
    }
  };

  const handlePreview = async (c: G7Candidate, eventIds: string[]) => {
    if (!day || !data) return null;
    setError(null);
    try {
      return await previewPartial(plan.id, day.id, c.id, eventIds, data.input_fingerprint, data.travel_mode, usedWeights);
    } catch (e) {
      setError(optimizationErrorMessage(e));
      return null;
    }
  };

  const handleApply = async (c: G7Candidate, eventIds?: string[]) => {
    if (!day || !data) return;
    const text = eventIds
      ? `「${c.label}」のうち選んだ${eventIds.length}件の予定だけを動かします。あとから「元に戻す」で取り消せます。よろしいですか?`
      : confirmApplyText(c);
    if (!window.confirm(text)) return;
    setApplying(c.id);
    setError(null);
    try {
      await applyCandidateG7(plan.id, day.id, c.id, data.input_fingerprint, data.base_revision, data.travel_mode,
        usedWeights, eventIds ?? null);
      await usePlanStore.getState().loadPlan(plan.id);
      setData(null);
      setApplied(eventIds
        ? `「${c.label}」のうち${eventIds.length}件を適用しました。取り消す場合は「直前の変更を取り消す」を押してください。`
        : `「${c.label}」を適用しました。取り消す場合は「直前の変更を取り消す」を押してください。`);
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
    <div className={`bg-surface rounded-xl shadow-xs border border-gray-200 ${className}`}>
      <button
        type="button"
        className="w-full flex items-center justify-between p-4 text-left"
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded((prev) => !prev)}
      >
        <span className="flex items-center gap-2 font-medium text-ink-900">
          <Route size={18} className="text-blue-700" aria-hidden="true" />
          この日の並べ替え(検証つき)
        </span>
        <span className="text-ink-700 text-sm">{isExpanded ? '閉じる' : '開く'}</span>
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-gray-100 pt-4">
          <p className="text-sm text-ink-700">
            移動距離(直線距離による概算)と、制約・実行可能性の検証結果を比べて、並び順と時刻の候補を示します。
            確定・予約付きの予定は動かしません。適用するまで旅程は変わりません。
          </p>

          <button
            type="button"
            onClick={() => handleFetch(null)}
            disabled={isLoading}
            className="w-full px-4 py-2 bg-blue-700 text-white rounded-lg hover:bg-blue-800 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isLoading ? <LoadingSpinner size="sm" /> : <Sparkles size={16} aria-hidden="true" />}
            並べ替え候補を計算する
          </button>

          <div>
            <button
              type="button"
              className="text-sm text-blue-800 flex items-center gap-1"
              aria-expanded={showWeights}
              onClick={() => setShowWeights((v) => !v)}
            >
              <SlidersHorizontal size={14} aria-hidden="true" />条件を変える(目的の重み)
            </button>
            {showWeights && (
              <fieldset className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <legend className="sr-only">目的の重み(0〜5。大きいほど重視)</legend>
                {WEIGHT_KEYS.map((k) => (
                  <label key={k} className="flex items-center justify-between gap-2 text-ink-900">
                    {data?.weight_labels[k] ?? { distance: '移動距離', constraints: '検証・制約', fatigue: '疲れ', fairness: '公平さ' }[k]}
                    <select
                      className="border rounded-sm px-2 py-1"
                      value={weights[k]}
                      onChange={(e) => setWeights((w) => ({ ...w, [k]: Number(e.target.value) }))}
                    >
                      {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                ))}
                <button
                  type="button"
                  className="col-span-2 px-3 py-1.5 border border-blue-700 text-blue-800 rounded-lg hover:bg-blue-50"
                  disabled={isLoading}
                  onClick={() => handleFetch(weights)}
                >
                  この条件で計算する
                </button>
              </fieldset>
            )}
          </div>

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
                className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm text-ink-900 hover:text-ink-900"
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
                <div className="text-sm text-ink-900">
                  <p className="font-medium flex items-center gap-1">
                    <ShieldCheck size={14} className="text-green-700" aria-hidden="true" />動かさない予定
                  </p>
                  <ul className="list-disc pl-5">{data.fixed.map((f) => <li key={f.event_id}>{`${f.title}(${f.reason})`}</li>)}</ul>
                </div>
              )}
              {data.candidates.map((c) => (
                <CandidateView key={c.id} data={data} c={c} applying={applying === c.id} onApply={handleApply}
                  onPreview={handlePreview} />
              ))}
              <p className="text-xs text-ink-700">{`方式: ${data.algorithm_version}・検証: ${data.validation_algorithm_version}`}
                {data.weights_given ? '・条件を変えて計算' : ''}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default OptimizationPanel;
