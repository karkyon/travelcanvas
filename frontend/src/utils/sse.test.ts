/**
 * [Gate G2] FR-020 Server-Sent Events の区切り: 空行で区切る・複数行の data・id・retry・空の知らせ(:)・
 * 途中で切れた知らせは次へ持ち越す・知らない種類と壊れた JSON は読み捨てる・CRLF。
 */
import { describe, it, expect } from 'vitest';
import { parseSse } from './sse';

describe('parseSse (Gate G2)', () => {
  it('知らせを区切り、残りを持ち越す', () => {
    const r = parseSse('retry: 3000\n\nid: 4\nevent: ready\ndata: {"revision":4}\n\n: keep-alive\n\nevent: revision\ndata: {"revi');
    expect(r.retry).toBe(3000);
    expect(r.events).toEqual([{ type: 'ready', id: '4', data: { revision: 4 } }]);
    expect(r.rest).toBe('event: revision\ndata: {"revi');
    const r2 = parseSse(r.rest + 'sion":5}\n\n');
    expect(r2.events).toEqual([{ type: 'revision', id: null, data: { revision: 5 } }]);
    expect(r2.rest).toBe('');
  });

  it('複数行の data・CRLF・知らない種類・壊れた JSON', () => {
    const r = parseSse('event: presence\r\ndata: {"people":\r\ndata: 2}\r\n\r\nevent: other\ndata: {}\n\nevent: revision\ndata: {broken\n\n');
    expect(r.events).toEqual([{ type: 'presence', id: null, data: { people: 2 } }]);
  });
});
