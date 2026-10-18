/**
 * [Gate S7] 計算の確認の解き方が backend(Python の hashlib)と同じ結果になること。
 * 期待値は backend/app/services/challenge.py と同じ計算を Python で求めたもの。
 */
import { describe, it, expect } from 'vitest';
import { leadingZeroBits, sha256, solutionOk, solveChallenge } from './challengeSolver';

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const ascii = (text: string) => new TextEncoder().encode(text);

describe('sha256 (Gate S7)', () => {
  it('既知の値と一致する(短い入力・複数ブロック)', () => {
    expect(hex(sha256(ascii('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hex(sha256(ascii('')))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(hex(sha256(ascii('a'.repeat(1000))))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
  });

  it('先頭の 0 のビット数', () => {
    expect(leadingZeroBits(new Uint8Array([0, 0, 0x0f]))).toBe(20);
    expect(leadingZeroBits(new Uint8Array([0x80]))).toBe(0);
    expect(leadingZeroBits(new Uint8Array([0x01]))).toBe(7);
  });
});

describe('solveChallenge (Gate S7)', () => {
  it.each([
    ['eyJ0ZXN0IjoxfQ.c2lnbmF0dXJl', 8, '284'],
    ['eyJ0ZXN0IjoxfQ.c2lnbmF0dXJl', 12, '8599'],
    ['a-b_c.d', 14, '44074'],
  ])('backend と同じ最小の解を見つける(%s, %i)', async (token, difficulty, expected) => {
    await expect(solveChallenge(token, difficulty)).resolves.toBe(expected);
    expect(solutionOk(token, expected, difficulty)).toBe(true);
    expect(solutionOk(token, String(Number(expected) - 1), difficulty)).toBe(false);
  });

  it('不正な問題は解かない', async () => {
    await expect(solveChallenge('<script>', 8)).rejects.toThrow();
    await expect(solveChallenge('abc.def', 40)).rejects.toThrow();
    await expect(solveChallenge('abc.def', -1)).rejects.toThrow();
  });

  it('止められる', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(solveChallenge('abc.def', 24, { signal: controller.signal })).rejects.toThrow();
  });
});
