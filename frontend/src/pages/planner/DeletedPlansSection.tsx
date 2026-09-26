/**
 * [Gate B-012] 最近削除したプラン(ゴミ箱)。
 *
 * プランの削除は論理削除で、完全削除の予定日(既定30日後)までは所有者が復元できる。
 * 完全削除すると予約・チケット・文書などプランに属する情報がすべて消え、元に戻せない。
 * 削除済みのプランが無いときは何も表示しない。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import { extractApiErrorDetailMessage, getDeletedPlans, purgePlan, restorePlan } from '@/services/api';
import type { DeletedPlanSummary } from '@/services/api';
import { formatDate, purgeNotice } from './planTrashModel';

function errorMessage(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return extractApiErrorDetailMessage(detail) ?? fallback;
}

export interface DeletedPlansSectionProps {
  /** 値が変わると一覧を読み直す(一覧画面でプランを削除した直後など) */
  refreshKey?: number;
  /** 復元に成功したとき(一覧画面のプラン一覧を読み直す) */
  onRestored?: (plan: DeletedPlanSummary) => void;
}

const DeletedPlansSection: React.FC<DeletedPlansSectionProps> = ({ refreshKey = 0, onRestored }) => {
  const [items, setItems] = useState<DeletedPlanSummary[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await getDeletedPlans());
    } catch (e) {
      setError(errorMessage(e, '削除済みプランの取得に失敗しました'));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const handleRestore = async (item: DeletedPlanSummary) => {
    setBusyId(item.id);
    setError(null);
    setNotice(null);
    try {
      await restorePlan(item.id);
      setItems((prev) => prev.filter((p) => p.id !== item.id));
      setNotice(`「${item.title}」を復元しました。共有リンクは無効のままなので、必要なら再発行してください。`);
      onRestored?.(item);
    } catch (e) {
      setError(errorMessage(e, 'プランの復元に失敗しました'));
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const handlePurge = async (item: DeletedPlanSummary) => {
    if (!window.confirm(
      `「${item.title}」を完全に削除しますか?\n予約・チケット・文書などプランの情報がすべて消え、元に戻せません。`
    )) return;
    setBusyId(item.id);
    setError(null);
    setNotice(null);
    try {
      await purgePlan(item.id);
      setItems((prev) => prev.filter((p) => p.id !== item.id));
      setNotice(`「${item.title}」を完全に削除しました。`);
    } catch (e) {
      setError(errorMessage(e, 'プランの完全削除に失敗しました'));
      await load();
    } finally {
      setBusyId(null);
    }
  };

  if (items.length === 0 && !error && !notice) return null;

  return (
    <section aria-labelledby="deleted-plans-heading" className="mt-10">
      <div className="flex items-center justify-between gap-3">
        <h2 id="deleted-plans-heading" className="text-lg font-semibold text-gray-800">
          最近削除したプラン {items.length}件
        </h2>
        {items.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={isOpen}
            aria-controls="deleted-plans-list"
            onClick={() => setIsOpen((v) => !v)}
          >
            {isOpen ? '閉じる' : '表示する'}
          </Button>
        )}
      </div>
      <p className="text-sm text-gray-600 mt-1">
        削除したプランは、完全に削除されるまで(削除から30日間)復元できます。
      </p>
      {error && <div className="mt-3 p-3 rounded-lg bg-red-50 text-red-700 text-sm" role="alert">{error}</div>}
      {notice && <div className="mt-3 p-3 rounded-lg bg-green-50 text-green-800 text-sm" role="status">{notice}</div>}
      {isOpen && items.length > 0 && (
        <ul id="deleted-plans-list" className="mt-3 space-y-3">
          {items.map((item) => (
            <li key={item.id}>
              <Card padding="md" className="bg-gray-50">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900">{item.title}</div>
                    {item.destination && <div className="text-sm text-gray-600">📍 {item.destination}</div>}
                    <div className="text-xs text-gray-600 mt-1">
                      削除日: {formatDate(item.deleted_at)} ・ {purgeNotice(item.purge_after)}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<RotateCcw size={14} />}
                      loading={busyId === item.id}
                      disabled={busyId !== null}
                      onClick={() => handleRestore(item)}
                      aria-label={`${item.title}を復元`}
                    >
                      復元
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Trash2 size={14} />}
                      disabled={busyId !== null}
                      onClick={() => handlePurge(item)}
                      aria-label={`${item.title}を完全に削除`}
                    >
                      完全に削除
                    </Button>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default DeletedPlansSection;
