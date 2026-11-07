/**
 * [Gate BookingImport] 予約メール・画像・PDF から項目の候補を作る。候補は確認してから予約になる(自動では登録しない)。
 * メールは規則で、画像はサーバーの中の OCR と規則で読む(費用なし・外部へ送らない)。
 * AI は選んだ時だけ。メールは番号・氏名などを伏せて送るが、画像は伏せられないことを選ぶ前に示す。
 */
import React, { useRef, useState } from 'react';
import { extractReservationFile, extractReservationText } from '@/services/api/photoFeatures';
import type { ExtractedJob } from '@/services/api/photoFeatures';
import { errorDetailMessage } from '@/utils/apiErrorDetail';

const BookingExtractCard: React.FC<{ planId: string; onExtracted: (job: ExtractedJob) => void }> = ({ planId, onExtracted }) => {
  const [text, setText] = useState('');
  const [useAi, setUseAi] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mailFile = useRef<HTMLInputElement>(null);
  const imageFile = useRef<HTMLInputElement>(null);
  const pdfFile = useRef<HTMLInputElement>(null);

  const run = async (work: () => Promise<ExtractedJob>) => {
    setBusy(true);
    setError(null);
    try {
      const job = await work();
      setText('');
      onExtracted(job);
    } catch (e) {
      setError(errorDetailMessage(e, '予約の項目を読み取れませんでした'));
    } finally {
      setBusy(false);
    }
  };
  const fromFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void run(() => extractReservationFile(planId, file, useAi, useAi));
  };

  return (
    <section className="tc-card p-4 mb-4 space-y-3" aria-labelledby="booking-extract-title" data-testid="booking-extract">
      <h2 id="booking-extract-title" className="tc-section-title">予約メール・画像・PDF から読み取る</h2>
      <p className="text-sm text-ink-700">読み取った内容を確認画面に出します。直してから登録できます。元のメールや画像は保存しません。</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="min-w-0">
          <label htmlFor="booking-text" className="block text-sm font-semibold text-ink-900">予約確認メールの本文を貼る</label>
          <textarea id="booking-text" rows={6} maxLength={20000} className="block w-full mt-1 border border-cloud-200 rounded-md bg-surface px-2 py-1 text-sm" value={text} onChange={(e) => setText(e.target.value)} placeholder="メールの本文を貼り付けてください" />
          <div className="flex flex-wrap gap-2 mt-2">
            <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--primary" disabled={busy || !text.trim()} onClick={() => void run(() => extractReservationText(planId, text, useAi))}>本文を読み取る</button>
            <input ref={mailFile} type="file" className="sr-only" accept=".eml,message/rfc822" aria-label="メールのファイル(.eml)" onChange={(e) => fromFile(e)} />
            <button type="button" className="tc-focus-ring tc-mbtn" disabled={busy} onClick={() => mailFile.current?.click()}>.eml ファイルを選ぶ</button>
          </div>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink-900">写真・スクリーンショット・PDF から</p>
          <p className="mt-1 text-sm text-ink-700">画像・PDF の文字をサーバーの中で読みます。外部には送らず、費用もかかりません。画像は JPEG・PNG・WebP、どれも 10MB まで。予約の確認の画面を「印刷 → PDF に保存」したものも読めます。</p>
          <input ref={imageFile} type="file" className="sr-only" accept="image/jpeg,image/png,image/webp" aria-label="予約の画像" onChange={(e) => fromFile(e)} data-testid="booking-image" />
          <input ref={pdfFile} type="file" className="sr-only" accept="application/pdf,.pdf" aria-label="予約の PDF" onChange={(e) => fromFile(e)} data-testid="booking-pdf" />
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--primary" disabled={busy} onClick={() => imageFile.current?.click()}>画像を選ぶ</button>
            <button type="button" className="tc-focus-ring tc-mbtn" disabled={busy} onClick={() => pdfFile.current?.click()}>PDF を選ぶ</button>
          </div>
        </div>
      </div>
      <label className="flex items-start gap-2 text-sm border-t pt-3">
        <input type="checkbox" className="mt-1" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} data-testid="booking-use-ai" />
        <span>読み取れない項目があれば AI で補う(OpenAI へ送ります。AI の回数を 1 回使います)。メールは予約番号・氏名・電話などを伏せて送りますが、画像は写っている内容がそのまま送られます。</span>
      </label>
      {busy && <p role="status" className="text-sm text-ink-700">読み取っています…</p>}
    </section>
  );
};

export default BookingExtractCard;
