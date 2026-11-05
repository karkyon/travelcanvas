/**
 * [Gate Receipt] レシートを撮る・選ぶ → 読み取る → 支出の追加のフォームに入れて確かめてもらう。ここでは何も登録しない。
 * まずサーバーの OCR で読む。AI は同意した時だけ、足りない項目を補うために画像を送る。
 */
import React, { useState } from 'react';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import { extractReceipt, type ReceiptResult } from '@/services/api/receipt';
import { errorDetailMessage } from '@/utils/apiErrorDetail';

interface Props {
  planId: string;
  isOpen: boolean;
  onClose: () => void;
  onRead: (result: ReceiptResult) => void;
}

const ReceiptScanDialog: React.FC<Props> = ({ planId, isOpen, onClose, onRead }) => {
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const read = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onRead(await extractReceipt(planId, file, consent));
      setFile(null);
    } catch (e) {
      setError(errorDetailMessage(e, 'レシートを読み取れませんでした'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="レシートを読み取る" size="md">
      <Modal.Body>
        <div className="space-y-3 text-sm text-ink-900">
          {error && <div className="p-2 rounded-sm bg-red-50 text-red-800" role="alert">{error}</div>}
          <p>店名・日付・合計・税額・通貨を読み取り、支出の追加の画面に入れます。登録の前に確かめて直せます。画像は保存しません。</p>
          <div>
            <label htmlFor="receipt-file" className="block font-medium mb-1">レシートの写真(JPEG・PNG・WebP、10MB まで)</label>
            <input id="receipt-file" type="file" accept="image/jpeg,image/png,image/webp" className="block w-full"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>
              読めない項目を AI で補う
              <span className="block text-xs text-ink-700">
                サーバーの読み取りで足りない時だけ、画像を OpenAI へ送ります(撮影情報は消します)。カードの番号や氏名が写っていれば一緒に送られます。AI の利用枠を使います。
              </span>
            </span>
          </label>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={onClose}>閉じる</Button>
        <Button variant="primary" onClick={() => void read()} loading={busy} disabled={!file}>読み取る</Button>
      </Modal.Footer>
    </Modal>
  );
};

export default ReceiptScanDialog;
