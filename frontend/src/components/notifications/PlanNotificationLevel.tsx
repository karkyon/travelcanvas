/**
 * [Gate G4] COL-03 この旅行の通知の量(全体の設定より優先)。押した時だけ今の設定を読む。
 */
import React, { useState } from 'react';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { deletePlanNotificationLevel, getNotificationSettings, putPlanNotificationLevel } from '@/services/api/g4';
import type { NotificationLevel } from '@/services/api';

const OPTIONS: Array<{ value: NotificationLevel | 'default'; label: string }> = [
  { value: 'default', label: '全体の設定に従う' }, { value: 'all', label: 'すべて受け取る' },
  { value: 'mentions', label: '自分あてだけ' }, { value: 'none', label: '受け取らない' },
];

const PlanNotificationLevel: React.FC<{ planId: string }> = ({ planId }) => {
  const [value, setValue] = useState<NotificationLevel | 'default' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const open = async () => {
    try {
      const p = await getNotificationSettings();
      setValue(p.plans.find((x) => x.plan_id === planId)?.level ?? 'default');
    } catch (e) {
      setMessage(errorDetailMessage(e, '通知の設定を読めませんでした'));
    }
  };

  const change = async (v: NotificationLevel | 'default') => {
    setMessage(null);
    const before = value;
    setValue(v); // 選んだ物をすぐ示す(失敗したら戻す)
    try {
      if (v === 'default') await deletePlanNotificationLevel(planId);
      else await putPlanNotificationLevel(planId, v);
      setMessage('この旅行の通知の設定を保存しました');
    } catch (e) {
      setValue(before);
      setMessage(errorDetailMessage(e, '通知の設定を保存できませんでした'));
    }
  };

  if (value === null) {
    return (
      <div className="text-sm">
        <button type="button" className="text-indigo-800 underline" onClick={() => void open()}>この旅行の通知を設定</button>
        {message && <span role="alert" className="ml-2 text-red-800">{message}</span>}
      </div>
    );
  }
  return (
    <div className="text-sm text-gray-900 flex flex-wrap items-center gap-2">
      <label>この旅行の通知
        <select className="ml-1 border rounded-sm px-2 py-1" value={value}
          onChange={(e) => void change(e.target.value as NotificationLevel | 'default')}>
          {OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      {message && <span role="status">{message}</span>}
    </div>
  );
};

export default PlanNotificationLevel;
