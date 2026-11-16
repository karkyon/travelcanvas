/**
 * [Gate P1] 準備状況(レディネス、FR-026)パネル。
 *
 * 未予約・未確認・未支払・期限・未割当・持ち物不足を一覧にする。「確認していない」と
 * 「問題なし」を同じ表示にしない(取得前は「まだ取得していません」と出す)。
 * 予約・支払などの項目は「タスクにする」で担当者・期限・完了条件を持たせられ、
 * そのタスクを完了にすると項目は対応済みとして一覧から外れる。
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '@/components/common/Button';
import { AlertTriangle, ListChecks, Luggage } from 'lucide-react';
import { KitSection } from '@/components/shell/KitParts';
import type { Readiness, ReadinessCategory, ReadinessItem } from '@/services/api';
import {
  CHECK_ACTION_LABEL, CHECK_GROUP_LABEL, DEPARTURE_CATEGORIES, PACKING_CATEGORIES, SEVERITY_LABEL, checkCounts, formatDue,
  readinessSummary,
} from './preparationModel';
import { safeInternalPath } from '@/utils/safeNavigation';

const SEVERITY_CLASS: Record<string, string> = {
  high: 'bg-red-100 text-red-800',
  medium: 'bg-amber-100 text-amber-900',
  low: 'bg-slate-200 text-ink-900',
};

interface Props {
  readiness: Readiness | null;
  canEdit: boolean;
  onMakeTask: (item: ReadinessItem) => void;
  onCompleteTask: (item: ReadinessItem) => void;
}

/** [Gate Remaining-7] FR-026 予算との連動: 予算・使った額・未払いの予約の見込み・残り */
const ReadinessBudgetView: React.FC<{ budget: NonNullable<Readiness['budget']> }> = ({ budget }) => {
  const yen = (v: string | null) => (v == null ? '—' : `${Number(v).toLocaleString('ja-JP')} ${budget.base_currency}`);
  const tone = budget.over || budget.projected_over ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-surface';
  return (
    <section aria-labelledby="readiness-budget" className={`tc-kit-box ${tone}`} data-testid="readiness-budget">
      <h3 id="readiness-budget" className="m-0 text-sm font-semibold text-ink-900">予算</h3>
      {budget.total == null ? (
        <p className="m-0 mt-1 text-sm text-ink-700">予算は未設定です(費用の画面で決められます)。使った額 {yen(budget.spent)}</p>
      ) : (
        <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-ink-700">予算</dt><dd className="m-0 font-medium">{yen(budget.total)}</dd></div>
          <div><dt className="text-xs text-ink-700">使った額</dt><dd className="m-0 font-medium">{yen(budget.spent)}</dd></div>
          <div><dt className="text-xs text-ink-700">未払いの予約</dt><dd className="m-0 font-medium">{yen(budget.unpaid_reserved)}</dd></div>
          <div>
            <dt className="text-xs text-ink-700">残り(見込み)</dt>
            <dd className={`m-0 font-medium ${budget.projected_over ? 'text-danger' : ''}`}>{yen(budget.remaining)}</dd>
          </div>
        </dl>
      )}
      {(budget.unpaid_reserved_foreign ?? 0) > 0 && (
        <p className="m-0 mt-1 text-xs text-ink-700">{`外貨の予約 ${budget.unpaid_reserved_foreign} 件は見込みに入れていません`}</p>
      )}
    </section>
  );
};

/** 1 件の項目(出発前チェック・持ち物の確認で同じ形) */
const CheckItem: React.FC<{ item: ReadinessItem; canEdit: boolean; onMakeTask: (i: ReadinessItem) => void;
  onCompleteTask: (i: ReadinessItem) => void }> = ({ item, canEdit, onMakeTask, onCompleteTask }) => {
  const navigate = useNavigate();
  const link = safeInternalPath(item.link);
  return (
    <li className="tc-kit-checkrow" data-testid={`readiness-item-${item.key}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded-sm ${SEVERITY_CLASS[item.severity]}`}>{SEVERITY_LABEL[item.severity]}</span>
          <b className="text-ink-900">{item.title}</b>
        </div>
        <p className="text-sm text-ink-700 mt-1 mb-0">{item.detail}</p>
        {item.due_at && <p className="text-xs text-ink-700 mt-1 mb-0">期限: {formatDue(item.due_at)}</p>}
        {item.task && (
          <p className="text-xs text-blue-900 mt-1 mb-0" data-testid={`readiness-task-${item.key}`}>
            タスクにしました(担当: {item.task.assignee_name ?? '未定'}
            {item.task.due_at ? `、期限: ${formatDue(item.task.due_at)}` : ''})
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        {link && (
          <Button variant="primary" size="sm" onClick={() => navigate(link)}>{CHECK_ACTION_LABEL[item.category]}</Button>
        )}
        {item.convertible && !item.task && canEdit && (
          <Button variant="outline" size="sm" onClick={() => onMakeTask(item)}>タスクにする</Button>
        )}
        {item.task && (
          <Button variant="outline" size="sm" onClick={() => onCompleteTask(item)}>対応済みにする</Button>
        )}
      </div>
    </li>
  );
};

/**
 * [Gate TripKitFix] 出発前チェック。予約・支払い・期限・予算を分類ごとに見出しを付けて出し、
 * 持ち物・担当の確認は別の欄にする(以前は全件を 1 つの「準備状況」として数えていた)。
 */
const ReadinessPanel: React.FC<Props> = ({ readiness, canEdit, onMakeTask, onCompleteTask }) => {
  const summary = readinessSummary(readiness);
  const cc = checkCounts(readiness);
  if (!readiness || !cc) {
    return <div className="tc-kit-box" data-testid="readiness-summary"><p className="m-0">{summary.text}</p></div>;
  }
  const groups = (cats: ReadinessCategory[]) => cats
    .map((c) => ({ category: c, items: readiness.items.filter((i) => i.category === c) }))
    .filter((g) => g.items.length > 0);
  const departure = groups(DEPARTURE_CATEGORIES);
  const packing = groups(PACKING_CATEGORIES);
  const checkedAt = readiness.checked_at ? formatDue(readiness.checked_at) : null;
  const props = { canEdit, onMakeTask, onCompleteTask };

  return (
    <div className="space-y-4">
      <div data-testid="readiness-departure">
      <KitSection title="出発前チェック" icon={<AlertTriangle size={16} />} id="readiness-departure-title"
        aside={`予約・支払い・期限・予算を確かめます${checkedAt ? `(${checkedAt} に確認)` : ''}`}>
        <div className="tc-kit-box" data-testid="readiness-summary"
          data-tone={cc.departure > 0 ? 'warn' : 'ok'}>
          <p className="m-0 font-medium">
            {cc.departure > 0 ? `出発前に確かめることが ${cc.departure}件 あります。` : '予約・支払い・期限・予算に、出発前に確かめることはありません。'}
            {readiness.resolved_by_tasks > 0 ? `(タスクで対応済み ${readiness.resolved_by_tasks}件)` : ''}
          </p>
        </div>
        {departure.map((g) => (
          <div key={g.category} className="tc-kit-group">
            <h3 className="tc-kit-day">{`${CHECK_GROUP_LABEL[g.category]} · ${g.items.length}件`}</h3>
            <ul className="tc-kit-checks" aria-label={`${CHECK_GROUP_LABEL[g.category]}の確認`}>
              {g.items.map((item) => <CheckItem key={item.key} item={item} {...props} />)}
            </ul>
          </div>
        ))}
      </KitSection>
      </div>

      <KitSection title="項目ごとの状態" icon={<ListChecks size={16} />} id="readiness-cats-title" aside="分類ごとの件数">
        <ul className="tc-kit-checks" aria-label="分類ごとの状態" data-testid="readiness-categories">
          {cc.byDeparture.map((x) => (
            <li key={x.category} className="tc-kit-checkrow">
              <span>{CHECK_GROUP_LABEL[x.category]}</span>
              <span className="tc-kit-pill" data-tone={x.count > 0 ? 'warn' : 'ok'}>{x.count > 0 ? `${x.count}件` : '問題なし'}</span>
            </li>
          ))}
        </ul>
      </KitSection>

      {readiness.budget && <ReadinessBudgetView budget={readiness.budget} />}

      {packing.length > 0 && (
        <KitSection title="持ち物・担当の確認" icon={<Luggage size={16} />} id="readiness-packing-title"
          aside={`${cc.packing}件(持ち物のタブで直せます)`}>
          {packing.map((g) => (
            <div key={g.category} className="tc-kit-group">
              <h3 className="tc-kit-day">{`${CHECK_GROUP_LABEL[g.category]} · ${g.items.length}件`}</h3>
              <ul className="tc-kit-checks" aria-label={`${CHECK_GROUP_LABEL[g.category]}の確認`}>
                {g.items.map((item) => <CheckItem key={item.key} item={item} {...props} />)}
              </ul>
            </div>
          ))}
        </KitSection>
      )}

      <p className="text-xs text-ink-700 m-0" data-testid="readiness-counts">
        持ち物: 必須 {readiness.packing.required_ready}/{readiness.packing.required_total} 件準備済み
        ・ タスク: 未完了 {readiness.tasks.open} 件 / 完了 {readiness.tasks.done} 件
      </p>
    </div>
  );
};

export default ReadinessPanel;
