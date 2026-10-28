/**
 * [Gate G8] FR-019 採用の前の確かめと、選んだ変更だけの採用(GET .../adoption-preview・POST .../adopt {only})。
 *
 * 変更ごとに「選ぶ」を付け、選んだ変更が頼る変更(足した予定を使う区間・付け替え)が欠けていれば理由を出して採用できない
 * ようにする。採用すると作る準備(予約の取消の手続き)も先に見せる。選ばなかった変更は本案へ当てずに案を閉じる。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { getAdoptionPreview } from '@/services/api/g8';
import type { AdoptionPreview } from '@/services/api/types/g8';
import { KIND_LABEL, OP_LABEL } from './resourcesModel';

interface Props {
  planId: string;
  branchId: string;
  isOpen: boolean;
  busy: boolean;
  onClose: () => void;
  onAdopt: (only: string[] | null) => void;
}

const REASON: Record<string, string> = {
  changed_in_plan: '分岐した後に本案でも変更されています',
  deleted_in_plan: '本案では削除されています',
  locked: '本案で確定されています',
  has_relations: '予約・移動区間と紐付いています',
  day_missing: '日程が本案にありません',
  event_missing: 'つなぐ予定が本案にありません',
  already_cancelled: '既に取消になっています',
  hidden: '見せない設定の項目に食い違いがあります',
};

const AdoptionDialog: React.FC<Props> = ({ planId, branchId, isOpen, busy, onClose, onAdopt }) => {
  const [preview, setPreview] = useState<AdoptionPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [allIds, setAllIds] = useState<string[]>([]);

  const load = useCallback(async (only: string[] | null) => {
    setLoading(true);
    setError(null);
    try {
      const p = await getAdoptionPreview(planId, branchId, only);
      setPreview(p);
      if (only === null) {
        setAllIds(p.items.map((i) => i.op_id));
        setSelected(new Set(p.items.map((i) => i.op_id)));
      }
    } catch (e) {
      setError(errorDetailMessage(e, '採用の前の確かめに失敗しました'));
    } finally {
      setLoading(false);
    }
  }, [planId, branchId]);

  useEffect(() => {
    if (isOpen) void load(null);
  }, [isOpen, load]);

  const partial = selected.size !== allIds.length;
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
    void load(allIds.filter((x) => next.has(x)));
  };

  const labels = useMemo(() => new Map((preview?.items ?? []).map((i) => [i.op_id, `${KIND_LABEL[i.kind]}「${i.label}」`])), [preview]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="本案に採用する前に確かめる" size="lg">
      <div className="space-y-3 text-sm" data-testid="adoption-dialog">
        {loading && !preview && <div className="flex justify-center py-6"><LoadingSpinner /></div>}
        {error && <p className="p-2 rounded-sm bg-red-50 text-red-800" role="alert">{error}</p>}
        {preview && (
          <>
            <fieldset>
              <legend className="font-medium text-ink-900">本案へ当てる変更</legend>
              <ul className="mt-1 space-y-1" aria-label="採用する変更">
                {preview.items.map((i) => (
                  <li key={i.op_id}>
                    <label className="flex items-start gap-2">
                      <input type="checkbox" className="mt-1" checked={selected.has(i.op_id)} onChange={() => toggle(i.op_id)} />
                      <span>
                        {`${KIND_LABEL[i.kind]}・${OP_LABEL[i.op] ?? i.op}: ${i.label}`}
                        {i.requires.length > 0 && (
                          <span className="block text-xs text-ink-700">
                            {`頼る変更: ${i.requires.map((r) => labels.get(r) ?? r).join('・')}`}
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
            {preview.missing_dependencies.length > 0 && (
              <div className="p-2 rounded-sm bg-amber-50 text-amber-900" role="alert" data-testid="adoption-missing">
                {preview.missing_dependencies.map((m) => (
                  <p key={m.op_id}>{`${labels.get(m.op_id) ?? m.op_id} には ${m.requires.map((r) => labels.get(r) ?? r).join('・')} も選んでください`}</p>
                ))}
              </div>
            )}
            {preview.conflicts.length > 0 && (
              <div className="p-2 rounded-sm bg-red-50 text-red-800" role="alert">
                <p className="font-medium">採用できない理由</p>
                <ul className="list-disc pl-5">
                  {preview.conflicts.map((c, n) => (
                    <li key={`${c.op_id}-${n}`}>{`${labels.get(c.op_id) ?? KIND_LABEL[c.kind]}: ${REASON[c.reason] ?? c.reason}`}</li>
                  ))}
                </ul>
                <p className="text-xs mt-1">選ぶのをやめるか、案を直してから採用してください。</p>
              </div>
            )}
            {preview.tasks.length > 0 && (
              <div className="p-2 rounded-sm bg-gray-50 text-ink-900">
                <p className="font-medium">採用すると準備の一覧に入るもの</p>
                <ul className="list-disc pl-5">
                  {preview.tasks.map((t) => (
                    <li key={t.title}>{t.title}{t.due_at ? `(期限 ${new Date(t.due_at).toLocaleString('ja-JP')})` : ''}</li>
                  ))}
                </ul>
                <p className="text-xs mt-1">予約先では取り消されません。手続きの後に予約の状態を「取消」にしてください。</p>
              </div>
            )}
            {partial && (
              <p className="text-xs text-ink-700">選ばなかった変更は本案へ当てません(この案は採用済みとして閉じます)。</p>
            )}
          </>
        )}
        <div className="flex flex-wrap gap-2 justify-end pt-2">
          <Button variant="ghost" onClick={onClose}>やめる</Button>
          <Button variant="primary" loading={busy} disabled={!preview?.can_adopt || loading || selected.size === 0}
            onClick={() => onAdopt(partial ? allIds.filter((x) => selected.has(x)) : null)}>
            {partial ? `選んだ${selected.size}件を採用` : 'すべて採用'}
          </Button>
        </div>
        <p className="text-xs text-ink-700">採用は本案の「元に戻す」で取り消せます(予定・区間・予約の紐付け・作った準備が戻ります)。</p>
      </div>
    </Modal>
  );
};

export default AdoptionDialog;
