# README 資料体系 読解ガイド v6.0(正本)

> 文書ID: README / 版: **v6.0** / 状態: APPROVED FOR IMPLEMENTATION(利用者の指示 2026-11-17。main への取り込みで発効)<br>
> 旧版: 資料室 `README_資料体系_読解ガイド_v5.1.md`(2026-09-03 発効。保管 `docs/spec/archive/v5.1/README.md`)<br>
> 変更統制: DOC-12 / 実装状態の正本: DOC-10 / 正本の所在の一覧: `docs/spec/CANONICAL-SOURCES.md`

## 0. v6.0 の改訂点

- **正本の場所をリポジトリ(GitHub `karkyon/travelcanvas` の `docs/spec/`)へ移す。** コードと同じ PR で直し、CI で食い違いを検査できるようにする。
  資料室は GitHub と同期して v6.0 の文書を読めるが、資料室の側では直さない。
- 版を v6.0 にした。v5.1 から後の利用者の決定(FR-059・プランB・料金のテストモード・外部の提供元の方針・自宅の場所・開発の鍵の例外)を本文へ入れた。
- 移すのは 4 段階(§3)。移す前の文書は資料室の v5.1 が正本のまま。
- 正準値: **FR 59・FC 180・SC 43・CA 16**(v5.1 の FR 58 に FR-059 を足した)。

## 1. この資料群の目的(v5.1 のまま)

本資料群は、TravelCanvasの現在のコードだけを説明するものではない。旧資料に残された構想と変遷、最新コードで確認できる資産、競合調査で得た能力、「旅行情報の一元化」と「集中する機密情報を守るセキュリティ」を統合し、最終的にどのような製品を完成させるかを定義する。

| 層 | 内容 | 確認先 |
|---|---|---|
| 最終目標 | 製品が最終的に提供する能力 | DOC-01/02 |
| 段階実装 | 依存順と品質Gate | DOC-09・DOC-10 §8 |
| 現行事実 | 最新コードで確認できる部品と証拠不足 | DOC-10・`docs/trace/FR-TRACE.md` |

最終仕様に存在する機能を「現在実装済み」とは扱わない。一方、現在未実装であることを理由に最終構想から削除しない。

## 2. 文書の一覧と今の正本

今の正本(v6.0 か v5.1 か)・保管の版は `docs/spec/CANONICAL-SOURCES.md`(生成元 `canonical-sources.json`)が正本。役割は v5.1 と同じ:

| 文書 | 正本として管理するもの |
|---|---|
| DOC-01 | Product Principles、長期目標 |
| DOC-02 | 要件 ID(FR59・FC180・NFR・AC・EX) |
| DOC-03 | Module/Policy/Data flow |
| DOC-04・DOC04-A | 画面 ID(SC43)・UX の規則・視覚 |
| DOC-05 | Data model |
| DOC-06 | API contract policy |
| DOC-07 | Operation model |
| DOC-08 | Technology policy |
| DOC-09 | Delivery order |
| DOC-10 | Implementation status(と `fr-status.json`・`v1-verification-ledger.json`・`fr-requirements.json`) |
| DOC-11 | Protection requirements(対応の索引 `docs/security/SECURITY-TRACE.md`) |
| DOC-12 | History/decision trace |
| DOC-13 | Canonical vocabulary |
| DOC-14 | MAP |
| FR-059 正本 | 外部 API の原価上限・利用者クラス別 quota |

## 3. v6.0 へ移す段階

| 段階 | 文書 | やり方 | 状態 |
|---|---|---|---|
| 1 | README・DOC-02・DOC-10・FR-059(DOC-15 は DOC-02 へ統合) | v5.1 の本文を引き継ぎ、承認済みの変更を本文へ | **済(2026-11-17)** |
| 2 | DOC-04・DOC04-A・DOC-13 | 画面は実際の route・画面・状態に合わせる(画面 ID SC-01〜43 と route の対応表)。語彙は実装の enum・状態と照合 | 未 |
| 3 | DOC-05・DOC-06・DOC-11 | 表・列・API の一覧はコード(SQLAlchemy の定義・FastAPI の OpenAPI)から生成し、原則・規則は v5.1 を引き継ぐ。生成物と本文の食い違いを CI で検査 | 未 |
| 4 | DOC-01・DOC-03・DOC-07・DOC-08・DOC-09・DOC-12・DOC-14 | v5.1 を引き継ぎ、実際の構成(Docker Compose・GCP 開発環境・CI)・Gate の実績に合わせる | 未 |

各段階は 1 つの PR。移した文書は `canonical-sources.json` の state を approved_v6.0 にし、資料室の版を保管の索引(`archive/v5.1/README.md` §2)へ移す。

## 4. TravelCanvasの中核(v5.1 のまま)

TravelCanvasの中核は、工程表のレイアウトではなく、旅行中に必要な情報が相互接続されていることである。ホテルのイベントから、正式名称、住所、地図、入口、電話、予約番号、名義、チェックイン、料金、取消期限、原本PDF、QR、担当、費用、前後の移動へ到達できる。値はコピーされた別々のメモではなく、同じPlace、Reservation、Ticket、Document、Segmentを参照する。

ただし、一元化は全員へ全情報を見せることではない。予約番号、QR、旅券、健康、個人予算、実位置は別の機密分類とfield policyを持つ。利用者は必要な時に瞬時に見られるが、権限のないメンバー、共有リンク、ログ、通知、AI、公開PDFには流れない。この利便性と保護の同時成立が製品要件である。

## 5. 文書更新時の禁止事項(v5.1 のまま + v6.0)

- 文字数を減らすだけの「簡潔化」で背景・受入・失敗を消す。
- 現行コードにないため最終要件を削除する。
- componentやendpointの存在だけで実装済みとする。
- 画面仕様、DB、APIで別のrole・状態・用語を作る。
- Securityを後付けの非機能へ追いやる。
- AI、外部API、暗号化、リアルタイムを曖昧な宣伝語で記載する。
- 旧問題を解消証拠なしで削除する。
- **v6.0:** 資料室の側で正本を直す(直すのはリポジトリ。資料室は同期で読むだけ)。
- **v6.0:** 実機・実 API・本番の確認を、その記録なしに「完了」と書く。

## 6. 変更要求の処理

新しい機能要求は、DOC-01の原則との整合、DOC-02のFR/FC、DOC-04の画面、DOC-05のデータ分類、DOC-06のAPI、DOC-11のthreat/privacy、DOC-09のGate、DOC-10の状態へ反映する。変更を一文書だけへ追記して終わらせない。
**v6.0:** 利用者の決定は、日付と出典をつけて DOC-02 の該当の要件(「v6.0:」の行)と `docs/trace/fr-requirements.json` の approved_changes に書く。

廃止する場合は、理由、利用者影響、代替、データmigration、API deprecation、削除release、旧資料回収表を更新する。

## 7. v6.0 共通不変条件(v5.1 のまま)

1. Quick/Advancedは同一Travel Information Graphの段階的開示であり、別形式へ保存しない。
2. 共有、検索、通知、AI、PDF、Offline、監査ログはfield-level Policy Decisionを必ず通過する。
3. 予定と実績は別Revisionで保存し、推定は根拠・confidence・algorithm_versionを持つ。
4. 自動処理は確定済み旅程を無断更新せず、差分、理由、影響、承認、Undoを提供する。
5. 秘密、位置、券、予約、健康、決済は最小化・暗号化・目的制限・保持期限・削除伝播を適用する。
6. 「実装済み」はDOC-10にcommit、test、migration、deploy、観測証拠が揃った場合だけ宣言する。
