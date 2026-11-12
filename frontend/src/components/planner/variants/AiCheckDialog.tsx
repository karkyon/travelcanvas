/**
 * [Gate PlanB-AI] 押した時だけの AI の確かめ。会員のクラス・旅行の枠・AI の利用の同意を守り、断られた時は理由を出す。
 * 結果は旅行に保存しない
 */
import React, { useEffect, useState } from 'react';
import Modal from '@/components/common/Modal';
import Button from '@/components/common/Button';
import { aiCheckVariant, type VariantSummary } from '@/services/api/dayVariants';
import { errorDetailMessage } from '@/utils/apiErrorDetail';

interface Props { planId: string; isOpen: boolean; variant: VariantSummary | null; onClose: () => void }

const AiCheckDialog: React.FC<Props> = ({ planId, isOpen, variant, onClose }) => {
  const [text, setText] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!isOpen || !variant) return undefined;
    let live = true;
    setText(null);
    setError(null);
    aiCheckVariant(planId, variant.day_id).then((r) => {
      if (live) { setText(r.result.text); setNotice(r.notice); }
    }).catch((e) => { if (live) setError(errorDetailMessage(e, 'AI で確かめられませんでした')); });
    return () => { live = false; };
  }, [isOpen, variant, planId]);
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`AI で確かめる · ${variant ? `${variant.label} ${variant.name}` : ''}`} size="lg">
      <Modal.Body>
        <div className="space-y-3" data-testid="ai-check-dialog">
          {error ? <p role="alert" className="text-sm text-danger">{error}</p>
            : text === null ? <p className="tc-variant-hint" role="status">AI に確かめています…(会員のクラスの利用枠を使います)</p>
              : <div className="tc-variant-ai" data-testid="ai-check-text">{text}</div>}
          {notice && <p className="tc-variant-hint">{notice}</p>}
        </div>
      </Modal.Body>
      <Modal.Footer><Button type="button" variant="secondary" onClick={onClose}>閉じる</Button></Modal.Footer>
    </Modal>
  );
};

export default AiCheckDialog;
