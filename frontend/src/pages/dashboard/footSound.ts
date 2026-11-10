/**
 * [Gate FootHover] 旅の足あとの地図で、カーソルが別の県・升目へ移った時の「カタカタ」という短い音。
 *
 * - 音のファイルは使わない(Web Audio で 20ms ほどの雑音を作り、木を叩いたような音にする)
 * - ブラウザの決まりで、利用者がこの画面で一度でも押す・打つまでは鳴らない(鳴らせない時は黙って何もしない)
 * - 鳴らすか鳴らさないかはこの端末に覚える(既定は鳴らす)。動きを減らす設定の端末でも鳴らすかは利用者が決める
 */
const KEY = 'tc.footSound';

export function soundEnabled(): boolean {
  try { return window.localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}

export function setSoundEnabled(on: boolean): void {
  try { window.localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* 覚えられなくても今回は効く */ }
}

type Ctx = AudioContext;
let ctx: Ctx | null = null;
let noise: AudioBuffer | null = null;
let last = 0;

function audio(): Ctx | null {
  if (ctx) return ctx;
  const W = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const C = W.AudioContext ?? W.webkitAudioContext;
  if (!C) return null;
  try {
    ctx = new C();
    const len = Math.floor(ctx.sampleRate * 0.03);
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < len; i += 1) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  } catch {
    ctx = null;
  }
  return ctx;
}

/** 押した・打った時に呼ぶ(止まっている音を使えるようにする) */
export function unlockSound(): void {
  const c = audio();
  if (c && c.state === 'suspended') void c.resume().catch(() => undefined);
}

/** カタッ。続けて動かした時に重ならないよう 35ms 以内は 1 回にする */
export function tick(strong = false): void {
  if (!soundEnabled()) return;
  const now = Date.now();
  if (now - last < 35) return;
  last = now;
  const c = audio();
  if (!c || !noise) return;
  if (c.state === 'suspended') { void c.resume().catch(() => undefined); return; }
  try {
    const src = c.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = 0.9 + Math.random() * 0.25; // 毎回少し違う高さ(カタ・カタ)
    const band = c.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = strong ? 2200 : 3000;
    band.Q.value = 4;
    const gain = c.createGain();
    const t = c.currentTime;
    gain.gain.setValueAtTime(strong ? 0.35 : 0.22, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    src.connect(band).connect(gain).connect(c.destination);
    src.start(t);
    src.stop(t + 0.035);
  } catch { /* 鳴らせなくても地図は動く */ }
}
