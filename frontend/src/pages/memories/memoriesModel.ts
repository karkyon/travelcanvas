/**
 * [Gate P12] 旅の記録(FR-037)の表示用の整形。
 *
 * - 記録を日・予定ごとに並べる(どの日にも紐付かない記録・消えた予定の記録は「そのほか」)
 * - 写真・音声のファイル選択の事前確認(サーバーでも同じ検証をする。画面では送る前に分かることだけ)
 * - 旅行記の下書きの保存用ファイル名
 */
import type { MemoryKind, NormalizedDay, TravelMemory } from '@/services/api';

export const KIND_LABEL: Record<MemoryKind, string> = {
  note: 'メモ', photo: '写真', audio: '音声メモ', video: '動画',
};

export const VISIBILITY_LABEL = { private: '自分だけ', members: 'メンバー' } as const;

export const PHOTO_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
export const AUDIO_EXTENSIONS = ['.mp3', '.m4a', '.wav', '.ogg', '.webm'];

export interface MemoryGroup {
  key: string;
  label: string;
  memories: TravelMemory[];
}

export function groupMemories(memories: TravelMemory[], days: NormalizedDay[]): MemoryGroup[] {
  const sortedDays = [...days].sort((a, b) => a.local_date.localeCompare(b.local_date) || a.sort_order - b.sort_order);
  const eventTitle = new Map<string, string>();
  const dayIds = new Set(sortedDays.map((d) => d.id));
  for (const d of sortedDays) for (const e of d.events ?? []) eventTitle.set(e.id, e.title);
  const groups: MemoryGroup[] = sortedDays.map((d) => ({
    key: d.id, label: `${d.local_date}${d.title ? ` ${d.title}` : ''}`, memories: [],
  }));
  const byDay = new Map(groups.map((g) => [g.key, g]));
  const other: MemoryGroup = { key: 'other', label: 'そのほかの記録', memories: [] };
  for (const m of memories) {
    const linkedEventExists = !m.event_id || eventTitle.has(m.event_id);
    const g = m.day_id && dayIds.has(m.day_id) && linkedEventExists ? byDay.get(m.day_id) : undefined;
    (g ?? other).memories.push(m);
  }
  return [...groups.filter((g) => g.memories.length > 0), ...(other.memories.length ? [other] : [])];
}

export function eventLabel(m: TravelMemory, days: NormalizedDay[]): string | null {
  if (!m.event_id) return null;
  for (const d of days) {
    const e = (d.events ?? []).find((x) => x.id === m.event_id);
    if (e) return e.title;
  }
  return '(削除された予定)';
}

/** 送る前に分かる問題(形式・大きさ・空)。問題が無ければ null */
export function fileProblem(kind: 'photo' | 'audio', file: File, maxBytes: number): string | null {
  const name = file.name.toLowerCase();
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  const allowed = kind === 'photo' ? PHOTO_EXTENSIONS : AUDIO_EXTENSIONS;
  if (!allowed.includes(ext)) {
    return `${KIND_LABEL[kind]}の形式に対応していません(対応: ${allowed.join(', ')})`;
  }
  if (file.size === 0) return 'ファイルが空です';
  if (file.size > maxBytes) return `ファイルが大きすぎます(上限 ${Math.floor(maxBytes / (1024 * 1024))}MB)`;
  return null;
}

/** 動画は https のURLだけ(サーバーでも検証する) */
export function videoUrlProblem(url: string): string | null {
  const v = url.trim();
  if (!v) return '動画のURLを入力してください';
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:') return '動画のURLは https:// から始まるURLにしてください';
    if (u.username || u.password) return 'ユーザー名やパスワードを含むURLは登録できません';
  } catch {
    return '動画のURLの形式が正しくありません';
  }
  return null;
}

export function journalFileName(title: string, generatedAt: string | null): string {
  const date = (generatedAt ?? '').slice(0, 10).replace(/-/g, '') || 'draft';
  const safe = title.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40) || '旅行記';
  return `${safe}_旅行記_${date}.md`;
}

export function formatSize(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
