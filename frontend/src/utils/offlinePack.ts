/**
 * [Gate #36] Offline Travel Pack
 *
 * 選択したプランをIndexedDBへ暗号化して保存し、ネットワーク接続が
 * 無い/失敗した状況でも閲覧できるようにする(FR-032)。
 *
 * 暗号化について(重要な限界の明記):
 * - AES-256-GCM (Web Crypto API / SubtleCrypto) を使用する。
 *   frontend/src/utils/Storage.ts に存在した `encrypt()` は実際には
 *   btoa()によるBase64符号化に過ぎず暗号化ではなかった(調査の結果、
 *   このファイル自体がどこからもimportされていないdead codeであることも
 *   判明した)。本モジュールはそれとは独立した、実際に暗号化された実装。
 * - 鍵は「現在のアクセストークン + デバイスごとのランダムなsalt」から
 *   PBKDF2で導出し、鍵そのものはどこにも保存しない。これにより
 *   「IndexedDBのファイルだけをコピーされても復号できない」ことは保証するが、
 *   「そのブラウザ・そのセッションを操作できる攻撃者(悪意あるブラウザ拡張、
 *   実行中ページへのXSS等)」からは保護できない。これはクライアントサイド
 *   暗号化に共通する限界であり、過大な安全性を主張しない。
 * - 既定の保持期限は7日。期限切れのパックは読み込み時に自動削除する。
 */

const DB_NAME = 'travelcanvas-offline';
const DB_VERSION = 1;
const PACKS_STORE = 'packs';
const META_STORE = 'meta';
const DEVICE_SALT_KEY = 'device_salt';
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7日

export interface OfflinePackSummary {
  planId: string;
  planTitle: string;
  createdAt: number;
  expiresAt: number;
  approxSizeBytes: number;
}

interface StoredPack {
  planId: string;
  planTitle: string;
  ciphertext: ArrayBuffer;
  iv: ArrayBuffer;
  createdAt: number;
  expiresAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('このブラウザはオフライン保存(IndexedDB)に対応していません'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PACKS_STORE)) {
        db.createObjectStore(PACKS_STORE, { keyPath: 'planId' });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getDeviceSalt(db: IDBDatabase): Promise<Uint8Array> {
  const existing = await new Promise<Uint8Array | null>((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readonly');
    const req = tx.objectStore(META_STORE).get(DEVICE_SALT_KEY);
    req.onsuccess = () => resolve(req.result ? new Uint8Array(req.result.value) : null);
    req.onerror = () => reject(req.error);
  });

  if (existing) {
    return existing;
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readwrite');
    tx.objectStore(META_STORE).put({ key: DEVICE_SALT_KEY, value: Array.from(salt) });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return salt;
}

async function deriveKey(accessToken: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(accessToken),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: 100_000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * プランを暗号化してオフラインパックとして保存する。
 * accessTokenは呼び出し側(authStore/apiService)から渡す。ここでは保存しない。
 */
export async function saveOfflinePack(
  planId: string,
  planTitle: string,
  planData: unknown,
  accessToken: string,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<void> {
  const db = await openDb();
  try {
    const salt = await getDeviceSalt(db);
    const key = await deriveKey(accessToken, salt);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const plaintext = enc.encode(JSON.stringify(planData));

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      plaintext
    );

    const now = Date.now();
    const record: StoredPack = {
      planId,
      planTitle,
      ciphertext,
      iv: iv.buffer,
      createdAt: now,
      expiresAt: now + ttlMs,
    };

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(PACKS_STORE, 'readwrite');
      tx.objectStore(PACKS_STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/**
 * オフラインパックを復号して返す。期限切れの場合はnullを返し、
 * そのパック自体を削除する(呼び出し側での期限切れ判定は不要)。
 */
export async function loadOfflinePack<T = unknown>(
  planId: string,
  accessToken: string
): Promise<T | null> {
  const db = await openDb();
  try {
    const record = await new Promise<StoredPack | undefined>((resolve, reject) => {
      const tx = db.transaction(PACKS_STORE, 'readonly');
      const req = tx.objectStore(PACKS_STORE).get(planId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    if (!record) {
      return null;
    }

    if (Date.now() > record.expiresAt) {
      await deleteOfflinePack(planId);
      return null;
    }

    const salt = await getDeviceSalt(db);
    const key = await deriveKey(accessToken, salt);

    try {
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: record.iv as BufferSource },
        key,
        record.ciphertext
      );
      const dec = new TextDecoder();
      return JSON.parse(dec.decode(plaintext)) as T;
    } catch {
      // アクセストークンが変わった(別アカウントでログイン等)場合は鍵が
      // 一致せず復号に失敗する。この場合は読めないパックとして扱い、
      // 呼び出し側がオフラインデータ無しとして処理できるようnullを返す。
      return null;
    }
  } finally {
    db.close();
  }
}

export async function deleteOfflinePack(planId: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(PACKS_STORE, 'readwrite');
      tx.objectStore(PACKS_STORE).delete(planId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function isOfflinePackAvailable(planId: string): Promise<boolean> {
  const db = await openDb();
  try {
    const record = await new Promise<StoredPack | undefined>((resolve, reject) => {
      const tx = db.transaction(PACKS_STORE, 'readonly');
      const req = tx.objectStore(PACKS_STORE).get(planId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (!record) return false;
    if (Date.now() > record.expiresAt) {
      await deleteOfflinePack(planId);
      return false;
    }
    return true;
  } finally {
    db.close();
  }
}

export async function listOfflinePacks(): Promise<OfflinePackSummary[]> {
  const db = await openDb();
  try {
    const records = await new Promise<StoredPack[]>((resolve, reject) => {
      const tx = db.transaction(PACKS_STORE, 'readonly');
      const req = tx.objectStore(PACKS_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });

    const now = Date.now();
    const valid: OfflinePackSummary[] = [];
    for (const r of records) {
      if (now > r.expiresAt) {
        await deleteOfflinePack(r.planId);
        continue;
      }
      valid.push({
        planId: r.planId,
        planTitle: r.planTitle,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        approxSizeBytes: r.ciphertext.byteLength,
      });
    }
    return valid;
  } finally {
    db.close();
  }
}

export async function clearAllOfflinePacks(): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(PACKS_STORE, 'readwrite');
      tx.objectStore(PACKS_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
