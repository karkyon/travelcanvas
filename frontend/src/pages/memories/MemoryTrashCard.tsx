/**
 * [Gate G6] MEM-01 削除した記録(削除から7日間は元に戻せる。期限の後は定期の処理がファイルごと消す)。
 */
import React, { useEffect, useState } from 'react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import { getMemoryTrash } from '@/services/api/g6';
import type { MemoryTrashItem } from '@/services/api/types/g6';
import { KIND_LABEL } from './memoriesModel';
import type { MemoryKind } from '@/services/api';

const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ja-JP') : '—');
const kindLabel = (k: string | null) => (k && k in KIND_LABEL ? KIND_LABEL[k as MemoryKind] : '記録');

interface Props {
  planId: string;
  reloadKey: number;
  busy: boolean;
  onRestore: (memoryId: string) => void;
}

const MemoryTrashCard: React.FC<Props> = ({ planId, reloadKey, busy, onRestore }) => {
  const [items, setItems] = useState<MemoryTrashItem[]>([]);

  useEffect(() => {
    let active = true;
    getMemoryTrash(planId).then((x) => active && setItems(x)).catch(() => active && setItems([]));
    return () => {
      active = false;
    };
  }, [planId, reloadKey]);

  if (items.length === 0) return null;
  return (
    <Card padding="md" className="mt-4">
      <section aria-label="削除した記録" className="space-y-2">
        <h2 className="font-semibold text-ink-900">削除した記録</h2>
        <p className="text-sm text-ink-700">削除から7日間は元に戻せます。期限を過ぎるとファイルごと消えます。</p>
        <ul className="divide-y">
          {items.map((t) => (
            <li key={t.memory_id} className="py-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm">
                <span className="font-medium text-ink-900">{`${kindLabel(t.kind)}: ${t.summary || '(本文なし)'}`}</span>
                <span className="block text-ink-700">{`${formatDate(t.restore_until)} まで戻せます`}</span>
              </span>
              <Button size="sm" variant="outline" disabled={busy} aria-label={`${t.summary || kindLabel(t.kind)}を元に戻す`}
                onClick={() => onRestore(t.memory_id)}>
                元に戻す
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </Card>
  );
};

export default MemoryTrashCard;
