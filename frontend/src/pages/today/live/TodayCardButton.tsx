/** [Gate Remaining-5] FR-046 NOW/NEXT のカードを画像で保存する(サーバーで作る。メッセージ・SNS へ貼る大きさ) */
import React, { useState } from 'react';
import { downloadTodayCard, saveBlob } from '@/services/api/remaining5';
import { errorDetailMessage } from '@/utils/apiErrorDetail';

const TodayCardButton: React.FC<{ planId: string }> = ({ planId }) => {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      saveBlob(await downloadTodayCard(planId), 'いまとつぎ.png');
      setMsg('画像を保存しました');
    } catch (e) {
      setMsg(errorDetailMessage(e, '画像を作れませんでした'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ marginTop: 16 }} data-testid="today-card">
      <h3 className="tl-lbl">画像</h3>
      <button type="button" className="tc-focus-ring tl-btn" disabled={busy} onClick={() => void save()}>「いま・つぎ」を画像で保存</button>
      {msg && <p className="tl-small tl-mute" role="status">{msg}</p>}
    </div>
  );
};

export default TodayCardButton;
