# ADR: 暗号化の鍵の版の切り替えと鍵の一覧(Gate G1・SEC-F1/F2)

- 状態: 採用(2026-10-20)
- 関連: DOC-11 §6.3(暗号化)、`docs/ops/KEY-INVENTORY.md`、`docs/ops/RUNBOOK.md` §8.2、`backend/app/core/crypto.py`、
  `backend/app/ops/rekey.py`、`backend/app/core/key_inventory.py`

## 1. 背景

全ての暗号化(`*_ciphertext` 列 17 列以上・保存ファイル・TOTP の秘密・Webhook の鍵)は、単一の `ENCRYPTION_KEY` から
導出した Fernet の鍵1つで行っていた。鍵を替えると既存の暗号文が全て読めなくなるため、漏洩が疑われても替えられなかった
(Runbook §8.2 は「単純に替えない」としていた)。監査の実行台帳(2026-10-20)の SEC-F1 は P0。

## 2. 決定

1. **鍵の輪(keyring):** `ENCRYPTION_KEY` を今の鍵、`ENCRYPTION_KEYS_PREVIOUS`(カンマ区切り)を前の鍵とし、
   `cryptography` の `MultiFernet` で「暗号化は今の鍵、復号は全ての鍵」にする。
2. **暗号文の書式を変えない(migration なし):** どの鍵の暗号文かは、各鍵で HMAC を検証して判定する(`key_id_of`)。
   鍵の版の名前は鍵の指紋(運用の道具と同じ式の SHA-256 の先頭12桁)。版を表す列を DB に足す案は、全ての暗号化列に
   列を足す大きな migration と、書き込み経路の全ての変更が要るため採らない。判定の費用は、前の鍵が残っている間だけ
   鍵の数に比例する(普段は1つ)。
3. **掛け直し(`python -m app.ops.rekey run`、`tcops.py keys rekey`):** 公開スキーマの全ての `*_ciphertext`(bytea)列を
   主キーの順に batch で読み、前の鍵の暗号文だけを `MultiFernet.rotate` で今の鍵へ替える。
   - 更新は「読んだ時の値のままなら」だけ書く(`WHERE id = :id AND col = :old`)。利用者の同時の書き込みを上書きしない。
   - batch ごとに確定し、今の鍵の暗号文は飛ばすので、何度実行しても同じ・途中で止めても続きから。
   - どの鍵でも読めない値は変えず、「表.列」と件数だけを出す(隔離)。
   - 保存ファイルは一時ファイルへ書いて `os.replace`(途中で止まっても壊れたファイルを残さない)。権限を保つ。
4. **失効:** `ENCRYPTION_KEYS_PREVIOUS` から外した鍵は、以後どの経路でも使わない。外してよいかは
   `keys status` の `previous_keys_removable` で判断する(前の鍵の暗号文が0件、読めない物が0件)。
5. **鍵の一覧と用途の分離(SEC-F2):** `key_inventory.py` に全ての鍵の用途・切り替え方・影響を持ち、用途を越えた同じ値
   (DB のパスワードを含む)を検出する。本番は使い回し・弱い鍵・`OFFLINE_PACK_KEY_SECRET` の未設定で起動しない
   (オフラインパックの鍵が `ENCRYPTION_KEY` から導出されたままだと、暗号化の鍵の切り替えで端末のデータが読めなくなる)。
6. `LOOKUP_INDEX_KEY`(HMAC の盲索引)は版を持たない。替えたら `backfill_lookup_index --all` で全ての索引を作り直す。

## 3. 限界(次の Gate)

- 鍵そのものは `.env` にある。KMS / Secret Manager への移行(SEC-F3)は本番環境と同時。
- 利用者・旅行ごとのデータ鍵(envelope)と、鍵の破棄による削除(SEC-F5)は無い。
- 掛け直し中は前の鍵も読めるので、漏洩した鍵への対処は「切り替え → 掛け直し → 外す」を急ぐ必要がある。
- バックアップは取得時の鍵で読める。前の鍵を外した後も古いバックアップを復元するには、前の鍵を別に保管する。
