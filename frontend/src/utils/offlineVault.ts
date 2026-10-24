/**
 * [Gate K1] B-008 端末内の暗号化保存(オフラインパック・当日画面)と、その鍵(docs/adr/ADR-offline-keys.md)。
 *
 * 以前はその時のアクセストークンから PBKDF2 で鍵を作っていたため、トークンの更新・再ログインで保存したパックが
 * 読めず、失効の手段も無かった。当日画面の保存は localStorage に平文だった。ここでは次のようにする。
 *
 * - 鍵は backend が利用者ごと・版ごとに導出して配る(GET /offline-pack/key)。同じ版なら再ログインしても同じ鍵。
 * - 受け取った鍵は「取り出せない」CryptoKey(non-extractable)として IndexedDB に置き、通信できない時はそれで開く。
 * - ログアウトで端末内の鍵を消す(次にログインして鍵を受け取るまで、保存したデータは開けない)。
 * - 失効(版を上げる)すると、次に鍵を受け取った時に、それより古い版で暗号化したデータを端末から消す。
 * - 暗号文には利用者 ID と鍵の版を付け(AES-GCM の追加認証データにも入れる)、別の利用者・失効した版では開かない。
 *
 * - [Gate G6] OFF-01 鍵は端末ごと(device_id。syncQueue.deviceId)。設定から1台だけを失効でき、失効した端末は次に通信した時に
 *   410 を受け取り、その利用者の保存したデータと鍵を消す(他の端末はそのまま)。鍵には期限(既定30日)があり、
 *   期限を過ぎた端末の鍵は、通信して受け取り直すまで使わない。端末の鍵で暗号化した物には端末の ID も付ける。
 *   端末の ID は IndexedDB(meta の device_id)にも置く。ログアウトや localStorage の消去の後も同じ端末として鍵を受け取り直し、
 *   保存したデータを開ける(以前の利用者ごとの鍵と同じ振る舞い)。失効した端末は ID を作り直す(次は新しい端末として登録する)。
 *
 * 限界: 同じブラウザで動くスクリプト(XSS・悪意ある拡張)は鍵を「使う」ことができる。ここで守れるのは、
 * IndexedDB のファイルのコピー・ログアウト後の端末・失効後の端末から読まれることまで。
 */
import { getOfflinePackKey } from '@/services/api';
import { deviceId } from './syncQueue';

export const OFFLINE_DB_NAME = 'travelcanvas-offline';
const DB_VERSION = 2;
export const PACKS_STORE = 'packs';
export const META_STORE = 'meta';
export const SNAPSHOTS_STORE = 'snapshots';
const KEY_PREFIX = 'offline-key:';
const MEMO_TTL_MS = 10 * 60 * 1000;
export const SEALED_FORMAT = 2;

export interface OfflineSession {
  userId: string;
  /** 同じログインの間だけ同じになる値(鍵のメモを使い回してよいかの判定にだけ使う。保存しない) */
  sessionTag: string;
}

export interface OfflineKey {
  userId: string;
  version: number;
  key: CryptoKey;
  /** [Gate G6] 端末の鍵の時だけ */
  deviceId?: string;
}

export interface SealedFields {
  format: typeof SEALED_FORMAT;
  userId: string;
  keyVersion: number;
  /** [Gate G6] 端末の鍵で暗号化した時の端末の ID(追加認証データにも入れる) */
  deviceId?: string;
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
}

type StoredKey = {
  key: string; userId: string; version: number; cryptoKey: CryptoKey; savedAt: number; deviceId?: string; expiresAt?: number;
};

let memo: (OfflineKey & { sessionTag: string; at: number }) | null = null;

const DEVICE_RECORD = 'device_id';
const DEVICE_STORAGE_KEY = 'tc_device_id';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const newUuid = (): string => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : deviceId());

function rememberInLocalStorage(id: string): void {
  try {
    localStorage.setItem(DEVICE_STORAGE_KEY, id);
  } catch {
    // 使えない環境では IndexedDB の値だけを使う
  }
}

/**
 * [Gate G6] この端末の ID(オフラインの鍵・同期の操作で使う)。IndexedDB の値を正とし、localStorage(同期の操作の ID)にも写す。
 * どちらにも無ければ作る。UUID の形でない値(localStorage が使えない時の仮の値)は使わない。
 */
export async function offlineDeviceId(): Promise<string> {
  try {
    const rec = await idbGet<{ key: string; value?: unknown }>(META_STORE, DEVICE_RECORD);
    if (rec && typeof rec.value === 'string' && UUID_RE.test(rec.value)) {
      rememberInLocalStorage(rec.value);
      return rec.value;
    }
  } catch {
    // IndexedDB が使えない: localStorage の値を使う
  }
  const fromStorage = deviceId();
  const id = UUID_RE.test(fromStorage) ? fromStorage : newUuid();
  rememberInLocalStorage(id);
  try {
    await idbPut(META_STORE, { key: DEVICE_RECORD, value: id });
  } catch {
    // 置けない環境では次も localStorage の値を使う
  }
  return id;
}

/** [Gate G6] 端末の ID を作り直す(この端末を失効した後。次に鍵を受け取る時は新しい端末として登録する) */
export async function resetOfflineDeviceId(): Promise<void> {
  try {
    localStorage.removeItem(DEVICE_STORAGE_KEY);
  } catch {
    // 何もしない
  }
  try {
    await idbDelete(META_STORE, DEVICE_RECORD);
  } catch {
    // 何もしない
  }
}

export function openOfflineDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('このブラウザはオフライン保存(IndexedDB)に対応していません'));
      return;
    }
    const request = indexedDB.open(OFFLINE_DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PACKS_STORE)) db.createObjectStore(PACKS_STORE, { keyPath: 'planId' });
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(SNAPSHOTS_STORE)) db.createObjectStore(SNAPSHOTS_STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest | void,
): Promise<T | undefined> {
  const db = await openOfflineDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = run(tx.objectStore(store));
      let result: T | undefined;
      if (req) req.onsuccess = () => { result = req.result as T; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export const idbGet = <T>(store: string, key: IDBValidKey) => withStore<T>(store, 'readonly', (s) => s.get(key));
export const idbGetAll = async <T>(store: string) => (await withStore<T[]>(store, 'readonly', (s) => s.getAll())) ?? [];
export const idbPut = (store: string, value: unknown) => withStore<void>(store, 'readwrite', (s) => { s.put(value); });
export const idbDelete = (store: string, key: IDBValidKey) => withStore<void>(store, 'readwrite', (s) => { s.delete(key); });
export const idbClear = (store: string) => withStore<void>(store, 'readwrite', (s) => { s.clear(); });

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** base64url(パディングなし可)をバイト列にする。atob は環境(jsdom 等)で挙動が違うため使わない */
export function base64UrlToBytes(value: string): Uint8Array {
  const clean = value.replace(/=+$/, '');
  if (!/^[A-Za-z0-9_-]*$/.test(clean) || clean.length % 4 === 1) throw new Error('base64url として読めません');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const ch of clean) {
    buffer = (buffer << 6) | B64URL.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index] = (buffer >> bits) & 0xff;
      index += 1;
    }
  }
  return out;
}

const isNetworkFailure = (error: unknown) => {
  const e = error as { response?: unknown; code?: string; message?: string } | null;
  return !!e && !e.response;
};
const statusOf = (error: unknown) => (error as { response?: { status?: number } } | null)?.response?.status;

async function storedKeyFor(userId: string): Promise<OfflineKey | null> {
  try {
    const stored = await idbGet<StoredKey>(META_STORE, KEY_PREFIX + userId);
    if (!stored || (stored.expiresAt && Date.now() > stored.expiresAt)) return null; // 期限切れの鍵は使わない
    return { userId: stored.userId, version: stored.version, key: stored.cryptoKey, deviceId: stored.deviceId };
  } catch {
    return null;
  }
}

/**
 * 利用者の鍵を得る。通信できれば backend から受け取り(端末にも置く)、できなければ端末に置いた鍵を使う。
 * 同じログインの間は10分まで使い回す。鍵が得られない(未ログイン・無効化・ログアウト後で通信できない)なら null。
 */
export async function obtainOfflineKey(session: OfflineSession | null, options: { refresh?: boolean } = {}): Promise<OfflineKey | null> {
  if (!session) return null;
  if (!options.refresh && memo && memo.userId === session.userId && memo.sessionTag === session.sessionTag
      && Date.now() - memo.at < MEMO_TTL_MS) {
    return { userId: memo.userId, version: memo.version, key: memo.key, deviceId: memo.deviceId };
  }
  try {
    const issued = await getOfflinePackKey(await offlineDeviceId());
    if (issued.user_id !== session.userId) return null; // 別の利用者の鍵は使わない
    const cryptoKey = await crypto.subtle.importKey(
      'raw', base64UrlToBytes(issued.key) as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'],
    );
    const result: OfflineKey = { userId: issued.user_id, version: issued.key_version, key: cryptoKey, deviceId: issued.device_id };
    try {
      const expiresAt = issued.expires_at ? Date.parse(issued.expires_at) : NaN;
      await idbPut(META_STORE, {
        key: KEY_PREFIX + result.userId, userId: result.userId, version: result.version, cryptoKey, savedAt: Date.now(),
        deviceId: result.deviceId, expiresAt: Number.isFinite(expiresAt) ? expiresAt : undefined,
      } satisfies StoredKey);
      await purgeRevoked(result.userId, result.version, result.deviceId);
    } catch {
      // 端末に置けない環境でも、この画面の間は使える
    }
    memo = { ...result, sessionTag: session.sessionTag, at: Date.now() };
    return result;
  } catch (error) {
    const status = statusOf(error);
    if (status === 410) {
      // [Gate G6] この端末は失効した: この利用者の保存したデータと鍵を消す(他の端末は影響を受けない)
      await forgetKeyFor(session.userId);
      await purgeRevoked(session.userId, Number.MAX_SAFE_INTEGER);
      await resetOfflineDeviceId();
      return null;
    }
    if (status === 404 || status === 401) {
      // 無効化された利用者・ログインが切れた: 端末の鍵も使わない
      await forgetKeyFor(session.userId);
      return null;
    }
    if (isNetworkFailure(error) || status === 503 || status === 429 || (status !== undefined && status >= 500)) {
      return storedKeyFor(session.userId);
    }
    return null;
  }
}

async function forgetKeyFor(userId: string): Promise<void> {
  if (memo?.userId === userId) memo = null;
  try {
    await idbDelete(META_STORE, KEY_PREFIX + userId);
  } catch {
    // 消せない環境では何もしない
  }
}

/** ログアウト時: 端末内の鍵を全て消す(保存したデータは次に鍵を受け取るまで開けない) */
export async function forgetOfflineKeys(): Promise<void> {
  memo = null;
  try {
    const all = await idbGetAll<{ key: string }>(META_STORE);
    for (const entry of all) {
      if (typeof entry.key === 'string' && entry.key.startsWith(KEY_PREFIX)) await idbDelete(META_STORE, entry.key);
    }
  } catch {
    // IndexedDB が使えない環境では鍵も置かれていない
  }
}

/** 試験用: メモだけを消す(端末に置いた鍵は残す。ページの再読込に相当) */
export function resetOfflineKeyMemoForTesting(): void {
  memo = null;
}

const aad = (userId: string, version: number, device?: string) =>
  new TextEncoder().encode(`travelcanvas/offline/v2|${userId}|${version}${device ? `|${device}` : ''}`);

export async function seal(key: OfflineKey, data: unknown): Promise<SealedFields> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, additionalData: aad(key.userId, key.version, key.deviceId) as BufferSource },
    key.key, plaintext,
  );
  return {
    format: SEALED_FORMAT, userId: key.userId, keyVersion: key.version, deviceId: key.deviceId, iv: iv.buffer as ArrayBuffer,
    ciphertext,
  };
}

export function isSealed(value: unknown): value is SealedFields {
  const v = value as Partial<SealedFields> | null;
  return !!v && v.format === SEALED_FORMAT && typeof v.userId === 'string' && typeof v.keyVersion === 'number';
}

/** 別の利用者・別の版のものは開かない(null)。改ざん・鍵違いも null */
export async function unseal<T>(record: SealedFields, key: OfflineKey): Promise<T | null> {
  if (!isSealed(record) || record.userId !== key.userId || record.keyVersion !== key.version
      || record.deviceId !== key.deviceId) return null;
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: record.iv as BufferSource,
        additionalData: aad(record.userId, record.keyVersion, record.deviceId) as BufferSource },
      key.key, record.ciphertext,
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  } catch {
    return null;
  }
}

/** 失効した版(今の版より古い)・別の鍵(端末の鍵に替わる前の利用者の鍵)で暗号化した、この利用者のデータを端末から消す */
export async function purgeRevoked(userId: string, currentVersion: number, currentDevice?: string): Promise<number> {
  let removed = 0;
  for (const store of [PACKS_STORE, SNAPSHOTS_STORE]) {
    const records = await idbGetAll<SealedFields & { planId?: string; key?: string }>(store);
    for (const r of records) {
      if (isSealed(r) && r.userId === userId
          && (r.keyVersion < currentVersion || (currentDevice !== undefined && r.deviceId !== currentDevice))) {
        await idbDelete(store, (store === PACKS_STORE ? r.planId : r.key) as IDBValidKey);
        removed += 1;
      }
    }
  }
  return removed;
}

// ===== 当日画面などの小さな保存(snapshots) =====

type StoredSnapshot = SealedFields & { key: string; savedAt: number };

export async function saveSnapshot(session: OfflineSession | null, name: string, data: unknown): Promise<boolean> {
  const key = await obtainOfflineKey(session);
  if (!key) return false;
  try {
    const sealed = await seal(key, data);
    await idbPut(SNAPSHOTS_STORE, { key: `${key.userId}:${name}`, savedAt: Date.now(), ...sealed } satisfies StoredSnapshot);
    return true;
  } catch {
    return false;
  }
}

export async function loadSnapshot<T>(session: OfflineSession | null, name: string): Promise<{ data: T; savedAt: number } | null> {
  if (!session) return null;
  try {
    const record = await idbGet<StoredSnapshot>(SNAPSHOTS_STORE, `${session.userId}:${name}`);
    if (!record) return null;
    const key = await obtainOfflineKey(session);
    if (!key) return null;
    if (record.keyVersion < key.version || record.deviceId !== key.deviceId) {
      await idbDelete(SNAPSHOTS_STORE, record.key);
      return null;
    }
    const data = await unseal<T>(record, key);
    return data === null ? null : { data, savedAt: record.savedAt };
  } catch {
    return null;
  }
}

export async function clearSnapshots(): Promise<void> {
  try {
    await idbClear(SNAPSHOTS_STORE);
  } catch {
    // 使えない環境では何も保存されていない
  }
}
