# ADR: オフラインデータの鍵(B-008、FR-032・FR-048)

- 状態: 採用(Gate K1)
- 前提: Gate E1 適用後
- 関連: DOC-02 FR-032/FR-048、DOC-11(端末内データ)、Gate #36(Offline Travel Pack)、Gate L1b(当日画面の端末保存)
- トレーサビリティ: `docs/trace/gate-k1-trace.md`

## 1. 背景

- オフラインパックの鍵を、その時のアクセストークン+端末の salt から PBKDF2 で作っていた。トークンは更新・再ログインで
  変わるため、保存したパックがすぐ読めなくなった(B-008)。
- 失効の手段が無かった(端末を無くしても、そのデータを無効にできない)。
- 当日画面の保存(L1b)は localStorage に**平文**だった(予定名・場所・時刻が端末に読める形で残った)。
- ゲストは保存できなかった(会員のトークンだけを使っていた)。

## 2. 決定

- **鍵は backend が利用者ごと・版ごとに導出して配る**(`app/services/offline_keys.py`)。
  - master = SHA-256(`OFFLINE_PACK_KEY_SECRET`)。未設定なら HMAC(SHA-256(`ENCRYPTION_KEY`), 用途ラベル)。
  - 鍵 = HMAC-SHA256(master, `travelcanvas/offline-pack/v1|<user_id>|<版>`)(32バイト、AES-256)。
  - 版 = `users.preferences["offline_pack_key"]["version"]`(既定1)。**DB に鍵は保存せず、migration も不要。**
  - 同じ利用者・同じ版なら何度でも同じ鍵になる(再ログイン・トークン更新で変わらない)。
- API(`app/api/v1/offline_pack.py`)
  - `GET /api/v1/offline-pack/key`: 今の版の鍵。ゲスト可。`Cache-Control: no-store`。1時間120回まで。秘密が無ければ503、
    無効化・存在しない利用者は404。
  - `POST /api/v1/offline-pack/key/rotate`: 版を1つ上げる(以前の鍵は二度と配られない)。If-Match に今の版が必要
    (無ければ400、違えば409)。1時間10回まで。監査 `offline_key_rotated` は版の数字だけ。
  - プロフィール更新(`PUT /auth/me`)では `offline_pack_key` を受け付けない(版を戻すと失効した鍵が復活するため)。
- 端末(`frontend/src/utils/offlineVault.ts`)
  - IndexedDB `travelcanvas-offline` を v2 に上げ、`snapshots` を追加(packs / meta / snapshots)。
  - 受け取った鍵は取り出せない CryptoKey(non-extractable)として `meta` に置き、通信できない時はそれで開く。
    同じログインの間は10分まで取得を使い回す。
  - 暗号文は `{format:2, userId, keyVersion, iv, ciphertext}`。AES-GCM の追加認証データに利用者 ID と版を入れる。
    別の利用者・別の版のものは開かない。
  - 鍵を受け取った時、それより古い版で暗号化したその利用者のデータを消す(失効の反映)。
  - **ログアウトで端末の鍵を消す**(次にログインして鍵を受け取るまで開けない)。
  - 旧形式(format なし)は、今のトークンで読めれば新形式で保存し直し、読めなければ消す。
  - 当日画面の保存も同じ方式で暗号化し、古い平文(localStorage)は消す。
  - ログイン(ゲスト開始・トークン更新を含む)したら鍵を先に受け取って端末に置く(App.tsx)。
- 設定画面に「全ての端末のオフラインデータを無効にする」(失効)を置く。

## 3. 限界(明記する)

- 同じブラウザで動くスクリプト(XSS・悪意ある拡張)は鍵を「使う」ことができる。守れるのは、IndexedDB のファイルの
  コピー、ログアウト後の端末、失効後の端末(次に通信した時に消える)まで。
- 通信しないままの端末からは、遠隔で消せない(次に鍵を受け取った時に消える)。
- `OFFLINE_PACK_KEY_SECRET`(未設定なら `ENCRYPTION_KEY`)を変えると、全員の端末のオフラインデータが読めなくなる。
  本番で使うなら `.env` に設定し、バックアップの指紋(`ops/storage_facts.KEY_NAMES`)で照合する。

## 4. 未実装(範囲外)

- サーバー側のオフラインパック(端末をまたぐ同期)、パックの差分更新
- 端末ごとの失効(今は利用者単位で全端末)
