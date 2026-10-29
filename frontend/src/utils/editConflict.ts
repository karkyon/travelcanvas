/**
 * [Gate C1] FR-020「楽観ロック・フィールド競合・削除競合を検出し、最後の書込で黙って上書きしない」。
 *
 * 予定の編集を始めた時の内容(original)・自分の入力(mine)・保存に失敗(409)した後に読み直した最新の内容(latest)を比べ、
 * 項目ごとに「相手が変えた」「自分が変えた」「両方が変えた」を出す。重ねて保存する時は、自分が変えた項目だけを
 * 最新の内容に重ねる(相手が変えた項目は残す。両方が変えた項目は、画面で両方の値を見せたうえで自分の値にする)。
 */
export interface EditFields {
  title: string;
  start_time: string;
  location_name: string;
  notes: string;
}

export const FIELD_LABEL: Record<keyof EditFields, string> = {
  title: 'タイトル', start_time: '開始時刻', location_name: '場所', notes: 'メモ',
};

const KEYS = Object.keys(FIELD_LABEL) as (keyof EditFields)[];

export interface EditConflict {
  /** 相手が予定を消した */
  deleted: boolean;
  /** [G11-Conflict] 競合したが最新を読み直せなかった(latest は null。どの項目が変わったかは分からない) */
  unread?: boolean;
  theirs: (keyof EditFields)[];
  mine: (keyof EditFields)[];
  both: (keyof EditFields)[];
  latest: EditFields | null;
}

const norm = (v: string | undefined | null) => (v ?? '').trim();

export function detectConflict(original: EditFields, mine: EditFields, latest: EditFields | null): EditConflict {
  if (!latest) return { deleted: true, theirs: [], mine: [], both: [], latest: null };
  const theirs = KEYS.filter((k) => norm(latest[k]) !== norm(original[k]));
  const changedByMe = KEYS.filter((k) => norm(mine[k]) !== norm(original[k]));
  const both = changedByMe.filter((k) => theirs.includes(k) && norm(mine[k]) !== norm(latest[k]));
  return { deleted: false, theirs, mine: changedByMe, both, latest };
}

/** [G11-Conflict] 最新を読み直せなかった時。自分が変えた項目だけ分かる(相手の変更・削除は分からない) */
export function unreadConflict(original: EditFields, mine: EditFields): EditConflict {
  const changedByMe = KEYS.filter((k) => norm(mine[k]) !== norm(original[k]));
  return { deleted: false, unread: true, theirs: [], mine: changedByMe, both: [], latest: null };
}

/** 最新の内容に、自分が変えた項目だけを重ねる */
export function mergeMine(original: EditFields, mine: EditFields, latest: EditFields): EditFields {
  const out = { ...latest };
  for (const k of KEYS) {
    if (norm(mine[k]) !== norm(original[k])) out[k] = mine[k];
  }
  return out;
}
