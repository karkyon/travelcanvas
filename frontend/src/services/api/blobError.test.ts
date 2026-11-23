/**
 * [監査 2026-11-23] ファイルで受ける要求の失敗の本文(Blob)を、ほかの要求と同じ JSON の形へ読み直す(core.ts の共通の処理)。
 */
import { describe, it, expect } from 'vitest';
import { parseBlobErrorBody } from './core';
import { errorDetailMessage } from '@/utils/apiErrorDetail';

describe('parseBlobErrorBody', () => {
  it('JSON の Blob は読み直し、画面の説明に使える', async () => {
    const err = { response: { status: 403, data: new Blob([JSON.stringify({ detail: { code: 'owner_only', message: '所有者だけです' } })]) } };
    await parseBlobErrorBody(err);
    expect(err.response.data).toEqual({ detail: { code: 'owner_only', message: '所有者だけです' } });
    expect(errorDetailMessage(err, '失敗')).toContain('所有者だけです');
  });

  it('JSON でない Blob・Blob でない本文・本文の無い失敗はそのまま(投げない)', async () => {
    const html = new Blob(['<html>502</html>']);
    const a = { response: { data: html } };
    await parseBlobErrorBody(a);
    expect(a.response.data).toBe(html);
    const b = { response: { data: { detail: 'x' } } };
    await parseBlobErrorBody(b);
    expect(b.response.data).toEqual({ detail: 'x' });
    await expect(parseBlobErrorBody({})).resolves.toBeUndefined();
  });
});
