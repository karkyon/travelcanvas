# DOC-04/05/06/07/11 とコードの突き合わせ・縦断導線・実機の記録表(2026-11-19)

基準: main `cd14e23` + 本ブランチ。**証跡の種類を分ける:** コード確認 / 機械照合 / CI。実機・実 API・実旅行は**未確認**(本書の §5 の記録表で人が実施する)。
「完了」「網羅」は主張しない。

## 1. 突き合わせの結果(文書 v5.1 の as-built は d8bd1b7・2026-11-05)

| 文書 | 照合の方法 | 結果 | 扱い |
|---|---|---|---|
| DOC-04 §19 画面の経路 | 文書の経路 64 件を `frontend/src/router/index.tsx` と機械照合 | 64 件すべて実在。router のみの経路: `*`・`404`・`planner`・`planner/:planId/branches/:branchId`・`profile` | 文書側へ 5 経路の追記が必要(v6.0 化の時) |
| DOC-05 表 | d8bd1b7 の 107 表 → 現 main の models | **124 表**(+17)。文書は古い | DOC-05 を v6.0 へ(未着手) |
| DOC-06 API | `backendRoutes.json` を d8bd1b7 と比較 | **+139 / −11**(468→596)。「パスワード再設定は無い」等の記述は古い(再設定・メール確認・passkey は実装済み。DOC-10 FR-003) | DOC-06 を v6.0 へ(未着手) |
| DOC-07 運用 | `.github/workflows`・CI の検査項目と照合 | CI は secret-scan・pip-audit/npm audit・SBOM(CycloneDX)・bundle 予算・flake8・mypy 基準・Playwright(axe 依存あり)・perf 夜間・deploy-gcp-dev。**文書にある SAST・container・IaC・license・署名・canary・staging・本番は無い**(PROD-01〜09 未着手)。文書のモノレポ構成(apps/・modules/)は現構成(backend/・frontend/)と別で「段階移行」の扱い | 差異として明記済み。本番の項目は未実装 |
| DOC-11 SEC-001〜020 | `docs/security/SECURITY-TRACE.md`(CI が実在を検査)と DOC-11 §18 の ID・題を照合 | 20 件の ID と題が一致。状態: SEC-014 は**一部**、SEC-002/007/013/016 は範囲の注記つき(DOM・cache は E2E、実機未確認、時間差の計測なし、本番の定期検査なし) | 「有」は CI の試験の存在であり実機・本番の証跡ではない |
| DOC-11 差異表 | 4 項目(Argon2id/bcrypt 等) | 現行コードと矛盾なし(bcrypt のまま)。ただし「passkey・メール確認・パスワード再設定は未実施」の記述は古い(実装済み) | DOC-11 を v6.0 へ |

**結論:** 文書 DOC-05/06/07/11 は v5.1 のまま古く、コードが先行している。食い違いの一覧は上のとおりで、本書は文書の書き換えまでは行っていない(利用者の承認が要る)。

## 2. FC-001〜100 の意味での照合

`docs/audit/2026-11-19_fc001-100_semantic_map.md`(`scripts/audit/scan_fc_semantic.py` で再生成)。FC ごとの検索語でコード・試験を検索した**根拠の候補**。
集計: 実装と試験の手がかりあり 83 / 実装のみ 6 / 試験のみ 3 / 手がかりなし 8。
**これは検証済みの判定ではない。** 語の一致は意味の一致を保証しない。「手がかりなし」8 件(FC-033/042/050/057/076/079/086/090)は未実装の断定ではなく、
検索語の不一致が主な原因の可能性が高い(例: FC-086 は `today_push.py` に通知本文の問題があり、既に利用者の決定待ち T-FC086)。人が FC ごとに確認するまで **`未照合`** とする。

## 3. 旅行体験の縦断導線(根拠 = ルート・API・既存の E2E 仕様。実行の記録は CI のみ)

| 導線 | 画面→API→保存の鎖(コード確認) | 既存の E2E / 試験(CI) | 穴・未確認 |
|---|---|---|---|
| ① 相談→検索→候補採用→旅程 | 相談(consult)→`search`→`adopt_candidate`(`FOR UPDATE`・同時採用の試験あり)→Place→旅程 | `zz-consult-ai.spec.ts`・`search.spec.ts`・`test_gate_c2_candidates_places.py` | 実 AI・実 Places は未確認。DB の一意制約なし(T の決定待ち) |
| ② 予約・チケット・オフライン・期限 | 予約→reveal(再認証)→オフライン pack→同期 | `reservations.spec.ts`・`offline-pack.spec.ts`・`offline-sync.spec.ts` | 実機の機内・圏外・端末失効は未確認。sw.js 未登録(DOC-11 差異) |
| ③ 当日 NOW/NEXT→再計画→失敗時→記録 | 当日画面→`replan`/`memory-replan`→記録 | `today-mode-mobile.spec.ts`・`replan.spec.ts`・`plan-b.spec.ts`・`memory-replan.spec.ts` | 実 GPS・実天候・実遅延は未確認 |
| ④ 共有・投票・権限・位置の秘匿 | share/vote/member policy・位置の local-first | `share-clone.spec.ts`・`share-policy.spec.ts`・`gate-g11-family-vote.spec.ts`・`location-local-first.spec.ts`・`location-track.spec.ts` | FC-086(通知本文)の決定待ち。割り勘の E2E 名のものは見つからず(別名の可能性。未確認) |
| ⑤ 国内/訪日/多言語・時差 | timezone 関連の API・文字列 | `i18n`・`timezone` 名の E2E は見つからず(名前の検索。内容は未確認) | **穴の候補**。人の確認が要る |

## 4. 利用者の決定・承認が要るもの(変更なし)

FC-086、DB 一意制約(重複の読み取り SQL を先に実行)、LICENSE、`frontend_spot_integration.py` の削除、会員名・価格、Stripe の手数料・税・特商法。PR #141 の T1〜T7 を参照。

## 5. 実機・実 API・実旅行の記録表(**私は実施できない。実施者が記入する。空欄=未確認**)

| ID | 確認 | 手順(要約) | 期待 | 実施日 | 端末・版(SHA) | 結果 | 証跡 |
|---|---|---|---|---|---|---|---|
| R-01 | ログイン・再設定メール | 実 SMTP で再設定→新パスワード | メールが届き入れる | | | | |
| R-02 | passkey | 実機で登録→ログイン | 成功 | | | | |
| R-03 | 実 AI 相談 | 実鍵で相談→候補→採用 | 原価上限内・採用 1 件 | | | | |
| R-04 | 実 Places/Routes | 検索・経路 | 結果・失敗時の表示 | | | | |
| R-05 | オフライン | 機内モードで当日画面・チケット | 表示・失効後は不可 | | | | |
| R-06 | 実 GPS・位置共有 | 当日に共有 on/off | 停止後は配信されない | | | | |
| R-07 | 通知 | 実 push | 本文に予定名・時刻が出るか(FC-086) | | | | |
| R-08 | 共有リンク | 期限・失効・PIN | 拒否される | | | | |
| R-09 | Stripe テスト鍵 | 実テスト鍵で Checkout→Webhook | 権利付与・二重付与なし | | | | |
| R-10 | 実旅行 1 本 | 計画→当日→記録 | 重大な詰まりなし(所見を記入) | | | | |

## 6. 残り(正直な状態)

- FC-001〜100 の**意味の確認は人の作業が残る**(候補の検索まで)。
- DOC-05/06/07/11 の v6.0 化は未着手(差異は §1)。
- 縦断導線⑤(多言語・時差)は E2E の穴の候補。
- 実機・実 API・実旅行は**未確認**。
