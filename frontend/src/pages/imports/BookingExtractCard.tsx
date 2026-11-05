/**
 * [Gate BookingImport] 予約メール・画像から項目の候補を作る。候補は確認してから予約になる(自動では登録しない)。
 * メールは規則で読む(費用なし・外部へ送らない)。AI は選んだ時だけで、番号・氏名などを伏せて送る。
 * 画像は AI でしか読めず、番号や氏名を伏せられないので、送ることへの同意を別に取る。
 */
import React, { useRef, useState } from 'react';
import { extractReservationFile, extractReservationText } from '@/services/api/photoFeatures';
import type { ExtractedJob } from '@/services/api/photoFeatures';
import { errorDetailMessage } from '@/utils/apiErrorDetail';

const AI_NOTE: Record<string, string | null> = {
  off: null, not_needed: '規則の読み取りで足りたため、AI は使いませんでした。',
  used: 'AI で足りない項目を補いました。確定する前に値を確かめてください。', denied: null,
};

const BookingExtractCard: React.FC<{ planId: string; onExtracted: (job: ExtractedJob) => void }> = ({ planId, onExtracted }) => {
  const [text, setText] = useState('');
  const [useAi, setUseAi] = useState(false);
  const [imageConsent, setImageConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const mailFile = useRef<HTMLInputElement>(null);
  const imageFile = useRef<HTMLInputElement>(null);

  const run = async (work: () => Promise<ExtractedJob>) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const job = await work();
      setText('');
      setNote([job.ai_message, AI_NOTE[job.ai_status], ...job.warnings].filter(Boolean).join(' ') || null);
      onExtracted(job);
    } catch (e) {
      setError(errorDetailMessage(e, '予約の項目を読み取れませんでした'));
    } finally {
      setBusy(false);
    }
  };
  const fromFile = (e: React.ChangeEvent<HTMLInputElement>, consent: boolean) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void run(() => extractReservationFile(planId, file, useAi, consent));
  };

  return (
    <section className="tc-card p-4 mb-4 space-y-3" aria-labelledby="booking-extract-title" data-testid="booking-extract">
      <h2 id="booking-extract-title" className="tc-section-title">予約メール・画像から読み取る</h2>
      <p className="text-sm text-ink-700">読み取った内容は候補として出ます。確かめて採用するまで予約にはなりません。元のメールや画像は保存しません。</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {note && <p role="status" className="text-sm text-warning" data-testid="booking-extract-note">{note}</p>}
      <div>
        <label htmlFor="booking-text" className="block text-sm font-semibold text-ink-900">予約確認メールの本文</label>
        <textarea id="booking-text" rows={5} maxLength={20000} className="block w-full mt-1 border rounded-sm px-2 py-1 text-sm" value={text} onChange={(e) => setText(e.target.value)} placeholder="メールの本文を貼り付けてください" />
        <label className="flex items-start gap-2 text-sm mt-2">
          <input type="checkbox" className="mt-1" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} />
          <span>読み取れない項目を AI で補う(予約番号・氏名・電話などを伏せて OpenAI へ送ります。AI の回数を 1 回使います)</span>
        </label>
        <div className="flex flex-wrap gap-2 mt-2">
          <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--primary" disabled={busy || !text.trim()} onClick={() => void run(() => extractReservationText(planId, text, useAi))}>本文を読み取る</button>
          <input ref={mailFile} type="file" className="sr-only" accept=".eml,message/rfc822" aria-label="メールのファイル(.eml)" onChange={(e) => fromFile(e, false)} />
          <button type="button" className="tc-focus-ring tc-mbtn" disabled={busy} onClick={() => mailFile.current?.click()}>メールのファイル(.eml)を選ぶ</button>
        </div>
      </div>
      <div className="border-t pt-3">
        <p className="text-sm font-semibold text-ink-900">写真・スクリーンショット</p>
        <label className="flex items-start gap-2 text-sm mt-1">
          <input type="checkbox" className="mt-1" checked={imageConsent} onChange={(e) => setImageConsent(e.target.checked)} data-testid="booking-image-consent" />
          <span>画像を OpenAI へ送って読み取ることに同意します。画像の中の予約番号・氏名も送られます。AI の回数を 1 回使います。AI を含まないクラスでは使えません。</span>
        </label>
        <input ref={imageFile} type="file" className="sr-only" accept="image/jpeg,image/png,image/webp" aria-label="予約の画像" onChange={(e) => fromFile(e, true)} data-testid="booking-image" />
        <button type="button" className="tc-focus-ring tc-mbtn mt-2" disabled={busy || !imageConsent} onClick={() => imageFile.current?.click()}>画像を選ぶ</button>
      </div>
      {busy && <p role="status" className="text-sm text-ink-700">読み取っています…</p>}
    </section>
  );
};

export default BookingExtractCard;
