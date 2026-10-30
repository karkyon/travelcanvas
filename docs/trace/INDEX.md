# trace の索引と今の状態(Gate G1・GOV-04)

> **今の状態の正本は `docs/trace/fr-status.json`(人が読む版は `docs/spec/DOC-10_*.md`)。** 各 trace は、その Gate の時点の
> 要件ごとの証拠。後の Gate で解消した行には `SUPERSEDED BY <Gate>` を書いてある。trace の `NOT STARTED`・`PARTIAL` を
> 全文検索して残件を判断しない(この索引の §2 か fr-status.json を見る)。
> この文書は `python3 scripts/ci/render_trace_index.py` が作る(手で直さない)。

## 1. trace の一覧

数は、その trace の中で `SUPERSEDED BY` の無い `NOT STARTED`・`PARTIAL` の行と、`SUPERSEDED BY` を付けた行。

| trace | 題 | NOT STARTED | PARTIAL | SUPERSEDED |
|---|---|---|---|---|
| [gate-a2-trace.md](gate-a2-trace.md) | Gate A2 トレース(FR-040 管理・監査)と E2E の安定化 | 0 | 0 | 2 |
| [gate-appshell-trace.md](gate-appshell-trace.md) | Gate AppShell トレース(UI/UX モックの殻・ホーム・旅程の3列・クイックの作成・検索の言葉を実際に合わせる・ゲストの設定) | 1 | 1 | 0 |
| [gate-b012-trace.md](gate-b012-trace.md) | Gate B-012 トレーサビリティ表(プラン削除) | 1 | 0 | 1 |
| [gate-b013-trace.md](gate-b013-trace.md) | Gate B-013 トレーサビリティ表(個別削除: 紐付け解除して削除) | 1 | 0 | 0 |
| [gate-b1-trace.md](gate-b1-trace.md) | Gate B1 トレース(FR-041 組織・B2B / FR-042 API・Webhook の最小形) | 2 | 1 | 3 |
| [gate-c1-trace.md](gate-c1-trace.md) | Gate C1 トレース(FR-020 共同編集・FR-023 秘匿プロフィール) | 0 | 0 | 1 |
| [gate-c2-trace.md](gate-c2-trace.md) | Gate C2 トレース(FR-007 候補箱・FR-008 場所の一元管理) | 5 | 0 | 0 |
| [gate-c3-trace.md](gate-c3-trace.md) | Gate C3 トレース(FR-009 情報内検索・コマンドパレット) | 1 | 0 | 0 |
| [gate-ci-redis-trace.md](gate-ci-redis-trace.md) | Gate CI-Redis トレース(CI の backend ジョブで Redis を使う試験を必ず実行する) | 0 | 0 | 0 |
| [gate-ci429-trace.md](gate-ci429-trace.md) | Gate CI-429 トレース(CI の E2E の 429 連鎖の原因の調査) | 0 | 0 | 0 |
| [gate-e1-trace.md](gate-e1-trace.md) | Gate E1 予約・チケット・取込・共有・複製の browser E2E トレーサビリティ表 | 2 | 1 | 0 |
| [gate-e2e-drag-trace.md](gate-e2e-drag-trace.md) | Gate E2E-Drag トレース(#10 gate-g7 のドラッグの並べ替えの不安定) | 0 | 0 | 1 |
| [gate-f45-trace.md](gate-f45-trace.md) | Gate F45 トレース(FR-045 / CA-003 安全な共有ポリシー: 項目単位の共有の規則) | 0 | 0 | 1 |
| [gate-fr059a-trace.md](gate-fr059a-trace.md) | Gate FR059-A トレース(外部 API の原価上限・利用者クラス別 quota の正本化) | 1 | 0 | 0 |
| [gate-fr059b-trace.md](gate-fr059b-trace.md) | Gate FR059-B トレース(外部 API の原価の守りのサーバー実装) | 2 | 1 | 1 |
| [gate-fr059c-trace.md](gate-fr059c-trace.md) | Gate FR059-C トレース(FR-059 正本 §13 D14: provider の停止を全ての worker で共有する) | 2 | 0 | 0 |
| [gate-g1-trace.md](gate-g1-trace.md) | Gate G1 トレース(正本の統制・鍵の版の切り替え・CI の証拠) | 4 | 1 | 2 |
| [gate-g10q-trace.md](gate-g10q-trace.md) | Gate G10-Q トレース(品質: V3 再監査・E2E の不安定の根治・mypy の削減) | 0 | 0 | 0 |
| [gate-g10ux-trace.md](gate-g10ux-trace.md) | Gate G10-UX トレース(UX-5 当日の画面・UX-6 共通の部品・UX-8 暗い見た目を全体へ) | 1 | 1 | 0 |
| [gate-g11-discover-trace.md](gate-g11-discover-trace.md) | Gate G11-Discover トレース(G11 の段階3: 発見・SNS・外部の写真・予定の写真) | 1 | 0 | 0 |
| [gate-g11-icons-trace.md](gate-g11-icons-trace.md) | Gate G11-Icons トレース(G11 の段階9: 移動手段のアイコン) | 0 | 0 | 2 |
| [gate-g11-intake-trace.md](gate-g11-intake-trace.md) | Gate G11-Intake トレース(G11 の段階5: 行き先が未定の旅行相談) | 2 | 0 | 0 |
| [gate-g11-layout-trace.md](gate-g11-layout-trace.md) | Gate G11-Layout トレース(旅程の画面の一覧のずれ・競合の後に最新を読み直せない時の表示) | 0 | 0 | 1 |
| [gate-g11-media-trace.md](gate-g11-media-trace.md) | Gate G11-Media トレース(G11 の段階1: 旅行の表紙の写真) | 2 | 0 | 0 |
| [gate-g11-planner-trace.md](gate-g11-planner-trace.md) | Gate G11-Planner トレース(G11 の段階2: 旅程の画面) | 1 | 0 | 0 |
| [gate-g11-planner2-trace.md](gate-g11-planner2-trace.md) | Gate G11-Planner2 トレース(G11 の段階6: 旅程の画面の残り) | 2 | 1 | 0 |
| [gate-g11-preview-trace.md](gate-g11-preview-trace.md) | Gate G11-Preview トレース(G11 の段階7: 並べ替えを保存する前の案) | 1 | 0 | 0 |
| [gate-g11-style-trace.md](gate-g11-style-trace.md) | Gate G11-Style トレース(G11 の段階4: 見た目の系統) | 0 | 0 | 0 |
| [gate-g11-usage-layout-trace.md](gate-g11-usage-layout-trace.md) | Gate G11-UsageLayout トレース(利用枠の知らせの状態で予定の一覧が動く問題) | 0 | 0 | 0 |
| [gate-g11-vote-trace.md](gate-g11-vote-trace.md) | Gate G11-Vote トレース(G11 の段階8: 候補箱の家族・グループの投票) | 0 | 0 | 0 |
| [gate-g2-trace.md](gate-g2-trace.md) | Gate G2 トレース(DB の権限の分離・依存のメジャー更新・外部サービスの要らない「(部分)」の解消) | 3 | 0 | 0 |
| [gate-g3-trace.md](gate-g3-trace.md) | Gate G3 トレース(基盤・品質: 外部の判断の要らない残り) | 1 | 1 | 0 |
| [gate-g4-trace.md](gate-g4-trace.md) | Gate G4 トレース(機能: 外部の判断の要らない残り) | 1 | 1 | 0 |
| [gate-g5-trace.md](gate-g5-trace.md) | Gate G5 トレース(機能: 費用・使用量・組織) | 2 | 1 | 0 |
| [gate-g6-trace.md](gate-g6-trace.md) | Gate G6 トレース(機能: オフライン・位置・記録) | 1 | 1 | 0 |
| [gate-g7-trace.md](gate-g7-trace.md) | Gate G7 トレース(機能: 移動・最適化・案の比較・記録・削除) | 4 | 0 | 0 |
| [gate-g8-trace.md](gate-g8-trace.md) | Gate G8・G9 トレース(機能: 案の中の区間・予約・所有者の移譲・訂正・定期の処理の記録 / 見た目の準備) | 2 | 0 | 0 |
| [gate-g9b-trace.md](gate-g9b-trace.md) | Gate G9 後半 トレース(UX-2 旅行の表紙・UX-3 見出しと移動・UX-4 文脈型ダッシュボード) | 2 | 0 | 0 |
| [gate-h1-trace.md](gate-h1-trace.md) | Gate H1 トレース(他の PC から画面を開く) | 0 | 0 | 0 |
| [gate-k1-trace.md](gate-k1-trace.md) | Gate K1 B-008 オフラインデータの鍵 トレーサビリティ表 | 2 | 0 | 0 |
| [gate-l2-fr016-trace.md](gate-l2-fr016-trace.md) | Gate L2 FR-016 トレーサビリティ表 | 0 | 0 | 2 |
| [gate-l3-fr017-trace.md](gate-l3-fr017-trace.md) | Gate L3 FR-017 トレーサビリティ表 | 0 | 1 | 3 |
| [gate-l4-fr018-trace.md](gate-l4-fr018-trace.md) | Gate L4 FR-018 トレーサビリティ表 | 1 | 0 | 1 |
| [gate-l5-trace.md](gate-l5-trace.md) | Gate L5 Local-first Location・適応型GPS記録 トレーサビリティ表 | 2 | 0 | 1 |
| [gate-lp-trace.md](gate-lp-trace.md) | Gate LP トレース(ランディングを景色の主画面・動く画面イメージ・旅の流れ・正直な料金へ作り直す) | 0 | 0 | 0 |
| [gate-m1-fr014-trace.md](gate-m1-fr014-trace.md) | Gate M1 FR-014 トレーサビリティ表 | 0 | 22 | 0 |
| [gate-m3-fr015-trace.md](gate-m3-fr015-trace.md) | Gate M3 FR-015 トレーサビリティ表 | 1 | 5 | 1 |
| [gate-o1-trace.md](gate-o1-trace.md) | Gate O1 B-010 トレーサビリティ表 | 2 | 0 | 1 |
| [gate-o2-trace.md](gate-o2-trace.md) | Gate O2 B-009 トレーサビリティ表 | 1 | 1 | 0 |
| [gate-p1-trace.md](gate-p1-trace.md) | Gate P1 FR-025・FR-026 トレーサビリティ表 | 1 | 0 | 0 |
| [gate-p10-trace.md](gate-p10-trace.md) | Gate P10 FR-030/FR-031 トレーサビリティ表 | 3 | 0 | 0 |
| [gate-p11-trace.md](gate-p11-trace.md) | Gate P11 FR-033 トレーサビリティ表 | 2 | 0 | 0 |
| [gate-p12-trace.md](gate-p12-trace.md) | Gate P12 FR-037 トレーサビリティ表 | 2 | 2 | 0 |
| [gate-p13-trace.md](gate-p13-trace.md) | Gate P13 FR-038 トレーサビリティ表 | 3 | 1 | 0 |
| [gate-p14-trace.md](gate-p14-trace.md) | Gate P14 FR-054・FR-053 トレーサビリティ表 | 1 | 0 | 0 |
| [gate-p15-trace.md](gate-p15-trace.md) | Gate P15 FR-052 トレーサビリティ表 | 2 | 1 | 0 |
| [gate-p16-trace.md](gate-p16-trace.md) | Gate P16 FR-046 トレーサビリティ表 | 2 | 0 | 0 |
| [gate-p17-trace.md](gate-p17-trace.md) | Gate P17 FR-057 トレーサビリティ表 | 0 | 0 | 1 |
| [gate-p2-trace.md](gate-p2-trace.md) | Gate P2 FR-027・FR-028 トレーサビリティ表 | 2 | 2 | 0 |
| [gate-p3-trace.md](gate-p3-trace.md) | Gate P3 FR-022・FR-024 トレーサビリティ表 | 2 | 1 | 0 |
| [gate-p4-trace.md](gate-p4-trace.md) | Gate P4 FR-034・FR-035・FR-046 トレーサビリティ表 | 2 | 0 | 0 |
| [gate-p5-trace.md](gate-p5-trace.md) | Gate P5 FR-036 トレーサビリティ表 | 1 | 0 | 1 |
| [gate-p6-trace.md](gate-p6-trace.md) | Gate P6 FR-039 トレーサビリティ表 | 1 | 0 | 1 |
| [gate-p7-trace.md](gate-p7-trace.md) | Gate P7 FR-019 トレーサビリティ表 | 0 | 0 | 1 |
| [gate-p8-trace.md](gate-p8-trace.md) | Gate P8 FR-036 カレンダー取込 トレーサビリティ表 | 1 | 0 | 0 |
| [gate-p9-trace.md](gate-p9-trace.md) | Gate P9 FR-039 アカウント削除・同意撤回 トレーサビリティ表 | 2 | 0 | 0 |
| [gate-q1-trace.md](gate-q1-trace.md) | Gate Q1 トレース(写真の撮影情報の除去・V2 の CI の e2e の不安定の修正) | 0 | 0 | 0 |
| [gate-r2-trace.md](gate-r2-trace.md) | Gate R2 Trace表（QuickDraft） | 0 | 1 | 1 |
| [gate-s1-trace.md](gate-s1-trace.md) | Gate S1 セキュリティ基盤の仕上げ トレーサビリティ表 | 1 | 1 | 1 |
| [gate-s10-trace.md](gate-s10-trace.md) | Gate S10 CSP 違反の報告 トレーサビリティ表 | 0 | 0 | 0 |
| [gate-s11-trace.md](gate-s11-trace.md) | Gate S11 管理者の多要素認証・CI の復旧・main の保護 トレーサビリティ表 | 1 | 0 | 1 |
| [gate-s2-trace.md](gate-s2-trace.md) | Gate S2 認証の強化と応答ヘッダー トレーサビリティ表 | 1 | 0 | 1 |
| [gate-s3-trace.md](gate-s3-trace.md) | Gate S3 回数制限の共有 トレーサビリティ表 | 0 | 0 | 1 |
| [gate-s4-trace.md](gate-s4-trace.md) | Gate S4 文書の配信条件・アップロード・トークン トレーサビリティ表 | 0 | 1 | 1 |
| [gate-s5-trace.md](gate-s5-trace.md) | Gate S5 トークンの保存場所 トレーサビリティ表 | 0 | 0 | 0 |
| [gate-s6-trace.md](gate-s6-trace.md) | Gate S6 不審な接続元の自動遮断 トレーサビリティ表 | 1 | 0 | 0 |
| [gate-s7-trace.md](gate-s7-trace.md) | Gate S7 段階的な計算の確認 トレーサビリティ表 | 1 | 0 | 0 |
| [gate-s8-trace.md](gate-s8-trace.md) | Gate S8 侵害が疑われる時の封じ込め トレーサビリティ表 | 0 | 0 | 1 |
| [gate-s9-trace.md](gate-s9-trace.md) | Gate S9 新しい端末からのログインの通知・ログイン中の端末 トレーサビリティ表 | 1 | 0 | 0 |
| [gate-ux6-icons-trace.md](gate-ux6-icons-trace.md) | Gate UX6-Icons トレース(旅程の中の移動・旅行の基本情報の飾りの絵文字を共通のアイコンへ) | 1 | 0 | 0 |
| [gate-ux6-icons2-trace.md](gate-ux6-icons2-trace.md) | Gate UX6-Icons2 トレース(画面に出る残りの飾りの絵文字を共通のアイコンへ・確定の予定の印) | 1 | 1 | 0 |
| [gate-v2-trace.md](gate-v2-trace.md) | Gate V2 トレース(FR-049 Visited Area Layer・FR-050 訪問判定・信頼度・FR-051 訪問訂正・Privacy除外) | 1 | 0 | 1 |

VERIFIED の証拠は [v1-verification-ledger.json](v1-verification-ledger.json)、全 FR の状態は [fr-status.json](fr-status.json)。

## 2. VERIFIED でない FR の残り(fr-status.json から)

| FR | 機能 | 状態 | 主な不足 |
|---|---|---|---|
| FR-007 | 候補箱 | INTEGRATED(部分) | 画像・音声からの候補(OCR・音声認識)、SNS 以外の URL の題名・画像の取得 |
| FR-008 | 場所の一元管理 | INTEGRATED(部分) | ジオコードの確認(地図の提供元 MAP-05)、祝日の暦の自動の取得(外部の暦。例外の日は手で登録できる) |
| FR-011 | 予約取込 | INTEGRATED(部分) | メール・OCRによる自動抽出 |
| FR-014 | 移動区間 | INTEGRATED | 外部の交通(時刻表・運賃)、区間の編集・UndoのE2E |
| FR-015 | 経路比較 | INTEGRATED | 経路の外部provider、route option の Undo・E2E |
| FR-018 | 説明可能最適化 | INTEGRATED(部分) | 外部経路による実移動時間 |
| FR-024 | コメント・通知 | INTEGRATED(部分) | メールの送信の提供元(SMTP の設定。運用の判断)、即時の配信(COL-01 の配信の仕組みに載せる) |
| FR-030 | 外部状況 | INTEGRATED(部分) | 外部provider(運行情報・天気・警報・休業) |
| FR-035 | 安全な印刷・公開 | INTEGRATED(部分) | サーバー側の PDF・ダウンロード URL |
| FR-036 | Calendar/Map IO | INTEGRATED(部分) | 外部カレンダーの常時同期、GPX/KML/CSV の取込、削除の取込 |
| FR-037 | 写真・旅行記 | INTEGRATED(部分) | 顔の検査(画像認識の提供元)、MEMORY MAP(地図の提供元) |
| FR-041 | 組織・B2B | INTEGRATED(部分) | 組織の料金(FR-058 待ち)、本番の DNS でのドメインの確認(RELEASE-1) |
| FR-042 | API・埋込 | INTEGRATED(部分) | 埋め込み(iframe・JS の部品)、旅行・予定・場所・予約の書き込み(個人データを外へ出さない方針で配布だけ) |
| FR-046 | 画像・PDFの出力 | INTEGRATED(部分) | サーバー側の生成、NOW/NEXT カードの画像、画像作成の監査 |
| FR-049 | Visited Area Layer | INTEGRATED(部分) | 候補の層、地図タイルの上への表示 |
| FR-052 | Personal Travel Atlas | INTEGRATED(部分) | 国・都道府県・市区町村・テーマ別(逆ジオコーディング)、地点単位の公開範囲 |
| FR-054 | 予定と実績 | INTEGRATED(部分) | 予定経路と GPS 軌跡の比較 |
| FR-055 | Local-first Location | INTEGRATED(部分) | 端末のバックグラウンド記録、端末内の点の暗号化 |
| FR-056 | 適応型GPS | INTEGRATED(部分) | OS の geofence、電池の計測 |
| FR-058 | Entitlement・料金 | SPECIFIED | 価格・有料の範囲・決済(購入・返金・請求・Trip Pass の販売)の製品判断待ち(使用量の上限の仕組み BILL-02 は G5。外部 API の原価上限・クラス別 quota は FR-059) |
| FR-059 | 旅程相談 API の原価上限・クラス別 Quota | INTEGRATED(部分) | 外部の有料 provider は未接続(fake provider で検証。limit を強制した staging での実際の請求の照合・80% と上限の画面の E2E は接続の後)、決済(Trip Pass の購入・指定した支払う人・組織でまとめる月の枠は FR-058・FR-041)、無料の provider の使用の記録(正本 §13 D11) |

## 3. 棚卸しの規則

- 後の Gate で解消したら、古い trace の行の最後に `※ **SUPERSEDED BY Gate <名前> …**` を足す(行は消さない。当時の証拠のため)。
- 解消した能力が FR の(部分)の理由だったなら、同じ commit で fr-status.json の `gaps` と `partial` を直し、
  `python3 scripts/ci/render_doc10.py` と `python3 scripts/ci/render_trace_index.py` を実行する。
- `backend/tests/test_gate_g1_doc10.py` が、この索引が最新であることと、既知の解消済みの行に `SUPERSEDED BY` があることを確かめる。
