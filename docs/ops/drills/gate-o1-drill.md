# 復元・rollback 演習記録 drill-20261016T082516Z

> `scripts/ops/tcops.py drill` が自動生成した記録です。個人データ・接続文字列・保存ファイルの名前は含めていません。

## 結果

| 項目 | 結果 |
|---|---|
| 総合判定 | **合格** |
| 実行日時(UTC) | 2026-10-16T08:25:16.690524Z |
| 実行環境 | omega-dev2(compose) |
| 実行時のHEAD | `f3cf06d65d6f880b5fb8aece931d75d3ab33dfed`(未commitの変更を含むことがある) |
| 所要時間 | 15.3 秒 |

## 1. バックアップ

| 項目 | 値 |
|---|---|
| バックアップID | `tc-20261016T082516Z` |
| 元DB | `travelcanvas`(alembic `d3f9b1c5e7a4`) |
| DBダンプ | 1452453 バイト、sha256 `b9751d7c9359144c…` |
| 保存ファイル | 118 件、アーカイブ 42365 バイト |
| manifest との照合 | 合格 |

## 2. 別DBへの復元(運用中のDBには触れない)

| 項目 | 結果 |
|---|---|
| 復元先 | `travelcanvas_restore_drill` |
| pg_restore | 合格 |
| alembic の版 | 合格(復元先 `d3f9b1c5e7a4`) |
| 表ごとの件数 | 合格(62 表・13063 行、一致 62、運用中に変化 0、不一致 0、欠落 0) |
| 保存ファイル | 合格(118 件、欠落 0、内容違い 0、DBが参照するのに無いファイル 0 件) |
| 暗号化列の復号(今の鍵で) | 合格(17 列を確認、成功 40、失敗 0) |
| 鍵の指紋の一致 | 一致 |

## 3. migration の rollback 演習(復元先DBで実施)

| 項目 | 結果 |
|---|---|
| downgrade -1 → upgrade head | 合格 |
| 戻した revision | `d3f9b1c5e7a4` → `c1e7a9b3d5f2` → `d3f9b1c5e7a4` |
| 往復後の表の数 | 62(往復前 62) |

## 4. コードの rollback 計画(1つ前の commit へ戻す場合)

| 項目 | 結果 |
|---|---|
| 戻し先 | `fba53c1` |
| 自動で戻せるか | はい |
| 先に必要な downgrade | 不要(migrationの変更なし) |

## 5. 監視の確認

| 項目 | 結果 |
|---|---|
| /health・/ready・/metrics | 合格 |
| 検出 | restore_drill_missing(warning) |
