/**
 * SyncStatusBar - オフラインで溜めた変更・同期で競合した変更の表示(SC-06「未同期・競合」、FR-033)。
 *
 * [Gate P11] 端末に溜めた操作がある時・競合がある時だけ表示する。通信が戻ったら(online)自動で送り、
 * 「今すぐ同期」でも送れる。競合は SyncConflictsPage で、自分の変更とサーバーの内容を比べて解決する。
 */
import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { CloudOff, RefreshCw, AlertTriangle } from 'lucide-react';
import { usePlanStore } from '@/store/planStore';

const SyncStatusBar: React.FC<{ planId: string }> = ({ planId }) => {
  const navigate = useNavigate();
  const pending = usePlanStore((s) => s.pendingSyncCount);
  const conflicts = usePlanStore((s) => s.syncConflictCount);
  const isSyncing = usePlanStore((s) => s.isSyncing);
  const refreshSyncState = usePlanStore((s) => s.refreshSyncState);
  const syncPending = usePlanStore((s) => s.syncPending);

  useEffect(() => {
    refreshSyncState(planId);
    const onOnline = () => {
      syncPending(planId);
    };
    window.addEventListener('online', onOnline);
    if (typeof navigator !== 'undefined' && navigator.onLine !== false && usePlanStore.getState().pendingSyncCount > 0) {
      syncPending(planId);
    }
    return () => window.removeEventListener('online', onOnline);
  }, [planId, refreshSyncState, syncPending]);

  if (pending === 0 && conflicts === 0) return null;
  return (
    <div className="mb-4 space-y-2" aria-label="同期の状態" role="region">
      {pending > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg bg-amber-50 text-amber-900 text-sm">
          <span className="flex items-center gap-2">
            <CloudOff size={16} aria-hidden="true" />
            {`未同期の変更 ${pending}件(この端末に保存しています。通信が戻ると自動で送ります)`}
          </span>
          <button
            type="button"
            onClick={() => syncPending(planId)}
            disabled={isSyncing}
            className="flex items-center gap-1 px-3 py-1 rounded-sm border border-amber-800 text-amber-900 disabled:opacity-50"
          >
            <RefreshCw size={14} aria-hidden="true" />
            {isSyncing ? '送信中' : '今すぐ同期'}
          </button>
        </div>
      )}
      {conflicts > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg bg-red-50 text-red-900 text-sm">
          <span className="flex items-center gap-2">
            <AlertTriangle size={16} aria-hidden="true" />
            {`同期で競合した変更 ${conflicts}件(他の人やほかの端末の変更と重なっています)`}
          </span>
          <button
            type="button"
            onClick={() => navigate(`/planner/${planId}/sync`)}
            className="px-3 py-1 rounded-sm border border-red-800 text-red-900"
          >
            競合を確認する
          </button>
        </div>
      )}
    </div>
  );
};

export default SyncStatusBar;
