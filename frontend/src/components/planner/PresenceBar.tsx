/**
 * [Gate C1] FR-020 共同編集: 同じ旅行を開いている人・編集中の予定・他の人の変更を示す帯(PlannerPage の上部)。
 *
 * 他の人が変更した時は、画面を勝手に書き換えずに「最新を読み込む」を示す(編集中の入力を失わないため)。
 */
import React from 'react';
import Button from '@/components/common/Button';
import type { PresenceChange, PresenceViewer } from '@/services/api';
import { ROLE_LABEL, describeChange, othersChanges } from '@/utils/presence';

interface Props {
  viewers: PresenceViewer[];
  changes: PresenceChange[];
  remoteRevision: number | null;
  localRevision: number | undefined;
  offline: boolean;
  /** [Gate G2] 即時の通知につながっている(他の人の変更がすぐ届く) */
  live?: boolean;
  onReload: () => void;
  isReloading?: boolean;
}

const PresenceBar: React.FC<Props> = ({
  viewers, changes, remoteRevision, localRevision, offline, live = false, onReload, isReloading = false,
}) => {
  const others = viewers.filter((v) => !v.is_self);
  const remote = othersChanges(changes);
  const behind = remoteRevision !== null && localRevision !== undefined && remoteRevision > localRevision;
  const showChanges = behind && remote.length > 0;
  if (others.length === 0 && !showChanges && !offline) return null;
  return (
    <section aria-label="一緒に見ている人" className="mb-4 space-y-2" data-testid="presence-bar">
      {others.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700">
          <span className="font-medium">この旅行を開いている人:</span>
          {live && <span className="text-xs text-green-800" data-testid="presence-live">(変更はすぐに届きます)</span>}
          <ul className="flex flex-wrap gap-2" aria-label="開いている人の一覧">
            {others.map((v) => (
              <li key={v.user_id} className="rounded-full bg-indigo-50 border border-indigo-200 px-3 py-1 text-indigo-900">
                {v.label}さん({ROLE_LABEL[v.role]})
                {v.editing && <span className="ml-1 font-medium">・「{v.editing.label}」を編集中</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {showChanges && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <div>
            <p className="font-medium">ほかの人が旅程を変更しました(この画面はまだ古い内容です)</p>
            <ul className="list-disc ml-5">
              {remote.map((c) => <li key={c.revision}>{describeChange(c)}</li>)}
            </ul>
          </div>
          <Button size="sm" variant="primary" onClick={onReload} loading={isReloading}>最新を読み込む</Button>
        </div>
      )}
      {offline && (
        <p className="text-xs text-gray-600">ほかの人の状況を確認できません(通信が戻ると自動で確認します)</p>
      )}
    </section>
  );
};

export default PresenceBar;
