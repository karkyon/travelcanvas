/**
 * [Gate #36] Offline Travel Pack / [Gate K1] 鍵の方式を変更(B-008、docs/adr/ADR-offline-keys.md)
 *
 * 選択したプランを IndexedDB へ暗号化して保存し、通信できない時にも閲覧できるようにする(FR-032/048)。
 *
 * - 暗号は AES-256-GCM(Web Crypto)。鍵は backend が利用者ごと・版ごとに配るもの(offlineVault.ts)。
 *   以前はその時のアクセストークンから PBKDF2 で鍵を作っていたため、トークンの更新・再ログインで読めなくなった。
 * - 暗号文には利用者 ID と鍵の版が付き、別の利用者・失効した版では開かない。失効した版のパックは端末から消す。
 * - 以前の形式(トークンから作った鍵)のパックは、今のトークンで読めれば新しい形式で保存し直し、読めなければ消す。
 * - 既定の保持期限は7日。期限切れのパックは読み込み時に消す。
 *
 * 限界: 同じブラウザで動くスクリプト(XSS・悪意ある拡張)からは守れない。過大な安全性は主張しない。
 */
import {
  PACKS_STORE, META_STORE, type OfflineSession, type SealedFields,
  clearSnapshots, idbClear, idbDelete, idbGet, idbGetAll, idbPut, isSealed, obtainOfflineKey, seal, unseal,
} from './offlineVault';

const DEVICE_SALT_KEY = 'device_salt';
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7日

export interface OfflinePackSummary {
  planId: string;
  planTitle: string;
  createdAt: number;
  expiresAt: number;
  approxSizeBytes: number;
}

/** 呼び出し側(planStore 等)が渡す「今のログイン」。legacyToken は旧形式の読み替えにだけ使う */
export interface OfflinePackSession extends OfflineSession {
  legacyToken?: string | null;
}

type StoredPack = SealedFields & {
  planId: string;
  planTitle: string;
  createdAt: number;
  expiresAt: number;
};

/** Gate #36 の旧形式(format なし。鍵はトークン+端末の salt から PBKDF2) */
type LegacyPack = {
  planId: string;
  planTitle: string;
  ciphertext: ArrayBuffer;
  iv: ArrayBuffer;
  createdAt: number;
  expiresAt: number;
};

async function legacyDecrypt(record: LegacyPack, token: string): Promise<unknown | null> {
  try {
    const saltEntry = await idbGet<{ value: number[] }>(META_STORE, DEVICE_SALT_KEY);
    if (!saltEntry) return null;
    const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(token), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: new Uint8Array(saltEntry.value) as BufferSource, iterations: 100_000, hash: 'SHA-256' },
      baseKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
    );
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: record.iv as BufferSource }, key, record.ciphertext);
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    return null;
  }
}

/**
 * プランを暗号化してオフラインパックとして保存する。鍵が得られない(未ログイン・通信できず端末にも鍵が無い)なら失敗する。
 */
export async function saveOfflinePack(
  planId: string,
  planTitle: string,
  planData: unknown,
  session: OfflinePackSession | null,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<void> {
  const key = await obtainOfflineKey(session);
  if (!key) throw new Error('オフライン保存の鍵を取得できませんでした(ログインと通信を確認してください)');
  const sealed = await seal(key, planData);
  const now = Date.now();
  const record: StoredPack = { planId, planTitle, createdAt: now, expiresAt: now + ttlMs, ...sealed };
  await idbPut(PACKS_STORE, record);
}

/**
 * オフラインパックを復号して返す。期限切れ・失効した版・読めない旧形式は消して null を返す。
 * 別の利用者のパックは消さずに null を返す(その利用者がログインすれば読める)。
 */
export async function loadOfflinePack<T = unknown>(planId: string, session: OfflinePackSession | null): Promise<T | null> {
  const record = await idbGet<StoredPack | LegacyPack>(PACKS_STORE, planId);
  if (!record) return null;
  if (Date.now() > record.expiresAt) {
    await deleteOfflinePack(planId);
    return null;
  }
  if (!session) return null;

  if (!isSealed(record)) {
    // 旧形式: 今のトークンで読めれば新しい形式で保存し直す。読めなければ消す(二度と読めないため)
    const legacy = session.legacyToken ? await legacyDecrypt(record as LegacyPack, session.legacyToken) : null;
    if (legacy === null) {
      await deleteOfflinePack(planId);
      return null;
    }
    try {
      await saveOfflinePack(planId, record.planTitle, legacy, session, Math.max(record.expiresAt - Date.now(), 1));
    } catch {
      // 鍵が得られない間は旧形式のまま残す(表示はできる)
    }
    return legacy as T;
  }

  if (record.userId !== session.userId) return null;
  const key = await obtainOfflineKey(session);
  if (!key) return null;
  if (record.keyVersion < key.version || record.deviceId !== key.deviceId) {
    await deleteOfflinePack(planId); // 失効した版・別の鍵(端末の鍵に替わる前の物)
    return null;
  }
  return unseal<T>(record, key);
}

export async function deleteOfflinePack(planId: string): Promise<void> {
  await idbDelete(PACKS_STORE, planId);
}

export async function isOfflinePackAvailable(planId: string): Promise<boolean> {
  const record = await idbGet<StoredPack | LegacyPack>(PACKS_STORE, planId);
  if (!record) return false;
  if (Date.now() > record.expiresAt) {
    await deleteOfflinePack(planId);
    return false;
  }
  return true;
}

/** 保存済みのパック。userId を渡すとその利用者のもの(と旧形式)だけ */
export async function listOfflinePacks(userId?: string): Promise<OfflinePackSummary[]> {
  const records = await idbGetAll<StoredPack | LegacyPack>(PACKS_STORE);
  const now = Date.now();
  const valid: OfflinePackSummary[] = [];
  for (const r of records) {
    if (now > r.expiresAt) {
      await deleteOfflinePack(r.planId);
      continue;
    }
    if (userId && isSealed(r) && r.userId !== userId) continue;
    valid.push({
      planId: r.planId,
      planTitle: r.planTitle,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      approxSizeBytes: r.ciphertext.byteLength,
    });
  }
  return valid;
}

/** この端末のオフラインデータ(パックと当日画面の保存)を全て消す */
export async function clearAllOfflinePacks(): Promise<void> {
  await idbClear(PACKS_STORE);
  await clearSnapshots();
}
