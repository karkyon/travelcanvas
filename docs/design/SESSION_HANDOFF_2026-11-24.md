# TravelCanvas 新しい会話への引継ぎ(作業継続用)— 2026-11-24 16:00 JST

> 長くなった会話を切り替えるための資料。**新しい会話の最初に、この資料と最新の指示書を Claude に渡す。**
> 数値・SHA は書いた時点の値。新しい会話では必ず GitHub から取り直す(この資料の値を信じ込まない)。
> 正本の引継ぎはリポジトリの `docs/design/HANDOFF_2026-11-24.md`。この資料はそれに「作業のやり方・環境の癖」を足したもの。

## 0. 新しい会話の最初に Claude へ渡す文(そのまま貼れる)

```
TravelCanvas(karkyon/travelcanvas)の製品固めゲート②の作業を続けてください。
最初に GitHub から main・open PR・main の CI・Alembic head を取り直し、docs/design/HANDOFF_2026-11-24.md と
docs/design/SESSION_HANDOFF_2026-11-24.md を読んでから、HANDOFF §3「次にすること」の 1 から再開してください。
指示の正本は 2026-11-24 の指示書「最新 main から最終目標まで自律継続開発指示」です。報告は日本語。
必須の検査が同じ head ですべて成功し差分に問題が無い PR はマージしてよい(本番・Cloud Run・Stripe Live・
破壊的な DB 変更・実データ変更・法務/価格/ライセンスの決定はしない)。CI 待ちや途中報告で止めず続けてください。
```

## 1. 今の状態(2026-11-24 16:00 JST に GitHub から取得)

| 項目 | 値 |
|---|---|
| main | `1e82f8b`(#198 HANDOFF 2026-11-24) |
| main の CI | `1e82f8b` で secret-scan・dependency-audit・backend・frontend・e2e がすべて success。`1dfc05b`(#199)も perf を含めすべて success |
| open PR | #200(この資料を入れる PR)の 1 件だけ。ほかは 0 件。#200 はマージ後に閉じるので、新しい会話では GitHub で取り直す |
| 台帳 | DOC-10 v6.0-r71・63 FR: VERIFIED 38・INTEGRATED 25(うち(部分)19)・RELEASED 0。加重値は製品の完成率ではない |
| FC-001〜100 | 実装あり 57・一部 40・未実装 3(FC-011・044・076)。`docs/audit/2026-11-23_fr_fc_recheck.md` §1・§5。FC-101〜180 は親 FR を継承・FC ごとの検証はしていない |
| Alembic head | `a5c9e1b3d7f4` |
| omega-dev2・GCP | 今の実測は無い(利用者の 11-21 のログ `214b179` は過去の値)。Claude は接続できない。反映は未実施 |
| #200 の追加 | 既存の試験 `test_gate_c3_search.py` の予約番号を伏せる確かめが、無作為の UUID に数字がたまたま入ると落ちる(flaky)ので、UUID を除いた本文で確かめるよう直した |
| Gate② | 未完了(Claude の作業も未完了。全体は環境の反映・手の確認・実機・実 API・実旅行の証拠が無い) |

## 2. この会話(11-22〜11-24)でマージした PR

| PR | 内容 |
|---|---|
| #175〜#179 | FR-061 日帰り・FR-062 今度/また行きたい・FR-063 SNS とリール(63 FR) |
| #181 | CI: E2E の Playwright の OS の依存の導入を 3 回までやり直す |
| #184・#185・#187 | 選んだ札の見た目・狭い画面の地図の欄・761〜1023px で地図が潰れる・地図の枠の幅で並びを切り替え(座標で重なりを測る E2E `planner-map-overlap.spec.ts`)・知らせ(toast)を上の帯の下へ |
| #188 | 全データの書き出しに行きたい場所・退会で行きたい場所を消す |
| #191・#196 | 書き出しに本人ごとの回数の上限(旅行 30/時・アカウント 10/時)・429 に Retry-After |
| #193 | ファイルで受ける要求(17 か所)の失敗の説明を画面に出す(Blob の本文を読み直す) |
| #194 | 日帰りの画面で閲覧だけの人に「予定に入れる」・計算し直しを出さない |
| #197 | 退会で保存先のファイルが消せなかった時に数えて記録(`files_not_removed`) |
| #199 | 公開した場所を消すと、ほかの人のお気に入り・訪問の参照で 500 になる不具合 |
| #182・#183・#186・#189・#190・#192・#195・#198 | HANDOFF・手の確認の票(C-1〜C-31・D-1〜D-12)・統合受入・追補 D §9/§9.4・FR/FC の照合し直し・判断票 §8・SECURITY-TRACE §14 |

## 3. 次にすること(Claude。HANDOFF_2026-11-24 §3 と同じ順)

1. 縦断の経路 1・2・3・5 をコードで追う(相談 → 候補 → 採用 → 日/時刻帯つきの予定 → 地図、予約 → 取込/OCR → チケット/QR → 圏外、準備 → NOW/NEXT・通知 → 失敗の表示・プラン B)。旅行 ID・候補 ID・Place ID・日/時刻帯・役割・同期の状態が途切れないか。通信の失敗・二重の送信・閲覧だけの人・権限を外した後・提供元の timeout・日付の境目を含める
2. DOC-11 の SEC 要件ごとに、実装・自動の試験・CI・開発環境・本番の証拠を分けた表(`docs/security/SECURITY-TRACE.md` を基準 `a2c419d` から今の main へ全体を照合し直す。新しい機能の行は 11-21〜24 に足し済み)
3. UI: 文字の拡大(200%)・読み上げ(主な画面)。320px・375px・761〜1440px の幅は確かめ済み
4. 見つけた P0/P1 は main からの小さな PR で直し、同じ head の必須の検査が成功したらマージ。終わる前に HANDOFF を更新

## 4. 作業のやり方(この会話で分かった環境の癖)

- **GitHub:** `gh` は REST(`gh api repos/karkyon/travelcanvas/...`)だけ使える。GraphQL(`gh pr view`・`gh pr checks`)は 403。PR の作成は `gh api repos/karkyon/travelcanvas/pulls -f title=… -f head=… -f base=main -f body=…`。マージ・main の取り込みは GitHub の MCP(`merge_pull_request` に `expectedHeadSha`・`update_pull_request_branch`)
- **ブランチ保護:** 必須 6 件(secret-scan・dependency-audit・frontend・backend・e2e・GitGuardian)と「main に追いついていること」。1 つマージすると他の PR は main の取り込みと CI のやり直しが要る。並べて出すより、**1 つずつ順に**マージする方が早い。E2E は 25〜35 分
- **CI の待ち:** Monitor の until ループ(30 分で切れるので張り直す)。結果は `gh api repos/karkyon/travelcanvas/commits/<sha>/check-runs`。E2E のリリース判定は flaky 1 件でも落ちる(落ちたらログの `✘` と `intercepts pointer events` 等を読み、原因を直す。やり直しだけで済ませない)
- **ローカルの試験:** コンテナが入れ替わると Postgres・Redis が止まる。`service postgresql start; redis-server --daemonize yes` を先に。backend の試験は env `DATABASE_URL=postgresql://travelcanvas_app:ci-only-not-a-real-secret@localhost:5432/travelcanvas_test3 JWT_SECRET_KEY=ci-only-dummy-jwt-secret-not-used-anywhere-else REDIS_URL=redis://localhost:6379/0 TC_REQUIRE_REDIS=1`(venv は会話ごとに作り直しが要る場合がある)。flake8 は行 120 字(CI の Lint で落ちる)
- **生成物:** エラーの文を足したら `python3 scripts/ci/render_error_catalog.py`(`test_gate_g3_errors` が見る)。FR の数・DOC-10 は `render_doc10.py`・`render_fr_trace.py`。SECURITY-TRACE の backtick のファイル名は実在が要る(`test_gate_hardening_trace.py`)
- **frontend:** eslint `--max-warnings 0`。画面のファイルから部品以外を export しない(react-refresh)。色の絵文字は UiIcon の試験で落ちる。axe の文字の対比 4.5:1。`navigationSafety` の試験(動的な href)
- **ローカルの E2E:** backend を 8001・`vite build` → `vite preview --port 4173`、Playwright は docker の globalSetup を外した設定で流す。CI の成果物(blob.core.windows.net)は proxy で取れない

## 5. 利用者の操作・判断を待つもの

| 種類 | 内容 |
|---|---|
| 環境 | omega-dev2・GCP を最新 main へ(`docs/audit/2026-11-20_gate2_status_addendum_d.md` §9・§9.4。反映の前に `gate2_env_record.sh` で今の SHA を取る・バックアップ・health/ready。T2 は重複があると migration が止まる) |
| 鍵の確認 | 反映の後、管理画面で Google のサーバー用キーの「有効性を確認」 |
| 手の確認 | `docs/test/gate2_manual_verification.md` の C-1〜C-31(試験だけの会員・架空の予約) |
| 実機 | D-1〜D-12・統合受入 §10・§11(SNS の動画は作って保存・読み込みだけ。投稿しない) |
| 実 API・実旅行 | A-1〜A-4・R-1/R-2(伊勢 11/28〜29 は予定) |
| 判断 | 判断票 T3(LICENSE)・T5〜T7(会員の名称・価格・Stripe Live・利用計測)・T8・T9(画面の言葉)。保存先に残ったファイルを走査して消す仕組みを作るか |
