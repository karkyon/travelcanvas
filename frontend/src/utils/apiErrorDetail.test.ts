import { describe, it, expect } from 'vitest';
import { errorDetailMessage, errorRetry, errorSupportId } from './apiErrorDetail';

describe('errorDetailMessage (Gate B-013)', () => {
  it('文字列detail・構造化detailのmessageを表示用に取り出し、それ以外は既定文言にする', () => {
    expect(errorDetailMessage({ response: { data: { detail: '競合しました' } } }, '失敗')).toBe('競合しました');
    expect(errorDetailMessage({ response: { data: { detail: { code: 'x', message: 'ロック中です' } } } }, '失敗')).toBe('ロック中です');
    expect(errorDetailMessage({ response: { data: { detail: [{ msg: 'bad' }] } } }, '失敗')).toBe('失敗');
    expect(errorDetailMessage({ response: { data: { detail: '' } } }, '失敗')).toBe('失敗');
    expect(errorDetailMessage(undefined, '失敗')).toBe('失敗');
  });
});

describe('エラーの表示の決まり (Gate G3 UX-04)', () => {
  const rid = '0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b';
  it('5xx は問い合わせ番号を添える。4xx は添えない', () => {
    const e500 = { response: { status: 500, data: { detail: 'サーバー内部でエラーが発生しました。', request_id: rid, retry: 'later' } } };
    expect(errorDetailMessage(e500, '失敗')).toBe('サーバー内部でエラーが発生しました。(問い合わせ番号: 0f1e2d3c)');
    expect(errorSupportId(e500)).toBe('0f1e2d3c');
    expect(errorRetry(e500)).toBe('later');
    const e409 = { response: { status: 409, data: { detail: { code: 'revision_conflict', message: '更新されています' }, request_id: rid, retry: 'after_reload' } } };
    expect(errorDetailMessage(e409, '失敗')).toBe('更新されています');
    expect(errorRetry(e409)).toBe('after_reload');
  });

  it('どの形のエラーでも [object Object]・中身の無い文・秘密を表示しない', () => {
    const shapes: unknown[] = [
      { response: { status: 422, data: { detail: [{ loc: ['body', 'title'], msg: 'Field required', type: 'missing' }] } } },
      { response: { status: 400, data: { detail: { code: 'x' } } } },
      { response: { status: 400, data: { detail: { message: { nested: 1 } } } } },
      { response: { status: 503, data: { detail: null, request_id: 'not a valid id <script>' } } },
      { response: { status: 500, data: 'Internal Server Error' } },
      { message: 'Network Error' },
      null, undefined, 42, 'boom',
    ];
    for (const s of shapes) {
      const text = errorDetailMessage(s, '操作に失敗しました');
      expect(text).not.toContain('[object Object]');
      expect(text).not.toContain('<script>');
      expect(text.trim()).not.toBe('');
    }
    expect(errorSupportId({ response: { data: { request_id: 'not a valid id <script>' } } })).toBeNull();
    expect(errorSupportId({ response: { headers: { 'x-request-id': rid } } })).toBe('0f1e2d3c');
    expect(errorRetry({ response: { data: { retry: 'sometimes' } } })).toBeNull();
  });
});
