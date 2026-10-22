# Gate C1 トレース(FR-020 共同編集・FR-023 秘匿プロフィール)

基準: main `1fa667e`(Gate L5)。migration `a9d4e7c2f8b3`。設計は `docs/adr/ADR-collaboration.md`。
B = backend `tests/test_gate_c1_collaboration.py`、U = vitest、E = `frontend/e2e/collaboration.spec.ts`。

## FR-020 共同編集

| # | 要件(DOC-02) | 状態 | 証拠 |
|---|---|---|---|
| 1 | 準リアルタイムで編集する | IMPLEMENTED | `POST /plans/{id}/presence`(5秒/15秒)。B `test_presence_viewers_editing_and_changes`、U `usePlanPresence.test`、E |
| 2 | 編集中を表示する | IMPLEMENTED | 開いている人・役割・「○○を編集中」。編集画面に「○○さんもこの予定を編集中です」。B・U `PresenceBar.test`・E |
| 3 | 版を表示する(他の人の変更) | IMPLEMENTED | 知っている版より後の変更を「誰が・どの予定を・何を」で示し、「最新を読み込む」。B・U・E |
| 4 | 楽観ロック | IMPLEMENTED | 既存の If-Match(409)。B(古い版の保存は 409、相手の値が残る) |
| 5 | フィールド競合を検出し、黙って上書きしない | IMPLEMENTED | 入力を残して項目ごとに「ほかの人の値」を示し、自分が変えた項目だけを重ねて保存。U `editConflict.test`・`PlannerPage.collab.test`、E |
| 6 | 削除競合を検出する | IMPLEMENTED | 相手が消した予定は「保存する前にほかの人が削除しました」。U `PlannerPage.collab.test` |
| 7 | 参加者だけ・名前にメールを出さない・外れた人は数えない | IMPLEMENTED | B `test_presence_access_and_hygiene`(403・422・TTL・外れた人・消えた予定) |
| 8 | Redis で全プロセス共有・届かない時はプロセス内 | IMPLEMENTED | B `test_presence_in_redis_is_shared_and_expires`(Redis に届く環境だけ) |
| 9 | カーソルの表示・即時の配信(WebSocket) | NOT STARTED | ADR §1(問い合わせを選んだ理由) ※ **SUPERSEDED BY Gate G2(Server-Sent Events の即時の通知 `GET /plans/{id}/events/stream`。gate-g2-trace.md #G2-20)** |

→ INTEGRATED(部分、E2E有)。

既存の不具合の修正: 予定の編集画面の「場所」「メモ」が保存の通信に載らず黙って捨てられていた(address・description に保存)。
「終了時刻」「費用」は予定の項目に無いため画面から外した(費用は「予算・費用」)。押しても何も起きない名前の無い「経路」ボタンを
外した。地図の移動概算の注記の文字のコントラストを上げた(axe)。

## FR-023 秘匿プロフィール・制約

| # | 要件(DOC-02) | 状態 | 証拠 |
|---|---|---|---|
| 1 | 予算・健康・宗教・食事・体力等を本人限定で保存 | IMPLEMENTED | 7種類(時刻・移動・食事の間隔・予算・避けたいこと・移動手段)。B `test_profile_items_are_checked`、U `privateProfile.test`・`PrivateProfileSection.test`、E |
| 2 | 他の参加者には満たす/満たさないのみ | IMPLEMENTED | 旅行に適用 → 本人の秘匿制約。他の参加者の制約の画面は伏せた形、検証は「秘匿制約を満たしていません」だけ。B `test_profile_applied_to_trip_is_private_and_drives_feasibility`、E |
| 3 | 運用管理者にも平文を常時見せない | IMPLEMENTED | 暗号文1つだけ(平文の列なし)、他人の分を読む API なし、監査は件数だけ。B `test_private_profile_is_encrypted_and_versioned` |
| 4 | 変更の競合 | IMPLEMENTED | If-Match(プロフィールの版)。B |
| 5 | プロフィールの変更が適用中の旅行に反映 | IMPLEMENTED | 項目の ID で対応付けて作り直す。B |
| 6 | 書き出し・削除 | IMPLEMENTED | アカウントの書き出しに本人の項目、旅行の書き出しに本人の適用、アカウントの削除で全部消える。B `test_profile_export_and_account_deletion` |

→ INTEGRATED(E2E有)。V1 の台帳で VERIFIED(`docs/trace/v1-verification-ledger.json`)。
