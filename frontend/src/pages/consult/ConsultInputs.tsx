/**
 * [Gate ConsultAI] 旅行相談の入力の部品: 音声で入力・その他の希望・追加で伝える。
 *
 * - 音声: ブラウザの音声認識(Web Speech API)。録音の開始・停止・認識中・文字起こしの確認と修正・相談に追加・取り消し。
 *   停止しても自動では送らない。使えないブラウザ・接続(http の LAN など、安全な接続でない時)では理由を出し、文字で続けられる
 * - その他の希望: 決まった項目に分けられない希望を残す(足す・直す・消す)。残した分だけ下書きへ渡す
 * - 追加で伝える: 確認の画面から、文章・箇条書き・断片で足す。確かめた行は消さず、違う値は「変更案」として示す
 */
import React, { useEffect, useId, useRef, useState } from 'react';
import Button from '@/components/common/Button';
import { speechSupport, type RecognitionLike } from './speech';

// ------------------------------------------------------------------ 音声で入力

const ERROR_LABEL: Record<string, string> = {
  'not-allowed': 'マイクの使用が許可されていません(ブラウザの設定で許可できます)',
  'service-not-allowed': 'このブラウザ・接続では音声認識を使えません',
  'no-speech': '声が聞き取れませんでした。もう一度お試しください',
  'audio-capture': 'マイクが見つかりません',
  network: '音声認識の通信ができませんでした',
};

/**
 * [Gate InputMode / VoiceWave] 録音中の声の波形(直近 WAVE_BARS 回の声の大きさ・0〜1。右から新しい値が入り左へ流れる)。
 * 音はこの端末の中だけで測り、保存も送信もしない。マイクの音を取れない時は null を返さず [] を渡す(画面は動く棒の飾り)
 */
export const WAVE_BARS = 40;

function useVoiceLevels(active: boolean, onLevels?: (levels: number[] | null) => void) {
  useEffect(() => {
    if (!onLevels) return undefined;
    if (!active) { onLevels(null); return undefined; }
    let stopped = false;
    let raf = 0;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    onLevels([]);
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    const AC = typeof window !== 'undefined'
      ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined;
    if (md?.getUserMedia && AC) {
      md.getUserMedia({ audio: true }).then((s) => {
        if (stopped) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        ctx = new AC();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(s).connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        const history: number[] = Array.from({ length: WAVE_BARS }, () => 0);
        let last = 0;
        const tick = (t: number) => {
          if (stopped) return;
          if (t - last > 70) {
            last = t;
            // 声の大きさ(波の振れ幅の二乗平均)。小さな声でも見えるよう平方根で持ち上げる
            analyser.getByteTimeDomainData(data);
            let sum = 0;
            for (let i = 0; i < data.length; i += 1) { const v = ((data[i] ?? 128) - 128) / 128; sum += v * v; }
            const level = Math.min(1, Math.sqrt(Math.sqrt(sum / data.length)) * 1.6);
            history.shift();
            history.push(level);
            onLevels([...history]);
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      }).catch(() => { /* 測れない時は飾りの棒のまま(音声認識は続く) */ });
    }
    return () => {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close().catch(() => undefined);
      onLevels(null);
    };
  }, [active, onLevels]);
}

export const VoiceInput: React.FC<{ onAdd: (text: string) => void; support?: ReturnType<typeof speechSupport>;
  /** [Gate InputMode] 録音中の声の大きさ(録音していない時は null)。入力の欄の背景の棒に使う */
  onLevels?: (levels: number[] | null) => void }> = ({
  onAdd, support, onLevels,
}) => {
  const id = useId();
  const sup = support ?? speechSupport();
  const [phase, setPhase] = useState<'idle' | 'recording' | 'review'>('idle');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<RecognitionLike | null>(null);
  const finalText = useRef('');

  useEffect(() => () => rec.current?.abort(), []);
  useVoiceLevels(phase === 'recording', onLevels);

  const start = () => {
    if (!sup.ctor) return;
    setError(null);
    finalText.current = '';
    setText('');
    const r = new sup.ctor();
    r.lang = 'ja-JP';
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const res = e.results[i]!;
        const t = res[0]?.transcript ?? '';
        if (res.isFinal) finalText.current += t;
        else interim += t;
      }
      setText(finalText.current + interim);
    };
    r.onerror = (e) => setError(ERROR_LABEL[e.error] ?? '音声を文字にできませんでした。文字で入力してください');
    r.onend = () => setPhase((p) => (p === 'recording' ? 'review' : p));
    rec.current = r;
    try {
      r.start();
      setPhase('recording');
    } catch {
      setError('音声入力を始められませんでした。文字で入力してください');
    }
  };
  const stop = () => {
    rec.current?.stop();
    setPhase('review'); // 停止しても送らない(文字起こしを確かめてから足す)
  };
  const cancel = () => {
    rec.current?.abort();
    setText('');
    setPhase('idle');
  };

  return (
    <div className="rounded-xl border border-cloud-200 p-3" data-testid="consult-voice">
      <p className="text-sm font-semibold text-ink-900">音声で入力</p>
      {!sup.ctor ? (
        <p className="mt-1 text-xs text-ink-700" data-testid="consult-voice-unavailable">{sup.reason}</p>
      ) : (
        <>
          <p className="mt-1 text-xs text-ink-700">
            話した内容は、ブラウザの音声認識で文字にします(Chrome では Google のサーバーで処理されます)。文字を確かめて直してから相談に足します。
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {phase !== 'recording' ? (
              <Button type="button" variant="outline" onClick={start} data-testid="consult-voice-start">
                {phase === 'review' ? '録り直す' : '録音を始める'}
              </Button>
            ) : (
              <Button type="button" onClick={stop} data-testid="consult-voice-stop">録音を止める</Button>
            )}
          </div>
          {phase === 'recording' && <p role="status" className="mt-2 text-xs text-accent">聞き取っています… 話し終えたら「録音を止める」</p>}
          {phase === 'review' && (
            <div className="mt-2 space-y-2">
              <label htmlFor={`${id}-t`} className="block text-xs font-semibold text-ink-900">文字起こし(直してから足せます)</label>
              <textarea id={`${id}-t`} value={text} onChange={(e) => setText(e.target.value)} rows={3}
                className="tc-focus-ring w-full rounded-lg border border-cloud-200 bg-cloud-0 p-2 text-sm" data-testid="consult-voice-text" />
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={() => { onAdd(text.trim()); cancel(); }} disabled={!text.trim()}
                  data-testid="consult-voice-add">相談に追加</Button>
                <Button type="button" variant="ghost" onClick={cancel}>取り消す</Button>
              </div>
            </div>
          )}
        </>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
};

// ------------------------------------------------------------------ その他の希望

export const NotesEditor: React.FC<{ notes: string[]; onChange: (notes: string[]) => void }> = ({ notes, onChange }) => {
  const id = useId();
  const [draft, setDraft] = useState('');
  const add = () => {
    const t = draft.trim();
    if (!t || notes.includes(t) || notes.length >= 10) return;
    onChange([...notes, t.slice(0, 100)]);
    setDraft('');
  };
  return (
    <section aria-labelledby={`${id}-h`} className="mt-4 rounded-xl border border-cloud-200 p-3" data-testid="consult-notes">
      <h3 id={`${id}-h`} className="text-sm font-semibold text-ink-900">その他の希望</h3>
      <p className="text-xs text-ink-700">上の項目に分けられない希望です。残した分は方面の検討と下書きへ引き継ぎます。</p>
      {notes.length === 0 ? <p className="mt-1 text-xs text-ink-700">(まだありません)</p> : (
        <ul className="mt-2 space-y-1">
          {notes.map((n, i) => (
            <li key={`${n}-${i}`} className="flex items-center gap-2">
              <input aria-label={`その他の希望 ${i + 1}`} value={n} maxLength={100}
                onChange={(e) => onChange(notes.map((x, j) => (j === i ? e.target.value : x)))}
                className="tc-focus-ring min-h-11 w-full rounded-lg border border-cloud-200 bg-cloud-0 px-2 text-sm" />
              <button type="button" onClick={() => onChange(notes.filter((_, j) => j !== i))}
                className="tc-focus-ring min-h-11 shrink-0 rounded-lg px-2 text-xs text-ink-700 underline">消す</button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex gap-2">
        <input aria-label="その他の希望を足す" value={draft} maxLength={100} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          className="tc-focus-ring min-h-11 w-full rounded-lg border border-cloud-200 bg-cloud-0 px-2 text-sm" placeholder="例: 何もしない時間もほしい" />
        <Button type="button" variant="outline" onClick={add} disabled={!draft.trim()}>足す</Button>
      </div>
    </section>
  );
};

// ------------------------------------------------------------------ 追加で伝える(確認の画面)

export const FollowUp: React.FC<{
  busy: boolean; aiReady: boolean; canUndo: boolean;
  /** 反映する。断る時は理由(文字数の上限など)を返す(その時は入力を消さない。[F07-3] 黙って切り捨てない) */
  onSend: (text: string, useAi: boolean) => string | null | void; onUndo: () => void;
}> = ({ busy, aiReady, canUndo, onSend, onUndo }) => {
  const id = useId();
  const [text, setText] = useState('');
  const [refused, setRefused] = useState<string | null>(null);
  const send = (useAi: boolean) => {
    const why = onSend(text.trim(), useAi);
    if (why) { setRefused(why); return; }
    setRefused(null);
    setText('');
  };
  return (
    <section aria-labelledby={`${id}-h`} className="mt-4 rounded-2xl border border-cloud-200 bg-surface p-4 text-sm"
      data-testid="consult-followup">
      <h3 id={`${id}-h`} className="font-semibold text-ink-900">追加で伝える・変える</h3>
      <p className="text-xs text-ink-700">
        例: 「やっぱり3人に変更」「福井も候補に加えて」「海はやめる」。確かめた行は消さず、違う値は「変更案」として示します(採用するまで変えません)。
      </p>
      <label htmlFor={`${id}-t`} className="sr-only">追加で伝えること</label>
      <textarea id={`${id}-t`} value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={1000}
        className="tc-focus-ring mt-2 w-full rounded-lg border border-cloud-200 bg-cloud-0 p-2 text-sm" data-testid="consult-followup-text" />
      <VoiceInput onAdd={(t) => setText((x) => (x ? `${x}\n${t}` : t))} />
      {refused && <p role="alert" className="mt-2 text-xs text-danger" data-testid="consult-followup-refused">{refused}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="button" disabled={busy || !text.trim() || !aiReady} loading={busy}
          onClick={() => send(true)} data-testid="consult-followup-ai">
          AI で読み取って反映する
        </Button>
        <Button type="button" variant="outline" disabled={busy || !text.trim()}
          onClick={() => send(false)} data-testid="consult-followup-rules">
          AI を使わずに反映する
        </Button>
        <Button type="button" variant="ghost" disabled={!canUndo || busy} onClick={onUndo} data-testid="consult-undo">
          直前の変更を元に戻す
        </Button>
      </div>
    </section>
  );
};
