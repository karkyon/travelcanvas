/**
 * [Gate P2] 支出一覧(FR-027)と精算(FR-028)のパネル。
 *
 * - 支出: 日付・内容・金額(外貨は基準通貨の換算額も)、支払者、負担者ごとの額。返金は元の支出に紐付けて示す。
 *   換算レート未入力の外貨は「未換算」と明示する。
 * - 精算: メンバーごとの支払・負担・差額と、送金回数の少ない精算案。案から精算を記録でき、記録は取り消せる。
 */
import React from 'react';
import { Pencil, Plus, Trash2, Undo2 } from 'lucide-react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import type { Expense, FinanceSummary, FinanceTransfer, Settlement } from '@/services/api';
import { categoryLabel, describeNet, describeShares, formatMoney } from './financeModel';

interface ExpenseListProps {
  expenses: Expense[];
  canEdit: boolean;
  onAdd: () => void;
  onEdit: (e: Expense) => void;
  onDelete: (e: Expense) => void;
  onRefund: (e: Expense) => void;
}

export const ExpenseListPanel: React.FC<ExpenseListProps> = ({ expenses, canEdit, onAdd, onEdit, onDelete, onRefund }) => {
  const titleOf = new Map(expenses.map((e) => [e.id, e.title]));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-700">{expenses.length} 件</p>
        {canEdit && (
          <Button variant="primary" size="sm" icon={<Plus size={16} />} onClick={onAdd}>支出を追加</Button>
        )}
      </div>
      {expenses.length === 0 ? (
        <Card padding="lg" className="text-center text-gray-700">支出はまだありません。</Card>
      ) : (
        <ul className="space-y-2" aria-label="支出">
          {expenses.map((e) => (
            <li key={e.id}>
              <Card padding="sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {e.kind === 'refund' && <span className="text-xs px-2 py-0.5 rounded-sm bg-green-100 text-green-800">返金</span>}
                      <span className="font-medium text-gray-900">{e.title}</span>
                      <span className="text-sm text-gray-800">
                        {e.kind === 'refund' ? '-' : ''}{formatMoney(e.amount, e.currency)}
                      </span>
                      {e.currency !== e.base_currency && (
                        e.is_converted
                          ? <span className="text-xs text-gray-700">(≒ {formatMoney(e.base_amount, e.base_currency)}、レート {e.fx_rate})</span>
                          : <span className="text-xs px-2 py-0.5 rounded-sm bg-amber-100 text-amber-900">未換算(集計に含まれません)</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-700 mt-0.5">
                      {e.local_date ?? '日付なし'} ・ {categoryLabel(e.category)} ・ 支払: {e.paid_by_name}
                      {e.refund_of_expense_id && ` ・ 元の支出: ${titleOf.get(e.refund_of_expense_id) ?? '(削除済み)'}`}
                      {e.refunded_amount && Number(e.refunded_amount) > 0 && ` ・ 返金済み ${formatMoney(e.refunded_amount, e.currency)}`}
                    </p>
                    <p className="text-xs text-gray-700">負担: {describeShares(e)}</p>
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1 shrink-0">
                      {e.kind === 'expense' && (
                        <button type="button" onClick={() => onRefund(e)} className="text-gray-600 hover:text-green-700 p-1" aria-label={`${e.title}の返金を登録`}>
                          <Undo2 size={16} />
                        </button>
                      )}
                      <button type="button" onClick={() => onEdit(e)} className="text-gray-600 hover:text-blue-700 p-1" aria-label={`${e.title}を編集`}>
                        <Pencil size={16} />
                      </button>
                      <button type="button" onClick={() => onDelete(e)} className="text-gray-600 hover:text-red-700 p-1" aria-label={`${e.title}を削除`}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

interface SettlementProps {
  summary: FinanceSummary;
  settlements: Settlement[];
  onRecord: (t: FinanceTransfer) => void;
  onUndo: (s: Settlement) => void;
}

export const SettlementPanel: React.FC<SettlementProps> = ({ summary, settlements, onRecord, onUndo }) => {
  const cur = summary.base_currency;
  return (
    <div className="space-y-5">
      <section aria-labelledby="balance-heading">
        <h3 id="balance-heading" className="font-semibold text-gray-900 mb-2">メンバーごとの差額</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="finance-balances">
            <thead>
              <tr className="text-gray-700 border-b">
                <th className="px-2 py-1 text-left">メンバー</th><th className="px-2 py-1 text-right">支払った額</th>
                <th className="px-2 py-1 text-right">負担する額</th><th className="px-2 py-1 text-right">差額</th>
              </tr>
            </thead>
            <tbody>
              {summary.members.map((m) => (
                <tr key={m.user_id} className="border-b">
                  <td className="px-2 py-1">{m.name}{m.is_me ? '(自分)' : ''}{m.is_member ? '' : '(メンバー外)'}</td>
                  <td className="px-2 py-1 text-right">{formatMoney(m.paid, cur)}</td>
                  <td className="px-2 py-1 text-right">{formatMoney(m.owed, cur)}</td>
                  <td className="px-2 py-1 text-right">{describeNet(m.net, cur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {summary.unconverted_expenses > 0 && (
          <p className="text-xs text-amber-900 mt-1">換算レート未入力の支出{summary.unconverted_expenses}件は差額に含まれていません。</p>
        )}
      </section>

      <section aria-labelledby="transfer-heading">
        <h3 id="transfer-heading" className="font-semibold text-gray-900 mb-2">精算案</h3>
        {summary.is_settled ? (
          <p className="text-sm text-green-900" data-testid="finance-settled">精算は完了しています。</p>
        ) : (
          <ul className="space-y-2" aria-label="精算案">
            {summary.transfers.map((t) => (
              <li key={`${t.from_user_id}-${t.to_user_id}`} className="flex flex-wrap items-center justify-between gap-2 p-2 border rounded-sm">
                <span className="text-sm">{t.from_name} → {t.to_name}: {formatMoney(t.amount, cur)}</span>
                <Button variant="outline" size="sm" onClick={() => onRecord(t)}>支払いを記録</Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="settlement-history-heading">
        <h3 id="settlement-history-heading" className="font-semibold text-gray-900 mb-2">精算の記録</h3>
        {settlements.length === 0 ? (
          <p className="text-sm text-gray-700">まだ記録はありません。</p>
        ) : (
          <ul className="space-y-2" aria-label="精算の記録">
            {settlements.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 p-2 border rounded-sm">
                <span className="text-sm">
                  {s.from_name} → {s.to_name}: {formatMoney(s.amount, s.currency)}{s.settled_on ? `(${s.settled_on})` : ''}
                </span>
                <Button variant="ghost" size="sm" onClick={() => onUndo(s)}>取り消す</Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};
