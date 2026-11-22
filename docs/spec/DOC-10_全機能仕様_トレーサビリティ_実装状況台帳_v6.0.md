# 10 全機能仕様 トレーサビリティ 実装状況台帳 v6.0(正本)

> 文書ID: DOC-10 / 版: **v6.0-r68** / 状態: APPROVED FOR IMPLEMENTATION / 改訂日: 2026-11-17<br>
> **正本の場所: このファイル(GitHub `karkyon/travelcanvas` の `docs/spec/`)。** プロジェクトの資料室(Library)に置く写しは、
> 冒頭にこのファイルの commit を書く。資料室の `10_全機能仕様_トレーサビリティ_実装状況台帳_v5.1.md`(r11、2026-09 の版)と
> `claude/DOC-10_r12_台帳更新_2026-10-20.md`(r12 の追補)は **廃止**(内容はこの版に統合した)。  
> 共通正本: 要件ID=DOC-02、画面ID=DOC-04、データ=DOC-05、API=DOC-06、Security=DOC-11、語彙=DOC-13。**v6.0 体系(2026-11-17〜)では正本を
> リポジトリの `docs/spec/` へ移す。** 移した物(DOC-02・DOC-04・DOC-13・本書・FR-059・資料体系の README。DOC04-A・DOC-15 は統合)は v6.0、まだの物は資料室の v5.1 が正本(移す段階は
> `docs/spec/README.md` §3)。所在・版・状態・優先の順は `docs/spec/CANONICAL-SOURCES.md`、FR ごとの要求の根拠と承認済みの変更は `docs/trace/FR-TRACE.md`、
> 保管した v5.1 は `docs/spec/archive/v5.1/README.md`

**目的:** 構想、仕様、画面、DB、API、コード、試験、リリースを一つの台帳で結び、名前だけ存在する機能を「完成」と誤認しない。

## 0. 同期基準・正本の関係・証拠の境界

### 0.1 同期基準

| 項目 | 値 |
|---|---|
| 基準commit | `d8bd1b7`(PR #60 Gate MockFit。2026-11-05 に版をそろえた時点の main) |
| Alembic head | `d7f3b5c9e1a4`(単一の head。Gate② FC-045 で documents に版(version・replaces_document_id・superseded_at)を追加。追加だけ。その前は `c5e1a7d3b9f2` travel_events.after_event_id) |
| 基準の試験の実測(`d8bd1b7`) | backend pytest 1603 合格・1 飛ばし / frontend vitest 1057 合格(196 ファイル) / E2E 100 合格 / 最初に読む JS 428.39 kB(上限 430 kB)。GitHub Actions の main の push run 41880257997 |
| GitHub Actions(`d8bd1b7`) | secret-scan / dependency-audit / frontend / backend / e2e の5ジョブ合格(push の run 41880257997)。main は保護(必須の CI・管理者にも適用・強制 push と削除の禁止・直線の履歴) |

`backend/tests/test_gate_g1_doc10.py` が、上の基準commit が履歴に実在すること・Alembic head が実際の head と一致すること・
§3 の表と §2 の集計が `docs/trace/fr-status.json` と一致すること・VERIFIED が `docs/trace/v1-verification-ledger.json`
と一致することを CI で確かめる。

### 0.2 正本の関係(GOV-02)

| 成果物 | 役割 | 同期の規則 |
|---|---|---|
| `docs/trace/fr-status.json` | 全60 FR の状態・(部分)・主な不足の**機械が読む正本** | 状態を変える Gate は同じ commit でこれを直し、`python3 scripts/ci/render_doc10.py` で本書の表を作り直す |
| `docs/trace/v1-verification-ledger.json` | VERIFIED の**証拠**(E2E・権限・競合・セキュリティ・運用の試験) | CI が、参照した試験の実在(`test_gate_v1_verification_ledger.py`)と、**その実行での合格**(`scripts/ci/check_ledger_results.py`)を確かめる |
| 本書(DOC-10) | 人が読む正本(状態の判定規則・集計・リリース・次工程) | 生成部分は手で直さない(CI が落ちる) |
| `docs/spec/FR-059_*.md` | FR-059(外部 API の原価上限・利用者クラス別 quota)の要件・データ・API・運用の正本 | 資料室の DOC-02/04/05/06/07/09/11/13 の該当箇所より優先する(同書 §12)。policy の版を変える時は同書と本書を同じ PR で直す |
| `docs/spec/canonical-sources.json`(人が読む版 `CANONICAL-SOURCES.md`) | 資料室の正本(DOC-01〜15)の所在・版・状態と、リポジトリの正本との優先の順(Hardening-A) | 資料室の文書の版が変わったら直し、`python3 scripts/ci/render_fr_trace.py` |
| `docs/trace/fr-requirements.json`(人が読む版 `docs/trace/FR-TRACE.md`) | 全60 FR の要求の出典・受入・承認済みの変更・画面/API/表/試験・証拠の区分(要件根拠/実装/統合/E2E/権限・失敗/実機/実 API/運用)・残件の分類 | FR の状態・残件を変える Gate は同じ commit で直す。実機・実 API・運用を「済」にするには証拠のファイルが要る(`test_gate_hardening_trace.py`) |
| `docs/security/SECURITY-TRACE.md` | DOC-11 の項目・SEC-001〜020 と実装・試験・本番の証跡の対応 | 参照の実在を CI で確かめる |
| `docs/trace/gate-*-trace.md` | Gate ごとの要件の証拠(当時の状態) | 後の Gate で解消した行には `SUPERSEDED BY` を書く。今の状態の索引は `docs/trace/INDEX.md` |
| 作業継続のハンドオフ(資料室) | 会話をまたぐ作業の引き継ぎ | 本書の版と commit を書く。状態の数字は本書から写す |

### 0.3 証拠の境界(この台帳が主張しないこと)

- **RELEASED は0件。** 本番環境(HTTPS・WAF・外部監視・SLO・KMS・別系統のバックアップ)と外部の侵入試験が無い(§6)。
- 外部の提供元(地図・経路・逆ジオコーディング・運行情報・天気・OCR・音声認識・KMS)は未接続。推定値は内部推定
  (`is_estimate`・`algorithm_version` 付き)だけ。外部の提供元が前提の能力は INTEGRATED(部分)を上限とする。
- 性能(負荷・p95)・実機の mobile・visual regression は未実施(mobile は Playwright の画面の大きさの模擬だけ)。
- AI は使っていない(旅行記の下書き・Memory Replan は規則とテンプレートによる生成)。

## 1. 状態の判定

| 状態 | 判定条件 |
|---|---|
| IDEA | 構想があるだけ |
| SPECIFIED | FR/FC、受入、画面、データ、API が定義済み |
| SCAFFOLDED | ファイル、型、route、component、endpoint の形がある |
| IMPLEMENTED | 個別処理が実装され単体試験できる |
| INTEGRATED | 画面→API→DB(provider)が正常・失敗系とも接続し、backend の統合試験(実 PostgreSQL)で正常系と失敗系(権限・競合・不正入力)を確認済み |
| VERIFIED | E2E、権限、競合、セキュリティ、運用を検証(証拠は ledger。CI がその実行での合格を確かめる) |
| RELEASED | 監視、Runbook、rollback、利用者向け仕様を伴い本番で提供 |

- **(部分):** FR の一部の能力だけが該当。未達の能力は「主な不足」に書く。**(部分)は VERIFIED にしない。**
- **E2E 列:** ✓=Playwright の実ブラウザ試験あり、一部=一部の能力だけ、✗=なし。E2E が無い機能は VERIFIED にしない。
- 段を飛ばさない(SCAFFOLDED から VERIFIED へ一気に上げない)。後退する時は理由を §9 に残す。

## 2. 集計(全60 FR)

<!-- generated:summary -->
| 見方 | 値 |
|---|---|
| コードがある機能(IMPLEMENTED 以上) | 60/60 = 100% |
| INTEGRATED 以上 | 60/60 = 100%(うち(部分) 16) |
| VERIFIED | 38/60 = 63% |
| RELEASED | 0/60 = 0% |
| 加重進捗(SPECIFIED 0・IMPLEMENTED 0.4・INTEGRATED 0.7・VERIFIED 0.9・RELEASED 1.0) | 約82.7% |
| 未着手(SPECIFIED 以下) | なし |

VERIFIED の一覧: 001/002/003/004/005/006/009/010/012/013/016/017/019/020/021/022/023/025/026/027/028/029/031/032/033/034/038/039/040/043/044/045/047/048/050/051/053/057。
<!-- /generated:summary -->

## 3. 親機能のトレーサビリティ(全60 FR)

画面・DB・API・試験の対応の詳細は各 Gate の trace(`docs/trace/gate-*-trace.md`)と ADR(`docs/adr/`)。
VERIFIED の証拠の試験名は `docs/trace/v1-verification-ledger.json`。

<!-- generated:fr-table -->
| FR | 機能 | 状態 | E2E | 主な Gate | 主な不足 |
|---|---|---|---|---|---|
| FR-001 | ゲスト旅行開始 | VERIFIED | ✓ | #35・R1・R2 | KPI、回復UX |
| FR-002 | ゲスト昇格 | VERIFIED | ✓ | G1・A1 | 重複の統合(既存のアカウントへゲストの持ち物をまとめる)は Remaining-7 |
| FR-003 | 認証・セッション | VERIFIED | ✓ | A1・S2・S5・S7・S9・S11 | passkey(Remaining-7)は実機の端末で未確認。パスワードの再設定・メールの確認(Remaining-6)は SMTP の設定の後に実メールで未確認 |
| FR-004 | 旅行CRUD | VERIFIED | ✓ | B-012・G8 | 本番の定期実行の基盤(Cloud Scheduler 等)での記録の確認(PROD-1) |
| FR-005 | 日・イベント | VERIFIED | ✓ | B-013・G7・G11 | 実機 mobile のタッチでの並べ替え |
| FR-006 | NOW/NEXT | VERIFIED | ✓ | L1・L1b | 実機mobile、夜行便のE2E |
| FR-007 | 候補箱 | INTEGRATED(部分) | ✓ | C2・G11 | 画像の文字(OCR)・声(ブラウザの音声認識)から候補の名前を入れる(Remaining-7)。画像そのものから場所を当てる AI は場所の登録の画面だけ(同意つき)。SNS 以外の URL は押した時に 1 ページだけ読む(Remaining-6) |
| FR-008 | 場所の一元管理 | INTEGRATED(部分) | ✓ | C2・G4・G11・Remaining-2 | ジオコードの確認(地図の提供元 MAP-05)。祝日は日本は計算・日本の外は Nager.Date(Remaining-2。例外の日は手で登録できる) |
| FR-009 | 情報内検索・コマンドパレット | VERIFIED | ✓ | C3・G4 | 利用の計測(どのコマンドが使われるか)、本番での確認(RELEASE-1) |
| FR-010 | 予約管理 | VERIFIED | ✓ | R3・E1・Remaining-3 | 外部予約サービスとの同期(取消期限の 48 時間前・6 時間前の知らせは Remaining-3) |
| FR-011 | 予約取込 | INTEGRATED(部分) | ✓ | R3-7・R3-9・E1・BookingImport・BookingFix・Remaining-3 | 転送アドレス(Remaining-3)・Gmail の連携(Remaining-7。読み取りだけ・押した時だけ)は、受信サービス・Google の OAuth クライアントの設定の後に実メールで未確認。1 通から複数の予約は予約番号で分ける(Remaining-6) |
| FR-012 | QR・チケット | VERIFIED | ✓ | R3-5・R3-11・E1 | オフライン表示の実機での確認(バーコードの描画は Code 128。Remaining-1) |
| FR-013 | 文書ウォレット | VERIFIED | ✓ | R3-6・M5〜M10・S4 | 本番の Object Storage・ClamAV の常時運用・KMS |
| FR-014 | 移動区間 | INTEGRATED | 一部 | M1・M2・B-014・G11・Remaining-2 | 時刻表・運賃は駅すぱあとの接続口(Remaining-2。有料の鍵の後に実通信で未確認)。区間の編集・Undo の E2E は Remaining-7 |
| FR-015 | 経路比較 | INTEGRATED | 一部 | M3・M4・M8・Remaining-2 | 経路の外部provider は駅すぱあとの接続口(鍵の後に実通信で未確認)。route option の Undo の E2E は Remaining-7 |
| FR-016 | 制約 | VERIFIED | ✓ | L2 | 制約の変更の Undo は Remaining-7(作成・変更・削除・有効の切り替え。本人・その後に変更が無い時だけ) |
| FR-017 | 実行可能性 | VERIFIED | ✓ | L3・G7・G11・Remaining-2 | 時刻表の照合は駅すぱあとの候補を経路候補に入れる形(鍵の後に実通信で未確認) |
| FR-018 | 説明可能最適化 | INTEGRATED(部分) | ✓ | L4・G7 | 外部経路による実移動時間 |
| FR-019 | 日ごとの案(プランB。旧 What-if) | VERIFIED | ✓ | P7・G7・G8 → PlanB P1〜P8・Next | 天気は Open-Meteo の日ごと・時間ごとの雨。気象警報は状況の画面の外の情報(気象庁。Remaining-2)。AI の確かめは会員のクラスの枠の中だけ |
| FR-020 | 共同編集 | VERIFIED | ✓ | C1・G2 | 文字単位の同時編集(CRDT)は対象外(版の競合を検出する方式) |
| FR-021 | 共有・権限 | VERIFIED | ✓ | #25・#30・E1・G8 | 組織(B2B)の旅行の所有者の移譲(組織の管理で扱う) |
| FR-022 | 合意形成 | VERIFIED | ✓ | P3・G4 | 利用の計測、本番での確認(RELEASE-1) |
| FR-023 | 秘匿プロフィール・制約 | VERIFIED | ✓ | L2・C1 | — |
| FR-024 | コメント・通知 | INTEGRATED | ✓ | P3・G4・Remaining-3 | SMTP の送信元の設定(運用の判断)。メールの「すぐ送る」・端末への「自分あての知らせ」は Remaining-3 |
| FR-025 | 持ち物 | VERIFIED | ✓ | P1 | 薬の時刻通知・天候連動 |
| FR-026 | レディネス | VERIFIED | ✓ | P1 | 予算との連動は Remaining-7(使った額・未払いの予約の見込み・費目の予算) |
| FR-027 | 予算・費用 | VERIFIED | ✓ | P2・G5・Receipt・Remaining-2 | 為替は ECB の参考値を自動で取れる(Remaining-2。対応外の通貨は出典つきの手入力)、本番での確認(RELEASE-1)。レシートの読み取りは実物と実の AI では未確認 |
| FR-028 | 立替・精算 | VERIFIED | ✓ | P2・G5 | 本番での確認(RELEASE-1) |
| FR-029 | 当日モード | VERIFIED | ✓ | L1・P10 | 外部状況の自動取得 |
| FR-030 | 外部状況 | INTEGRATED(部分) | ✓ | P10・Remaining-2 | 休業の外部provider。気象庁の警報・注意報は Remaining-2(実通信は omega-dev2 で未確認)、鉄道の運行情報は ODPT の鍵の後に未確認 |
| FR-031 | 安全な再計画 | VERIFIED | ✓ | P10 | 代替移動手段の探索、プッシュ通知 |
| FR-032 | Offline Pack | VERIFIED | ✓ | #36・K1 | サーバー側のパック、通信しない端末の遠隔消去。アプリの殻のキャッシュ(sw.js の登録は Remaining-1)は実機で未確認 |
| FR-033 | Offline同期 | VERIFIED | ✓ | P11・G6 | 本番での確認(RELEASE-1) |
| FR-034 | しおり生成 | VERIFIED | ✓ | P4・BookletPatterns | 冊子の面付。12 パターンは配備先の本物の字体・地図の画像で未確認 |
| FR-035 | 安全な印刷・公開 | INTEGRATED | ✓ | P4・Remaining-5 | サーバー側の PDF は画像のページ(文字の検索はできない。Remaining-5)。開発の image にも字体(fonts-ipafont-gothic)を入れた(Remaining-6。GCP の VM は次の配備から) |
| FR-036 | Calendar/Map IO | INTEGRATED | ✓ | P5・P8・MyMaps・Remaining-1・Remaining-5 | カレンダーの購読(webcal。Remaining-5)は外のカレンダーへの一方向。GPX/KML/CSV・取り消しの取込は Remaining-1。Google マイマップは KML の案内付き取り込み(自動作成なし、自動更新なし) |
| FR-037 | 写真・旅行記 | INTEGRATED(部分) | ✓ | P12・Q1・G6・G11・PhotoMap・PhotoQR・PhotoPlace・Remaining-5 | 顔の検査は Google Cloud Vision の接続口(Remaining-5。鍵の後に実通信で未確認)。写真の地図・QR の投稿は実機未確認。印のまとめ表示は Remaining-6 |
| FR-038 | 位置軌跡 | VERIFIED | ✓ | P13・L5 | バックグラウンドの記録、現在地の共有 |
| FR-039 | 輸出・削除 | VERIFIED | ✓ | P6・P9・G7・G8 | 書類の写しの添付による出典の証明 |
| FR-040 | 管理・監査 | VERIFIED | ✓ | A2・S11・G2・G4 | 管理の画面の外部連携の障害の表示(ADM-01)、本番での運用の確認(RELEASE-1) |
| FR-041 | 組織・B2B | INTEGRATED(部分) | ✓ | B1・G5 | 組織の料金(FR-058 待ち)、本番の DNS でのドメインの確認(RELEASE-1) |
| FR-042 | API・埋込 | INTEGRATED(部分) | ✓ | B1・G2・Remaining-5 | 旅行・予定・場所・予約の書き込み(個人データを外へ出さない方針で配布だけ)。埋め込み(iframe・JS の部品)は Remaining-5 |
| FR-043 | Quick Plan | VERIFIED | ✓ | #38・R2 | — |
| FR-044 | Guest Travel View | VERIFIED | ✓ | #35・#41・E1・G4 | モバイルの実機での確認(UX-03)、本番での確認(RELEASE-1) |
| FR-045 | 安全な共有ポリシー | VERIFIED | ✓ | F45・G2 | — |
| FR-046 | 画像・PDFの出力 | INTEGRATED | ✓ | P4・P16・Remaining-5 | PDF・NOW/NEXT の画像はサーバーの Pillow で作る(Remaining-5。PDF は画像のページ)。生成は監査に残す |
| FR-047 | 旅程複製 | VERIFIED | ✓ | #39・R3-12・E1 | — |
| FR-048 | Offline Travel Pack(端末) | VERIFIED | ✓ | #36・P11・K1・G6 | 本番での確認(RELEASE-1)。通信しない端末は鍵の期限(30日)の後は開けない(消去は次の通信の時)。sw.js の登録は Remaining-1(実機で未確認) |
| FR-049 | Visited Area Layer | INTEGRATED(部分) | ✓ | V2 | 候補の層・地図タイル(OpenStreetMap)の上への表示は Remaining-7。実機の位置の記録での確認は UAT |
| FR-050 | 訪問判定・信頼度 | VERIFIED | ✓ | V2 | — |
| FR-051 | 訪問訂正・除外 | VERIFIED | ✓ | V2・Q1・G6・G8 | 実機の GPS での訂正・除外の確認(PoC) |
| FR-052 | Personal Travel Atlas | INTEGRATED(部分) | ✓ | P15・Remaining-2 | テーマ別は予定の種類から(Remaining-6)。国・都道府県・市区町村は Remaining-2(国土地理院・Nominatim。実通信は omega-dev2 で未確認) |
| FR-053 | 旅の達成指標 | VERIFIED | ✓ | P14 | — |
| FR-054 | 予定と実績 | INTEGRATED(部分) | ✓ | P14 | 予定の経路と GPS の軌跡の比べ(到達・寄り道・経路からの外れ)は Remaining-7。予定の経路は直線(道の形ではない) |
| FR-055 | Local-first Location | INTEGRATED(部分) | ✓ | L5 | 端末のバックグラウンド記録、端末内の点の暗号化 |
| FR-056 | 適応型GPS | INTEGRATED(部分) | ✓ | L5 | OS の geofence、電池の計測 |
| FR-057 | Memory Replan | VERIFIED | ✓ | P17・G7 | 実際の旅の記録が増えた時の傾向の確かめ(RELEASE-1) |
| FR-058 | Entitlement・料金 | INTEGRATED(部分) | 一部 | Remaining-4 | Stripe のテストモードだけ(本番の鍵 sk_live_ は断る。利用者の決定 2026-11-13)。価格は仮(管理画面で変える)。実の Stripe のテストの鍵での確認は鍵の登録の後。組織でまとめる支払い(FR-041)・指定した支払う人は未実装。E2E は鍵の無い時の案内だけ |
| FR-059 | 旅程相談 API の原価上限・クラス別 Quota | INTEGRATED(部分) | ✓ | FR059-A・FR059-B・FR059-C・FR059-Tiers・ProviderConnect | OpenAI(ai.generate)・Places(places.search)・Routes(routes.element)の adapter と鍵の有効性の確認は実装済み(CI は模擬の通信。実の鍵での確認・実送信・請求の照合は omega-dev2 で未実施)。places.details・places.photo・ai.web_search・map.load(Maps Static)の adapter は Remaining-7(実の鍵での確認・請求の照合は鍵の後)、会員の機能クラス Free/Trip/Journey/Explorer の価格・販売(FR-058)、保存の数・オフライン・書き出しのクラス別の制限は未実装(既存の上限のまま)、決済(Trip Pass の購入・指定した支払う人・組織でまとめる月の枠は FR-058・FR-041)。鍵の確認は 72 時間で失効する |
| FR-060 | スポットモード(自由に歩くエリア) | INTEGRATED(部分) | ✓ | SpotMode | エリア・候補・当日の着いた/行きたい印・周りを探す・次どこ？・方角で見る・端末への保存・別行動の集合の共有・旅帖の歩いた順は実装済み(統合試験・E2E・画面の試験)。周りを探すの実の場所の検索(CI は模擬)・実機(iPhone・Android・iPad の位置・地図・画面の大きさ)・旅行当日の確認は未実施(確認表は縦断シナリオ §10)。地図の絵の端末への保存は OpenStreetMap の方針で一括取得をしない(圏外は方角で見る) |
<!-- /generated:fr-table -->

## 4. 主要な縦切り(J-01〜J-07)

| ID | 縦切り | 状態 | 残り |
|---|---|---|---|
| J-01 | 登録なしで旅程を作る(FR-001/004/005) | 成立(quickdraft-flow・auth-flows) | — |
| J-02 | ホテル予約の一元化(FR-008/010/011/012/013) | 部分成立(予約・チケット・文書・取込・オフラインの鍵を E2E で確認) | PDF・メールからの自動抽出、チケットのオフライン表示 |
| J-03 | 説明可能な最適化(FR-014〜018) | 成立(内部推定の範囲) | 外部経路による実移動時間 |
| J-04 | グループの合意(FR-020〜024) | 部分成立(投票・懸念・決定の採用・コメント・秘匿プロフィール・開いている人) | コメントの即時の配信 |
| J-05 | 当日の障害対応(FR-029〜033) | 成立(外部 provider を除く) | 外部状況の自動取得、プッシュ通知 |
| J-06 | 安全な出力(FR-034/035/039/045) | 成立(ブラウザ側の出力、項目単位の共有の規則、しおりの Web 公開) | サーバー側の PDF |
| J-07 | 旅の記憶(FR-037/038/052/053/054/057) | 成立(旅行記の公開 URL を含む) | 地図の上の表示 |

## 5. 品質・運用の基盤(要点)

| 区分 | 現在 | 証拠 |
|---|---|---|
| CI | 5ジョブが blocking(secret-scan / dependency-audit / frontend / backend / e2e)。**G1: pytest と E2E の結果(JUnit)を保存し、VERIFIED の証拠の合格を照合。frontend の bundle の上限(main 450kB・gzip 150kB)。G9 Q03 で main を 430kB に下げた** | `.github/workflows/ci.yml`、`scripts/ci/` |
| main の保護 | 必須の CI・管理者にも適用・強制 push と削除の禁止・直線の履歴(H1 で設定)。**G1: 設定を `docs/ops/evidence/branch-protection.json` に記録** | `scripts/ops/ci_gate.py export` |
| 秘密の検査 | 追跡中のファイルの中身と、**G1: ファイルの種類(.env・鍵・Redis のダンプ・DB のファイル)**。`backend/dump.rdb` を追跡から外した | `scripts/security/scan_secrets.py` |
| 依存の脆弱性 | pip-audit 0件。npm audit 0件(G2 で例外 0 件) | `scripts/security/audit_deps.py` |
| 試験の品質(G3) | 単体試験の標準エラー 0 行・本物の通信の禁止・再試行なし(vitest)。E2E の flaky を別に数え issue 化。coverage・migration の構造の差分・mypy の基準(増やさない)。**G10-Q: mypy 0 件(models を SQLAlchemy 2.0 の型付きの列へ・不要な type: ignore も失敗)・ORM と migration の列・型・NULL の一致を試験・V3 再監査の規則 R1〜R8 を CI で検査(`scripts/ci/audit_v3.py`)** | `scripts/ci/`、`backend/mypy-baseline.txt`、`backend/tests/test_gate_g10_quality.py` |
| 性能(G3) | 外部キーの索引の欠落 0・主な API の SQL の数が件数で増えない(N+1)・主な問い合わせの索引の使用。毎晩、予定 10,000・通知 100,000 で p95。**G10-Q: `99744c3` から落ちていた毎晩の検査を修正(一括の INSERT の分割を1文として数える・古い判定の記録の削除を1文に)** | `backend/tests/test_gate_g3_perf.py`、`.github/workflows/perf.yml` |
| 画面の配信(G3) | `vite preview` をやめ、依存なしの本番用の配信(CSP・キャッシュ・圧縮・SPA) | `frontend/server/static-server.mjs` |
| 見た目の基準(G9) | UX-0 今の6画面の記録(PC・スマホ)と壊してはいけない所の E2E、UX-1 デザインの決まり(色・面4種類・文字と地の AA・暗い見た目)と一覧 `/design-system`。**G10-UX: UX-8 暗い見た目を全ての画面へ(`<html data-theme>`・今の色のクラスの橋渡しの生成 CSS、漏れ 0・置き換えた文字は 4.5:1 以上)・UX-6 共通の部品を決まりへ(直書きの色のクラス 3,338 → 1,632、増やさない)・UX-5 当日の画面(今・次・この後・下の固定の操作)** | `docs/ux/UX-0_baseline.md`、`frontend/e2e/ux-baseline.spec.ts`、`frontend/src/styles/tokens.ts`、`docs/adr/ADR-design-tokens.md`、`frontend/src/styles/darkBridge.ts`、`frontend/e2e/gate-g10-ux.spec.ts` |
| エラーの説明(G3) | 全てのエラーの応答に問い合わせ番号・再試行の可否・code。一覧はコードから生成 | `docs/spec/error-catalog.md` |
| 運用 | バックアップ・別DBへの復元演習・監視・ログの漏れの検査・封じ込め・**G1: 鍵の点検と版の切り替え(`tcops.py keys`)** | `docs/ops/RUNBOOK.md`、`docs/ops/KEY-INVENTORY.md` |

## 6. セキュリティ(SEC)の状況

| 項目 | 状態 | Gate | 残り |
|---|---|---|---|
| SEC-00〜23(認証の強化・回数制限・自動遮断・計算の確認・封じ込め・CSP 報告・ログの保護・依存の監査) | 実装済み | S1〜S10 | 閾値の実運用での見直し |
| SEC-06 管理者の多要素認証 | 実装済み | S11 | passkey |
| SEC-24 main の保護 | 実装済み(設定の記録は G1) | S11・H1・G1 | — |
| SEC-F1 暗号化の鍵の版の切り替え(前の鍵での復号・今の鍵での暗号化・掛け直し・失効) | **実装済み** | **G1** | 定期の切り替えの演習の記録 |
| SEC-F2 鍵の一覧・用途の分離・使い回しの検出 | **実装済み** | **G1** | — |
| SEC-F3 KMS / Secret Manager | 未着手 | — | 本番環境(GCP)と同時 |
| SEC-F4 DB の権限の分離(migration 用と実行用) | **実装済み** | G2 | — |
| SEC-F5 鍵の破棄による削除(cryptographic erasure) | **実装済み**(旅行・利用者ごとのデータ鍵、バックアップの鍵の写しからも消す) | **G3** | KMS(SEC-F3)へ KEK を移す |
| SEC-F6 TOTP の秘密の保護 | **実装済み**(版つきの MFA_KEY、解除は申請と承認の二者) | S11・G1・**G3** | — |
| 本番の入口(HTTPS・WAF・外部監視・別系統のバックアップ・侵入試験) | 未着手 | — | PROD-01〜09 |

## 7. リリース台帳

| Release | 対象 | 状態 |
|---|---|---|
| 0.1 alpha(G1) | 基本しおり・共有・NOW | ほぼ達成(実機 mobile が未) |
| 0.2 alpha(G2) | 情報の一元化 | 部分(バーコード描画・自動抽出が未) |
| 0.3 beta(G3) | 実行可能性 | 達成(内部推定) |
| 0.4 beta(G4) | 当日の再計画 | 達成(手入力の alert) |
| 0.5 beta(G5) | グループ・費用 | 部分(公平性の指標が未) |
| 1.0 | 一般公開 | 未(SLO・法務・サポート・本番の DR・侵入試験) |
| 2.x(G6) | 記憶・B2B・API | 部分(料金 FR-058 が未) |

## 8. 次工程(Gate の順。監査の実行台帳 2026-10-20 に従う)

| 順 | Gate | 内容 | migration | 外部の判断 |
|---|---|---|---|---|
| 1 | G1(済) | DOC-10 の正本化・trace の整理・`dump.rdb`・公開範囲の方針・鍵の版の切り替え・鍵の一覧・CI の証拠の保存と照合・bundle の上限 | なし | なし |
| 2 | G2(済) | DB の権限の分離・依存のメジャー更新・即時の共同編集・サポート閲覧・同行者向けの項目の規則・外部 API の書き込み | あり | なし |
| 3 | G3(済) | 画面の移動先・本番用の配信・試験の警告・鍵の破棄による削除・TOTP の鍵・CI の証拠・型・flaky・性能・エラーの説明 | あり | なし |
| 4 | G4(済) | 検索のコマンド・場所の例外日と入口・合意の決定・対象ごとのコメント・ゲストの閲覧の複製・濫用の検知の画面 | あり | なし |
| 5 | G5(済) | 予算の版と為替の記録・精算の取消と端数・使用量の上限・組織のロゴ・ドメイン・席 | あり | なし |
| 5b | G6(済) | オフラインの端末ごとの鍵と失効・日程と並びのオフラインの編集・位置のぼかし(守る範囲・軌跡の両端)・旅行記の公開と失効・記録の削除の取り消し | あり | なし |
| 5c | G7(済) | 移動の既定の滞在・疲れと休憩・最終の便(MOVE-03)・目的の内訳と部分の採用(MOVE-04)・記録の残り(MEM-03)・日をまたぐ予定・もしもの比較・猶予つきの削除 | あり | なし |
| 5d | **G8・G9 前半(本版)** | 案の中の区間・予約の変更と選んだ変更だけの採用・所有者の移譲・出典つきの訂正・定期の処理の記録・2つの端末の同時の編集(G8)、最初に読む JS 430kB・今の画面の記録・デザインの決まり(G9 Q03・UX-0・UX-1) | あり | なし |
| 5e | G9 後半(済) | UX-2 旅行の表紙・UX-3 見出し・UX-4 文脈型ダッシュボード | なし | 見た目の確認 |
| 5f | G10-Q(済) | V3 再監査(R1〜R8)・account-deletion の不安定の根治・mypy 0・毎晩の perf の修正・計算の確認の点数 | なし | なし |
| 5g | **G10-UX(本版)** | UX-5 当日の画面・UX-6 共通の部品の置き換え(残りの直書きの色 1,632 件は画面ごとに下げる)・UX-8 暗い見た目を全体へ | なし | 見た目の確認 |
| 5h | G11-Media / G12-Self | 旅行の写真の表紙(EXIF の除去・非公開の保存)/ 外部の提供元の要らない残り(Undo・投票・URL の題名・即時の通知・取り込み・埋め込み) | 場合により | なし |
| 6 | PROD-1・2 | HTTPS・WAF・private origin・Cloud SQL・Redis・GCS・ClamAV・別系統のバックアップ・外部監視・KMS | 場合により | GCP の project・domain・費用 |
| 7 | MAP-P / OCR-P | 地図・経路・ジオコード・OCR・天気・メールの提供元(**有料のものは FR059-B の合格の後**) | cache 等 | 契約・API キー |
| 7b | **FR059-A(済)→ FR059-B(本版)** | 外部 API の原価上限(1旅行 50円)・利用者クラス別 quota の正本化(A、docs だけ)→ サーバー側の予約・確定・解放・台帳・管理の二者の承認・画面の利用枠(B、fake provider で受入条件) | B であり | なし(利用者が決定済み) |
| 8 | BILL-1 | FR-058 料金(価格・決済。原価上限は FR-059) | あり | **利用者の決定が必須** |
| 9 | V3 → RELEASE-1 | (部分)の再監査と VERIFIED への昇格 → staging・負荷・DR・侵入試験・β | なし | 運用の承認 |

## 9. 改訂履歴

| 版 | 日付 | 基準 | 内容 |
|---|---|---|---|
| r1 | 2026-09-26 | `94d855a` | 実装状況を実測へ同期(D1) |
| r2〜r6 | 2026-09-26〜27 | `5b73cfe`〜`2e06249` | L1b・A1・L2・L3・B-012・B-013 |
| r7 | 2026-10-16 | `f3cf06d` | P1〜P17・L4(FR 20件を遷移) |
| r8・r9 | 2026-10-17 | `655e811`・`d4ca2b9` | 運用基盤(O1)・ログの保護(O2) |
| r10 | 2026-10-18 | `501de35` | E1・K1・S1、セキュリティ整理(§6) |
| r11 | 2026-10-19 | `5b3ff04` | S2〜S10 の適用 |
| r12 | 2026-10-20 | `af7de3d` | L5・V1・C1・A2・S11・V2・Q1・C2・C3・F45・B1(VERIFIED 26)。追補として資料室にあった |
| r13 | 2026-10-20 | `16f1aa9` | 本書をリポジトリの正本にした(r12 の追補と r11 の本体を統合)。状態の機械が読む正本 `fr-status.json`、CI の照合(表・集計・ledger・migration head・基準 commit)。H1・G1 を反映。FR の状態の遷移なし |
| r14 | 2026-10-21 | `4bb0240` | Gate G2: DB の権限の分離(SEC-F4)・依存のメジャー更新(DEP-1)。FR-020(即時の通知)・FR-040(サポート閲覧・運用の要約)・FR-045(同行者向けの項目の規則)を VERIFIED、FR-042(書き込みの API・鍵の切り替え・自動の再送)は INTEGRATED(部分)のまま(埋め込みが残る)。`docs/trace/gate-g2-trace.md` |
| r15 | 2026-10-22 | `f327971` | Gate G3: 画面の移動先の検査(DEP-02)・本番用の配信(DEP-03)・試験の警告0(DEP-04)・鍵の破棄による削除(SEC-F5)・TOTP の鍵と解除の二者の確認(SEC-F6)・CI の証拠・型・flaky・性能(CI-02〜05)・エラーの説明(UX-04)。§6 の SEC-F4 を G2 で実装済みに直した。FR の状態の遷移なし。`docs/trace/gate-g3-trace.md` |
| r16 | 2026-10-22 | `f327971`+G3 | Gate G4: 場所の例外の日・最終入場・ラストオーダー・入口・出典の違い(MAP-02)・検索のコマンド(MAP-03)・合意の決定の採用・締切・定足数・同点(COL-02)・対象ごとのコメント・通知の設定・メールのまとめと再送(COL-03)・ゲストの閲覧の確認・一時トークン・複製(COL-05)・濫用への対応(FC-097)。FR-022 を VERIFIED。FR-008・FR-024 は外部の提供元(地図・メール)が残るため(部分)のまま。`docs/trace/gate-g4-trace.md` |
| r17 | 2026-10-23 | `f327971`+G3+G4 | Gate G5: 為替の記録(出典・基準日)・予算の版(当初・更新・確定・実績)・確定した予約額の換算と換算できない通貨の別表示(FIN-01)・支出の取消・端数の規則・精算の締め・領収書の選択・精算の冪等(FIN-02)・使用量の上限(soft/hard・管理者の上書き。BILL-02)・組織のロゴ・独自のドメインの確認・席の上限(ORG-01)。FR-027 を VERIFIED。FR-041 は料金(FR-058)が残るため(部分)のまま。`docs/trace/gate-g5-trace.md` |
| r18 | 2026-10-23 | `f327971`+G3+G4+G5 | Gate G6: オフラインの端末ごとの鍵(期限・1台だけの失効・失効した端末の消去。OFF-01)・日程と並びのオフラインの編集と依存の順・予約はオンラインだけ(OFF-02)・守る範囲と書き出し・公開での位置のぼかし(LOC-02)・旅行記の公開と失効・記録の削除の取り消し(MEM-01)。FR-048 を VERIFIED。FR-051 は(部分)を外した。FR-037 は顔の検査・MEMORY MAP(外部の提供元)が残るため(部分)のまま。`docs/trace/gate-g6-trace.md` |
| r19 | 2026-10-26 | `2576a91` | **Gate G7: 移動・滞在の既定・休憩の自動判定・日ごとの疲れ・最終の便(MOVE-03)・目的の内訳・条件の変更・選んだ予定だけの採用(MOVE-04)・同じ同行者と移動手段の傾向(MEM-03)・日をまたぐ予定・変更の影響の確認・実際のブラウザのドラッグ(FR-005)・本案と案の比較(FR-019)・猶予つきのアカウントの削除(FR-039)。FR-005・FR-057 を VERIFIED。FR-017 は時刻表の照合だけが残る。FR-018(外部の経路)・FR-019(案の中の予約・区間の分岐)・FR-039(所有者の移譲・出典つきの訂正)は(部分)のまま。`docs/trace/gate-g7-trace.md` |
| r20 | 2026-10-27 | `083e6b1` | Gate G8: 案の中の移動区間・予約の変更と選んだ変更だけの採用・予約の取消の手続き(FR-019)・所有者の移譲(FR-021・FR-039)・出典・確認・履歴つきの訂正と所有者への訂正の申し出(FR-039)・定期の処理の実行の記録と遅れ・失敗の監視・2つの端末の同時の編集の E2E(FR-004)・訪問の訂正の証拠の整理(FR-051)。FR-004・FR-019・FR-039・FR-051 を VERIFIED。Gate G9 前半: 最初に読む JS の上限 430kB(Q03)・今の6画面の記録と壊してはいけない所の E2E(UX-0)・デザインの決まり(UX-1)。`docs/trace/gate-g8-trace.md` |
| r21 | 2026-10-28 | `3c23828` | Gate G10-Q: V3 再監査(`scripts/ci/audit_v3.py` の R1〜R8。誤った VERIFIED 0、FR-001・002・006・044 の E2E に FR 番号を記載)・account-deletion の E2E の不安定の根治(削除の後の 401 で /login へ移さない)・mypy 1,382 → 0・毎晩の perf の修正・計算の確認の最初の1回を点数にしない。FR の状態の遷移なし。`docs/trace/gate-g10q-trace.md` |
| r22 | 2026-10-28 | `e39d5e7` | **Gate G10-UX: UX-8 暗い見た目を全ての画面へ・UX-6 共通の部品をデザインの決まりへ・UX-5 当日の画面・issue #7(オフラインの書き込みで共通の「ネットワークエラー」と「端末に保存」が食い違う)。FR の状態の遷移なし。`docs/trace/gate-g10ux-trace.md`** |
| r23 | 2026-10-28 | `540955d` | Gate G11-Media(G11 の段階1): 旅行の表紙の写真(既存の非公開・暗号化した写真の記録を選ぶ・取り込む、見せる位置と拡大、見える人だけに配信、撮影情報の除去、読めない時は色の表紙)。migration `a7c3e5f9b2d4`(表紙・予定の写真・外部の写真の出典・SNS の候補)。FR-037 は顔の検査・MEMORY MAP が残るため(部分)のまま。仕様 `docs/ux/G11_UIUX全範囲_実装仕様.md`、`docs/trace/gate-g11-media-trace.md` |
| r24 | 2026-10-28 | `540955d`+G11-Media | Gate G11-Planner(G11 の段階2): 予定ごとの営業時間の照合(`GET /plans/{id}/hours-check`。時間内・閉店間際・最終入場・ラストオーダー・滞在中に閉まる・休業・未確認・古い出典)と予定のカードの帯、予定へ着く移動の名前(新幹線・ヘリを足す。migration `b8d4f6a0c3e5`)・日の現地の時刻帯・時差をまたぐ区間の両端の現地の日時、触って使う並べ替え(上へ・下へ)と再確認の知らせ、全日程の横断チャート。FR の状態の遷移なし(FR-005 の実機のタッチ・FR-014 の外部の時刻表は残る)。`docs/trace/gate-g11-planner-trace.md` |
| r25 | 2026-10-28 | `b21e47b`+G11-Planner | Gate G11-Discover(G11 の段階3): 外部の画像・SNS の provider の interface(設定で止められる。値を作らない)、Wikimedia Commons の写真の候補(作者・ライセンス・出典。CC0・PD・CC BY・CC BY-SA だけ取り込める)と非公開の記録への取り込み(記録と同じ検査・撮影情報の除去・暗号化。出典を残す)、YouTube・TikTok の公式 oEmbed による SNS の投稿の確認(投稿へ直接つながない。取れない時は URL とメモ)と候補箱への social の保存、予定のカードの写真、近くの検索のカテゴリ・半径・距離・Overpass の正規表現の逃がし。migration なし(G11-Media で用意した列を使う)。FR-007 の gaps を「SNS 以外の URL の題名・画像の取得」に狭めた(部分のまま)。`docs/trace/gate-g11-discover-trace.md`・`docs/adr/ADR-media-providers.md` |
| r26 | 2026-10-29 | `1c25a37` | Gate G11-Planner2(G11 の段階6): 路線バス・高速バスの区別(migration `c4e8a1f3b7d2` で区間の mode に express_bus)、移動の区間をタイムラインの独立した行に出し並べ替えで合わなくなった区間を知らせる、並べ替えの影響(順・営業時間・区間)と元に戻す、確定の予定を動かさない(確定の予定がある日の並べ替えが 409 で失敗していた不具合を直した)。G11-Style・G11-Intake(段階4・5)はDOC-10 を変えていない。FR の状態の遷移なし。`docs/trace/gate-g11-planner2-trace.md` |
| r27 | 2026-10-29 | `6571fc5` | Gate FR059-A: 外部 API の原価上限(1旅行 50円・全 provider の合計・ちょうど 50円は許可・40円で警告)と利用者クラス別 quota(Guest 0・Free 月1旅行/50円・Trip Pass 対象の1旅行・Plus 月5旅行/250円・Family/Group 人数で増えない・Pro/B2B 契約)を正本 `docs/spec/FR-059_旅程相談API原価上限_利用者クラス別Quota_v6.0.md` にし、FR-059 を SPECIFIED で登録(全60 FR)。FR-058 は価格・決済に絞った。資料室の追補との差異は同書 §13。docs だけ。`docs/trace/gate-fr059a-trace.md` |
| r28 | 2026-10-29 | `6571fc5`+FR059-A | Gate FR059-B: 外部 API の原価の守りをサーバーに実装(migration `d5f9b2c8e1a3`: entitlements・usage_policy_profiles(policy 2026-10-29.1 の6クラス)・usage_budget_accounts・provider_usage_reservations・provider_usage_events)。クラスの解決(Guest 0・Free・Trip Pass・Plus・Family・Pro の契約の例外は二者の承認の後だけ)、旅行・月の口座の行の鍵による原子的な予約(ちょうど 50円は許可)、回数・token の上限、冪等・確定・解放・期限切れの回復、再試行1回、見込みの超過と請求の照合の差で provider を止める、`GET /entitlements`・`GET /plans/{id}/planning-usage`・`POST /plans/{id}/planning-actions/estimate`・管理の申請と承認、旅程・下書き・旅行相談の利用枠の表示。FR-059 を INTEGRATED(部分)(外部の有料 provider は未接続)。`docs/trace/gate-fr059b-trace.md` |
| r29 | 2026-10-29 | `6571fc5`+FR059-B | Gate G11-Vote(G11 の段階8): 候補箱で家族・グループが候補に投票する(合意形成 FR-022 の投票の選択肢を候補にする仕組みを使う。新しい表なし)。FR-007 の gaps から「候補への投票」を外した(OCR・音声認識・URL の題名が残るため(部分)のまま)。間の Gate CI-429(接続元の点数の log)・G11-Preview(並べ替えの案)は DOC-10 を変えていない。`docs/trace/gate-g11-vote-trace.md` |
| r30 | 2026-10-30 | `b75c645`+G11-Layout | Gate FR059-C: FR-059 正本 §13 D14 provider の停止(見込みの超過・請求の照合の差)を Redis の印で全ての worker・運用のコマンドが共有する(届かない間は process の中で止め、届いた時に送る)。運用者の再開 `tcops.py security provider-resume`(理由が必須)。FR-059 の gaps から D14 を外した(外部の有料 provider は未接続のため INTEGRATED(部分)のまま)。間の Gate G11-Layout(一覧のずれ・競合の後の読み直し)・UX6-Icons(旅程の中の移動の絵文字)は DOC-10 を変えていない。`docs/trace/gate-fr059c-trace.md` |
| r31 | 2026-10-31 | `ad041f5` | Gate AppShell(#33)・Gate OpsCMS(#35)・Gate OpsSecrets: UI/UX モックの画面、運用コンソール `/admin/ops`(外部 API の接続・原価の台帳・Cloud 環境・Fake の家族旅行の試験)、運用コンソールから API キーを暗号化して登録(migration `e8b4c2a7f1d3`: provider_secrets・`f2a6d8c4b9e1`: 外部キーの索引)。FR の状態は変えない(有料の provider は未接続)。`docs/trace/gate-appshell-trace.md`・`docs/trace/gate-opscms-trace.md` 間の Gate GeocodeJP(#37: 旅行相談の地名を日本で照会・地図の CSS・人数の食い違い・方面の詳細・近くの検索の失敗の表示・管理の画面の余白)も FR の状態を変えていない(`docs/trace/gate-geocodejp-trace.md`)。**Gate DOC10-Rev(2026-10-31)**: r31 の行を書いたのに版の表示と `fr-status.json` が r30 のままだった食い違いを直し、版の表示・`fr-status.json` の revision・変更履歴の最後の行が一致することを CI で確かめる(`test_doc10_revision_matches_status_and_changelog`) |
| r32 | 2026-10-31 | main+FR059-D11 | Gate OpsSecrets-Clarity(#39)・Gate FR059-D11: 運用コンソールに鍵の保存先(アプリの DB・Secret Manager ではない)と接続(adapter)の列、配布物の秘密の CI の検査。FR-059 正本 §13 D11: 無料の provider(Nominatim・Overpass・Wikipedia・Wikimedia Commons・oEmbed)へ送った回数を 0円・価格の版 free で記録し、FR-059 の gaps から D11 を外した。§2.2.1 で価格の版の単価が 2026-10-31 の公開の単価以上であることを確かめた(版は変えない)。外部の有料 provider は未接続のため INTEGRATED(部分)のまま。`docs/trace/gate-opscms-trace.md`・`docs/trace/gate-fr059-d11-trace.md` |
| r33 | 2026-10-31 | `39aac73`+FR059-Tiers | Gate FR059-Tiers: 会員の機能クラス Free(自分でつくる)・Trip(行先を見つける)・Journey(計画を一緒に考える)・Explorer(比較して深掘りする)を実装(FR-059 正本 §3.2〜§3.5・migration `a1d3f5b7c9e2`: 価格の版 2026-10-31.1、以前の Free(AI 5回)は retired)。クラスに含まない有料の操作は provider の前で 403 `tier_feature_not_included`(新しい Free は AI・有料の検索なし)、全てのクラスで 1旅行 50円・40円の警告・45円の運用の知らせ。旧クラス(Plus・Trip Pass・Family・Pro)は一律に変えない。運用コンソールに「会員クラス」(比較・機能の表・移行の表・開発環境の試験の切り替え)、Fake の試験のクラスの選択。価格・販売・決済(FR-058)は持たない。FR-059 は外部の有料 provider が未接続のため INTEGRATED(部分)のまま。`docs/trace/gate-fr059-tiers-trace.md` |
| r34 | 2026-11-01 | `1db0815`+ProviderConnect | Gate SecretPolicy・Gate ProviderConnect: 外部 API の鍵の取得元を登録した有効な版だけにし(.env への fallback の廃止・サンプル値の拒否・保管先 SECRET_BACKEND の明示)、新しい鍵は候補として保存して、提供元への最小の要求で有効性を確かめてから有効にする(migration `b7e3c9d1f5a2`)。確認の費用は管理者の確認の日の枠(50円/日)。OpenAI Responses・Places Text Search・Routes computeRoutes の adapter を旅行の中の明示の操作(AI に聞く・Google で場所を探す・経路を調べる)へ接続し、会員のクラス・1旅行 50円・停止・確認済みの鍵を送る前に確かめる。時間切れは見込みで確定、鍵の拒否は次の送信を止める。FR-059 は実の鍵での受入・請求の照合が未実施のため INTEGRATED(部分)のまま。`docs/trace/gate-secretpolicy-trace.md`・`docs/trace/gate-providerconnect-trace.md` |
| r35 | 2026-11-01 | `679277e`+ConsultAI | Gate ConsultAI: 旅行相談の「AI で読み取る」(OpenAI Responses の構造化の出力。AI の行は未確認として示し、確かめた行だけを条件に使う)・AI の方面の案(足した時だけ比べる)・方面の詳細の「Google で場所を探す」「経路を調べる」を、旅行を作る前の相談の口座(migration `c3e5a7b9d1f4`: trip_consult_sessions・口座の範囲 consult。1相談 = 1旅行の 50円・回数、下書きを作ると旅行の口座へ移す)で接続。送る前に AI の利用の同意・クラス・枠・確認済みの鍵。CI の E2E は模擬の提供元(PROVIDER_HTTP_STUB、本番では起動を拒む)。あわせて Gate OFF-02 の日付の不具合(日の追加が既存の日と同じ日付になる)を直した。監査(09be28b)の指摘も直した: 同じ Idempotency-Key の並行・再送で二度送らない(送信権の確保・要求の指紋)、usage が分からない応答を 0 円にしない、確かめていない日数・出発地を使わない、予算の意味(誰の分・対象・期間・上限か目安か)、入力の仕方の切り替え・音声で入力・その他の希望・追加の相談の変更案と元に戻す、反映の道具(PR の本文・段ごとの再開・merge 前の停止・500/503 の失敗・決め打ちの downgrade の廃止)、CI の要約の自己試験の隔離と E2E のリリース判定。FR-059 は実の鍵での受入・請求の照合が未実施のため INTEGRATED(部分)のまま。`docs/trace/gate-consultai-trace.md` |
| r36 | 2026-11-01 | `78aefe5`+AdminUAT | Gate AdminUAT: 運用コンソールの鍵の表示を登録と接続確認の状態から1つに決める(DB 登録済みに再登録を促さない・旧 .env は「旧設定の詳細」へ・確認済みは確認期限つき・使わない鍵は「設定不要」・提供元の停止は鍵の確認と別に表示・Fake の試験のクラスは会員クラスと別と明示)。概要に旅行相談の UAT の準備(このアカウントの会員クラス・同意・鍵・停止・模擬かどうかと変える場所、`GET /admin/ops/uat-readiness`)。食い違う希望を AI が片方に決めず示す。音声の UAT 用の https の入口(compose の profile `uat-https`・`scripts/ops/uat_https.sh`)。実環境・実 AI の U01〜U12 は未実施(runbook `consult-uat-omega-dev2.md`)。FR-059 は INTEGRATED(部分)のまま。`docs/trace/gate-admin-uat-trace.md` |
| r37 | 2026-11-01 | `04f7537`+SearchUAT | Gate SearchUAT: 旅行相談の方面の詳細の場所の検索の入口を「候補を探す」の1つにし、検索元(OpenStreetMap 無料 / Google 有料・この相談の利用枠)を同じ欄で選ぶ(Google の場所の検索の欄は廃止、経路は別)。Google は鍵の確認・会員クラス・停止・利用枠を判定して理由と解決の操作を出し、無料の失敗から自動で切り替えない。UAT の失敗の原因(コード上): Overpass の要求に User-Agent が無く、公開の server が 406 で断っていた。User-Agent を付け、失敗を分類して画面・API・利用の記録・ログに残す(該当なしと区別)。Google の場所は下書きに place ID と URL だけを保存。実環境の確認は `scripts/ops/search_diag.sh` と runbook §2b(未実施)。`docs/trace/gate-search-uat-trace.md` |
| r38 | 2026-11-02 | `6920d88`+監査 F01〜F06 | Gate SearchUAT の監査(6920d88)の是正: PR #45 の PR 側の E2E の flaky(登録の後の時間切れ)は、登録の回数制限(1分5回・接続元ごと)の 429 と手元で再現し、試験の環境だけの回数の記録の初期化と応答の列の記録で直した(本番の制限は変えない。retries=0 で10回合格)。反映の道具は PR 側の必須の検査を待ってから merge する。Google の検索の応答の喪失の後は同じ Idempotency-Key(二度課金しない)・検索範囲を送る。Overpass の応答の構造の検証と一部だけの結果の区別。検索の失敗の原因は未確定(同じ本文で User-Agent だけを変える比較で確かめる)。会話理解・AI 10回・原価の半減(F07)は未実装。`docs/trace/gate-search-uat-trace.md` |
| r39 | 2026-11-02 | `6632d65`+SearchUAT-S3 | Gate SearchUAT-S3: OpenStreetMap(Overpass)の問い合わせを軽くし(囲む四角・カテゴリの種類と値・server の上限 10 秒/64MB)、429 の Retry-After・406 の 10 分はアプリから送らない待機(Redis で共有)、同じ条件の成功の 45 分の保存(キーは条件の SHA-256)と提供元の失敗の時の「前の結果」、承認した mirror だけへの移り(既定は空)。`search_diag` の occurred_at・送った header の記録・標準は外へ 1 回。概要の ¥ を「利用枠の計上(見込み)」「管理者の鍵の確認」「提供元の請求額(未照合)」に分け、計上の根拠の表。料金版 `2026-11-02.1`(migration `e9c1a5d3f7b2`: Places Text Search Pro $0.032・gpt-5-nano の公式の単価・Journey/Explorer の AI 10回・Journey の検索 3回・AI の保護の枠)。追加の相談の黙った切り捨ての廃止、管理ダッシュボードのゲスト・試験の区分。実環境の検索・実 AI・端末の音声・請求の照合は未実施、F07-1/2(会話の状態・複数の予算)は次の PR。FR-059 は INTEGRATED(部分)のまま。`docs/trace/gate-search-uat-s3-trace.md` |
| r40 | 2026-11-02 | SearchUAT-S3+F07-Turn | Gate F07-Turn: 旅行相談の追加の相談を1ターンとして読む `POST /trip-intents/ai/turn`(AI へは最新の発言と今の条件の状態(値・確認の状態・ID)だけ。JSON Schema strict の操作: 項目の set・clear、過ごし方・その他の希望・予算(複数)・方面の候補/決定/外す、食い違い・問い)。根拠が最新の発言に無い・知らない ID・範囲の外の操作は捨てる、同じターンの同じ項目の食い違いは決めない、確かめた行への変更は変更案(採用するまで変えない)、人数の変更で予算を計算し直さない。下書きの intent に確かめた予算の全て(`budgets`)。実 AI の 10 ターン・30 会話の評価・原価の半減の比較は未実施。FR-059 は INTEGRATED(部分)のまま。`docs/trace/gate-f07-turn-trace.md` |
| r41 | 2026-11-02 | F07-Turn+HomeHeroVideo | Gate HomeHeroVideo: HOME の「最初の旅行を始めましょう」の背景だけを最大 4 本の動画にする仕組み(7 秒ごと・クロスフェード・音声なし・次の場面だけを先に読む・隠れた間は停止・動きを減らす設定と Save-Data は静止画・読めない場面は飛ばす)。素材は受け取り待ちで設定は空(画面は以前の山並みの絵のまま)。素材の台帳 `docs/ux/home-hero-video-assets.md`。あわせて下書きの画面に旅行相談で確かめた予算(複数)を表示。`docs/trace/gate-home-hero-video-trace.md` |
| r42 | 2026-11-02 | HomeHeroVideo+AreaGeo | Gate AreaGeo(UAT 15:30 の指摘): 方面の位置を内蔵の地名の表(47 都道府県と代表の地名)→ Nominatim(5 件から場所の種類と重要度で選ぶ)の順に決め、出発地からの直線の距離が上限を大きく越える位置は疑わしいとして地図に置かず理由を出す(③が北海道の是正)。地図の枠を大きくし、上限を越える方面を除いて範囲を合わせる。観光の場所は Overpass と Wikipedia の座標付きの記事を並行して探し、行ごとに出典を示す。HOME の動画は透かし入りのプレビューのため公開リポジトリに入れず、配備先の手元だけに置く仕組み(`scripts/ops/install_hero_local.sh`・.gitignore)と動画の Range の配信。実環境の確認は未実施。`docs/trace/gate-area-geo-trace.md` |
| r43 | 2026-11-02 | `5a7a18c`+AreaLogic | Gate AreaLogic(UAT 18:16 の指摘): 比べる方面を「行き先・地域の範囲(関西・東海・北陸…)・行き先ではない語(出発地・高速…)」に分け、出発地を地名だけにし、行き先が無い・候補を頼まれた時は内蔵の候補表から条件(片道の目安・地域・過ごし方)に合う方面を選ぶ。AI の方面の案は範囲と目安で確かめる。Nominatim のあいまいな一致を捨てる。未確認の出発地も位置関係には使う。HOME 動画の連続の切り替え(ちらつき)の修正。実環境は未確認。`docs/trace/gate-area-logic-trace.md` |
| r44 | 2026-11-03 | `1aa46bb`+AreaAI | Gate AreaAI: 旅行相談の方面は AI の読み取りと同じ 1 回の要求で、条件に合う具体的な行き先(頼まれた件数・既定 4)を片道の目安・見どころつきで出し、サーバーで範囲・距離の明らかな誤りを外して比べる方面にする(追加の費用なし。足りない分だけ内蔵の候補表)。比較の画面は AI の目安で片道の条件を判定し、超えそうな方面は地図に置かない。AI の案の都道府県で同じ名前の別の場所を避ける。方面ごとの Google Routes(PR #51)は統合しない。実 AI の UAT は未実施。`docs/trace/gate-area-ai-trace.md` |
| r45 | 2026-11-03 | `83c3406`+AreaAI2 | Gate AreaAI2: AI の方面の案に特色・代表的な場所(種類つき)・希望に合う理由・注意・片道の目安を必ず入れさせる(条件の読み取りの「推測しない」と分ける)。方面の代表画像(Wikipedia・無料)。相談の入力の欄をキーボード(鉛筆)と音声(声の大きさの棒)で区別。方面の比較の地図で選んだ方面を強調。方面の詳細の場所に種類・代表画像・説明を付け、観光でない記事を除き、希望に合う種類を先に並べ、種類と希望で絞り込む。実環境は未確認。`docs/trace/gate-area-ai2-trace.md` |
| r46 | 2026-11-03 | `c561ff4`+AreaAI3 | Gate AreaAI3: AI の方面の案が足りない時だけ案だけを頼む 2 回目の呼び出し(条件の要約だけ)。出力は日本語。方面の詳細に代表的な場所(提案の場所を Wikipedia に結び付け・AI のおすすめは方面ごとに 1 回)を出し、近くの検索をおすすめ順(人気)/近い順で並べる。方面の写真の取り直し。モーダルの余白。始め方の写真。下書きの種類を日本語で。実環境は未確認。`docs/trace/gate-area-ai3-trace.md` |
| r47 | 2026-11-04 | `c561ff4`+AreaAI3+PlanUX | Gate PlanUX: 旅程の画面で移動手段の印を常に並べず、予定と予定の間で印を押して決める(詳細は後から)。予定を押すと選ぶだけ・編集は鉛筆から。編集の画面の見直し。時刻の無い予定に営業時間の照合を出さない。声の波形。始め方の写真の差し替え。`docs/trace/gate-plan-ux-trace.md` |
| r48 | 2026-11-04 | `ea97839`+HomeV2 | Gate HomeV2: ホーム v2(いま計画中の旅の準備と次にやること・旅行の一覧の状態のタブと見送り・旅の記録と思い出・旅の足あと・行ってみたい場所・道具)。`docs/trace/gate-home-v2-trace.md` |
| r49 | 2026-11-04 | `8b25f98`+MockFit | Gate MockFit: ホームの表紙・左の帯をモックアップ v2 の通りに、旅の記録と思い出の画面、しおりの Web 公開(migration `b7d2f4a6c8e1`)、写真(撮影場所)・声・SNS から探す(スポット検索・旅行相談・近くを発見で共有)。`docs/trace/gate-mock-fit-trace.md` |
| **r50** | 2026-11-05 | `d8bd1b7` | **設計書の as-built 改訂に合わせて同期: 基準 commit と試験の実測を更新、J-04/06/07 の古い残りを直し、FR-003(パスワード再設定)・FR-032/048(sw.js の未登録)・FR-059(鍵の確認の失効)の不足を明記。FR の状態の遷移なし** |
| **r51** | 2026-11-14 | `PR #108` | **残りの機能の実装(Remaining-1〜5): 地図・表の取込と取り消しの取込・オフラインのメモ・Code 128(1)、為替・気象警報・逆ジオコーディング・祝日・時刻表と運行情報の接続口(2)、取消期限の知らせ・メールの即時・予約メールの転送(3)、Stripe のテストモードの決済(4)、サーバー側の PDF・画像・埋め込み・カレンダーの購読・顔の検査の接続口(5)。FR-058 SPECIFIED→INTEGRATED、FR-024・035・036・046 の部分を外す** |
| **r52** | 2026-11-14 | `PR #110` | **Remaining-6: パスワードの再設定(忘れた時)・メールの確認の API と画面(FR-003)、1 通の予約メールを予約ごとに分ける(FR-011)、SNS 以外の URL の題名・説明・場所(FR-007)、写真の地図の印のまとめ(FR-037)、Atlas のテーマ別(FR-052)、GCP 配備の準備(開発の image の字体・購読 URL の https)。古い残り(FR-012 のバーコード・FR-032/048 の sw.js)を直す** |
| **r53** | 2026-11-14 | `PR #111` | **Remaining-7: passkey(FR-003)・画像と声からの候補(FR-007)・Gmail の連携(FR-011)・候補の層と地図タイル(FR-049)・予定の経路と軌跡の比べ(FR-054)・場所の詳細/写真/静的な地図/AI の Web 検索の adapter(FR-059)・制約の Undo(FR-016)と区間・経路の Undo の E2E(FR-014/015)・予算との連動(FR-026)・ゲストを既存のアカウントへまとめる(FR-002)。migration `e8a2c4f6b1d3`** |
| **r54** | 2026-11-16 | `dev/tripkit-ui` | **TripKitUI・HomePlace・HomeRoute: 旅行箱の 6 画面(概要・予約・準備・予算・文書・予約の取込)と検索の見出し・まとめの札・一覧の行・切り替えを同じ部品にそろえる。自宅の場所(本人だけ・暗号化。登録・地図に出す・経路に使う・提供元へ送るを本人が選ぶ)。旅程の地図に前の夜の宿・今夜の宿(連泊)・自宅の印と線(宿=紫・予定の間=緑・自宅=青)。migration `a3c7e9f1b5d2`** |
| **r55** | 2026-11-17 | `a2c419d`+Hardening-A | **製品固めゲート監査(2026-11-17)の是正: 共通正本(DOC-02/04/05/06/11/13)は資料室の v5.1(2026-09-03 発効)にあることを記録し所在を `docs/spec/CANONICAL-SOURCES.md` に(G-01・G-09)、全60 FR の要求の根拠・承認済みの変更・8 区分の証拠・残件の分類を `docs/trace/FR-TRACE.md` に(G-01・G-03)、DOC-11 の対応 `docs/security/SECURITY-TRACE.md`、SEC-009 の判定を差し替えない試験、開発の環境の間の同じ鍵の移し方を本番・ステージングで止める(G-10)、総合テストの縦断シナリオ `docs/test/integrated-acceptance-scenarios.md`、再判定とゲート判定 `docs/audit/2026-11-17_product-hardening-gate_addendum.md`。FR の状態の遷移なし。`docs/trace/gate-hardening-trace.md`** |
| **r56** | 2026-11-17 | `14065fe`+Hardening-A+DocsV6 | **資料の体系を v6.0 へ(利用者の指示 2026-11-17「完全に更新し旧バージョンは保管へ」): 本書を `DOC-10_*_v6.0.md`(版 v6.0-r56。r の番号は続ける)、FR-059 正本を v6.0 の名前へ。DOC-02 要件定義書 v6.0 をリポジトリの正本として作成(FR 59 件・プランB・FR-059・承認済みの変更を本文へ。FC・NFR・AC・EX は削らず引き継ぎ)。資料体系の README v6.0(`docs/spec/README.md`)・保管の索引(`docs/spec/archive/v5.1/`)。FR の状態の遷移なし** |
| r57 | 2026-11-17 | `167f266`+DocsV6-2 | **資料の体系 v6.0 の段階 2: DOC-04 画面仕様 v6.0(画面 ID と実装の経路の対応 §19、実装済みの画面 SC-44 旅行箱・SC-45 旅行相談・SC-46 旅行の下書き・SC-47 料金と利用枠・SC-48 写真の投稿を追加、SC-17 をプランBへ、今日の画面を旅帖ライブに、DOC04-A を §20 へ統合)、DOC-13 用語集 v6.0(プランB・旅行箱・旅帖・利用枠・移動手段・移動時間の出どころ・地図の線の言葉、エラーの code の正本を error-catalog に)。v5.1 は保管。FR の状態の遷移なし** |
| r58 | 2026-11-17 | DocsV6-2+ChatConsensus | **相談を話し合い中心にする(利用者の決定 2026-11-17): 画面はタブなしで「決まったこと」「投票」「話し合い」。発言の「これで決まり」(投票なしで記録・旅程へ反映)・「投票にする」(題名と選択肢の下書き)・かんたん投票を既定(1人1つ)・4段階・定足数・不可は「詳しい設定」・AI の選択肢の案(任意・同意と枠・名前を送らない・伏せ字・根拠の無い案を捨てる・保存しない)。API: POST /polls/decision・POST /polls/suggest-options、polls.mode・source_comment_id(Alembic `b7e3c9a1d5f4`)。DOC-02 FR-022・FC-065、DOC-04 SC-19・SC-20、DOC-13 §20 を更新。FR-022 は VERIFIED のまま(試験 backend/tests/test_gate_chat_consensus.py・frontend/e2e/discussion.spec.ts を証拠に追加)** |
| r59 | 2026-11-18 | ChatConsensus+SpotMode | **FR-060 スポットモード(自由に歩くエリア)を追加(利用者の決定 2026-11-18。モックアップを承認): 旅程に順番を決めない「自由に歩くエリア」を置き、当日は予定 ⇄ スポットを切り替え、地図・ジャンルの絞り込み・候補の詳しい所(歩く時間・方角・道順の目安・地図アプリ)・着いた/今日はやめる・行きたい印・次どこ？(気分・近さ・行きたい・営業時間・残り時間。AI なし)・回れる道順の案・周りを探す(位置を保存しない)・方角で見る・端末への暗号化保存・タブレット横の左右の配置・戻り始め。準備(SC-50)は候補箱で近くにまとまった候補からエリアの案。API /plans/{id}/spot-areas(11 経路)、表 spot_areas・spot_area_items(Alembic `c4d8e2f6a9b1`)。DOC-02 FR-060・DOC-04 SC-49/50・DOC-13 §21。FR-060 は INTEGRATED(部分)(実機・実の場所の検索・旅帖への記録は未)** |
| r60 | 2026-11-18 | SpotMode-2 | **FR-060 の残りの未実装を実装(利用者の指示): 別行動の集合の共有(PUT/DELETE /spot-areas/{id}/split。集合の時刻・場所・ひとことだけをメンバーに知らせる。位置は共有しない。閲覧者も自分の分。当日の札にも表示)・旅帖の下書きに日ごとの「自由に歩いた」(着いた時刻の順。位置なし。公開の旅行記には入れない)。表 spot_area_splits(Alembic `d5e9f3a7b2c6`)。実機の確認表を縦断シナリオ §10 に。FR-060 の残りは実機待ち・実通信待ちだけ** |
| **r61** | 2026-11-18 | Gate2-Docs | **製品固めゲート②(G2-09): 文書の件数・基準の食い違いを直した。DOC-10 の「全59 FR」(§0・§2・§3 の見出しと正本の表の説明)を実際の 60 件に、fr-status.json・fr-requirements.json の説明を 60 件に、FR-TRACE・縦断シナリオ・fr-requirements の基準 commit を `32c7db6`(PR #127 のマージ)に。FR の状態の遷移なし・コード・DB(Alembic head は `d5e9f3a7b2c6` のまま)の変更なし。実機・実 API の証拠は増えていない(FR-060 は INTEGRATED(部分)のまま)。`docs/audit/2026-11-18_gate2_ledger.md`** |
| **r62** | 2026-11-21 | Gate2-T2 | **判断票 T2(利用者の指示「未実装の作業をすべて継続しろ」): places(created_by, adopted_from_candidate_id) の部分一意インデックス(Alembic `e6a4c2b8d0f3`)。重複があれば migration は止まって何も変えない。採用の FOR UPDATE は残す。FR の状態の遷移なし** |
| **r63** | 2026-11-21 | Gate2-FC | **未実装の FC の実装(利用者の指示「未実装の作業をすべて継続しろ」): FC-041 変更・取消のメールを元の予約の履歴へまとめる(予約番号が同じ組を利用者が選んだ時だけ。表 reservation_history・Alembic `f1b5d3a9c7e2`)・FC-027 住所と地図の印が 500 m を越えて離れた時に確かめる。FR の状態の遷移なし** |
| **r64** | 2026-11-21 | Gate2-FC | **FC-026 不適切な候補の報告(利用者の指示「未実装の作業をすべて継続しろ」): 旅行のメンバーが候補箱の候補へ閉業・住所の誤り・危険・重複を報告し、候補が場所に紐付いていればその場所の出典を「要確認」(stale)にする。表 candidate_reports(Alembic `a3c7e9b1d5f4`)。FR の状態の遷移なし** |
| **r65** | 2026-11-21 | Gate2-FC | **FC-064 既読の確認(利用者の指示「未実装の作業をすべて継続しろ」): 編集できる人が重大な変更・集合の変更のお知らせを出し、メンバーへ通知(急ぎの種類)、各メンバーの「確認しました」を残す。編集できる人には誰がまだかを出す。表 plan_notices・plan_notice_acks(Alembic `b8d2f4a6c1e3`)。B2B の改訂は B2B の機能が無いため対象外。FR の状態の遷移なし** |
| **r66** | 2026-11-21 | Gate2-FC | **FC-007 テンプレートとして保存(複製の as_template。構造だけ。自由に書いた文・電話・予算は写さない)・FC-017 予定の先行条件(travel_events.after_event_id・Alembic `c5e1a7d3b9f2`。同じ旅行の予定だけ・自分と循環は断る。先行の予定より前に始まる予定を検証で PREREQUISITE_ORDER として知らせる)。FR の状態の遷移なし** |
| **r67** | 2026-11-21 | Gate2-FC | **FC-012 まとめて編集(POST /plans/{id}/events/bulk。選んだ予定の種類を変える・別の日へ移すを 1 つの変更の組で。元に戻すで一度に戻る。鍵・エリアは断る。参加者は予定に持たない項目のため対象外)。DB の変更なし(Alembic head は `c5e1a7d3b9f2` のまま)。FR の状態の遷移なし** |
| **r68** | 2026-11-22 | Gate2-FC | **FC-045 文書の差し替え(POST …/documents/{id}/replace・GET …/versions。新しい版として保存し前の版を残す。旅程・予約との紐付けは新しい版へ移し、費用のレシート・読み取りの記録は読み取った版を指したまま。Alembic `d7f3b5c9e1a4`)・OCR を 1 つのスレッドで動かす(CPU が混んだ時の時間切れを防ぐ)。FR の状態の遷移なし** |

## 10. 台帳の更新の規則

- FR の状態を変える Gate は、同じ commit で `fr-status.json`・本書(`render_doc10.py`)・(VERIFIED なら)ledger を直す。
- READMEや画面表示だけを証拠にしない。失敗試験・権限試験・運用証拠がなければ RELEASED にしない。
- 外部 provider・暗号の鍵の方式の変更も機能の状態へ反映する。
- 基準commit を進める時は §0.1 と §9 を直す(CI が履歴にあるかを確かめる)。
