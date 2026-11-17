# 仕様の正本の所在(Gate Hardening-A・監査 G-01/G-09)

> この文書は `python3 scripts/ci/render_fr_trace.py` が `docs/spec/canonical-sources.json` から作る(手で直さない)。

TravelCanvas の仕様の正本の所在(Gate Hardening-A・監査 G-01/G-09 の対応)。DOC-10 が「共通正本」と呼ぶ DOC-02/04/05/06/11/13 は、プロジェクトの資料室(claude.ai の Project の文書)にある v5.1 の原本で、リポジトリには写しを置かない(正本を二重にしない)。資料室の原本は 2026-09-03 発効のまま変わっておらず、その後の承認済みの変更はリポジトリの DOC-10・FR-059 正本・ADR・docs/ux・各 Gate の trace に記録する。FR ごとの要求の根拠と承認済みの変更は docs/trace/fr-requirements.json。

- 確認した日: 2026-11-17(Gate Hardening-A(資料室の文書の冒頭の版・状態の表記を読んで確認))
- 資料室: claude.ai Project「AI旅行プランナーアプリ開発」の資料室(文書のパスは library_path)

## 優先の順

- 1. 利用者の明示の決定(日付と出典を docs/trace/fr-requirements.json の approved_changes に記録)
- 2. リポジトリの正本: docs/spec/DOC-10_*.md(実装の状態)、docs/spec/FR-059_*.md(FR-059。資料室の該当箇所より優先、DOC-10 §0.2)、docs/adr/*.md(設計の判断)、docs/ux/*.md(画面の実装仕様)
- 3. 資料室の v5.1 正本(下の documents。2026-09-03 発効)
- 4. v4.x 以前(DOC-12 が参照する履歴。実装の判断に使わない)

## 文書の一覧

| ID | 文書 | 資料室のパス | 版 | 状態 | 役割 | 共通正本 | リポジトリで引き継ぐ所 |
|---|---|---|---|---|---|---|---|
| DOC-01 | 企画書・プロダクトビジョン書 | `01_企画書_プロダクトビジョン書_v5.1.md` | v5.1 | 資料室にあるが、本 Gate では冒頭の版・状態の表記を読んで確かめていない | 製品原則・KPI |  | — |
| DOC-02 | 要件定義書 | `02_要件定義書_v5.1.md` | v5.1 | APPROVED(2026-09-03 発効) | 要件 ID(FR-001〜058・FC-001〜180・NFR・AC-01〜08・EX-001〜020) | ○ | `docs/trace/fr-requirements.json`・`docs/spec/FR-059_旅程相談API原価上限_利用者クラス別Quota_v5.1.md` |
| DOC-03 | 基本設計書・システム構成 | `03_基本設計書_システム構成_v5.1.md` | v5.1 | 資料室にあるが、本 Gate では冒頭の版・状態の表記を読んで確かめていない | モジュール・信頼境界・処理 |  | `docs/adr` |
| DOC-04 | 外部機能仕様書・画面仕様 | `04_外部機能仕様書_画面仕様_v5.1.md` | v5.1 | APPROVED(2026-09-03 発効) | 画面 ID(SC-01〜43)・UX の規則・UI-001〜015 | ○ | `docs/ux/G11_UIUX全範囲_実装仕様.md`・`docs/ux/TDay_旅の当日_旅帖ライブ.md`・`docs/ux/TripKit_旅行箱.md`・`docs/adr/ADR-ux-information-design.md` |
| DOC04-A | 高忠実度統合ワイヤーフレーム | `DOC04-A_高忠実度統合ワイヤーフレーム_v5.1.html` | v5.1 | 資料室にあるが、本 Gate では冒頭の版・状態の表記を読んで確かめていない | 主要画面の視覚の正本 |  | `docs/ux/TravelCanvas_ホーム改善案_v2_モックアップ.html` |
| DOC-05 | DB 設計書 | `05_DB設計書_v5.1.md` | v5.1 | APPROVED(2026-09-03 発効) | 論理データ・暗号化の台帳・状態の遷移 | ○ | `backend/app/models/models.py`・`backend/alembic/versions` |
| DOC-06 | API 設計書 | `06_API設計書_v5.1.md` | v5.1 | APPROVED(2026-09-03 発効) | API の原則・権限の行列・冪等・同期の契約 | ○ | `backend/app/api/v1`・`docs/spec/error-catalog.md` |
| DOC-07 | 開発環境・運用環境仕様書 | `07_開発環境_運用環境仕様書_v5.1.md` | v5.1 | APPROVED(2026-09-03 発効) | 環境・CI・SLO・Runbook・DR |  | `docs/ops/RUNBOOK.md`・`docs/runbooks`・`.github/workflows/ci.yml` |
| DOC-08 | 開発スタック定義書 | `08_開発スタック定義書_v5.1.md` | v5.1 | APPROVED(2026-09-03 発効) | 技術の選定 |  | — |
| DOC-09 | 計画・展開指針 | `09_計画_展開指針_v5.1.md` | v5.1 | APPROVED(2026-09-03 発効) | Gate・リリースの順 |  | `docs/spec/DOC-10_全機能仕様_トレーサビリティ_実装状況台帳_v5.1.md` |
| DOC-10 | 全機能仕様・トレーサビリティ・実装状況台帳(資料室の版) | `10_全機能仕様_トレーサビリティ_実装状況台帳_v5.1.md` | v5.1-r11 | 廃止 | 廃止。正本はリポジトリの DOC-10(DOC-10 冒頭) |  | `docs/spec/DOC-10_全機能仕様_トレーサビリティ_実装状況台帳_v5.1.md` |
| DOC-11 | セキュリティ・プライバシー・データ保護詳細仕様 | `11_セキュリティ_プライバシー_データ保護詳細仕様_v5.1.md` | v5.1 | APPROVED(2026-09-03 発効) | データ分類・認可・暗号・SEC-001〜020・Field Policy | ○ | `docs/security/SECURITY-TRACE.md`・`docs/adr/ADR-security-baseline.md`・`docs/adr/ADR-data-keys.md`・`docs/ops/KEY-INVENTORY.md` |
| DOC-12 | 旧資料情報回収・変更履歴・整合性評価 | `12_旧資料情報回収_変更履歴_整合性評価_v5.1.md` | v5.1 | APPROVED(2026-09-03 発効) | 変更の統制・決定の記録 |  | — |
| DOC-13 | 用語集・データ辞書・イベントカタログ | `13_用語集_データ辞書_イベントカタログ_v5.1.md` | v5.1 | APPROVED(2026-09-03 発効) | 語彙・情報の品質の状態・Event・Error の名前空間 | ○ | `docs/spec/error-catalog.md` |
| DOC-14 | MAP 中核機能・詳細仕様 | `14_MAP中核機能_詳細仕様_v5.1.md` | v5.1 | 資料室にあるが、本 Gate では冒頭の版・状態の表記を読んで確かめていない | 地図のレイヤー・Plan-to-Memory |  | — |
| DOC-15 | 競合調査反映・追加変更機能仕様書 | `15_競合調査反映_追加変更機能仕様書_v5.1.md` | v5.1 | APPROVED(2026-09-03 発効) | CA-001〜016(DOC-02 の FR-043〜058 へ統合済み) |  | — |
| README | 資料体系・読解ガイド | `README_資料体系_読解ガイド_v5.1.md` | v5.1 | APPROVED(2026-09-03 発効) | 正本の体系と変更の手順 |  | `docs/spec/CANONICAL-SOURCES.md` |

状態の語: approved_v5.1=冒頭に「文書版: v5.1 / 状態: APPROVED FOR IMPLEMENTATION / 発効日: 2026-09-03」と書いてあることを確認した / unverified_header=資料室にあるが、本 Gate では冒頭の版・状態の表記を読んで確かめていない / abolished=廃止(内容はリポジトリの正本へ統合済み)
