/**
 * オフラインパックの鍵(B-008 / FR-032・FR-048)APIの型
 *
 * [Gate K1] backend/app/api/v1/offline_pack.py に対応する。鍵は利用者ごと・版ごとに backend が導出して配る
 * (AES-256。base64url・パディングなしの43文字)。失効すると版が上がり、以前の鍵は二度と配られない。
 */
export interface OfflinePackKey {
  user_id: string;
  key_version: number;
  /** base64url(パディングなし)。32バイト */
  key: string;
  algorithm: 'AES-256-GCM';
  key_bits: 256;
  issued_at: string;
}

export interface OfflinePackKeyRotated extends OfflinePackKey {
  previous_version: number;
}
