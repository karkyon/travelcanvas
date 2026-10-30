# Gate CI-Redis トレース(CI の backend ジョブで Redis を使う試験を必ず実行する)

対象: 監査 2026-10-30k §4 の 1(FR-059-C の Redis の経路が CI で実行されていない)。製品のコードの変更なし・migration なし・
FR の状態の遷移なし(DOC-10 は変えない)。GCP の関係のファイルは触らない。

以前: CI の backend ジョブには Redis が無く、Redis を使う試験(S3 回数制限の共有・C1 共同編集の知らせ・FR059-C 停止の共有)は
`skipif(Redis に届かない)` で**全て飛ばされたまま** CI は合格していた。サンドボックスでだけ合格を確かめていた。

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。試験: BE = `backend/tests/test_gate_ci_redis.py`・`test_gate_fr059c_shared_suspension.py`。

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | CI の backend ジョブに使い捨ての Redis(`redis:7-alpine`、health の確認つき)を置き、`REDIS_URL` を渡す | IMPLEMENTED | `.github/workflows/ci.yml`、BE `test_ci_backend_job_runs_redis_and_requires_it` |
| 2 | `TC_REQUIRE_REDIS=1` の時は Redis の試験を飛ばさず、Redis に届かなければ試験の収集で失敗させる。判定は共通の部品にまとめる(3つのファイルの重複を消す) | IMPLEMENTED | `backend/tests/redis_support.py`(手元で Redis を止めて `RuntimeError` を確認) |
| 3 | JUnit の結果で、必須の試験(FR059-C・S3)が実行されて合格したこと(下限 17 件)、理由に「Redis」を含む飛ばしが 0 件であることを確かめる。飛ばした試験は全て一覧に出す(job の要約にも書く) | IMPLEMENTED | `scripts/ci/check_required_tests.py`、CI の「Redis を使う試験の実行の確認 (ブロッキング)」、BE(合格・Redis の飛ばし・失敗・結果無し・下限未満) |
| 4 | 別の process(別の worker と同じ: process の中の印を持たない)で止める → この process で止まる → ここで戻す → 別の process でも戻る | IMPLEMENTED | BE `test_suspension_and_resume_cross_real_processes`(`subprocess` で実際に別の process を起こす) |
| 5 | 名前空間(環境ごとの `RATE_LIMIT_NAMESPACE`)が違えば停止の印は混ざらない | IMPLEMENTED | BE `test_namespaces_are_isolated` |
| 6 | 既にあった: 共有と別の process からの再開・Redis が届かない間の印の保持と復帰の後の送信・先の理由を上書きしない・運用のコマンド | IMPLEMENTED | `gate-fr059c-trace.md` |
| 7 | E2E のジョブの Redis(compose の Redis)は以前から使われていた | — | 変更なし |

## 検証(サンドボックス。CI とは別)

| 検査 | 結果(2026-10-30) |
|---|---|
| Redis の試験 3 ファイル | 24 合格・飛ばし 0。新しい検査で FR059-C 8・S3 9 = 17 合格、飛ばし 0 |
| Redis を止めた時 | 既定: 9 件飛ばし → 検査が「禁止の理由で飛ばした」で失敗(終了コード 1)。`TC_REQUIRE_REDIS=1`: 収集の時点で `RuntimeError` |
| 全検証(`verify.sh` 17 項目) | **失敗 0**。backend 1,309 合格・2 飛ばし(浅い履歴の DOC-10 の基準 commit の確認・毎晩の性能の検査。どちらも Redis と無関係。CI は履歴を全部取るため前者は CI では実行される)。全件の結果に新しい検査を流して FR059-C 8・S3 9 = 17 合格・Redis の理由の飛ばし 0 |
| CI | CI_RESULT |
