import { describe, it, expect } from 'vitest';
import { errorDetailMessage } from './apiErrorDetail';

describe('errorDetailMessage (Gate B-013)', () => {
  it('文字列detail・構造化detailのmessageを表示用に取り出し、それ以外は既定文言にする', () => {
    expect(errorDetailMessage({ response: { data: { detail: '競合しました' } } }, '失敗')).toBe('競合しました');
    expect(errorDetailMessage({ response: { data: { detail: { code: 'x', message: 'ロック中です' } } } }, '失敗')).toBe('ロック中です');
    expect(errorDetailMessage({ response: { data: { detail: [{ msg: 'bad' }] } } }, '失敗')).toBe('失敗');
    expect(errorDetailMessage({ response: { data: { detail: '' } } }, '失敗')).toBe('失敗');
    expect(errorDetailMessage(undefined, '失敗')).toBe('失敗');
  });
});
