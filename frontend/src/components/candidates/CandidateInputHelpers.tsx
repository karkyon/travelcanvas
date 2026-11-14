/**
 * [Gate Remaining-7] FR-007 画像・声から候補の名前を入れる。
 *
 * - 画像: 写真・スクリーンショットの文字をサーバーで読み(OCR。画像は外へ送らず保存しない)、名前らしい行を選ぶ
 * - 声: ブラウザの音声認識(Web Speech API)。使えないブラウザでは出さない。認識はブラウザの提供元で行われることがある
 * どちらも名前の欄を埋めるだけで、保存は「候補に追加」を押した時。
 */
import React, { useRef, useState } from 'react';
import { readPlaceImage } from '@/services/api/spotIntake';
import { errorDetailMessage } from '@/utils/apiErrorDetail';

interface SpeechResultEvent { results: ArrayLike<ArrayLike<{ transcript: string }>> }
interface SpeechRecognitionLike {
  lang: string; interimResults: boolean; maxAlternatives: number;
  onresult: ((e: SpeechResultEvent) => void) | null; onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null; start: () => void; stop: () => void;
}
type SpeechCtor = new () => SpeechRecognitionLike;

function speechRecognitionCtor(): SpeechCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

interface Props { onPick: (text: string) => void; disabled?: boolean }

const CandidateInputHelpers: React.FC<Props> = ({ onPick, disabled }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const [words, setWords] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const Speech = speechRecognitionCtor();

  const readImage = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setMsg(null); setWords(null);
    try {
      const r = await readPlaceImage(file);
      if (!r.ocr_available) setMsg('このサーバーでは画像の文字を読めません(手で入れてください)');
      else if (r.words.length === 0) setMsg('名前らしい文字が見つかりませんでした');
      setWords(r.words.slice(0, 12));
    } catch (e) {
      setMsg(errorDetailMessage(e, '画像を読めませんでした'));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const listen = () => {
    if (!Speech) return;
    if (listening) { recRef.current?.stop(); return; }
    const rec = new Speech();
    rec.lang = 'ja-JP'; rec.interimResults = false; rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      const text = e.results[0]?.[0]?.transcript?.trim();
      if (text) { onPick(text.slice(0, 200)); setMsg(`「${text.slice(0, 40)}」を名前に入れました`); }
    };
    rec.onerror = (e) => setMsg(e.error === 'not-allowed' ? 'マイクの使用が許可されていません' : '声を聞き取れませんでした');
    rec.onend = () => setListening(false);
    recRef.current = rec;
    setMsg(null);
    setListening(true);
    rec.start();
  };

  return (
    <div className="space-y-2" data-testid="candidate-input-helpers">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" disabled={disabled || busy}
          onClick={() => fileRef.current?.click()}>{busy ? '読んでいます…' : '画像から名前を読む'}</button>
        <input ref={fileRef} type="file" accept="image/*" className="sr-only" aria-label="文字を読む画像を選ぶ"
          onChange={(e) => void readImage(e.target.files?.[0])} data-testid="candidate-image-input" />
        {Speech && (
          <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" disabled={disabled} aria-pressed={listening}
            onClick={listen} data-testid="candidate-voice">{listening ? '聞いています…(押すと止める)' : '声で入れる'}</button>
        )}
      </div>
      {Speech && <p className="m-0 text-xs text-ink-700">声はブラウザの音声認識で文字にします(ブラウザの提供元で処理されることがあります)。</p>}
      {msg && <p role="status" className="m-0 text-xs text-ink-700">{msg}</p>}
      {words && words.length > 0 && (
        <div role="group" aria-label="画像から読んだ名前の候補" className="flex flex-wrap gap-1">
          {words.map((w) => (
            <button key={w} type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={() => { onPick(w.slice(0, 200)); setWords(null); }}>
              {w}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default CandidateInputHelpers;
