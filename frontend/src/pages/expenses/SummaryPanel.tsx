/**
 * [Gate P2] 予算と実績の概要パネル(FR-027)。
 *
 * 旅行全体・カテゴリ別・日別・自分の予算と実績の差異を示し、超過を色以外(「超過」の文字)でも示す。
 * 換算できない外貨の支出・予約が集計に入っていないことを明示する(問題なしと誤解させない)。
 */
import React from 'react';
import { Pencil, Plus } from 'lucide-react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import type { Budget, BudgetDiff, FinanceSummary } from '@/services/api';
import { categoryLabel, formatMoney, summaryNotices } from './financeModel';

interface Props {
  summary: FinanceSummary;
  budgets: Budget[];
  canEdit: boolean;
  onEditBudget: (preset: { kind: Budget['kind']; category?: string; local_date?: string }, existing?: Budget) => void;
}

const DiffCells: React.FC<{ d: BudgetDiff; currency: string }> = ({ d, currency }) => (
  <>
    <td className="px-2 py-1 text-right">{d.budget ? formatMoney(d.budget, currency) : '未設定'}</td>
    <td className="px-2 py-1 text-right">{formatMoney(d.actual, currency)}</td>
    <td className="px-2 py-1 text-right">
      {d.remaining == null ? '—' : formatMoney(d.remaining, currency)}
      {d.over && <span className="ml-1 text-xs px-1.5 py-0.5 rounded-sm bg-red-100 text-red-800">超過</span>}
    </td>
  </>
);

const SummaryPanel: React.FC<Props> = ({ summary, budgets, canEdit, onEditBudget }) => {
  const cur = summary.base_currency;
  const find = (kind: Budget['kind'], key?: string) =>
    budgets.find((b) => b.kind === kind && (kind !== 'category' || b.category === key) && (kind !== 'day' || b.local_date === key));
  const total = find('total');
  const mine = find('member');
  const notices = summaryNotices(summary);

  return (
    <div className="space-y-5">
      {notices.length > 0 && (
        <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 text-sm" data-testid="finance-notices">
          {notices.map((n) => <p key={n}>{n}</p>)}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Card padding="md">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-ink-900">旅行全体</h3>
            {canEdit && (
              <button type="button" className="text-ink-700 hover:text-blue-700 p-1" aria-label="旅行全体の予算を設定"
                onClick={() => onEditBudget({ kind: 'total' }, total)}>
                {total ? <Pencil size={16} /> : <Plus size={16} />}
              </button>
            )}
          </div>
          <dl className="mt-2 text-sm grid grid-cols-2 gap-y-1" data-testid="finance-total">
            <dt className="text-ink-700">予算</dt><dd className="text-right">{summary.total.budget ? formatMoney(summary.total.budget, cur) : '未設定'}</dd>
            <dt className="text-ink-700">実績</dt><dd className="text-right">{formatMoney(summary.total.actual, cur)}</dd>
            <dt className="text-ink-700">残り</dt>
            <dd className="text-right">
              {summary.total.remaining == null ? '—' : formatMoney(summary.total.remaining, cur)}
              {summary.total.over && <span className="ml-1 text-xs px-1.5 py-0.5 rounded-sm bg-red-100 text-red-800">超過</span>}
            </dd>
            <dt className="text-ink-700">予約額(参考)</dt><dd className="text-right">{formatMoney(summary.reserved.total, cur)}</dd>
            <dt className="text-ink-700">うち税/手数料/返金</dt>
            <dd className="text-right">{formatMoney(summary.tax_total, cur)} / {formatMoney(summary.fee_total, cur)} / {formatMoney(summary.refund_total, cur)}</dd>
          </dl>
        </Card>
        <Card padding="md">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-ink-900">自分の予算(自分だけに表示)</h3>
            <button type="button" className="text-ink-700 hover:text-blue-700 p-1" aria-label="自分の予算を設定"
              onClick={() => onEditBudget({ kind: 'member' }, mine)}>
              {mine ? <Pencil size={16} /> : <Plus size={16} />}
            </button>
          </div>
          {summary.my_budget ? (
            <dl className="mt-2 text-sm grid grid-cols-2 gap-y-1" data-testid="finance-my-budget">
              <dt className="text-ink-700">予算</dt><dd className="text-right">{summary.my_budget.budget ? formatMoney(summary.my_budget.budget, cur) : '表示できません'}</dd>
              <dt className="text-ink-700">自分の負担</dt><dd className="text-right">{formatMoney(summary.my_budget.actual, cur)}</dd>
              <dt className="text-ink-700">残り</dt>
              <dd className="text-right">
                {summary.my_budget.remaining == null ? '—' : formatMoney(summary.my_budget.remaining, cur)}
                {summary.my_budget.over && <span className="ml-1 text-xs px-1.5 py-0.5 rounded-sm bg-red-100 text-red-800">超過</span>}
              </dd>
            </dl>
          ) : (
            <p className="mt-2 text-sm text-ink-700">未設定です。他のメンバーには金額は表示されません。</p>
          )}
        </Card>
      </div>

      <section aria-labelledby="finance-category-heading">
        <div className="flex items-center justify-between mb-2">
          <h3 id="finance-category-heading" className="font-semibold text-ink-900">カテゴリ別</h3>
          {canEdit && (
            <Button variant="outline" size="sm" onClick={() => onEditBudget({ kind: 'category', category: 'food' })}>
              カテゴリの予算を追加
            </Button>
          )}
        </div>
        {summary.by_category.length === 0 ? (
          <p className="text-sm text-ink-700">まだ支出・予算はありません。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-ink-700 border-b"><th className="px-2 py-1 text-left">カテゴリ</th><th className="px-2 py-1 text-right">予算</th><th className="px-2 py-1 text-right">実績</th><th className="px-2 py-1 text-right">残り</th></tr></thead>
              <tbody>
                {summary.by_category.map((c) => {
                  const b = find('category', c.category);
                  return (
                    <tr key={c.category} className="border-b">
                      <td className="px-2 py-1">
                        {categoryLabel(c.category)}
                        {canEdit && (
                          <button type="button" className="ml-1 text-ink-700 hover:text-blue-700 align-middle" aria-label={`${categoryLabel(c.category)}の予算を設定`}
                            onClick={() => onEditBudget({ kind: 'category', category: c.category }, b)}>
                            <Pencil size={14} />
                          </button>
                        )}
                      </td>
                      <DiffCells d={c} currency={cur} />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {(summary.by_day.length > 0 || summary.undated_actual !== '0') && (
        <section aria-labelledby="finance-day-heading">
          <h3 id="finance-day-heading" className="font-semibold text-ink-900 mb-2">日別</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-ink-700 border-b"><th className="px-2 py-1 text-left">日付</th><th className="px-2 py-1 text-right">予算</th><th className="px-2 py-1 text-right">実績</th><th className="px-2 py-1 text-right">残り</th></tr></thead>
              <tbody>
                {summary.by_day.map((d) => (
                  <tr key={d.local_date} className="border-b">
                    <td className="px-2 py-1">{d.local_date}</td>
                    <DiffCells d={d} currency={cur} />
                  </tr>
                ))}
                <tr><td className="px-2 py-1 text-ink-700">日付なし</td><td /><td className="px-2 py-1 text-right">{formatMoney(summary.undated_actual, cur)}</td><td /></tr>
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
};

export default SummaryPanel;
