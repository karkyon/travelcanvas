# 10 全機能仕様 トレーサビリティ 実装状況台帳 v5.1(正本)

> 文書ID: DOC-10 / 版: **v5.1-r22** / 状態: APPROVED FOR IMPLEMENTATION / 改訂日: 2026-10-28  
> **正本の場所: このファイル(GitHub `karkyon/travelcanvas` の `docs/spec/`)。** プロジェクトの資料室(Library)に置く写しは、
> 冒頭にこのファイルの commit を書く。資料室の `10_全機能仕様_トレーサビリティ_実装状況台帳_v5.1.md`(r11、2026-09 の版)と
> `claude/DOC-10_r12_台帳更新_2026-10-20.md`(r12 の追補)は **廃止**(内容はこの版に統合した)。  
> 共通正本: 要件ID=DOC-02、画面ID=DOC-04、データ=DOC-05、API=DOC-06、Security=DOC-11、語彙=DOC-13

**目的:** 構想、仕様、画面、DB、API、コード、試験、リリースを一つの台帳で結び、名前だけ存在する機能を「完成」と誤認しない。

## 0. 同期基準・正本の関係・証拠の境界

### 0.1 同期基準

| 項目 | 値 |
|---|---|
| 基準commit | `e39d5e7`(Gate G10-Q PR #6。この後に、この版を入れる Gate G10-UX の commit が続く) |
| Alembic head | `f4d8a2c6e9b1`(単一の head。G7 `e8b2c6d0f4a7` の後、G8 で案の中の区間・予約・所有者の移譲・訂正・定期の処理の記録) |
| 基準の試験の実測(サンドボックス、G10-UX) | backend pytest 1239 合格・2 飛ばし(G10-Q から backend の変更なし) / frontend vitest 851 合格(169 ファイル)・標準エラー 0 行 / E2E 81 合格・再試行 0(本番用の配信 static-server.mjs。通常・計算の確認を常に求める設定の両方)/ **mypy の誤り 0 件**(G10-Q で 1,382 → 0、基準は空)/ 毎晩の perf(予定 10,000・通知 100,000)合格 / 最初に読む JS 426.08 kB(上限 430 kB) |
| GitHub Actions(H1 `16f1aa9`) | secret-scan / dependency-audit / frontend / backend / e2e の5ジョブ合格。main は保護(必須の CI・管理者にも適用・強制 push と削除の禁止・直線の履歴) |

`backend/tests/test_gate_g1_doc10.py` が、上の基準commit が履歴に実在すること・Alembic head が実際の head と一致すること・
§3 の表と §2 の集計が `docs/trace/fr-status.json` と一致すること・VERIFIED が `docs/trace/v1-verification-ledger.json`
と一致することを CI で確かめる。

### 0.2 正本の関係(GOV-02)

| 成果物 | 役割 | 同期の規則 |
|---|---|---|
| `docs/trace/fr-status.json` | 全58 FR の状態・(部分)・主な不足の**機械が読む正本** | 状態を変える Gate は同じ commit でこれを直し、`python3 scripts/ci/render_doc10.py` で本書の表を作り直す |
| `docs/trace/v1-verification-ledger.json` | VERIFIED の**証拠**(E2E・権限・競合・セキュリティ・運用の試験) | CI が、参照した試験の実在(`test_gate_v1_verification_ledger.py`)と、**その実行での合格**(`scripts/ci/check_ledger_results.py`)を確かめる |
| 本書(DOC-10) | 人が読む正本(状態の判定規則・集計・リリース・次工程) | 生成部分は手で直さない(CI が落ちる) |
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

## 2. 集計(全58 FR)

<!-- generated:summary -->
| 見方 | 値 |
|---|---|
| コードがある機能(IMPLEMENTED 以上) | 57/58 = 98% |
| INTEGRATED 以上 | 57/58 = 98%(うち(部分) 17) |
| VERIFIED | 38/58 = 66% |
| RELEASED | 0/58 = 0% |
| 加重進捗(SPECIFIED 0・IMPLEMENTED 0.4・INTEGRATED 0.7・VERIFIED 0.9・RELEASED 1.0) | 約81.9% |
| 未着手(SPECIFIED 以下) | FR-058 |

VERIFIED の一覧: 001/002/003/004/005/006/009/010/012/013/016/017/019/020/021/022/023/025/026/027/028/029/031/032/033/034/038/039/040/043/044/045/047/048/050/051/053/057。
<!-- /generated:summary -->

## 3. 親機能のトレーサビリティ(全58 FR)

画面・DB・API・試験の対応の詳細は各 Gate の trace(`docs/trace/gate-*-trace.md`)と ADR(`docs/adr/`)。
VERIFIED の証拠の試験名は `docs/trace/v1-verification-ledger.json`。

<!-- generated:fr-table -->
| FR | 機能 | 状態 | E2E | 主な Gate | 主な不足 |
|---|---|---|---|---|---|
| FR-001 | ゲスト旅行開始 | VERIFIED | ✓ | #35・R1・R2 | KPI、回復UX |
| FR-002 | ゲスト昇格 | VERIFIED | ✓ | G1・A1 | 全所有物の移管のE2E、重複統合 |
| FR-003 | 認証・セッション | VERIFIED | ✓ | A1・S2・S5・S7・S9・S11 | メールの確認、passkey |
| FR-004 | 旅行CRUD | VERIFIED | ✓ | B-012・G8 | 本番の定期実行の基盤(Cloud Scheduler 等)での記録の確認(PROD-1) |
| FR-005 | 日・イベント | VERIFIED | ✓ | B-013・G7 | 実機 mobile のタッチでの並べ替え |
| FR-006 | NOW/NEXT | VERIFIED | ✓ | L1・L1b | 実機mobile、夜行便のE2E |
| FR-007 | 候補箱 | INTEGRATED(部分) | ✓ | C2 | 画像・音声からの候補(OCR・音声認識)、候補への投票、URLの題名・画像の取得 |
| FR-008 | 場所の一元管理 | INTEGRATED(部分) | ✓ | C2・G4 | ジオコードの確認(地図の提供元 MAP-05)、祝日の暦の自動の取得(外部の暦。例外の日は手で登録できる) |
| FR-009 | 情報内検索・コマンドパレット | VERIFIED | ✓ | C3・G4 | 利用の計測(どのコマンドが使われるか)、本番での確認(RELEASE-1) |
| FR-010 | 予約管理 | VERIFIED | ✓ | R3・E1 | 外部予約サービスとの同期、取消期限の通知 |
| FR-011 | 予約取込 | INTEGRATED(部分) | ✓ | R3-7・R3-9・E1 | メール・OCRによる自動抽出 |
| FR-012 | QR・チケット | VERIFIED | ✓ | R3-5・R3-11・E1 | バーコードの描画、オフライン表示 |
| FR-013 | 文書ウォレット | VERIFIED | ✓ | R3-6・M5〜M10・S4 | 本番の Object Storage・ClamAV の常時運用・KMS |
| FR-014 | 移動区間 | INTEGRATED | 一部 | M1・M2・B-014 | 外部の交通(時刻表・運賃)、区間の編集・UndoのE2E |
| FR-015 | 経路比較 | INTEGRATED | 一部 | M3・M4・M8 | 経路の外部provider、route option の Undo・E2E |
| FR-016 | 制約 | VERIFIED | ✓ | L2 | 制約の変更の Undo |
| FR-017 | 実行可能性 | VERIFIED | ✓ | L3・G7 | 時刻表の照合 |
| FR-018 | 説明可能最適化 | INTEGRATED(部分) | ✓ | L4・G7 | 外部経路による実移動時間 |
| FR-019 | What-if | VERIFIED | ✓ | P7・G7・G8 | 案どうしの統合(rebase) |
| FR-020 | 共同編集 | VERIFIED | ✓ | C1・G2 | 文字単位の同時編集(CRDT)は対象外(版の競合を検出する方式) |
| FR-021 | 共有・権限 | VERIFIED | ✓ | #25・#30・E1・G8 | 組織(B2B)の旅行の所有者の移譲(組織の管理で扱う) |
| FR-022 | 合意形成 | VERIFIED | ✓ | P3・G4 | 利用の計測、本番での確認(RELEASE-1) |
| FR-023 | 秘匿プロフィール・制約 | VERIFIED | ✓ | L2・C1 | — |
| FR-024 | コメント・通知 | INTEGRATED(部分) | ✓ | P3・G4 | メールの送信の提供元(SMTP の設定。運用の判断)、即時の配信(COL-01 の配信の仕組みに載せる) |
| FR-025 | 持ち物 | VERIFIED | ✓ | P1 | 薬の時刻通知・天候連動 |
| FR-026 | レディネス | VERIFIED | ✓ | P1 | 予算との連動 |
| FR-027 | 予算・費用 | VERIFIED | ✓ | P2・G5 | 為替の自動取得(外部の提供元。決まるまで出典つきの手入力の記録)、本番での確認(RELEASE-1) |
| FR-028 | 立替・精算 | VERIFIED | ✓ | P2・G5 | 本番での確認(RELEASE-1) |
| FR-029 | 当日モード | VERIFIED | ✓ | L1・P10 | 外部状況の自動取得 |
| FR-030 | 外部状況 | INTEGRATED(部分) | ✓ | P10 | 外部provider(運行情報・天気・警報・休業) |
| FR-031 | 安全な再計画 | VERIFIED | ✓ | P10 | 代替移動手段の探索、プッシュ通知 |
| FR-032 | Offline Pack | VERIFIED | ✓ | #36・K1 | サーバー側のパック、通信しない端末の遠隔消去 |
| FR-033 | Offline同期 | VERIFIED | ✓ | P11・G6 | 本番での確認(RELEASE-1) |
| FR-034 | しおり生成 | VERIFIED | ✓ | P4 | 冊子の面付 |
| FR-035 | 安全な印刷・公開 | INTEGRATED(部分) | ✓ | P4 | サーバー側の PDF・ダウンロード URL |
| FR-036 | Calendar/Map IO | INTEGRATED(部分) | ✓ | P5・P8 | 外部カレンダーの常時同期、GPX/KML/CSV の取込、削除の取込 |
| FR-037 | 写真・旅行記 | INTEGRATED(部分) | ✓ | P12・Q1・G6 | 顔の検査(画像認識の提供元)、MEMORY MAP(地図の提供元) |
| FR-038 | 位置軌跡 | VERIFIED | ✓ | P13・L5 | バックグラウンドの記録、現在地の共有 |
| FR-039 | 輸出・削除 | VERIFIED | ✓ | P6・P9・G7・G8 | 書類の写しの添付による出典の証明 |
| FR-040 | 管理・監査 | VERIFIED | ✓ | A2・S11・G2・G4 | 管理の画面の外部連携の障害の表示(ADM-01)、本番での運用の確認(RELEASE-1) |
| FR-041 | 組織・B2B | INTEGRATED(部分) | ✓ | B1・G5 | 組織の料金(FR-058 待ち)、本番の DNS でのドメインの確認(RELEASE-1) |
| FR-042 | API・埋込 | INTEGRATED(部分) | ✓ | B1・G2 | 埋め込み(iframe・JS の部品)、旅行・予定・場所・予約の書き込み(個人データを外へ出さない方針で配布だけ) |
| FR-043 | Quick Plan | VERIFIED | ✓ | #38・R2 | — |
| FR-044 | Guest Travel View | VERIFIED | ✓ | #35・#41・E1・G4 | モバイルの実機での確認(UX-03)、本番での確認(RELEASE-1) |
| FR-045 | 安全な共有ポリシー | VERIFIED | ✓ | F45・G2 | — |
| FR-046 | 画像・PDFの出力 | INTEGRATED(部分) | ✓ | P4・P16 | サーバー側の生成、NOW/NEXT カードの画像、画像作成の監査 |
| FR-047 | 旅程複製 | VERIFIED | ✓ | #39・R3-12・E1 | — |
| FR-048 | Offline Travel Pack(端末) | VERIFIED | ✓ | #36・P11・K1・G6 | 本番での確認(RELEASE-1)。通信しない端末は鍵の期限(30日)の後は開けない(消去は次の通信の時) |
| FR-049 | Visited Area Layer | INTEGRATED(部分) | ✓ | V2 | 候補の層、地図タイルの上への表示 |
| FR-050 | 訪問判定・信頼度 | VERIFIED | ✓ | V2 | — |
| FR-051 | 訪問訂正・除外 | VERIFIED | ✓ | V2・Q1・G6・G8 | 実機の GPS での訂正・除外の確認(PoC) |
| FR-052 | Personal Travel Atlas | INTEGRATED(部分) | ✓ | P15 | 国・都道府県・市区町村・テーマ別(逆ジオコーディング)、地点単位の公開範囲 |
| FR-053 | 旅の達成指標 | VERIFIED | ✓ | P14 | — |
| FR-054 | 予定と実績 | INTEGRATED(部分) | ✓ | P14 | 予定経路と GPS 軌跡の比較 |
| FR-055 | Local-first Location | INTEGRATED(部分) | ✓ | L5 | 端末のバックグラウンド記録、端末内の点の暗号化 |
| FR-056 | 適応型GPS | INTEGRATED(部分) | ✓ | L5 | OS の geofence、電池の計測 |
| FR-057 | Memory Replan | VERIFIED | ✓ | P17・G7 | 実際の旅の記録が増えた時の傾向の確かめ(RELEASE-1) |
| FR-058 | Entitlement・料金 | SPECIFIED | ✗ | — | 価格・有料の範囲の製品判断待ち(使用量の上限の仕組み BILL-02 は G5。料金・支払いは決まるまで実装しない) |
<!-- /generated:fr-table -->

## 4. 主要な縦切り(J-01〜J-07)

| ID | 縦切り | 状態 | 残り |
|---|---|---|---|
| J-01 | 登録なしで旅程を作る(FR-001/004/005) | 成立(quickdraft-flow・auth-flows) | — |
| J-02 | ホテル予約の一元化(FR-008/010/011/012/013) | 部分成立(予約・チケット・文書・取込・オフラインの鍵を E2E で確認) | PDF・メールからの自動抽出、チケットのオフライン表示 |
| J-03 | 説明可能な最適化(FR-014〜018) | 成立(内部推定の範囲) | 外部経路による実移動時間 |
| J-04 | グループの合意(FR-020〜024) | 部分成立(投票・懸念・コメント・秘匿プロフィール・開いている人) | 決定の予定への反映、即時の配信 |
| J-05 | 当日の障害対応(FR-029〜033) | 成立(外部 provider を除く) | 外部状況の自動取得、プッシュ通知 |
| J-06 | 安全な出力(FR-034/035/039/045) | 成立(ブラウザ側の出力、項目単位の共有の規則) | サーバー側の PDF |
| J-07 | 旅の記憶(FR-037/038/052/053/054/057) | 成立 | 公開 URL、地図の上の表示 |

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
| 7 | MAP-P / OCR-P | 地図・経路・ジオコード・OCR・天気・メールの提供元 | cache 等 | 契約・API キー |
| 8 | BILL-1 | FR-058 料金 | あり | **利用者の決定が必須** |
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
| **r22** | 2026-10-28 | `e39d5e7` | **Gate G10-UX: UX-8 暗い見た目を全ての画面へ・UX-6 共通の部品をデザインの決まりへ・UX-5 当日の画面。FR の状態の遷移なし。`docs/trace/gate-g10ux-trace.md`** |

## 10. 台帳の更新の規則

- FR の状態を変える Gate は、同じ commit で `fr-status.json`・本書(`render_doc10.py`)・(VERIFIED なら)ledger を直す。
- READMEや画面表示だけを証拠にしない。失敗試験・権限試験・運用証拠がなければ RELEASED にしない。
- 外部 provider・暗号の鍵の方式の変更も機能の状態へ反映する。
- 基準commit を進める時は §0.1 と §9 を直す(CI が履歴にあるかを確かめる)。
