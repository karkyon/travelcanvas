/**
 * [Gate P1] 持ち物パネル(FR-025)。
 *
 * - 共有の持ち物はメンバー全員に、個人の持ち物(薬など)は自分にだけ表示される。
 * - 状態(未準備・要購入・梱包済み・使用後)はその場で切り替えられる。
 * - 「候補を表示」で旅程と条件(海外・洗濯・子ども連れ・常備薬)から理由付きの候補を出し、
 *   追加・不要・数量変更の候補を示す。天候は判定していないことを明示する。
 */
import React from 'react';
import { Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import type {
  PackingItem, PackingStatus, PackingSuggestion, PackingSuggestionConditions, PackingSuggestions,
} from '@/services/api';
import { STATUS_OPTIONS, categoryLabel, groupByCategory, packingProgress } from './preparationModel';

interface Props {
  items: PackingItem[];
  canEdit: boolean;
  myUserId: string | null;
  suggestions: PackingSuggestions | null;
  conditions: PackingSuggestionConditions;
  isLoadingSuggestions: boolean;
  onConditionsChange: (c: PackingSuggestionConditions) => void;
  onShowSuggestions: () => void;
  onAdoptSuggestion: (s: PackingSuggestion) => void;
  onApplyQuantity: (itemId: string, quantity: number) => void;
  onAdd: () => void;
  onEdit: (item: PackingItem) => void;
  onDelete: (item: PackingItem) => void;
  onStatusChange: (item: PackingItem, status: PackingStatus) => void;
}

const CONDITION_LABELS: { key: keyof PackingSuggestionConditions; label: string }[] = [
  { key: 'overseas', label: '海外旅行' },
  { key: 'laundry', label: '旅先で洗濯できる' },
  { key: 'with_children', label: '子ども連れ' },
  { key: 'takes_medication', label: '常備薬がある' },
];

const PackingPanel: React.FC<Props> = (props) => {
  const { items, canEdit, myUserId, suggestions, conditions } = props;
  const progress = packingProgress(items);
  const groups = groupByCategory(items);

  const canChangeStatus = (item: PackingItem) =>
    item.scope === 'personal' ? item.is_mine : canEdit || (myUserId !== null && item.assignee_user_id === myUserId);
  const canModify = (item: PackingItem) => (item.scope === 'personal' ? item.is_mine : canEdit);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-700" data-testid="packing-progress">
          梱包済み {progress.packed}/{progress.total} 件
          {progress.requiredLeft > 0 ? `(必須で未準備 ${progress.requiredLeft} 件)` : ''}
        </p>
        <Button variant="primary" size="sm" icon={<Plus size={16} />} onClick={props.onAdd}>
          持ち物を追加
        </Button>
      </div>

      <section aria-labelledby="packing-suggestion-heading" className="p-4 rounded-lg border bg-blue-50 border-blue-200">
        <h3 id="packing-suggestion-heading" className="font-semibold text-gray-900">持ち物の候補</h3>
        <p className="text-sm text-gray-700 mt-1">旅程(日数・予定・予約・移動)と、次の条件から候補を作ります。</p>
        <fieldset className="mt-2">
            <legend className="sr-only">候補の条件</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              {CONDITION_LABELS.map((c) => (
                <label key={c.key} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={!!conditions[c.key]}
                    onChange={(e) => props.onConditionsChange({ ...conditions, [c.key]: e.target.checked })}
                  />
                  {c.label}
                </label>
              ))}
            </div>
          </fieldset>
        <div className="mt-3">
          <Button variant="outline" size="sm" onClick={props.onShowSuggestions} loading={props.isLoadingSuggestions}>
            候補を表示
          </Button>
        </div>

        {suggestions && (
          <div className="mt-4 space-y-3" data-testid="packing-suggestions">
            {suggestions.unverified.map((u) => (
              <p key={u.code} className="text-sm text-gray-800 bg-white border rounded p-2">{u.message}</p>
            ))}
            {suggestions.add.length === 0 && suggestions.remove.length === 0 && suggestions.change.length === 0 && (
              <p className="text-sm text-gray-700">追加・見直しの候補はありません。</p>
            )}
            {suggestions.add.length > 0 && (
              <ul className="space-y-2" aria-label="追加の候補">
                {suggestions.add.map((s) => (
                  <li key={s.key} className="flex flex-wrap items-center justify-between gap-2 bg-white border rounded p-2">
                    <div className="min-w-0">
                      <span className="font-medium text-gray-900">{s.name}</span>
                      <span className="text-sm text-gray-700"> ×{s.quantity}</span>
                      {s.is_required && <span className="ml-2 text-xs px-2 py-0.5 rounded bg-red-100 text-red-800">必須</span>}
                      {s.scope === 'personal' && <span className="ml-2 text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-800">自分だけ</span>}
                      <p className="text-xs text-gray-700">{s.reason}</p>
                    </div>
                    {(s.scope === 'personal' || canEdit) && (
                      <Button variant="outline" size="sm" onClick={() => props.onAdoptSuggestion(s)} aria-label={`${s.name}を持ち物に追加`}>
                        追加
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {suggestions.change.length > 0 && (
              <ul className="space-y-2" aria-label="数量の見直し">
                {suggestions.change.map((c) => (
                  <li key={c.item_id} className="flex flex-wrap items-center justify-between gap-2 bg-white border rounded p-2">
                    <div>
                      <span className="font-medium text-gray-900">{c.name}</span>
                      <span className="text-sm text-gray-700"> {c.current_quantity} → {c.suggested_quantity}</span>
                      <p className="text-xs text-gray-700">{c.reason}</p>
                    </div>
                    {canEdit && (
                      <Button variant="outline" size="sm" onClick={() => props.onApplyQuantity(c.item_id, c.suggested_quantity)}>
                        数量を{c.suggested_quantity}にする
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {suggestions.remove.length > 0 && (
              <ul className="space-y-2" aria-label="不要かもしれない持ち物">
                {suggestions.remove.map((r) => (
                  <li key={r.item_id} className="bg-white border rounded p-2">
                    <span className="font-medium text-gray-900">{r.name}</span>
                    <p className="text-xs text-gray-700">{r.reason}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {items.length === 0 ? (
        <Card padding="lg" className="text-center text-gray-700">持ち物はまだありません。</Card>
      ) : (
        groups.map((g) => (
          <section key={g.category} aria-labelledby={`packing-group-${g.category}`}>
            <h3 id={`packing-group-${g.category}`} className="text-base font-semibold text-gray-900 mb-2">
              {g.label}
            </h3>
            <ul className="space-y-2">
              {g.items.map((item) => (
                <li key={item.id}>
                  <Card padding="sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          {item.scope === 'personal' && <Lock size={14} aria-label="自分だけの持ち物" />}
                          <span className="font-medium text-gray-900">{item.name ?? '(内容を表示できません)'}</span>
                          <span className="text-sm text-gray-700">×{item.quantity}</span>
                          {item.is_required && <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-800">必須</span>}
                        </div>
                        <p className="text-xs text-gray-700 mt-0.5">
                          {categoryLabel(item.category)}
                          {item.scope === 'shared' && ` ・ 担当: ${item.assignee_name ?? (item.assignee_missing ? 'メンバー外(未割当)' : '未定')}`}
                          {item.note ? ` ・ ${item.note}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <label className="sr-only" htmlFor={`packing-status-${item.id}`}>{`${item.name ?? '持ち物'}の状態`}</label>
                        <select
                          id={`packing-status-${item.id}`}
                          className="border rounded px-2 py-1 text-sm"
                          value={item.status}
                          disabled={!canChangeStatus(item)}
                          onChange={(e) => props.onStatusChange(item, e.target.value as PackingStatus)}
                        >
                          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                        {canModify(item) && (
                          <>
                            <button type="button" onClick={() => props.onEdit(item)} className="text-gray-600 hover:text-blue-700 p-1" aria-label={`${item.name ?? '持ち物'}を編集`}>
                              <Pencil size={16} />
                            </button>
                            <button type="button" onClick={() => props.onDelete(item)} className="text-gray-600 hover:text-red-700 p-1" aria-label={`${item.name ?? '持ち物'}を削除`}>
                              <Trash2 size={16} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
};

export default PackingPanel;
