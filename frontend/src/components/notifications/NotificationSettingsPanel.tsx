/**
 * [Gate G4] COL-03 通知の設定(全体・旅行ごと)と、読んでいない通知のまとめ。
 *
 * - 全体: すべて / 自分あてだけ(メンション・返信・回答の催促)/ 受け取らない
 * - 旅行ごとの設定は全体より優先する(旅行の相談の画面からも変えられる)
 * - メールのまとめ(1日1回): 管理者がメールの送信を設定した環境だけ選べる。本文は旅行名と件数だけ
 */
import React, { useEffect, useState } from 'react';
import Card from '@/components/common/Card';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import {
  deletePlanNotificationLevel, getNotificationDigest, getNotificationSettings, putNotificationSettings,
} from '@/services/api/g4';
import type { NotificationDigest, NotificationLevel, NotificationPrefs } from '@/services/api';

const LEVEL_LABEL: Record<NotificationLevel, string> = {
  all: 'すべて受け取る', mentions: '自分あてだけ(メンション・返信・回答の催促)', none: '受け取らない',
};

const NotificationSettingsPanel: React.FC = () => {
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [digest, setDigest] = useState<NotificationDigest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([getNotificationSettings(), getNotificationDigest()])
      .then(([p, d]) => { if (alive) { setPrefs(p); setDigest(d); } })
      .catch((e) => { if (alive) setError(errorDetailMessage(e, '通知の設定を読めませんでした')); });
    return () => { alive = false; };
  }, []);

  const save = async (patch: { level?: NotificationLevel; email_digest?: 'off' | 'daily' }) => {
    setError(null);
    setSaved(null);
    const before = prefs;
    if (before) setPrefs({ ...before, ...patch }); // 選んだ物をすぐ示す(失敗したら戻す)
    try {
      setPrefs(await putNotificationSettings(patch));
      setSaved('通知の設定を保存しました');
    } catch (e) {
      setPrefs(before);
      setError(errorDetailMessage(e, '通知の設定を保存できませんでした'));
    }
  };

  const clearPlan = async (planId: string) => {
    try {
      setPrefs(await deletePlanNotificationLevel(planId));
      setSaved('旅行ごとの設定を外しました');
    } catch (e) {
      setError(errorDetailMessage(e, '旅行ごとの設定を外せませんでした'));
    }
  };

  return (
    <Card className="p-4 mb-6">
      <section aria-label="通知の設定">
        <h2 className="text-lg font-semibold text-gray-900">通知の設定</h2>
        {error && <p role="alert" className="mt-2 text-sm text-red-800">{error}</p>}
        {saved && <p role="status" className="mt-2 text-sm text-green-900">{saved}</p>}
        {prefs && (
          <>
            <fieldset className="mt-2">
              <legend className="text-sm font-medium text-gray-800">アプリの中の通知</legend>
              {(['all', 'mentions', 'none'] as const).map((lv) => (
                <label key={lv} className="flex items-center gap-2 text-sm text-gray-900">
                  <input type="radio" name="notification-level" checked={prefs.level === lv} onChange={() => void save({ level: lv })} />
                  {LEVEL_LABEL[lv]}
                </label>
              ))}
            </fieldset>
            <fieldset className="mt-3">
              <legend className="text-sm font-medium text-gray-800">メールでまとめる(1日1回、読んでいない通知の件数)</legend>
              {!prefs.email_available && <p className="text-sm text-gray-700">この環境ではメールを送れません(管理者の設定が必要です)。</p>}
              {prefs.email_available && !prefs.has_email && <p className="text-sm text-gray-700">メールアドレスが登録されていません。</p>}
              {(['off', 'daily'] as const).map((d) => (
                <label key={d} className="flex items-center gap-2 text-sm text-gray-900">
                  <input type="radio" name="notification-digest" checked={prefs.email_digest === d}
                    disabled={d === 'daily' && (!prefs.email_available || !prefs.has_email)}
                    onChange={() => void save({ email_digest: d })} />
                  {d === 'off' ? '送らない' : '毎日まとめて送る'}
                </label>
              ))}
            </fieldset>
            {prefs.plans.length > 0 && (
              <div className="mt-3">
                <p className="text-sm font-medium text-gray-800">旅行ごとの設定</p>
                <ul className="text-sm text-gray-900">
                  {prefs.plans.map((p) => (
                    <li key={p.plan_id} className="flex flex-wrap items-center gap-2">
                      <span>{p.plan_title ?? '旅行'}: {LEVEL_LABEL[p.level]}</span>
                      <button type="button" className="text-indigo-800 underline" onClick={() => void clearPlan(p.plan_id)}
                        aria-label={`${p.plan_title ?? '旅行'}の設定を外す`}>全体の設定に戻す</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
        {digest && digest.total > 0 && (
          <div className="mt-3" aria-label="読んでいない通知のまとめ">
            <p className="text-sm font-medium text-gray-800">読んでいない通知 {digest.total} 件</p>
            <ul className="text-sm text-gray-900 list-disc ml-5">
              {digest.groups.map((g) => (
                <li key={g.plan_id ?? 'none'}>{g.plan_title ?? '旅行に関係しない通知'}: {g.total} 件</li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </Card>
  );
};

export default NotificationSettingsPanel;
