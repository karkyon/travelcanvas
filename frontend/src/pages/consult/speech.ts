/**
 * [Gate ConsultAI] ブラウザの音声認識(Web Speech API)が使えるか。使えなければ画面に出す理由。
 */
export interface RecognitionLike {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void; stop: () => void; abort: () => void;
}
type RecognitionCtor = new () => RecognitionLike;

/** 使える音声認識の作り方。使えなければ理由(画面に出す) */
export function speechSupport(w: Window | undefined = typeof window !== 'undefined' ? window : undefined):
  { ctor: RecognitionCtor | null; reason: string | null } {
  if (!w) return { ctor: null, reason: 'この環境では音声入力を使えません' };
  const ctor = ((w as unknown as { SpeechRecognition?: RecognitionCtor }).SpeechRecognition
    ?? (w as unknown as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition) ?? null;
  if (!ctor) return { ctor: null, reason: 'このブラウザは音声入力に対応していません(Chrome・Edge・Safari で使えます)' };
  if (w.isSecureContext === false) {
    return { ctor: null, reason: '安全な接続(https)でないため、ブラウザがマイクを使わせません。https の試験用の入口(例 https://…:4443)から開くと使えます。今は文字で入力してください' };
  }
  return { ctor, reason: null };
}

