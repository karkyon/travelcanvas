/**
 * [Gate S7] SEC-07 計算の確認(proof of work)を解く(backend/app/services/challenge.py と同じ計算)。
 *
 * 怪しい接続元からのログイン・登録・ゲスト開始・昇格に、backend は 428 と問題(token・difficulty)を返す。
 * sha256(token + ":" + counter) の先頭の 0 のビット数が difficulty 以上になる counter(10進の文字列)を探す。
 * 普通の利用者は点数が低く 428 にならない。なっても APIクライアントが自動で解いて送り直す(操作は増えない)。
 *
 * crypto.subtle.digest は1回ごとに非同期で遅い(数万回の計算に数秒)ため、同期の SHA-256 を持つ。
 * 画面を止めないよう、一定の回数ごとに処理を手放す。
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const W = new Uint32Array(64);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/** SHA-256(入力はバイト列)。戻り値は32バイト。 */
export function sha256(bytes: Uint8Array): Uint8Array {
  const bitLength = bytes.length * 8;
  const padded = new Uint8Array((((bytes.length + 9 + 63) >> 6) << 6));
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(padded.length - 4, bitLength >>> 0);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) W[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const w15 = W[i - 15] ?? 0;
      const w2 = W[i - 2] ?? 0;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      W[i] = ((W[i - 16] ?? 0) + s0 + (W[i - 7] ?? 0) + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + (K[i] ?? 0) + (W[i] ?? 0)) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((v, i) => outView.setUint32(i * 4, v));
  return out;
}

export function leadingZeroBits(digest: Uint8Array): number {
  let bits = 0;
  for (const byte of digest) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0x7f;
  return out;
}

export function solutionOk(token: string, counter: string, difficulty: number): boolean {
  return leadingZeroBits(sha256(asciiBytes(`${token}:${counter}`))) >= difficulty;
}

export const MAX_SUPPORTED_DIFFICULTY = 24;
const YIELD_EVERY = 4000;

/**
 * 解を探す。token は backend が返した ASCII の文字列。difficulty が大きすぎる・token が不正なら例外。
 * signal で途中で止められる。
 */
export async function solveChallenge(
  token: string,
  difficulty: number,
  options: { signal?: AbortSignal; maxIterations?: number } = {},
): Promise<string> {
  if (!/^[A-Za-z0-9_\-.]{1,512}$/.test(token)) throw new Error('確認の問題の形式が不正です');
  if (!Number.isInteger(difficulty) || difficulty < 0 || difficulty > MAX_SUPPORTED_DIFFICULTY) {
    throw new Error('確認の問題の難しさが不正です');
  }
  const prefix = asciiBytes(`${token}:`);
  const maxIterations = options.maxIterations ?? 2 ** (difficulty + 6);
  const buffer = new Uint8Array(prefix.length + 20);
  buffer.set(prefix);
  for (let counter = 0; counter < maxIterations; counter++) {
    const digits = String(counter);
    for (let i = 0; i < digits.length; i++) buffer[prefix.length + i] = digits.charCodeAt(i);
    if (leadingZeroBits(sha256(buffer.subarray(0, prefix.length + digits.length))) >= difficulty) {
      return digits;
    }
    if (counter % YIELD_EVERY === YIELD_EVERY - 1) {
      if (options.signal?.aborted) throw new Error('確認の計算を中止しました');
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  throw new Error('確認の計算が終わりませんでした');
}
