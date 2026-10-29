# Gate FR059-C トレース(FR-059 正本 §13 D14: provider の停止を全ての worker で共有する)

対象: `docs/spec/FR-059_旅程相談API原価上限_利用者クラス別Quota_v5.1.md` §13 D14、ハンドオフ 2026-10-30i §3 の残り 4 の一部。
DOC-10 v5.1-r30(FR-059 の gaps から D14 を外した。状態は INTEGRATED(部分)のまま)。migration なし・API の変更なし。

以前(FR059-B): 見込みの超過・請求の照合の差で provider を止める印は process の中だけ。本番の gunicorn は複数の worker を動かすため、
止めた worker 以外は呼び続け、backend を作り直すと印が消えて戻っていた。有料の provider をつなぐ前に入れる
(正本は「初めてつなぐ Gate で足す」としていた。つなぐ Gate を鍵と接続だけに絞るため前に出した)。

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。試験: BE = `backend/tests/test_gate_fr059c_shared_suspension.py`。

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 停止の印を Redis(回数制限と同じ接続・名前空間 `{ns}:costguard:suspended`)に置き、全ての worker・運用のコマンドが同じ印を見る | IMPLEMENTED | `app/services/cost_guard.py`(`suspend_provider`・`is_suspended`・`suspended_providers`)、BE |
| 2 | Redis に届く時は Redis の印を正本にする(運用者が別の process から戻した時に、止めた worker の古い印で止め続けない) | IMPLEMENTED | BE `test_suspension_is_shared_and_resumed_from_another_process` |
| 3 | Redis を使わない設定(試験・CI の backend ジョブ)・届かない時は、その process の印で止める(止めた印を忘れない向き) | IMPLEMENTED | BE `test_memory_backend_suspends_in_process`・`test_suspension_while_redis_is_down_is_kept_and_sent_later` |
| 4 | 届かない間に付けた印は、次に届いた時に Redis へ送る(先に付いている理由は上書きしない)。届かなかったことを `/metrics` に出す | IMPLEMENTED | `_unsynced`・`hsetnx`、`provider_suspension_unshared`、BE |
| 5 | 止まっている間は予約を拒む(503 `provider_suspended`。有料の provider へ送らない) | IMPLEMENTED | `reserve`、BE `test_reserve_refuses_while_suspended` |
| 6 | 運用者の確認・再開: `tcops.py security provider-status` / `provider-resume --provider … --yes --reason …`(理由が必須・Redis に届かない時は全 worker に伝えられないため戻さない)。監査 `provider_usage_resumed` | IMPLEMENTED | `backend/scripts/security_incident.py`、BE `test_ops_command_requires_confirmation_and_reason`、Runbook の FR-059 |
| 7 | 管理の画面の旅行の利用(`admin_plan_usage`)の止まっている provider は共有の印から出す | IMPLEMENTED | `suspended_providers()` |
| 8 | 無料の provider の使用の記録(正本 §13 D11) | NOT STARTED | 正本どおり各 provider の Gate で足す(FR-059 の gaps) |
| 9 | 有料の provider の接続・staging での請求の照合・上限の画面の E2E | NOT STARTED | 鍵・契約・外部送信・課金の利用者の判断が先(FR-059 の gaps) |

## 検証(サンドボックス。CI・omega-dev2 とは別)

| 検査 | 結果(2026-10-30) |
|---|---|
| 全検証(`verify.sh` 17 項目) | **失敗 0**。backend 1,304 合格・2 飛ばし(この Gate の試験 6 件は Redis を使う 3 件を含めて合格。CI の backend ジョブには Redis が無いため、Redis を使う 3 件は CI では飛ばされる)、vitest 917 合格・標準エラー 0 行 |
| E2E(全件・Redis と DB を空にして) | **91 合格・失敗 0・再試行 0**(画面・API の変更は無いが、予約の経路が Redis を読むため流した) |
