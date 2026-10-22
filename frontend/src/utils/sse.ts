/**
 * [Gate G2] FR-020 即時の通知(Server-Sent Events。サーバーから画面へ一方向に送り続ける仕組み)の読み取り。
 *
 * EventSource は Authorization ヘッダーを付けられないため、fetch で応答を少しずつ読み、ここで区切る。
 * 形式(WHATWG の仕様の範囲): 空行で1つの知らせが終わる。`event:`・`data:`(複数行は改行でつなぐ)・`id:`・
 * `retry:`。`:` で始まる行は接続を保つための空の知らせ(読み捨てる)。
 */
import type { PlanStreamEnd, PlanStreamEvent, PlanStreamEventType } from '@/services/api/types';

const KNOWN: ReadonlySet<string> = new Set(['ready', 'revision', 'presence', 'reconnect', 'access_lost']);

export interface SseParseResult {
  events: PlanStreamEvent[];
  /** まだ区切りの来ていない残り(次の読み取りの前に付ける) */
  rest: string;
  /** サーバーが指定したつなぎ直しの間隔(ミリ秒) */
  retry: number | null;
}

export function parseSse(buffer: string): SseParseResult {
  const text = buffer.replace(/\r\n?/g, '\n');
  const blocks = text.split('\n\n');
  const rest = blocks.pop() ?? '';
  const events: PlanStreamEvent[] = [];
  let retry: number | null = null;
  for (const block of blocks) {
    let type = 'message';
    let id: string | null = null;
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const i = line.indexOf(':');
      const field = i < 0 ? line : line.slice(0, i);
      const value = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '');
      if (field === 'event') type = value;
      else if (field === 'data') data.push(value);
      else if (field === 'id') id = value;
      else if (field === 'retry' && /^\d+$/.test(value)) retry = Number(value);
    }
    if (!KNOWN.has(type) || data.length === 0) continue;
    try {
      const parsed: unknown = JSON.parse(data.join('\n'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        events.push({ type: type as PlanStreamEventType, id, data: parsed as Record<string, unknown> });
      }
    } catch {
      // 壊れた知らせは読み捨てる(次の知らせ・ポーリングで追いつく)
    }
  }
  return { events, rest, retry };
}

/** fetch で即時の通知を読み、知らせごとに onEvent を呼ぶ。接続が終わると終わり方を返す。 */
export async function readPlanStream(url: string, authorization: string | null, knownRevision: number | undefined,
  onEvent: (event: PlanStreamEvent) => void, signal?: AbortSignal): Promise<PlanStreamEnd> {
  if (typeof fetch !== 'function' || typeof TextDecoder === 'undefined') return 'unsupported';
  const headers: Record<string, string> = { Accept: 'text/event-stream' };
  if (authorization) headers.Authorization = authorization;
  if (knownRevision !== undefined) headers['Last-Event-ID'] = String(knownRevision);
  let response: Response;
  try {
    response = await fetch(url, { headers, credentials: 'include', cache: 'no-store', signal });
  } catch {
    return signal?.aborted ? 'aborted' : 'failed';
  }
  if (response.status === 401) return 'unauthorized';
  if (!response.ok) return 'refused';
  const body = response.body;
  if (!body || typeof body.getReader !== 'function') return 'unsupported';
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSse(buffer);
      buffer = parsed.rest;
      for (const ev of parsed.events) onEvent(ev);
    }
  } catch {
    return signal?.aborted ? 'aborted' : 'failed';
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // 読み終わった後は何もしない
    }
  }
  return 'closed';
}
