import { createHash } from 'node:crypto';
import type { APIRequestContext, APIResponse } from '@playwright/test';

/**
 * [Gate A2] 計算の確認(S7)を、E2E の API の下準備(page.request 等。画面を通らない要求)でも解いて送り直す。
 *
 * backend/app/services/challenge.py と同じ計算: sha256(token + ":" + counter) の先頭の 0 のビット数が difficulty 以上の counter。
 * 画面の要求はアプリ(services/api/core.ts)が自動で解く。ここは試験の下準備だけが使う。
 */
function leadingZeroBits(digest: Buffer): number {
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

export function solve(token: string, difficulty: number): string {
  for (let counter = 0; counter < 2 ** (difficulty + 6); counter++) {
    if (leadingZeroBits(createHash('sha256').update(`${token}:${counter}`).digest()) >= difficulty) return String(counter);
  }
  throw new Error('計算の確認を解けませんでした');
}

/** POST し、428(計算の確認)なら解いて1回だけ送り直す */
export async function postSolvingChallenge(
  request: APIRequestContext, url: string, options: { headers?: Record<string, string>; data?: unknown } = {},
): Promise<APIResponse> {
  const first = await request.post(url, options);
  if (first.status() !== 428) return first;
  const token = first.headers()['x-tc-challenge'];
  const difficulty = Number(first.headers()['x-tc-challenge-difficulty']);
  if (!token || !Number.isInteger(difficulty)) return first;
  return request.post(url, {
    ...options,
    headers: { ...(options.headers ?? {}), 'X-TC-Challenge': token, 'X-TC-Challenge-Solution': solve(token, difficulty) },
  });
}
