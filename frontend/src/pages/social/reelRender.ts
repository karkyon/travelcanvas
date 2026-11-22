/**
 * [FR-063] リールを端末の中で作る(詳細設計 DD-2026-11-22-01 §8.4)。
 *
 * - 写真は長辺 1920px の ImageBitmap にして Canvas(1080×1920)へ 30fps で描く。Canvas に描くので、元の写真の Exif(位置を含む)は動画に入らない
 * - 写真: 画面いっぱいに切り抜き、ゆっくり寄る(1.00→1.08)。切り替えは 0.3 秒の重ね
 * - 地図のコマ: ルートの形(0〜1 の点だけ)を伸びていくように描く(地図の絵は使わない)
 * - 文字: 日付・場所の名前を安全な範囲の中に(白の文字に影)。最後のコマに旅行の名前と「TravelCanvas で作りました」(消せる)
 * - 顔をぼかす: 選んだ時だけ、端末の Canvas で枠をぼかす(枠はサーバーが返した 0〜1 の値)
 * - 録る: canvas.captureStream(30) + MediaRecorder。MP4(avc1)→ MP4 → WebM(vp9)→ WebM。8Mbps(60MB を超えたら 5Mbps で作り直す)
 * - 音: 無音(既定)か自分の声の記録 1 つ(AudioContext で混ぜる)。音楽は付けない
 */
import {
  BITRATE_HIGH, BITRATE_LOW, MAX_BYTES, REEL_H, REEL_W, fadeAt, frameSeconds, pickMime, safeRect, zoomAt, type Template,
} from './socialModel';

export interface ReelFrame { image: ImageBitmap | HTMLImageElement; label: string | null; date: string | null; faces?: number[][] }
export interface ReelInput {
  frames: ReelFrame[]; title: string; period: string | null; routeShape: number[][]; durationS: number; template: Template;
  withMap: boolean; credit: boolean; audio?: Blob | null;
}
export interface ReelResult { blob: Blob; mime: string; ext: 'mp4' | 'webm'; mp4: boolean; seconds: number; bitrate: number }

const FPS = 30;

/** 写真を長辺 1920px の絵にする(Exif は使わない) */
export async function loadFrameImage(blob: Blob): Promise<ImageBitmap> {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, 1920 / Math.max(bmp.width, bmp.height));
  if (scale >= 1) return bmp;
  const out = await createImageBitmap(bmp, { resizeWidth: Math.round(bmp.width * scale), resizeHeight: Math.round(bmp.height * scale) });
  bmp.close?.();
  return out;
}

function cover(ctx: CanvasRenderingContext2D, img: ReelFrame['image'], zoom: number, faces?: number[][]) {
  const iw = img.width; const ih = img.height;
  const s = Math.max(REEL_W / iw, REEL_H / ih) * zoom;
  const w = iw * s; const h = ih * s;
  const x = (REEL_W - w) / 2; const y = (REEL_H - h) / 2;
  ctx.drawImage(img, x, y, w, h);
  for (const [fx, fy, fw, fh] of faces ?? []) {
    // 顔の枠をぼかす(枠の絵を小さくして大きく戻す = モザイク)
    const bx = x + (fx ?? 0) * w; const by = y + (fy ?? 0) * h; const bw = (fw ?? 0) * w; const bh = (fh ?? 0) * h;
    if (bw < 2 || bh < 2) continue;
    const tmp = document.createElement('canvas');
    tmp.width = Math.max(1, Math.round(bw / 24)); tmp.height = Math.max(1, Math.round(bh / 24));
    const t = tmp.getContext('2d');
    if (!t) continue;
    t.drawImage(ctx.canvas, bx, by, bw, bh, 0, 0, tmp.width, tmp.height);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, bx, by, bw, bh);
    ctx.restore();
  }
}

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, maxW: number, weight = 700) {
  ctx.save();
  ctx.font = `${weight} ${size}px "Noto Sans JP", system-ui, sans-serif`;
  ctx.fillStyle = '#fff';
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 12;
  ctx.textBaseline = 'top';
  let line = s;
  while (line.length > 1 && ctx.measureText(line).width > maxW) line = line.slice(0, -1);
  ctx.fillText(line === s ? s : `${line.slice(0, -1)}…`, x, y);
  ctx.restore();
}

/** t 秒目の 1 コマを描く(見本の再生と録るので同じ物を使う) */
export function drawAt(ctx: CanvasRenderingContext2D, input: ReelInput, t: number): void {
  const safe = safeRect();
  const per = frameSeconds(input.durationS, input.frames.length);
  const mapS = input.withMap ? 2 : 0;
  const mapFirst = input.template === 'map_first';
  ctx.fillStyle = '#10302b';
  ctx.fillRect(0, 0, REEL_W, REEL_H);
  let tt = t;
  const drawMap = (u: number) => {
    const pts = input.routeShape;
    if (pts.length < 2) return;
    const k = Math.max(2, Math.round(pts.length * Math.min(1, u / Math.max(0.1, mapS - 0.3))));
    ctx.save();
    ctx.strokeStyle = '#f6c77b'; ctx.lineWidth = 12; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    pts.slice(0, k).forEach(([x, y], i) => {
      const px = safe.x + (x ?? 0) * safe.w; const py = safe.y + 200 + (y ?? 0) * (safe.h - 400);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke();
    ctx.restore();
    text(ctx, input.title, safe.x, safe.y + 40, 64, safe.w);
  };
  if (mapFirst && input.withMap) {
    if (tt < mapS) { drawMap(tt); return; }
    tt -= mapS;
  }
  const photosS = per * input.frames.length;
  if (tt < photosS) {
    const i = Math.min(input.frames.length - 1, Math.floor(tt / per));
    const local = tt - i * per;
    const f = input.frames[i]!;
    ctx.globalAlpha = fadeAt(local, per);
    cover(ctx, f.image, zoomAt(local, per), f.faces);
    ctx.globalAlpha = 1;
    if (i === 0) {
      // 表紙のコマ: 旅行の名前と日付を大きく
      text(ctx, input.title, safe.x, safe.y + 40, 80, safe.w, 800);
      if (input.period) text(ctx, input.period, safe.x, safe.y + 150, 44, safe.w, 600);
    } else if (input.template === 'flow') {
      const line = [f.date, f.label].filter(Boolean).join(' · ');
      if (line) text(ctx, line, safe.x, safe.y + safe.h - 80, 48, safe.w, 600);
    }
    return;
  }
  tt -= photosS;
  if (!mapFirst && input.withMap && tt < mapS) { drawMap(tt); return; }
  // 最後のコマ
  text(ctx, input.title, safe.x, safe.y + safe.h / 2 - 60, 72, safe.w, 800);
  if (input.credit) text(ctx, 'TravelCanvas で作りました', safe.x, safe.y + safe.h - 60, 32, safe.w, 400);
}

export function totalSeconds(input: ReelInput): number {
  return Math.min(60, frameSeconds(input.durationS, input.frames.length) * input.frames.length + (input.withMap ? 2 : 0) + 2);
}

export class RenderCancelled extends Error { constructor() { super('cancelled'); } }

interface RenderOptions {
  signal?: AbortSignal; onProgress?: (ratio: number) => void;
  isTypeSupported?: (m: string) => boolean; bitrate?: number;
}

/** 録る(1 回)。やめた時は RenderCancelled */
async function recordOnce(input: ReelInput, opts: RenderOptions, bitrate: number): Promise<ReelResult> {
  const supported = opts.isTypeSupported ?? ((m: string) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m));
  const fmt = pickMime(supported);
  if (!fmt) throw new Error('この端末では動画を作れません(MediaRecorder が使えません)');
  const canvas = document.createElement('canvas');
  canvas.width = REEL_W; canvas.height = REEL_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('この端末では動画を作れません(Canvas が使えません)');
  const stream = (canvas as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }).captureStream(FPS);
  let audioCtx: AudioContext | null = null;
  if (input.audio) {
    audioCtx = new AudioContext();
    const buf = await audioCtx.decodeAudioData(await input.audio.arrayBuffer());
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    const dest = audioCtx.createMediaStreamDestination();
    src.connect(dest);
    dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
    src.start();
  }
  const rec = new MediaRecorder(stream, { mimeType: fmt.mime, videoBitsPerSecond: bitrate });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const total = totalSeconds(input);
  const done = new Promise<void>((resolve) => { rec.onstop = () => resolve(); });
  rec.start(1000);
  const started = performance.now();
  await new Promise<void>((resolve, reject) => {
    const tick = () => {
      if (opts.signal?.aborted) { reject(new RenderCancelled()); return; }
      const t = (performance.now() - started) / 1000;
      if (t >= total) { resolve(); return; }
      drawAt(ctx, input, t);
      opts.onProgress?.(Math.min(1, t / total));
      setTimeout(tick, 1000 / FPS);
    };
    tick();
  }).finally(() => {
    if (rec.state !== 'inactive') rec.stop();
    stream.getTracks().forEach((tr) => tr.stop());
    void audioCtx?.close();
  });
  await done;
  const blob = new Blob(chunks, { type: fmt.mime.split(';')[0] });
  return { blob, mime: fmt.mime, ext: fmt.ext, mp4: fmt.mp4, seconds: total, bitrate };
}

export async function renderReel(input: ReelInput, opts: RenderOptions = {}): Promise<ReelResult> {
  // 作っている間は画面を消さない(使えない時は画面に「画面を消さないでください」を出す)
  let lock: { release(): Promise<void> } | null = null;
  try { lock = await (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen') ?? null; } catch { lock = null; }
  try {
    const first = await recordOnce(input, opts, opts.bitrate ?? BITRATE_HIGH);
    if (first.blob.size <= MAX_BYTES) return first;
    return await recordOnce(input, opts, BITRATE_LOW);
  } finally {
    void lock?.release().catch(() => undefined);
  }
}

export const wakeLockAvailable = () => typeof navigator !== 'undefined' && 'wakeLock' in navigator;
