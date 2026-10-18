import React, { useCallback, useEffect, useState } from 'react';
import { api as apiService } from '@/services/api';
import type { ActiveSession } from '@/services/api';

/**
 * [Gate S9] ログイン中の端末(設定 → セキュリティ)。
 *
 * 新しい端末からのログインの通知(backend app/services/login_alerts.py)を受けた本人が、
 * どの端末でログインしているかを確かめ、心当たりの無い端末をここでログアウトさせる。
 * 端末の名前はブラウザと OS の組(「Chrome / Windows」)、接続元は丸めた表示(203.0.113.x)。
 */

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' });
}

type Status = { type: 'success' | 'error'; text: string } | null;

const ActiveSessionsSection: React.FC = () => {
  const [sessions, setSessions] = useState<ActiveSession[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      setSessions(await apiService.getSessions());
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (target: ActiveSession) => {
    if (!window.confirm(`「${target.device_label}」をログアウトさせます。よろしいですか?`)) return;
    setBusyId(target.id);
    setStatus(null);
    try {
      await apiService.revokeSession(target.id);
      setStatus({ type: 'success', text: `「${target.device_label}」をログアウトさせました。` });
      await load();
    } catch {
      setStatus({ type: 'error', text: 'ログアウトさせられませんでした。もう一度お試しください。' });
    } finally {
      setBusyId(null);
    }
  };

  const others = (sessions ?? []).filter((s) => !s.is_current);

  const revokeOthers = async () => {
    if (!window.confirm(`この端末以外の ${others.length} 台をログアウトさせます。よろしいですか?`)) return;
    setBusyId('others');
    setStatus(null);
    let failed = 0;
    for (const s of others) {
      try {
        await apiService.revokeSession(s.id);
      } catch {
        failed += 1;
      }
    }
    setStatus(failed
      ? { type: 'error', text: `${failed} 台はログアウトさせられませんでした。もう一度お試しください。` }
      : { type: 'success', text: 'この端末以外をすべてログアウトさせました。' });
    setBusyId(null);
    await load();
  };

  return (
    <section aria-labelledby="active-sessions-heading" className="border-t pt-6">
      <h3 id="active-sessions-heading" className="text-lg font-semibold text-gray-900 mb-2">ログイン中の端末</h3>
      <p className="text-sm text-gray-700 mb-4">
        心当たりの無い端末があれば、ログアウトさせてからパスワードを変更してください。
        新しい端末からログインすると、通知でお知らせします。
      </p>
      {status && (
        <p role={status.type === 'error' ? 'alert' : 'status'}
          className={`mb-3 text-sm ${status.type === 'error' ? 'text-red-700' : 'text-green-800'}`}>
          {status.text}
        </p>
      )}
      {loadError && (
        <p role="alert" className="text-sm text-red-700">
          一覧を読み込めませんでした。{' '}
          <button type="button" className="underline" onClick={() => void load()}>再読み込み</button>
        </p>
      )}
      {sessions === null && !loadError && <p className="text-sm text-gray-700">読み込み中…</p>}
      {sessions !== null && (
        <ul aria-label="ログイン中の端末" className="divide-y divide-gray-200 border border-gray-200 rounded-lg">
          {sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div>
                <p className="font-medium text-gray-900">
                  {s.device_label}
                  {s.is_current && (
                    <span className="ml-2 rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-800">この端末</span>
                  )}
                </p>
                <p className="text-xs text-gray-700">
                  {s.network_label ? `接続元 ${s.network_label}・` : ''}
                  ログイン {formatDateTime(s.created_at)}・最終利用 {formatDateTime(s.last_active_at)}
                </p>
              </div>
              {!s.is_current && (
                <button
                  type="button"
                  onClick={() => void revoke(s)}
                  disabled={busyId !== null}
                  aria-label={`「${s.device_label}」(ログイン ${formatDateTime(s.created_at)})をログアウトさせる`}
                  className="rounded border border-red-300 px-3 py-1 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  ログアウトさせる
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {others.length > 0 && (
        <button
          type="button"
          onClick={() => void revokeOthers()}
          disabled={busyId !== null}
          className="mt-3 rounded border border-red-300 px-3 py-1 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          この端末以外をすべてログアウト
        </button>
      )}
    </section>
  );
};

export default ActiveSessionsSection;
