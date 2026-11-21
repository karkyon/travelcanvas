# 製品固めゲート② 再監査(2026-11-20 夕。main `8118aa9` で着手、`fe5eaec` で更新)

> 指示書「最新main全面再監査・残件一括継続」(2026-11-20)に沿う。**事実・未確認・利用者の判断待ちを分ける。**
> 証拠の段階: コード=読んで確認 / 単体・E2E=自動の試験 / CI=GitHub Actions / 実環境=利用者の実行ログ / 実機・実 API・実旅行=**無い**。

## 1. 作業基準(GitHub から取り直した値)

| 項目 | 値 | 根拠 |
|---|---|---|
| main(着手時) | `8118aa99793ee5b811132fe45970b3b4403a0e9e`(#155) | GitHub branches API |
| main(更新時) | `fe5eaece7b4e5999e93fd79b26042ce75e3ca7b9`(#156 をマージ。#156 の head `39085ec` の時点でマージされた) | GitHub branches・pulls API |
| main の CI | `8118aa9`: run #809 の 5 件とも success。`fe5eaec`: run #811 — run #811 の 5 件とも success(09:43 UTC に確認) | check-runs |
| open PR | #157(この文書)・#158(FC-084 と、#156 に漏れた地図の凡例の試験)。#156 はマージ済み | pulls API |
| main の tree | blob 1,879 件(tree の entry 2,007・truncated=false) | git/trees API |
| 作業ツリー | 変更なし(clean)で開始 | `git status` |

### 1.1 ファイルの目録(main `8118aa9` の blob 1,879 件)

| 区分 | 件数 | 区分 | 件数 |
|---|---:|---|---:|
| docs/spec | 10 | frontend pages | 332 |
| docs/audit | 17 | frontend components | 215 |
| docs/trace | 110 | frontend services・store・utils・hooks | 279 |
| docs/ux | 24 | frontend e2e | 85 |
| docs/adr | 64 | frontend その他 | 89 |
| docs/runbooks・ops | 12 | backend api(router) | 84 |
| docs その他 | 2 | backend services | 132 |
| .github(workflow) | 3 | backend models・core・ops | 41 |
| scripts/ops | 17 | backend alembic | 90 |
| scripts その他 | 29 | backend tests | 210 |
| その他 | 7 | backend その他 | 27 |

frontend の単体試験のファイルは 265(main)。**全ファイルを 1 行ずつ読んだわけではない。** 詳しく読んだのは、Gate② の作業で触れた経路(下の 4)と、#155・#156 の差分、会員・共有・予約・地図・検索・認証の周り。

### 1.2 `docs/design/HANDOFF_2026-11-19.md`

- travelcanvas の **146 の branch すべての tree** を GitHub API で調べた。handoff の名前のファイルは `docs/audit/2026-09-03_gate26_handoff.md` だけで、**`HANDOFF_2026-11-19.md` はどの branch にも無い**。
- 同じ名前のファイルは **別のリポジトリ `karkyon/jadeworks-os` の branch `feature/core-gateway-phase`(commit `0a9f84e`)** にある。中身は Jade Works OS の引継ぎで、TravelCanvas の内容ではない。
- 再発を防ぐため、TravelCanvas の引継ぎを `docs/design/HANDOFF_2026-11-20.md` として新しく作った(この PR)。

## 2. 環境(開発環境だけ)

> **2026-11-21 更新:** 利用者の実行ログで、**omega-dev2・GCP VM とも main `fe5eaec` に反映済み**(バックアップ `tc-20261121T013246Z`・`tc-20261121T015530Z`、Alembic `d5e9f3a7b2c6`、healthy・/ready の checks すべて true、T2 などの件数はすべて 0)。詳細は追補 D §7。下の表は 11-20 時点の記録として残す。

| 環境 | 状態 | 根拠 |
|---|---|---|
| omega-dev2 | **`8118aa9` に反映済み**(反映前 `cd14e23`。最新の main `fe5eaec` との差は frontend の 5 ファイルと docs だけで migration なし。`fe5eaec` へはまだ)。Alembic `d5e9f3a7b2c6`(head)、バックアップ `tc-20261120T061310Z`(検証 OK)、/health・/ready・`/`・`/admin/ops` 200、LAN の CORS 可 | 利用者の実行ログ(追補 D §6、#156 に記録) |
| omega-dev2 の未確認 | backend・frontend の healthy の表示、/ready の checks の本文、`gate2_env_record.sh`(T2 の重複・大文字小文字違いのアカウント・正規化前の招待の件数)、C-1〜C-6 | — |
| GCP VM | **未反映**(最後に確認された版は `cd14e23`) | — |
| この作業環境から | **どちらにも接続できない**(SSH の鍵・LAN/tailnet・gcloud の認証が無く、利用者の端末も接続されていない)。迂回していない | `list_computer_folders` が空、`gcloud auth list` に認証なし |

## 3. PR #156 のレビュー(この監査の後にマージされた)

| 変更 | 確かめたこと | 結果 |
|---|---|---|
| 全体の検索の保存先の説明 | 「プランに追加」の実際の動き: `navigate('/planner', { state: { newSpot } })` → 旅程の画面が旅行の一覧と「どの旅行に入れるか」の窓を出し、日と時刻を選んで追加(`PlannerPage.tsx` の `routeNewSpot`・`addSpotToExistingOrNewPlan`)。「行きたい場所に保存」は旅行に結び付かない一覧(`saveWish`)。説明と一致 | 問題なし |
| 見出しの統一 | 帯(#155)「場所を探す・候補」と、全体の検索・場所の詳細の「DISCOVER · 場所を探す」。「候補箱」は DOC-04 の画面名 SC-08 なので変えない | 問題なし |
| 地図の凡例 | 線を引く分岐(区間ごとの線 / 予定の順の点線 / 線なし)と凡例の分岐が同じ条件か。自宅との区間(送らない時は直線)・道の経路の取得の失敗・場所 1 つ・エリアの円 | 一致。**ただし点線の見本の色が固定(`#334155`)で、暗い表示では凡例の背景に溶ける** → この監査で `currentColor` に直した。#156 の branch に積んだ `a114008` は、#156 が `39085ec` でマージされたため **main に入らなかった** → **#158 に同じ内容を入れた** |
| 試験 | 以前は判定の関数の単体だけ | **PlanMap を描く試験 4 件を追加**(`PlanMap.legend.test.tsx`。道を聞かない時・場所 1 つ・道と直線の混在で実線/点線と一致・取得失敗)。#158 に入れた。#158 の branch で frontend 267 ファイル 1522 件通過(ローカル) |

狭い幅: 凡例は既存の `.tc-map-endlegend`(折り返し・幅の上限あり)の中に足しただけ。読み上げ: 凡例の入れ物に `aria-label="線の色と種類"`、見本は `aria-hidden`、文字で種類を書く。**実機・読み上げの実際の確認は無い。**

## 4. 縦断の経路(画面 → API → 権限 → DB → 試験。証拠はコードと自動の試験まで)

| # | 経路 | 主な画面 / API | 権限・データ | 試験(代表) | 判定 |
|---|---|---|---|---|---|
| 1 | ホーム → 作成・相談 → 再開 | `/dashboard`・`/trip-consult`・`/planner/:id` / `travel-plans`・`trip-intents`・`quickdrafts` | 所有者・ゲスト。下書きは確定まで旅程を作らない | `test_gate_g9_dashboard.py`・`test_gate_g11_intake.py`・e2e `gate-g11-intake` | 自動の試験で合格。実利用は未 |
| 2 | 相談 → 候補 → Place 採用 → 予定 | `/planner/:id/candidates` / `search/candidates/{id}/adopt`(FOR UPDATE で冪等) | 本人の検索結果だけ採用(IDOR 防止) | `test_gate_c2_candidates_places.py`(並列 4 件で 1 件)・e2e `candidates` | 合格(実 API の検索は未) |
| 3 | 予約の取り込み → 確認 → 予定 → 当日の QR | `/planner/:id/imports`・`reservations` / `imports`・`reservations`・`tickets` | 予約番号は暗号化・reveal は再認証と監査。重複は候補だけ(FC-042) | `test_gate_booking_import.py`・`test_gate_r3_5_tickets.py`・`test_gate2_reservation_duplicates.py` | 合格(メールの自動の取り込みの実運用は未) |
| 4 | 共有・招待・投票 → 権限 → 旅程 | `/share/:id`・`/planner/:id/discussion` / `travel-plans/{id}/collaborators`・`invitations` | 招待の宛先は大文字小文字を区別しない(#147)。宛先違いは 404 | `test_share.py`・`test_gate_s4_authz_matrix.py`・`test_gate_p3_discussion.py` | 合格(C-1・C-2 の実環境は未) |
| 5 | 準備 → 当日 → provider の失敗 → 再計画 | `/planner/:id/today`・`alerts`・`replans` / `today`・`replans`・`search` | 現在地は押した時だけ(#129)。失敗と 0 件を区別(#131・#135) | `test_gate_tday_live.py`・`test_gate_p10_replans.py`・`SearchPage.test.tsx` | 合格(実機・実 API は未) |
| 6 | オフライン → 同期 → 競合・再送 | `/planner/:id/sync` / `sync`・`offline-pack/key` | operation_id で二重適用しない。パックの期限の警告(#132) | `test_gate_p11_sync.py`・`k1offlinePack.test.ts`・e2e `offline-sync` | 合格(実機の圏外は未) |
| 7 | 支出・精算 → 記録 → 旅行記・しおり | `/planner/:id/expenses`・`memories`・`booklet` / `finance`・`memories`・`booklet` | 個人予算は他人に返らない。公開は noindex・止められる | `test_gate_p2_finance.py`・`test_gate_p12_memories.py`・`test_gate_p4_booklet.py` | 合格 |
| 8 | 会員の枠・期限切れ・解約・削除・書き出し | `/settings/billing` / `billing`・`account`・`data-export` | 枠超過・解約・期限切れでも旅行データ・予約番号・書き出し・退会は止まらない | `test_gate2_access_never_blocked.py`(4 件)・`test_gate_g2_billing_boundaries.py`(6 件)・`test_gate_remaining4_billing.py` | 合格(Stripe はテストモードだけ。Live は無効) |

## 5. セキュリティ: 実装・試験と運用の証拠を分ける

- `docs/security/SECURITY-TRACE.md` の SEC-001〜020 が参照する試験・演習のファイル **55 件すべてが main に実在**することを機械的に確かめた。
- これは**実装と CI の証拠**。本番の WAF・KMS・外部の監視・冗長化・侵入試験・復旧演習の証拠ではない(**運用の証拠は無い**)。SEC-014 は「一部」のまま(少人数の集計からの推測)。
- この監査の範囲で、悪用できる新しい弱点は見つけていない(見つけた場合も公開の PR に悪用の手順は書かない)。

## 6. 課題台帳(この監査で増えたもの・状態が変わったもの)

| ID | 区分 | 重要度 | 内容 | 対応・受入条件 | 状態 |
|---|---|---|---|---|---|
| G2-12-A | 問題 | P2 | 地図の凡例の点線の見本が固定の色で、暗い表示で見えにくい | `currentColor` に。PlanMap を描く試験を追加 | #158(未マージ。#156 には入らなかった) |
| G2-12-D | 問題 | P2 | FC-084(時計ずれ)を「未実装」と判定したのは誤り。補正は既にあり、警告だけが無かった | 警告を足し、照合の文書の判定と集計を直す(実装あり 49・一部 37・未実装 11・要確認 2・判断待ち 1) | #158(未マージ) |
| G2-12-B | 課題 | P1 | 引継ぎの文書が指示と違う場所・リポジトリにあり、繰り返し「無い」ことの確認が必要だった | `docs/design/HANDOFF_2026-11-20.md` を作る | この PR |
| G2-12-C | 改善 | P3 | G11 の UX 仕様 §3.3 が画面を「発見の画面」と呼ぶ(帯の名前は #155 で「場所を探す・候補」) | 仕様に注記を足す(履歴は消さない) | この PR |
| G2-ENV-G(**11-21 に利用者が `fe5eaec` へ反映。追補 D §7**) | 課題 | P0 | GCP VM の最新の main への反映・記録 | 利用者が VM で `gcp_vm.sh deploy fe5eaece7b4e5999e93fd79b26042ce75e3ca7b9`(CI #811 成功)と記録の道具 | 未実施 |
| G2-ENV-O2(**11-21 に利用者が反映。追補 D §7**) | 課題 | P1 | omega-dev2 を `8118aa9` から最新の main `fe5eaec` へ(frontend と docs だけ・migration なし) | 利用者が `TC_BRANCH=main` で反映し、記録の道具 | 未実施 |
| G2-12-E | 問題 | P2 | #156 の全体の検索の説明「日と時刻を決めて」は実際と違う(1 日目に時刻なしで入る) | 説明を事実に合わせ、窓にも入る場所を出す | #160(未マージ) |
| G2-ENV-O | 課題 | P1 | omega-dev2 の記録の道具(T2 などの件数)・C-1〜C-6 | 利用者が実行 | 未実施 |

## 7. 利用者の判断待ち(変わらず。実装していない)

FC-086(通知の本文に予定名・時刻)・T2(候補の採用の一意制約。件数の確認の後)・LICENSE(README は「MIT License - see LICENSE file」だが LICENSE は無い。この監査でも再確認)・未使用ファイル `frontend/src/frontend_spot_integration.py`(main で参照なしを再確認。消しても Git の履歴には残る)・会員の名称と価格・Stripe Live と法務/税/特商法・利用計測(既定 OFF のまま)・未実装の FC 12 件。

## 8. Gate② の判定

| 段階 | 状態 |
|---|---|
| コード・CI の準備 | main `8118aa9` の必須 CI 5 件が成功。主な経路の自動の試験あり(上の 4) |
| 開発環境の同期 | **omega-dev2 は反映済み・GCP VM は未反映**。両方そろっていない |
| 実利用の Gate② | **未完了**(実機・実 API・実旅行・C-1〜C-6 が無い) |
| 本番 | 別のゲート |
