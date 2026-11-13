/**
 * [Gate Remaining-5] FR-037 公開の前の顔の検査(Google Cloud Vision。運用で鍵を登録した時だけ。押した時だけ写真を送る)。
 * 結果は手がかり(見落としがある)。写っている人の了解の確認は今までどおり人が行う。
 */
import React, { useState } from 'react';
import Button from '@/components/common/Button';
import { checkFaces } from '@/services/api/remaining5';
import { errorDetailMessage } from '@/utils/apiErrorDetail';

const FaceCheckButton: React.FC<{ planId: string; photoIds: string[] }> = ({ planId, photoIds }) => {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (photoIds.length === 0) return null;
  const run = async () => {
    setBusy(true);
    setMsg(null);
    try {
      setMsg((await checkFaces(planId, photoIds)).message);
    } catch (e) {
      setMsg(errorDetailMessage(e, '顔の判定を取れませんでした。写っている人の了解を確かめてください'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div data-testid="face-check">
      <Button size="sm" variant="outline" loading={busy} onClick={() => void run()}>
        {`写真の顔を自動で確かめる(${Math.min(photoIds.length, 10)}枚を Google へ送る)`}
      </Button>
      {msg && <p className="text-sm text-ink-700 mt-1" role="status">{msg}</p>}
    </div>
  );
};

export default FaceCheckButton;
