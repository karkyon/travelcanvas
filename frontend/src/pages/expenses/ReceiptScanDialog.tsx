/**
 * [Gate Receipt] レシートを入れる → すぐ読み取る → 小さな画像と読み取った項目を並べて確かめる → 支出のフォームへ。
 * ここでは何も登録しない。AI は同意した時だけ、足りない項目を補うために画像を送る。
 */
import React, { useState } from 'react';
import Button from '@/components/common/Button';
import ImageDropzone from '@/components/common/ImageDropzone';
import Modal from '@/components/common/Modal';
import { extractReceipt, type ReceiptResult } from '@/services/api/receipt';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { categoryLabel } from './financeModel';
import type { ExpenseCategory } from '@/services/api';

interface Props {
  planId: string;
  isOpen: boolean;
  onClose: () => void;
  onRead: (result: ReceiptResult) => void;
}

const ROWS: [keyof ReceiptResult['fields'], string][] = [
  ['title', '店名'], ['local_date', '日付'], ['amount', '合計'], ['currency', '通貨'], ['tax_amount', '税額'], ['category', '分類'],
];

const ReceiptScanDialog: React.FC<Props> = ({ planId, isOpen, onClose, onRead }) => {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ReceiptResult | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const read = async (f: File, ai: boolean) => {
    setFile(f);
    setResult(null);
    setBusy(true);
    setError(null);
    try {
      setResult(await extractReceipt(planId, f, ai));
    } catch (e) {
      setError(errorDetailMessage(e, 'レシートを読み取れませんでした'));
    } finally {
      setBusy(false);
    }
  };
  const close = () => { setFile(null); setResult(null); setError(null); onClose(); };
  const missing = result ? ROWS.filter(([k]) => ['title', 'local_date', 'amount'].includes(k) && !result.fields[k]) : [];
  const show = (key: keyof ReceiptResult['fields'], value: string) =>
    (key === 'category' ? categoryLabel(value as ExpenseCategory) : value);
  return (
    <Modal isOpen={isOpen} onClose={close} title="レシートを読み取る" size="lg">
      <Modal.Body>
        <div className="space-y-3 text-sm text-ink-900">
          <ImageDropzone label="レシートの画像" hint="JPEG・PNG・WebP、10MB まで" file={file} disabled={busy}
            onFile={(f) => void read(f, consent)}>
            {busy && <p role="status" className="font-medium">読み取っています…</p>}
            {error && <p role="alert" className="text-danger">{error}</p>}
            {result && (
              <div data-testid="receipt-preview">
                <h3 className="font-semibold mb-1">読み取った内容</h3>
                <dl className="grid grid-cols-[4rem_minmax(0,1fr)] gap-x-2 gap-y-1">
                  {ROWS.map(([key, label]) => {
                    const f = result.fields[key];
                    return (
                      <React.Fragment key={key}>
                        <dt className="text-ink-700">{label}</dt>
                        <dd className="break-words font-medium" data-testid={`receipt-${key}`}>
                          {f ? show(key, f.value) : <span className="font-normal text-ink-700">読めませんでした</span>}
                          {f && f.confidence < 0.7 && <span className="ml-1 text-xs font-normal text-warning">要確認</span>}
                        </dd>
                      </React.Fragment>
                    );
                  })}
                </dl>
                {[...result.warnings, ...(result.ai_message ? [result.ai_message] : [])].map((w) => <p key={w} className="mt-1 text-xs text-warning">{w}</p>)}
              </div>
            )}
          </ImageDropzone>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={consent} disabled={busy} onChange={(e) => setConsent(e.target.checked)} />
            <span>
              読めない項目を AI で補う
              <span className="block text-xs text-ink-700">読めない時だけ画像を OpenAI へ送ります。カード番号や氏名が写っていれば一緒に送られます。AI の利用枠を使います。画像はここでは保存しません。</span>
            </span>
          </label>
          {file && consent && !busy && (error || missing.length > 0 || result?.ai_status === 'off') && (
            <Button variant="outline" size="sm" onClick={() => void read(file, true)}>AI で読み直す</Button>
          )}
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={close}>閉じる</Button>
        <Button variant="primary" disabled={!result} onClick={() => { if (result) { const r = result; setFile(null); setResult(null); onRead(r); } }}>この内容で支出に入れる</Button>
      </Modal.Footer>
    </Modal>
  );
};

export default ReceiptScanDialog;
