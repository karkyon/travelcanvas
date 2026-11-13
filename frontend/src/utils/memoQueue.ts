/**
 * [Gate Remaining-1] 通信できない時の写真・声・ひとことの送信待ち(旅の当日の「この場所に残す」)。
 *
 * - 端末の暗号化した保存(offlineVault の snapshots。鍵は利用者・端末ごと)に置く。平文では置かない
 * - つながった時(当日の画面の取得が通った時)に、置いた順に送る。送れた物から消す。通信できない失敗で止め、次に回す
 * - サーバーが断った物(権限・大きすぎる等)は送り直しても通らないため、捨てて数を返す(画面で知らせる)
 * - 上限: 20 件・1 件 15MB・合計 60MB(端末の保存の容量を使い切らない)
 */
import { addMedia, addNote } from '@/services/api/travelDay';
import { loadSnapshot, saveSnapshot } from './offlineVault';
import { isNetworkError } from './syncQueue';
import type { OfflineSession } from './offlineVault';

export const MEMO_QUEUE_MAX = 20;
export const MEMO_FILE_MAX = 15 * 1024 * 1024;
export const MEMO_TOTAL_MAX = 60 * 1024 * 1024;

export interface QueuedMemo {
  id: string;
  kind: 'note' | 'photo' | 'audio';
  eventId: string;
  dayId: string | null;
  body: string | null;
  visibility: 'private' | 'members';
  placeName: string | null;
  includeInJournal: boolean;
  /** 写真・声の中身(base64)・名前・種類 */
  file: { name: string; type: string; data: string; size: number } | null;
  createdAt: number;
}

const name = (planId: string) => `memo-queue:${planId}`;

function readBytes(file: Blob): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(file);
  });
}

async function toBase64(file: Blob): Promise<string> {
  const buf = new Uint8Array(await readBytes(file));
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(f: NonNullable<QueuedMemo['file']>): File {
  const bin = atob(f.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], f.name, { type: f.type });
}

export async function loadMemoQueue(session: OfflineSession | null, planId: string): Promise<QueuedMemo[]> {
  const got = await loadSnapshot<QueuedMemo[]>(session, name(planId));
  return Array.isArray(got?.data) ? got!.data : [];
}

export type QueueResult = { ok: true; count: number } | { ok: false; reason: 'full' | 'too_large' | 'no_key' };

/** 置く。置けたら待ちの数を返す */
export async function queueMemo(session: OfflineSession | null, planId: string,
  item: Omit<QueuedMemo, 'id' | 'createdAt' | 'file'> & { file?: File | null }): Promise<QueueResult> {
  const cur = await loadMemoQueue(session, planId);
  if (cur.length >= MEMO_QUEUE_MAX) return { ok: false, reason: 'full' };
  let file: QueuedMemo['file'] = null;
  if (item.file) {
    if (item.file.size > MEMO_FILE_MAX) return { ok: false, reason: 'too_large' };
    const total = cur.reduce((n, x) => n + (x.file?.size ?? 0), 0);
    if (total + item.file.size > MEMO_TOTAL_MAX) return { ok: false, reason: 'full' };
    file = { name: item.file.name || 'memo', type: item.file.type || 'application/octet-stream', data: await toBase64(item.file),
      size: item.file.size };
  }
  const { file: _f, ...rest } = item;
  void _f;
  const next = [...cur, { ...rest, file, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, createdAt: Date.now() }];
  if (!(await saveSnapshot(session, name(planId), next))) return { ok: false, reason: 'no_key' };
  return { ok: true, count: next.length };
}

/** 送る。{送れた数, 断られて捨てた数, 残りの数} */
export async function flushMemoQueue(session: OfflineSession | null, planId: string): Promise<{ sent: number; dropped: number; left: number }> {
  const cur = await loadMemoQueue(session, planId);
  if (cur.length === 0) return { sent: 0, dropped: 0, left: 0 };
  let sent = 0;
  let dropped = 0;
  const rest: QueuedMemo[] = [];
  let stopped = false;
  for (const m of cur) {
    if (stopped) { rest.push(m); continue; }
    try {
      if (m.kind === 'note') {
        await addNote(planId, { event_id: m.eventId, day_id: m.dayId, body: m.body ?? '', visibility: m.visibility,
          place_name: m.placeName, include_in_journal: m.includeInJournal, occurred_at: new Date(m.createdAt).toISOString() });
      } else if (m.file) {
        await addMedia(planId, { kind: m.kind, file: fromBase64(m.file), event_id: m.eventId, day_id: m.dayId, body: m.body,
          visibility: m.visibility, place_name: m.placeName, include_in_journal: m.includeInJournal,
          occurred_at: new Date(m.createdAt).toISOString() });
      }
      sent += 1;
    } catch (e) {
      if (isNetworkError(e)) { stopped = true; rest.push(m); } else dropped += 1;
    }
  }
  await saveSnapshot(session, name(planId), rest);
  return { sent, dropped, left: rest.length };
}
