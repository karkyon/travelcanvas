/**
 * [Gate C1] FR-023 この旅行に自分の秘匿プロフィールを適用する/やめる(制約の画面の上部)。
 * 適用すると、項目ごとに自分だけの秘匿制約が作られる(プロフィールの変更で作り直される)。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import { extractApiErrorDetailMessage, getPlanPrivateProfile, putPlanPrivateProfile } from '@/services/api';
import type { PlanPrivateProfile } from '@/services/api';

interface Props {
  planId: string;
  onChanged: () => void;
}

const PrivateProfilePanel: React.FC<Props> = ({ planId, onChanged }) => {
  const [state, setState] = useState<PlanPrivateProfile | null>(null);
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await getPlanPrivateProfile(planId));
    } catch {
      setState(null);
    }
  }, [planId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async () => {
    if (!state) return;
    setIsSaving(true);
    setMessage(null);
    try {
      const next = await putPlanPrivateProfile(planId, !state.applied);
      setState(next);
      setMessage({ type: 'ok', text: next.applied ? '非公開の条件をこの旅行に適用しました' : 'この旅行への適用をやめました' });
      onChanged();
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      setMessage({ type: 'error', text: extractApiErrorDetailMessage(detail) ?? '変更できませんでした' });
    } finally {
      setIsSaving(false);
    }
  };

  if (!state) return null;
  return (
    <Card padding="md" className="mb-6">
      <section aria-labelledby="pp-panel-heading" className="space-y-2">
        <h2 id="pp-panel-heading" className="text-base font-semibold text-ink-900">あなたの非公開の条件</h2>
        <p className="text-sm text-ink-700">
          登録した条件 {state.profile_items}件。
          {state.applied ? `この旅行に適用しています(${state.applied_constraints}件)。` : 'この旅行にはまだ適用していません。'}
          ほかの参加者には「秘匿制約を満たしていません」とだけ伝わります。
          <Link to="/settings?tab=conditions" className="ml-1 text-blue-700 underline">設定で変更する</Link>
        </p>
        {message && (
          <p role={message.type === 'error' ? 'alert' : 'status'}
            className={`text-sm ${message.type === 'error' ? 'text-red-700' : 'text-green-800'}`}>{message.text}</p>
        )}
        <Button size="sm" variant={state.applied ? 'outline' : 'primary'} onClick={() => void toggle()} loading={isSaving}
          disabled={!state.applied && state.profile_items === 0}>
          {state.applied ? 'この旅行への適用をやめる' : 'この旅行に適用する'}
        </Button>
      </section>
    </Card>
  );
};

export default PrivateProfilePanel;
