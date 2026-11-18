# 全60 FR の要求の追跡(Gate Hardening-A・監査 G-01/G-03。FR-060 は Gate SpotMode)

> この文書は `python3 scripts/ci/render_fr_trace.py` が `docs/trace/fr-requirements.json` と `docs/trace/fr-status.json` から作る(手で直さない)。
> 要求の原文の正本は DOC-02 v6.0(`docs/spec/DOC-02_要件定義書_v6.0.md`。所在の一覧は [CANONICAL-SOURCES.md](../spec/CANONICAL-SOURCES.md))。ここの要約・受入は抜粋の言い換え。
> 状態の正本は fr-status.json、VERIFIED の証拠は v1-verification-ledger.json。基準 commit `a2c419d`。

## 1. 証拠の区分の一覧

● 証拠あり ◐ 一部 ○ 未実施・未確認 — 対象外。**実機・実 API・運用(本番)の ● は 0 件**(証拠の記録が無いものを完了にしない)。

| FR | 機能 | 状態 | 要件の根拠 | 実装 | 統合試験 | E2E | 権限・失敗系 | 実機 | 実 API | 運用(本番) | 残件の分類 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| FR-001 | ゲスト旅行開始 | VERIFIED | ● | ● | ● | ● | ● | ○ | — | ○ | 未実装 |
| FR-002 | ゲスト昇格 | VERIFIED | ● | ● | ● | ● | ● | ○ | — | ○ | — |
| FR-003 | 認証・セッション | VERIFIED | ● | ● | ● | ● | ● | ○ | ○ | ○ | 実機待ち・設定待ち・実通信待ち |
| FR-004 | 旅行CRUD | VERIFIED | ● | ● | ● | ● | ● | ○ | — | ○ | 運用待ち |
| FR-005 | 日・イベント | VERIFIED | ● | ● | ● | ● | ● | ○ | — | ○ | 実機待ち |
| FR-006 | NOW/NEXT | VERIFIED | ● | ● | ● | ● | ● | ○ | — | ○ | 実機待ち・未実装 |
| FR-007 | 候補箱 | INTEGRATED(部分) | ● | ◐ | ◐ | ● | ◐ | ○ | ○ | ○ | 未実装・実通信待ち |
| FR-008 | 場所の一元管理 | INTEGRATED(部分) | ● | ◐ | ◐ | ● | ◐ | ○ | ○ | ○ | 設定待ち・実通信待ち |
| FR-009 | 情報内検索・コマンドパレット | VERIFIED | ● | ● | ● | ● | ● | ○ | — | ○ | 未実装・運用待ち |
| FR-010 | 予約管理 | VERIFIED | ● | ● | ● | ● | ● | ○ | ○ | ○ | 未実装 |
| FR-011 | 予約取込 | INTEGRATED(部分) | ● | ◐ | ◐ | ● | ◐ | ○ | ○ | ○ | 設定待ち・実通信待ち |
| FR-012 | QR・チケット | VERIFIED | ● | ● | ● | ● | ● | ○ | — | ○ | 実機待ち |
| FR-013 | 文書ウォレット | VERIFIED | ● | ● | ● | ● | ● | ○ | ○ | ○ | 運用待ち |
| FR-014 | 移動区間 | INTEGRATED | ● | ● | ● | ◐ | ◐ | ○ | ○ | ○ | 設定待ち・実通信待ち |
| FR-015 | 経路比較 | INTEGRATED | ● | ● | ● | ◐ | ◐ | ○ | ○ | ○ | 設定待ち・実通信待ち |
| FR-016 | 制約 | VERIFIED | ● | ● | ● | ● | ● | ○ | — | ○ | — |
| FR-017 | 実行可能性 | VERIFIED | ● | ● | ● | ● | ● | ○ | ○ | ○ | 設定待ち・実通信待ち |
| FR-018 | 説明可能最適化 | INTEGRATED(部分) | ● | ◐ | ◐ | ● | ◐ | ○ | ○ | ○ | 未実装・設定待ち |
| FR-019 | 日ごとの案(プランB。旧 What-if) | VERIFIED | ● | ● | ● | ● | ● | ○ | ○ | ○ | 実通信待ち |
| FR-020 | 共同編集 | VERIFIED | ● | ● | ● | ● | ● | ○ | — | ○ | — |
| FR-021 | 共有・権限 | VERIFIED | ● | ● | ● | ● | ● | ○ | — | ○ | 未実装 |
| FR-022 | 合意形成 | VERIFIED | ● | ● | ● | ● | ● | ○ | — | ○ | 未実装・運用待ち |
| FR-023 | 秘匿プロフィール・制約 | VERIFIED | ● | ● | ● | ● | ● | ○ | — | ○ | — |
| FR-024 | コメント・通知 | INTEGRATED | ● | ● | ● | ● | ◐ | ○ | ○ | ○ | 設定待ち・実通信待ち |
| FR-025 | 持ち物 | VERIFIED | ● | ● | ● | ● | ● | ○ | — | ○ | 未実装 |
| FR-026 | レディネス | VERIFIED | ● | ● | ● | ● | ● | ○ | — | ○ | — |
| FR-027 | 予算・費用 | VERIFIED | ● | ● | ● | ● | ● | ○ | ○ | ○ | 実通信待ち・運用待ち |
| FR-028 | 立替・精算 | VERIFIED | ● | ● | ● | ● | ● | ○ | — | ○ | 運用待ち |
| FR-029 | 当日モード | VERIFIED | ● | ● | ● | ● | ● | ○ | — | ○ | 未実装 |
| FR-030 | 外部状況 | INTEGRATED(部分) | ● | ◐ | ◐ | ● | ◐ | ○ | ○ | ○ | 設定待ち・実通信待ち |
| FR-031 | 安全な再計画 | VERIFIED | ● | ● | ● | ● | ● | ○ | ○ | ○ | 未実装 |
| FR-032 | Offline Pack | VERIFIED | ● | ● | ● | ● | ● | ○ | — | ○ | 未実装・実機待ち |
| FR-033 | Offline同期 | VERIFIED | ● | ● | ● | ● | ● | ○ | — | ○ | 運用待ち |
| FR-034 | しおり生成 | VERIFIED | ● | ● | ● | ● | ● | ○ | ○ | ○ | 未実装・運用待ち |
| FR-035 | 安全な印刷・公開 | INTEGRATED | ● | ● | ● | ● | ◐ | ○ | ○ | ○ | 未実装・運用待ち |
| FR-036 | Calendar/Map IO | INTEGRATED | ● | ● | ● | ● | ◐ | ○ | — | ○ | 未実装 |
| FR-037 | 写真・旅行記 | INTEGRATED(部分) | ● | ◐ | ◐ | ● | ◐ | ○ | ○ | ○ | 設定待ち・実通信待ち・実機待ち |
| FR-038 | 位置軌跡 | VERIFIED | ● | ● | ● | ● | ● | ○ | — | ○ | 未実装 |
| FR-039 | 輸出・削除 | VERIFIED | ● | ● | ● | ● | ● | ○ | — | ○ | 未実装 |
| FR-040 | 管理・監査 | VERIFIED | ● | ● | ● | ● | ● | ○ | — | ○ | 未実装・運用待ち |
| FR-041 | 組織・B2B | INTEGRATED(部分) | ● | ◐ | ◐ | ● | ◐ | ○ | ○ | ○ | 未実装・運用待ち |
| FR-042 | API・埋込 | INTEGRATED(部分) | ● | ◐ | ◐ | ● | ◐ | ○ | — | ○ | 未実装 |
| FR-043 | Quick Plan | VERIFIED | ● | ● | ● | ● | ● | ○ | — | ○ | — |
| FR-044 | Guest Travel View | VERIFIED | ● | ● | ● | ● | ● | ○ | — | ○ | 実機待ち・運用待ち |
| FR-045 | 安全な共有ポリシー | VERIFIED | ● | ● | ● | ● | ● | ○ | — | ○ | — |
| FR-046 | 画像・PDFの出力 | INTEGRATED | ● | ● | ● | ● | ◐ | ○ | ○ | ○ | 未実装 |
| FR-047 | 旅程複製 | VERIFIED | ● | ● | ● | ● | ● | ○ | — | ○ | — |
| FR-048 | Offline Travel Pack(端末) | VERIFIED | ● | ● | ● | ● | ● | ○ | — | ○ | 実機待ち・運用待ち |
| FR-049 | Visited Area Layer | INTEGRATED(部分) | ● | ◐ | ◐ | ● | ◐ | ○ | ○ | ○ | 実機待ち |
| FR-050 | 訪問判定・信頼度 | VERIFIED | ● | ● | ● | ● | ● | ○ | — | ○ | — |
| FR-051 | 訪問訂正・除外 | VERIFIED | ● | ● | ● | ● | ● | ○ | — | ○ | 実機待ち |
| FR-052 | Personal Travel Atlas | INTEGRATED(部分) | ● | ◐ | ◐ | ● | ◐ | ○ | ○ | ○ | 実通信待ち |
| FR-053 | 旅の達成指標 | VERIFIED | ● | ● | ● | ● | ● | ○ | — | ○ | — |
| FR-054 | 予定と実績 | INTEGRATED(部分) | ● | ◐ | ◐ | ● | ◐ | ○ | — | ○ | 未実装 |
| FR-055 | Local-first Location | INTEGRATED(部分) | ● | ◐ | ◐ | ● | ◐ | ○ | — | ○ | 未実装 |
| FR-056 | 適応型GPS | INTEGRATED(部分) | ● | ◐ | ◐ | ● | ◐ | ○ | — | ○ | 未実装 |
| FR-057 | Memory Replan | VERIFIED | ● | ● | ● | ● | ● | ○ | — | ○ | 運用待ち |
| FR-058 | Entitlement・料金 | INTEGRATED(部分) | ● | ◐ | ◐ | ◐ | ◐ | ○ | ○ | ○ | 設定待ち・未実装・利用者判断待ち |
| FR-059 | 旅程相談 API の原価上限・クラス別 Quota | INTEGRATED(部分) | ● | ◐ | ◐ | ● | ◐ | ○ | ○ | ○ | 設定待ち・実通信待ち・未実装 |
| FR-060 | スポットモード(自由に歩くエリア) | INTEGRATED(部分) | ● | ◐ | ● | ● | ◐ | ○ | ○ | ○ | 実機待ち・実通信待ち |

| 集計 | 要件の根拠 | 実装 | 統合試験 | E2E | 権限・失敗系 | 実機 | 実 API | 運用(本番) |
|---|---|---|---|---|---|---|---|---|
| ● 証拠あり | 60 | 44 | 45 | 57 | 38 | 0 | 0 | 0 |
| ◐ 一部 | 0 | 16 | 15 | 3 | 22 | 0 | 0 | 0 |
| ○ 未実施・未確認 | 0 | 0 | 0 | 0 | 0 | 60 | 25 | 60 |
| — 対象外(理由を書く) | 0 | 0 | 0 | 0 | 0 | 0 | 35 | 0 |

## 2. FR ごとの要求の根拠と対応

### FR-001 ゲスト旅行開始

- **出典:** DOC-02 §3 FR-001(優先度 MUST・段階 G0-G1)
- **要求(抜粋):** 登録なしでゲスト旅行を始め、推測困難なゲストの所有権を発行する。保存できない時は成功と表示せず下書きと再試行を出す
- **受入(抜粋):** 初回訪問から60秒以内にイベントを1件保存できる
- **仕様の参照:** 画面 SC-01・SC-02 / API 群 AUTH/PLAN
- **実装:** API `backend/app/api/v1/auth.py`・`backend/app/api/v1/quickdrafts.py`・`backend/app/api/v1/plans.py` / 画面 `/`・`/planner/:planId?` / 表 `users`・`quick_drafts`・`travel_plans`
- **試験:** `backend/tests/test_gate35_guest.py`・`backend/tests/test_gate_r1_guest_normalized_api.py`・`frontend/e2e/a11y.spec.ts`・`frontend/e2e/quickdraft-flow.spec.ts`
- **外部の提供元:** なし
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API —(外部の提供元を使わない) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** KPI、回復UX

### FR-002 ゲスト昇格

- **出典:** DOC-02 §3 FR-002(優先度 MUST・段階 G1)
- **要求(抜粋):** 旅行・添付・履歴・共有設定を失わず登録アカウントへ移す。既存メールと衝突したら再認証後に統合
- **受入(抜粋):** ゲストトークンだけで既存アカウントへ勝手に紐付けない
- **仕様の参照:** 画面 SC-03 / API 群 AUTH
- **実装:** API `backend/app/api/v1/auth.py`・`backend/app/api/v1/guest_merge.py` / 画面 `/guest/upgrade` / 表 `users`・`travel_plans`
- **試験:** `backend/tests/test_gate35_guest.py`・`backend/tests/test_gate_remaining7_guest_merge.py`・`backend/tests/test_gate_s2_auth_hardening.py`・`frontend/e2e/auth-flows.spec.ts`・`frontend/e2e/remaining7.spec.ts`・`frontend/src/components/Remaining7.test.tsx`
- **外部の提供元:** なし
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API —(外部の提供元を使わない) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** 重複の統合(既存のアカウントへゲストの持ち物をまとめる)は Remaining-7

### FR-003 認証・セッション

- **出典:** DOC-02 §3 FR-003(優先度 MUST・段階 G0-G2)
- **要求(抜粋):** メール確認・パスワード・passkey/MFA・ログアウト・全端末失効・セッション一覧。短命 access と回す refresh
- **受入(抜粋):** refresh の再利用を検出し、機密の表示・外部連携の変更は再認証を要求できる
- **仕様の参照:** 画面 SC-03・SC-29 / API 群 AUTH
- **実装:** API `backend/app/api/v1/auth.py`・`backend/app/api/v1/mfa.py`・`backend/app/api/v1/passkeys.py`・`backend/app/api/v1/account_recovery.py` / 画面 `/login`・`/register`・`/settings` / 表 `users`・`user_sessions`・`user_mfa`・`webauthn_credentials`
- **試験:** `backend/tests/test_gate_remaining6_account.py`・`backend/tests/test_gate_remaining7_passkeys.py`・`backend/tests/test_gate_s11_admin_mfa.py`・`backend/tests/test_gate_s2_auth_hardening.py`・`backend/tests/test_gate_s4_authz_matrix.py`・`backend/tests/test_sessions.py`・`frontend/e2e/account-recovery.spec.ts`・`frontend/e2e/active-sessions.spec.ts`・`frontend/e2e/auth-flows.spec.ts`・`frontend/e2e/mfa.spec.ts`・`frontend/e2e/remaining7.spec.ts`・`frontend/src/components/Remaining7.test.tsx`・`frontend/src/pages/AccountRecovery.test.tsx`
- **外部の提供元:** SMTP(メールの送信)・端末の passkey(WebAuthn)
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API ○(実の提供元での確認なし(CI は模擬): SMTP(メールの送信)・端末の passkey(WebAuthn)) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** passkey(Remaining-7)は実機の端末で未確認。パスワードの再設定・メールの確認(Remaining-6)は SMTP の設定の後に実メールで未確認

### FR-004 旅行CRUD

- **出典:** DOC-02 §3 FR-004(優先度 MUST・段階 G0)
- **要求(抜粋):** 名称・期間・基準タイムゾーン・通貨・表紙・種別・公開状態。UTC 保存と現地表示。猶予つきの論理削除
- **受入(抜粋):** 削除で関連する添付・共有を失効する
- **仕様の参照:** 画面 SC-04・SC-05 / API 群 PLAN
- **実装:** API `backend/app/api/v1/plans.py`・`backend/app/api/v1/travel.py` / 画面 `/dashboard`・`/planner/:planId?` / 表 `travel_plans`・`ops_job_runs`
- **試験:** `backend/tests/test_gate_b012_plan_deletion.py`・`backend/tests/test_gate_g8_job_runs.py`・`backend/tests/test_plans_normalized.py`・`frontend/e2e/gate-g8.spec.ts`・`frontend/e2e/plan-deletion.spec.ts`
- **外部の提供元:** なし
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API —(外部の提供元を使わない) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** 本番の定期実行の基盤(Cloud Scheduler 等)での記録の確認(PROD-1)

### FR-005 日・イベント

- **出典:** DOC-02 §3 FR-005(優先度 MUST・段階 G0-G1)
- **要求(抜粋):** 日・時刻・終日・未定・複数日・所要・カテゴリ・状態。ドラッグ・キーボード・長押しで並べ替え
- **受入(抜粋):** 時刻を変える時に移動・予約・営業時間・通知への影響を事前に示す
- **仕様の参照:** 画面 SC-06 / API 群 DAY/EVENT
- **実装:** API `backend/app/api/v1/plans.py`・`backend/app/api/v1/travel.py` / 画面 `/planner/:planId?` / 表 `travel_days`・`travel_events`・`change_sets`
- **試験:** `backend/tests/test_gate_g2_member_policy.py`・`backend/tests/test_gate_g7_movement.py`・`frontend/e2e/gate-g11-planner.spec.ts`・`frontend/e2e/gate-g7.spec.ts`・`frontend/e2e/item-deletion.spec.ts`・`frontend/src/components/planner/EventTimeImpact.test.tsx`・`frontend/src/hooks/useDragDrop.test.tsx`・`frontend/src/store/planStore.test.ts`
- **外部の提供元:** なし
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API —(外部の提供元を使わない) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** 実機 mobile のタッチでの並べ替え

### FR-006 NOW/NEXT

- **出典:** DOC-02 §3 FR-006(優先度 MUST・段階 G1-G4)
- **要求(抜粋):** 旅行の基準時刻からNOW・NEXT・遅延・空き時間を判定し、次の場所・出発・チケット・予約・連絡先へ1操作
- **受入(抜粋):** 過去・未来の日を手で見ている間は自動で移らない
- **仕様の参照:** 画面 SC-07 / API 群 NOW
- **実装:** API `backend/app/api/v1/today_live.py`・`backend/app/api/v1/plans.py` / 画面 `/planner/:planId/today` / 表 `travel_events`
- **試験:** `backend/tests/test_gate_l1_today_mode.py`・`backend/tests/test_gate_l1b_today_timezone.py`・`backend/tests/test_gate_s4_authz_matrix.py`・`frontend/e2e/today-mode-mobile.spec.ts`
- **外部の提供元:** なし
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ。旅行当日に直結) / 実 API —(外部の提供元を使わない) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** 実機mobile、夜行便のE2E

### FR-007 候補箱

- **出典:** DOC-02 §3 FR-007(優先度 MUST・段階 G1-G2)
- **要求(抜粋):** URL・文・画像・音声・地図・共有から未確定の候補を集め、出典・登録者・取得時刻・重複・確定状態を持つ
- **受入(抜粋):** 旅程へ置いても元の出典を失わない
- **仕様の参照:** 画面 SC-08 / API 群 PLACE/SEARCH
- **実装:** API `backend/app/api/v1/candidates.py`・`backend/app/api/v1/spot_intake.py` / 画面 `/planner/:planId/candidates` / 表 `plan_candidates`・`source_records`
- **試験:** `backend/tests/test_gate_c2_candidates_places.py`・`backend/tests/test_gate_g11_discover.py`・`backend/tests/test_gate_remaining6_account.py`・`frontend/e2e/candidates.spec.ts`・`frontend/e2e/gate-g11-family-vote.spec.ts`・`frontend/src/components/Remaining7.test.tsx`・`frontend/src/pages/CandidatesPage.test.tsx`・`frontend/src/pages/candidates/CandidateVoting.test.tsx`・`frontend/src/services/api.surface.test.ts`・`frontend/src/services/api/c2candidates.test.ts`・`frontend/src/services/api/contract.test.ts`
- **外部の提供元:** 画像の場所の推定(AI・同意つき)・Web ページの読み取り(1ページ)
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API ○(実の提供元での確認なし(CI は模擬): 画像の場所の推定(AI・同意つき)・Web ページの読み取り(1ページ)) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** 画像の文字(OCR)・声(ブラウザの音声認識)から候補の名前を入れる(Remaining-7)。画像そのものから場所を当てる AI は場所の登録の画面だけ(同意つき)。SNS 以外の URL は押した時に 1 ページだけ読む(Remaining-6)

### FR-008 場所の一元管理

- **出典:** DOC-02 §3 FR-008(優先度 MUST・段階 G2)
- **要求(抜粋):** 正式名・別名・住所・座標・入口・階・電話・URL・営業時間・休業・予約要否・価格帯・アクセシビリティを1つの場所 ID で持つ
- **受入(抜粋):** 地図・イベント・予約・移動・PDF が同じ場所 ID を参照し、同名施設を地理 ID と提供元 ID で区別する
- **仕様の参照:** 画面 SC-09 / API 群 PLACE
- **実装:** API `backend/app/api/v1/places.py`・`backend/app/api/v1/holidays.py`・`backend/app/api/v1/hours_check.py`・`backend/app/api/v1/home_place.py` / 画面 `/planner/:planId/places/:placeId` / 表 `places`・`opening_hours`・`place_special_hours`・`place_entrances`・`field_sources`・`user_home_places`
- **試験:** `backend/tests/test_gate_c2_candidates_places.py`・`frontend/e2e/candidates.spec.ts`・`frontend/e2e/gate-g11-planner.spec.ts`・`frontend/src/hooks/usePlanHolidays.test.ts`・`frontend/src/pages/PlacePage.test.tsx`・`frontend/src/services/api.surface.test.ts`・`frontend/src/services/api/c2candidates.test.ts`・`frontend/src/services/api/contract.test.ts`
- **外部の提供元:** 地図・ジオコードの提供元・祝日(Nager.Date)
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API ○(実の提供元での確認なし(CI は模擬): 地図・ジオコードの提供元・祝日(Nager.Date)) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** ジオコードの確認(地図の提供元 MAP-05)。祝日は日本は計算・日本の外は Nager.Date(Remaining-2。例外の日は手で登録できる)

### FR-009 情報内検索・コマンドパレット

- **出典:** DOC-02 §3 FR-009(優先度 MUST・段階 G2)
- **要求(抜粋):** 店名・住所・予約番号末尾・参加者・日付・タグ・文書名で旅行全体を横断検索し、固定の絞り込みを持つ
- **受入(抜粋):** 権限の無い秘密値を検索の候補・件数にも漏らさない
- **仕様の参照:** 画面 SC-10 / API 群 SEARCH
- **実装:** API `backend/app/api/v1/plan_search.py`・`backend/app/api/v1/commands.py`・`backend/app/api/v1/search.py` / 画面 `/search` / 表 `command_runs`
- **試験:** `backend/tests/test_gate_c3_search.py`・`backend/tests/test_gate_g4_commands.py`・`frontend/e2e/gate-g4.spec.ts`・`frontend/e2e/search.spec.ts`・`frontend/src/components/CommandPalette.test.tsx`・`frontend/src/services/api.surface.test.ts`・`frontend/src/services/api/c3search.test.ts`・`frontend/src/services/api/contract.test.ts`
- **外部の提供元:** なし
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API —(外部の提供元を使わない) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** 利用の計測(どのコマンドが使われるか)、本番での確認(RELEASE-1)

### FR-010 予約管理

- **出典:** DOC-02 §3 FR-010(優先度 MUST・段階 G2)
- **要求(抜粋):** 宿・航空・鉄道・バス・船・レンタカー・飲食・体験等を統一の予約モデルで持ち、番号・PIN・名義・取消期限・原本を保持
- **受入(抜粋):** 予約を旅程の固定の制約にできる
- **仕様の参照:** 画面 SC-11 / API 群 RESERVATION
- **実装:** API `backend/app/api/v1/reservations.py` / 画面 `/planner/:planId/reservations` / 表 `reservations`・`event_reservations`・`reservation_participants`
- **試験:** `backend/tests/test_gate_r3_0_reservation.py`・`backend/tests/test_gate_r3_1_reservation_participants.py`・`backend/tests/test_gate_r3_3_event_reservations.py`・`backend/tests/test_gate_remaining3_mail.py`・`frontend/e2e/reservations.spec.ts`
- **外部の提供元:** 外部の予約サービス(同期は未実装)
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ。旅行当日に直結) / 実 API ○(実の提供元での確認なし(CI は模擬): 外部の予約サービス(同期は未実装)) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** 外部予約サービスとの同期(取消期限の 48 時間前・6 時間前の知らせは Remaining-3)

### FR-011 予約取込

- **出典:** DOC-02 §3 FR-011(優先度 MUST・段階 G2-G5)
- **要求(抜粋):** 転送アドレス・メール連携・PDF・画像から候補を抽出し、原本と差分を並べて利用者が確定する
- **受入(抜粋):** 重複・更新・取消のメールを同じ予約の版として統合する
- **仕様の参照:** 画面 SC-13 / API 群 IMPORT
- **実装:** API `backend/app/api/v1/imports.py`・`backend/app/api/v1/inbound_mail.py`・`backend/app/api/v1/gmail.py` / 画面 `/planner/:planId/imports` / 表 `import_jobs`・`extraction_candidates`・`inbound_mail_addresses`・`gmail_connections`
- **試験:** `backend/tests/test_gate_booking_import.py`・`backend/tests/test_gate_r3_7_imports.py`・`backend/tests/test_gate_remaining3_mail.py`・`backend/tests/test_gate_remaining7_gmail.py`・`backend/tests/test_gate_s4_authz_matrix.py`・`frontend/e2e/reservations.spec.ts`・`frontend/src/components/Remaining7.test.tsx`・`frontend/src/pages/imports/InboundMailCard.test.tsx`
- **外部の提供元:** メールの受信サービス・Google OAuth(Gmail 読み取り)
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API ○(実の提供元での確認なし(CI は模擬): メールの受信サービス・Google OAuth(Gmail 読み取り)) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** 転送アドレス(Remaining-3)・Gmail の連携(Remaining-7。読み取りだけ・押した時だけ)は、受信サービス・Google の OAuth クライアントの設定の後に実メールで未確認。1 通から複数の予約は予約番号で分ける(Remaining-6)

### FR-012 QR・チケット

- **出典:** DOC-02 §3 FR-012(優先度 MUST・段階 G2)
- **要求(抜粋):** QR・Aztec・PDF417・Code128 を原画像または安全な描画で持ち、明るさ・回転・オフライン表示・最終確認時刻を出す
- **受入(抜粋):** 共有はチケット単位で既定は非公開。スクリーンショットの完全な防止は約束しない
- **仕様の参照:** 画面 SC-12 / API 群 RESERVATION
- **実装:** API `backend/app/api/v1/reservations.py` / 画面 `/planner/:planId/reservations` / 表 `tickets`
- **試験:** `backend/tests/test_gate_r3_5_tickets.py`・`frontend/e2e/reservations.spec.ts`
- **外部の提供元:** なし
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ。旅行当日に直結) / 実 API —(外部の提供元を使わない) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** オフライン表示の実機での確認(バーコードの描画は Code 128。Remaining-1)

### FR-013 文書ウォレット

- **出典:** DOC-02 §3 FR-013(優先度 MUST・段階 G2-G5)
- **要求(抜粋):** 確認書・旅券写し・保険・領収書等を分類し関連へ紐付け、RESTRICTED は本人限定、AI 解析は明示同意の時だけ
- **受入(抜粋):** ウイルス検査・MIME 検証・容量制限・暗号化・期限付き URL
- **仕様の参照:** 画面 SC-13 / API 群 DOCUMENT
- **実装:** API `backend/app/api/v1/documents.py` / 画面 `/planner/:planId/documents` / 表 `documents`・`document_links`
- **試験:** `backend/tests/test_gate_m5_object_storage.py`・`backend/tests/test_gate_m7_document_hardening.py`・`backend/tests/test_gate_r3_6_documents.py`・`frontend/e2e/document-wallet.spec.ts`・`frontend/src/services/api.test.ts`
- **外部の提供元:** Object Storage・ClamAV(常時運用)
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API ○(実の提供元での確認なし(CI は模擬): Object Storage・ClamAV(常時運用)) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** 本番の Object Storage・ClamAV の常時運用・KMS

### FR-014 移動区間

- **出典:** DOC-02 §3 FR-014(優先度 MUST・段階 G2-G3)
- **要求(抜粋):** 出発・到着・手段・便名・所要・距離・費用・乗換・予約・荷物を持つ区間。推奨出発は移動＋準備＋余裕
- **受入(抜粋):** 徒歩・車・鉄道・バス・船・航空・自転車・タクシー・混合を扱う
- **承認済みの変更 2026-11:** 外部の提供元は無料の物だけ接続し、有料(駅すぱあと等)は接続口だけ(鍵があれば動く)(出典: 利用者の決定(プロジェクトの記録 2026-11)・確度 高)
- **承認済みの変更 2026-11-16:** 自宅の場所(本人だけ・暗号化)を出発と帰着の経路に使うかを本人が選ぶ(出典: 利用者の指示(DOC-10 §0.1 HomePlace・migration a3c7e9f1b5d2)・確度 高)
- **仕様の参照:** 画面 SC-14 / API 群 ROUTE
- **実装:** API `backend/app/api/v1/segments.py`・`backend/app/api/v1/movement.py` / 画面 `/planner/:planId/segments` / 表 `travel_segments`・`plan_movement_settings`・`travel_estimate_settings`
- **試験:** `backend/tests/test_gate_m1_travel_segments.py`・`backend/tests/test_gate_m3_route_options.py`・`frontend/e2e/gate-g11-planner.spec.ts`・`frontend/e2e/remaining7.spec.ts`・`frontend/src/services/api.test.ts`
- **外部の提供元:** 時刻表・運賃(駅すぱあと。有料の鍵の後)
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ。旅行当日に直結) / 実 API ○(実の提供元での確認なし(CI は模擬): 時刻表・運賃(駅すぱあと。有料の鍵の後)) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** 時刻表・運賃は駅すぱあとの接続口(Remaining-2。有料の鍵の後に実通信で未確認)。区間の編集・Undo の E2E は Remaining-7

### FR-015 経路比較

- **出典:** DOC-02 §3 FR-015(優先度 SHOULD・段階 G3-G5)
- **要求(抜粋):** 最速・最安・乗換少・徒歩少・バリアフリー等で経路を比べ、外部の値に提供元・取得時刻・推定幅を持つ
- **受入(抜粋):** 経路が取れない時は手で区間を登録できる
- **承認済みの変更 2026-11:** 有料の経路の提供元は接続口だけ(鍵があれば動く)(出典: 利用者の決定(プロジェクトの記録 2026-11)・確度 高)
- **仕様の参照:** 画面 SC-14 / API 群 ROUTE
- **実装:** API `backend/app/api/v1/route_options.py` / 画面 `/planner/:planId/route-options` / 表 `route_options`・`route_legs`
- **試験:** `backend/tests/test_gate_m3_route_options.py`・`frontend/e2e/remaining7.spec.ts`・`frontend/src/services/api.test.ts`
- **外部の提供元:** 経路の提供元(駅すぱあと。有料の鍵の後)
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API ○(実の提供元での確認なし(CI は模擬): 経路の提供元(駅すぱあと。有料の鍵の後)) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** 経路の外部provider は駅すぱあとの接続口(鍵の後に実通信で未確認)。route option の Undo の E2E は Remaining-7

### FR-016 制約

- **出典:** DOC-02 §3 FR-016(優先度 MUST・段階 G3-G5)
- **要求(抜粋):** ハード制約(予約・営業時間・終電・集合・予算上限)とソフト制約を個人・グループ・イベント・日単位で持つ
- **受入(抜粋):** 秘匿の制約は詳細を見せずに判定へ使う
- **仕様の参照:** 画面 SC-15 / API 群 VALIDATE
- **実装:** API `backend/app/api/v1/constraints.py` / 画面 `/planner/:planId/constraints` / 表 `constraints`・`constraint_undo_snapshots`
- **試験:** `backend/tests/test_gate_l2_constraints.py`・`frontend/e2e/constraints.spec.ts`・`frontend/e2e/remaining7.spec.ts`・`frontend/src/pages/ConstraintsPage.test.tsx`・`frontend/src/services/api.surface.test.ts`・`frontend/src/services/api/contract.test.ts`・`frontend/src/services/api/l2constraints.test.ts`
- **外部の提供元:** なし
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API —(外部の提供元を使わない) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** 制約の変更の Undo は Remaining-7(作成・変更・削除・有効の切り替え。本人・その後に変更が無い時だけ)

### FR-017 実行可能性

- **出典:** DOC-02 §3 FR-017(優先度 MUST・段階 G3)
- **要求(抜粋):** 重複・移動不足・営業時間外・予約不一致・滞在不足・予算超過・休憩不足・最終交通・未確認を検出し ERROR/WARNING/INFO
- **受入(抜粋):** 検証できない事を「問題なし」にしない
- **承認済みの変更 2026-11:** 時刻表の照合は有料の提供元の接続口だけ(鍵があれば動く)(出典: 利用者の決定(プロジェクトの記録 2026-11)・確度 高)
- **仕様の参照:** 画面 SC-15 / API 群 VALIDATE
- **実装:** API `backend/app/api/v1/validation.py`・`backend/app/api/v1/hours_check.py` / 画面 `/planner/:planId?` / 表 `validation_runs`・`validation_issues`
- **試験:** `backend/tests/test_gate_g7_movement.py`・`backend/tests/test_gate_l3_validation.py`・`frontend/e2e/feasibility.spec.ts`・`frontend/e2e/gate-g11-planner.spec.ts`・`frontend/e2e/gate-g7.spec.ts`・`frontend/src/pages/ConstraintsPage.test.tsx`・`frontend/src/pages/constraints/validationModel.test.ts`・`frontend/src/services/api.surface.test.ts`・`frontend/src/services/api/contract.test.ts`・`frontend/src/services/api/l3validation.test.ts`
- **外部の提供元:** 時刻表(駅すぱあと。有料の鍵の後)
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API ○(実の提供元での確認なし(CI は模擬): 時刻表(駅すぱあと。有料の鍵の後)) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** 時刻表の照合は駅すぱあとの候補を経路候補に入れる形(鍵の後に実通信で未確認)

### FR-018 説明可能最適化

- **出典:** DOC-02 §3 FR-018(優先度 MUST・段階 G3)
- **要求(抜粋):** 時間・費用・距離・希望・公平性・疲労を重み付けて候補を作り、ロック済みを変えない
- **受入(抜粋):** 適用前に差分・改善・悪化・違反・信頼度を示し、1つの変更セットとして Undo できる
- **仕様の参照:** 画面 SC-16 / API 群 OPTIMIZE
- **実装:** API `backend/app/api/v1/optimization.py` / 画面 `/optimization`・`/planner/:planId?` / 表 `optimization_results`・`change_sets`
- **試験:** `backend/tests/test_gate_l4_optimization.py`・`frontend/e2e/optimization.spec.ts`・`frontend/src/services/api/contract.test.ts`・`frontend/src/services/api/l4optimization.test.ts`
- **外部の提供元:** 外部の経路による実移動時間
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API ○(実の提供元での確認なし(CI は模擬): 外部の経路による実移動時間) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** 外部経路による実移動時間

### FR-019 日ごとの案(プランB。旧 What-if)

- **出典:** DOC-02 §3 FR-019(承認済みの変更でプランB へ置き換え)(優先度 SHOULD・段階 G4-G6)
- **要求(抜粋):** 雨・遅延・予算・欠席・体調の分岐案を保存し本案との差分と採用履歴を持つ。→ 2026-11-12 からは日ごとの案(プランB)。旅行前の複数案・旅行中の切り替え・旅行後の履歴
- **受入(抜粋):** 本案を壊さず、日ごとの「いまの案」は1つだけ。切り替えを記録する
- **承認済みの変更 2026-11-12:** もしもの案(What-if・旅程ブランチ)を、日ごとの案(プランB)に置き換えた。もしもの案の画面とデータは消した(出典: 利用者の指示(資料室 claude/TravelCanvas_プランB_日ごとの案_要件と画面設計_2026-11-12.md)・ADR-branches.md・DOC-10 §0.1(migration a9d4e2c7f1b6)・確度 高)
- **仕様の参照:** 画面 SC-17 / API 群 OPTIMIZE(branches)
- **実装:** API `backend/app/api/v1/day_variants.py` / 画面 `/planner/:planId?` / 表 `travel_days`・`day_variant_switches`
- **試験:** `backend/tests/test_gate_g7_optimize_compare.py`・`backend/tests/test_gate_planb_next.py`・`backend/tests/test_gate_planb_variants.py`・`frontend/e2e/gate-g7.spec.ts`・`frontend/e2e/gate-g8.spec.ts`・`frontend/e2e/plan-b.spec.ts`
- **外部の提供元:** 天気(Open-Meteo)・気象警報(気象庁)・AI の確かめ(会員クラスの枠の中)
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ。旅行当日に直結) / 実 API ○(実の提供元での確認なし(CI は模擬): 天気(Open-Meteo)・気象警報(気象庁)・AI の確かめ(会員クラスの枠の中)) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** 天気は Open-Meteo の日ごと・時間ごとの雨。気象警報は状況の画面の外の情報(気象庁。Remaining-2)。AI の確かめは会員のクラスの枠の中だけ

### FR-020 共同編集

- **出典:** DOC-02 §3 FR-020(優先度 MUST・段階 G1-G5)
- **要求(抜粋):** リアルタイムまたは準リアルタイムで編集し、編集中・版を示す
- **受入(抜粋):** 楽観ロックでフィールド・削除の競合を検出し、最後の書き込みで黙って上書きしない
- **承認済みの変更 2026-10-21:** 文字単位の同時編集(CRDT)は対象外にし、版の競合を検出する方式にする(出典: ADR-collaboration.md・DOC-10 §3 FR-020・確度 中(ADR の判断。利用者の明示の承認の記録は見当たらない))
- **仕様の参照:** 画面 SC-06・SC-20 / API 群 SHARE/MEMBER
- **実装:** API `backend/app/api/v1/presence.py`・`backend/app/api/v1/plans.py` / 画面 `/planner/:planId?` / 表 `plan_collaborators`・`plan_versions`
- **試験:** `backend/tests/test_gate_c1_collaboration.py`・`backend/tests/test_gate_g2_realtime.py`・`frontend/e2e/collaboration.spec.ts`・`frontend/e2e/realtime-collab.spec.ts`・`frontend/src/components/planner/PresenceBar.test.tsx`・`frontend/src/hooks/usePlanPresence.test.tsx`・`frontend/src/pages/PlannerPage.collab.test.tsx`・`frontend/src/services/api.surface.test.ts`・`frontend/src/services/api/c1collab.test.ts`・`frontend/src/services/api/contract.test.ts`・`frontend/src/utils/editConflict.test.ts`・`frontend/src/utils/sse.test.ts`
- **外部の提供元:** なし
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API —(外部の提供元を使わない) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** 文字単位の同時編集(CRDT)は対象外(版の競合を検出する方式)

### FR-021 共有・権限

- **出典:** DOC-02 §3 FR-021(優先度 MUST・段階 G1-G2)
- **要求(抜粋):** 所有者・編集者・投票者・閲覧者・チケット閲覧・費用閲覧の権限。リンクは期限・回数・パスコード・範囲・失効
- **受入(抜粋):** 予約番号・実位置・RESTRICTED 資料は共有リンクで既定非公開
- **仕様の参照:** 画面 SC-18 / API 群 SHARE/MEMBER
- **実装:** API `backend/app/api/v1/share.py`・`backend/app/api/v1/member_policy.py`・`backend/app/api/v1/ownership.py` / 画面 `/share/:planId` / 表 `plan_share_links`・`plan_collaborators`・`plan_ownership_transfers`
- **試験:** `backend/tests/test_gate_g8_ownership_corrections.py`・`backend/tests/test_share.py`・`frontend/e2e/document-wallet.spec.ts`・`frontend/e2e/gate-g8.spec.ts`・`frontend/e2e/share-clone.spec.ts`
- **外部の提供元:** なし
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API —(外部の提供元を使わない) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** 組織(B2B)の旅行の所有者の移譲(組織の管理で扱う)

### FR-022 合意形成

- **出典:** DOC-02 §3 FR-022(優先度 MUST・段階 G5)
- **要求(抜粋):** 候補へ Love/OK/懸念/不可と理由・代替・期限を入れ、拒否権の濫用を避ける規則を旅行単位で持つ
- **受入(抜粋):** 合意の状態と未回答者を見える化する
- **仕様の参照:** 画面 SC-19 / API 群 VOTE
- **実装:** API `backend/app/api/v1/discussion.py`・`backend/app/api/v1/decisions.py` / 画面 `/planner/:planId/discussion` / 表 `polls`・`poll_options`・`votes`
- **試験:** `backend/tests/test_gate_g4_decisions_comments.py`・`backend/tests/test_gate_p3_discussion.py`・`frontend/e2e/discussion.spec.ts`・`frontend/e2e/gate-g11-family-vote.spec.ts`・`frontend/e2e/gate-g4.spec.ts`・`frontend/src/pages/DiscussionPage.test.tsx`・`frontend/src/pages/candidates/CandidateVoting.test.tsx`・`frontend/src/services/api/contract.test.ts`・`frontend/src/services/api/p3discussion.test.ts`
- **外部の提供元:** なし
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API —(外部の提供元を使わない) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** 利用の計測、本番での確認(RELEASE-1)

### FR-023 秘匿プロフィール・制約

- **出典:** DOC-02 §3 FR-023(優先度 MUST・段階 G5)
- **要求(抜粋):** 予算・健康・宗教・食事・体力等を本人限定で保存し、他の参加者には充足/不充足だけ見せる
- **受入(抜粋):** 運用管理者にも平文を常に見せない
- **仕様の参照:** 画面 SC-19・SC-29 / API 群 MEMBER
- **実装:** API `backend/app/api/v1/private_profile.py` / 画面 `/settings` / 表 `user_private_profiles`・`private_profile_links`
- **試験:** `backend/tests/test_gate_c1_collaboration.py`・`backend/tests/test_gate_s4_authz_matrix.py`・`frontend/e2e/collaboration.spec.ts`・`frontend/e2e/constraints.spec.ts`・`frontend/src/components/settings/PrivateProfileSection.test.tsx`・`frontend/src/pages/constraints/PrivateProfilePanel.test.tsx`・`frontend/src/services/api.surface.test.ts`・`frontend/src/services/api/c1collab.test.ts`・`frontend/src/services/api/contract.test.ts`・`frontend/src/utils/privateProfile.test.ts`
- **外部の提供元:** なし
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API —(外部の提供元を使わない) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** —

### FR-024 コメント・通知

- **出典:** DOC-02 §3 FR-024(優先度 SHOULD・段階 G1-G5)
- **要求(抜粋):** イベント・予約・候補・変更セットへのコメント。メンション・変更・期限・出発・遅延・情報期限切れの通知
- **受入(抜粋):** 通知本文に予約番号や健康情報を含めない
- **承認済みの変更 2026-11:** メールは SMTP を設定した時だけ送り、未設定ならアプリ内の通知(出典: 利用者の決定(プロジェクトの記録 2026-11)・確度 高)
- **仕様の参照:** 画面 SC-20・SC-30 / API 群 SHARE/MEMBER
- **実装:** API `backend/app/api/v1/discussion.py`・`backend/app/api/v1/notifications.py`・`backend/app/api/v1/push.py` / 画面 `/notifications`・`/planner/:planId/discussion` / 表 `comments`・`notifications`・`notification_preferences`・`email_outbox`
- **試験:** `backend/tests/test_gate_p3_discussion.py`・`backend/tests/test_gate_remaining3_mail.py`・`frontend/e2e/discussion.spec.ts`・`frontend/src/pages/DiscussionPage.test.tsx`・`frontend/src/services/api/contract.test.ts`・`frontend/src/services/api/p3discussion.test.ts`
- **外部の提供元:** SMTP(メールの送信)・Web Push
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ。旅行当日に直結) / 実 API ○(実の提供元での確認なし(CI は模擬): SMTP(メールの送信)・Web Push) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** SMTP の送信元の設定(運用の判断)。メールの「すぐ送る」・端末への「自分あての知らせ」は Remaining-3

### FR-025 持ち物

- **出典:** DOC-02 §3 FR-025(優先度 SHOULD・段階 G2-G5)
- **要求(抜粋):** 共有/個人・数量・担当・必須・購入・梱包・使用後を管理し、日数・天候・活動等から候補を作る
- **受入(抜粋):** 旅程の変更で追加・不要の候補を示す
- **仕様の参照:** 画面 SC-21 / API 群 PACKING
- **実装:** API `backend/app/api/v1/preparation.py` / 画面 `/planner/:planId/preparation` / 表 `packing_items`
- **試験:** `backend/tests/test_gate_p1_preparation.py`・`frontend/e2e/preparation.spec.ts`・`frontend/src/pages/PreparationPage.test.tsx`・`frontend/src/services/api/contract.test.ts`・`frontend/src/services/api/p1preparation.test.ts`
- **外部の提供元:** なし
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API —(外部の提供元を使わない) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** 薬の時刻通知・天候連動

### FR-026 レディネス

- **出典:** DOC-02 §3 FR-026(優先度 MUST・段階 G2-G5)
- **要求(抜粋):** 未予約・未支払・未確認・未割当・期限切れ・持ち物不足を一覧にする
- **受入(抜粋):** 完了条件・責任者・期限を持つ
- **仕様の参照:** 画面 SC-22 / API 群 READINESS
- **実装:** API `backend/app/api/v1/preparation.py` / 画面 `/planner/:planId/preparation`・`/planner/:planId/kit` / 表 `preparation_tasks`
- **試験:** `backend/tests/test_gate_p1_preparation.py`・`frontend/e2e/preparation.spec.ts`・`frontend/e2e/remaining7.spec.ts`・`frontend/src/components/Remaining7.test.tsx`・`frontend/src/pages/PreparationPage.test.tsx`・`frontend/src/services/api/contract.test.ts`・`frontend/src/services/api/p1preparation.test.ts`
- **外部の提供元:** なし
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API —(外部の提供元を使わない) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** 予算との連動は Remaining-7(使った額・未払いの予約の見込み・費目の予算)

### FR-027 予算・費用

- **出典:** DOC-02 §3 FR-027(優先度 MUST・段階 G5)
- **要求(抜粋):** 計画・予約・実費・税・手数料・返金・複数通貨・換算を扱う
- **受入(抜粋):** 人別・カテゴリ別・日別の予算と差異を出す
- **仕様の参照:** 画面 SC-23 / API 群 EXPENSE
- **実装:** API `backend/app/api/v1/finance.py`・`backend/app/api/v1/finance_ledger.py`・`backend/app/api/v1/receipts.py` / 画面 `/planner/:planId/expenses` / 表 `budgets`・`budget_versions`・`expenses`・`fx_rates`
- **試験:** `backend/tests/test_gate_g5_finance.py`・`backend/tests/test_gate_p2_finance.py`・`frontend/e2e/expenses.spec.ts`・`frontend/e2e/gate-g5.spec.ts`・`frontend/src/pages/ExpensesPage.test.tsx`・`frontend/src/services/api/contract.test.ts`・`frontend/src/services/api/p2finance.test.ts`
- **外部の提供元:** 為替(ECB の参考値)・レシートの読み取り(AI)
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API ○(実の提供元での確認なし(CI は模擬): 為替(ECB の参考値)・レシートの読み取り(AI)) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** 為替は ECB の参考値を自動で取れる(Remaining-2。対応外の通貨は出典つきの手入力)、本番での確認(RELEASE-1)。レシートの読み取りは実物と実の AI では未確認

### FR-028 立替・精算

- **出典:** DOC-02 §3 FR-028(優先度 SHOULD・段階 G5)
- **要求(抜粋):** 支払者・負担者・均等/比率/金額/項目別の分割・債務の簡約・精算済み
- **受入(抜粋):** 領収書の原本と紐付ける
- **仕様の参照:** 画面 SC-23 / API 群 EXPENSE
- **実装:** API `backend/app/api/v1/finance.py` / 画面 `/planner/:planId/expenses` / 表 `expense_shares`・`settlements`
- **試験:** `backend/tests/test_gate_p2_finance.py`・`frontend/e2e/expenses.spec.ts`・`frontend/src/pages/ExpensesPage.test.tsx`・`frontend/src/services/api/contract.test.ts`・`frontend/src/services/api/p2finance.test.ts`
- **外部の提供元:** なし
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API —(外部の提供元を使わない) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** 本番での確認(RELEASE-1)

### FR-029 当日モード

- **出典:** DOC-02 §3 FR-029(優先度 MUST・段階 G4)
- **要求(抜粋):** 起動直後に今日・NOW・NEXT・出発まで・遅延・必要なチケットを出し、大きな文字・片手・高コントラスト・低電力
- **受入(抜粋):** 重要な情報へ1操作、一般の情報へ3操作以内
- **仕様の参照:** 画面 SC-07 / API 群 EXECUTION
- **実装:** API `backend/app/api/v1/today_live.py` / 画面 `/planner/:planId/today` / 表 `travel_events`
- **試験:** `backend/tests/test_gate_l1_today_mode.py`・`backend/tests/test_gate_l1b_today_timezone.py`・`backend/tests/test_gate_s4_authz_matrix.py`・`frontend/e2e/replan.spec.ts`・`frontend/e2e/today-mode-mobile.spec.ts`
- **外部の提供元:** なし
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ。旅行当日に直結) / 実 API —(外部の提供元を使わない) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** 外部状況の自動取得

### FR-030 外部状況

- **出典:** DOC-02 §3 FR-030(優先度 SHOULD・段階 G4-G5)
- **要求(抜粋):** 天気・警報・交通遅延・欠航・ゲート・休業を取得し旅程への影響を判定する
- **受入(抜粋):** 外部の値に確実性と取得時刻を出し、取れない時に最後の値を今の値のように見せない
- **承認済みの変更 2026-11:** 外部の状況は無料の提供元だけ接続し、有料・鍵の要る物は接続口だけ(出典: 利用者の決定(プロジェクトの記録 2026-11)・確度 高)
- **仕様の参照:** 画面 SC-24 / API 群 EXECUTION
- **実装:** API `backend/app/api/v1/replans.py` / 画面 `/planner/:planId/alerts` / 表 `plan_alerts`
- **試験:** `backend/tests/test_gate_p10_replans.py`・`frontend/e2e/replan.spec.ts`・`frontend/src/pages/replan/ExternalStatusPanel.test.tsx`・`frontend/src/services/api/contract.test.ts`・`frontend/src/services/api/p10replans.test.ts`
- **外部の提供元:** 気象庁の警報・注意報・鉄道の運行情報(ODPT。鍵の後)・休業の提供元
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ。旅行当日に直結) / 実 API ○(実の提供元での確認なし(CI は模擬): 気象庁の警報・注意報・鉄道の運行情報(ODPT。鍵の後)・休業の提供元) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** 休業の外部provider。気象庁の警報・注意報は Remaining-2(実通信は omega-dev2 で未確認)、鉄道の運行情報は ODPT の鍵の後に未確認

### FR-031 安全な再計画

- **出典:** DOC-02 §3 FR-031(優先度 MUST・段階 G4)
- **要求(抜粋):** 問題のイベントから固定の予約を守る代替案 A/B を出し、変更・通知・費用差・遅延差・失う予定を示す
- **受入(抜粋):** 利用者の承認の前に共有の旅程を変えない
- **仕様の参照:** 画面 SC-24 / API 群 REPLAN
- **実装:** API `backend/app/api/v1/replans.py` / 画面 `/planner/:planId/replans/:replanId` / 表 `replans`
- **試験:** `backend/tests/test_gate_p10_replans.py`・`frontend/e2e/replan.spec.ts`
- **外部の提供元:** Web Push
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ。旅行当日に直結) / 実 API ○(実の提供元での確認なし(CI は模擬): Web Push) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** 代替移動手段の探索、プッシュ通知

### FR-032 Offline Pack

- **出典:** DOC-02 §3 FR-032(優先度 MUST・段階 G2-G4)
- **要求(抜粋):** 当日と数日分の旅程・場所・予約・チケット・連絡先・緊急情報を端末の暗号化領域へ保存する
- **受入(抜粋):** 最終同期・未同期・期限・端末の失効を出し、共有端末では保存範囲を縮められる
- **仕様の参照:** 画面 SC-07・SC-38 / API 群 SYNC
- **実装:** API `backend/app/api/v1/offline_pack.py` / 画面 `/planner/:planId/today` / 表 `offline_devices`
- **試験:** `backend/tests/test_gate_k1_offline_keys.py`・`frontend/e2e/offline-pack.spec.ts`
- **外部の提供元:** なし
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ。旅行当日に直結) / 実 API —(外部の提供元を使わない) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** サーバー側のパック、通信しない端末の遠隔消去。アプリの殻のキャッシュ(sw.js の登録は Remaining-1)は実機で未確認

### FR-033 Offline同期

- **出典:** DOC-02 §3 FR-033(優先度 SHOULD・段階 G4-G5)
- **要求(抜粋):** 一時 ID・操作の列・再送・冪等・競合の解決
- **受入(抜粋):** 予約番号等の機密の変更はオンラインの再認証を要求できる
- **仕様の参照:** 画面 SC-07 / API 群 SYNC
- **実装:** API `backend/app/api/v1/sync.py` / 画面 `/planner/:planId/sync` / 表 `sync_operations`
- **試験:** `backend/tests/test_gate_g6_offline.py`・`backend/tests/test_gate_p11_sync.py`・`frontend/e2e/gate-g6.spec.ts`・`frontend/e2e/offline-sync.spec.ts`・`frontend/src/services/api/contract.test.ts`・`frontend/src/services/api/p11sync.test.ts`
- **外部の提供元:** なし
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ。旅行当日に直結) / 実 API —(外部の提供元を使わない) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** 本番での確認(RELEASE-1)

### FR-034 しおり生成

- **出典:** DOC-02 §3 FR-034(優先度 MUST・段階 G1-G2)
- **要求(抜粋):** かわいい・簡潔・家族・学校・出張・アクセシブル・白黒のテーマで、同じ構造化データから Web・PDF・印刷を作る
- **受入(抜粋):** 表紙・目次・日程・地図・持ち物・連絡先・費用・注意を選べる
- **仕様の参照:** 画面 SC-25 / API 群 EXPORT
- **実装:** API `backend/app/api/v1/booklet.py` / 画面 `/planner/:planId/booklet` / 表 `booklet_exports`
- **試験:** `backend/tests/test_gate_p4_booklet.py`・`frontend/e2e/booklet.spec.ts`・`frontend/src/services/api/contract.test.ts`・`frontend/src/services/api/p4booklet.test.ts`
- **外部の提供元:** 配備先の字体・地図の画像
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API ○(実の提供元での確認なし(CI は模擬): 配備先の字体・地図の画像) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** 冊子の面付。12 パターンは配備先の本物の字体・地図の画像で未確認

### FR-035 安全な印刷・公開

- **出典:** DOC-02 §3 FR-035(優先度 MUST・段階 G1-G2)
- **要求(抜粋):** 版ごとに予約番号・QR・住所・電話・参加者を含めるか選び、機密を含む版に警告・透かし・有効日
- **受入(抜粋):** 公開ページは検索エンジン除外を既定にする
- **仕様の参照:** 画面 SC-26 / API 群 EXPORT
- **実装:** API `backend/app/api/v1/booklet_share.py`・`backend/app/api/v1/booklet.py`・`backend/app/api/v1/server_exports.py` / 画面 `/b/:token`・`/planner/:planId/booklet` / 表 `booklet_exports`
- **試験:** `backend/tests/test_gate_p4_booklet.py`・`backend/tests/test_gate_remaining5_server_exports.py`・`frontend/e2e/booklet.spec.ts`
- **外部の提供元:** 配備先の字体(サーバー PDF)
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API ○(実の提供元での確認なし(CI は模擬): 配備先の字体(サーバー PDF)) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** サーバー側の PDF は画像のページ(文字の検索はできない。Remaining-5)。開発の image にも字体(fonts-ipafont-gothic)を入れた(Remaining-6。GCP の VM は次の配備から)

### FR-036 Calendar/Map IO

- **出典:** DOC-02 §3 FR-036(優先度 SHOULD・段階 G5)
- **要求(抜粋):** ICS・Google/Apple カレンダー・KML・GPX・CSV の入出力
- **受入(抜粋):** 外部の更新の取り込みは差分を確認してから適用する
- **承認済みの変更 2026-11-05:** Google マイマップは KML の案内付きの取り込み(自動の作成・更新はしない)(出典: ADR-mymaps-photo-qr.md・利用者の指示(DOC-10 §0.1 MyMaps)・確度 高)
- **仕様の参照:** 画面 SC-27 / API 群 CALENDAR/MAP
- **実装:** API `backend/app/api/v1/itinerary_export.py`・`backend/app/api/v1/calendar_import.py` / 画面 `/planner/:planId/calendar-import`・`/planner/:planId/exports` / 表 `plan_external_maps`
- **試験:** `backend/tests/test_gate_p5_itinerary_export.py`・`backend/tests/test_gate_p8_calendar_import.py`・`backend/tests/test_gate_remaining5_server_exports.py`・`frontend/e2e/calendar-import.spec.ts`・`frontend/e2e/exports.spec.ts`・`frontend/src/pages/CalendarImportPage.test.tsx`・`frontend/src/pages/ExportsPage.test.tsx`・`frontend/src/pages/exports/CalendarFeedCard.test.tsx`・`frontend/src/services/api/contract.test.ts`・`frontend/src/services/api/p5itineraryExport.test.ts`・`frontend/src/services/api/p8calendarImport.test.ts`
- **外部の提供元:** なし
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API —(外部の提供元を使わない) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** カレンダーの購読(webcal。Remaining-5)は外のカレンダーへの一方向。GPX/KML/CSV・取り消しの取込は Remaining-1。Google マイマップは KML の案内付き取り込み(自動作成なし、自動更新なし)

### FR-037 写真・旅行記

- **出典:** DOC-02 §3 FR-037(優先度 SHOULD・段階 G6)
- **要求(抜粋):** イベント・場所・日時へ写真・動画の参照・音声メモ・文を紐付け、計画と実績から旅行記の下書きを作る
- **受入(抜粋):** 公開の範囲を確かめる(顔・同行者・位置・予約の公開前の検査)
- **仕様の参照:** 画面 SC-28 / API 群 MEMORY
- **実装:** API `backend/app/api/v1/memories.py`・`backend/app/api/v1/memory_publish.py`・`backend/app/api/v1/photo_upload.py`・`backend/app/api/v1/spot_media.py` / 画面 `/planner/:planId/memories`・`/journal/:token`・`/u/:token` / 表 `memories`・`memory_publications`・`photo_upload_links`
- **試験:** `backend/tests/test_gate_p12_memories.py`・`backend/tests/test_gate_remaining5_server_exports.py`・`frontend/e2e/gate-g11-media.spec.ts`・`frontend/e2e/memories.spec.ts`・`frontend/src/pages/MemoriesPage.test.tsx`・`frontend/src/pages/memories/FaceCheckButton.test.tsx`・`frontend/src/services/api.surface.test.ts`・`frontend/src/services/api/contract.test.ts`・`frontend/src/services/api/p12memories.test.ts`
- **外部の提供元:** 顔の検査(Google Cloud Vision。鍵の後)
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API ○(実の提供元での確認なし(CI は模擬): 顔の検査(Google Cloud Vision。鍵の後)) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** 顔の検査は Google Cloud Vision の接続口(Remaining-5。鍵の後に実通信で未確認)。写真の地図・QR の投稿は実機未確認。印のまとめ表示は Remaining-6

### FR-038 位置軌跡

- **出典:** DOC-02 §3 FR-038(優先度 COULD・段階 G6)
- **要求(抜粋):** 旅行期間に限った位置の軌跡。精度の選択・即停止・後から削除
- **受入(抜粋):** 参加者への位置共有と本人の旅行記の記録を分ける
- **仕様の参照:** 画面 SC-43・SC-29 / API 群 MEMORY
- **実装:** API `backend/app/api/v1/location_tracks.py` / 画面 `/planner/:planId/track` / 表 `location_tracks`・`trip_location_settings`
- **試験:** `backend/tests/test_gate_l5_local_first_location.py`・`backend/tests/test_gate_p13_location_tracks.py`・`backend/tests/test_gate_p9_account_deletion.py`・`frontend/e2e/location-local-first.spec.ts`・`frontend/e2e/location-track.spec.ts`・`frontend/src/pages/LocationTrackPage.test.tsx`・`frontend/src/services/api.surface.test.ts`・`frontend/src/services/api/contract.test.ts`・`frontend/src/services/api/p13location.test.ts`
- **外部の提供元:** なし
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ。旅行当日に直結) / 実 API —(外部の提供元を使わない) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** バックグラウンドの記録、現在地の共有

### FR-039 輸出・削除

- **出典:** DOC-02 §3 FR-039(優先度 MUST・段階 G2-G6)
- **要求(抜粋):** 旅行単位・アカウント単位の輸出・訂正・削除・同意の撤回
- **受入(抜粋):** バックアップ・監査の残る期間を説明する
- **仕様の参照:** 画面 SC-29 / API 群 PRIVACY
- **実装:** API `backend/app/api/v1/data_export.py`・`backend/app/api/v1/privacy.py`・`backend/app/api/v1/corrections.py` / 画面 `/settings/data` / 表 `data_corrections`・`memory_trash`・`data_keys`
- **試験:** `backend/tests/test_gate_g7_memory_deletion.py`・`backend/tests/test_gate_g8_ownership_corrections.py`・`backend/tests/test_gate_p6_data_export.py`・`backend/tests/test_gate_p9_account_deletion.py`・`frontend/e2e/account-deletion.spec.ts`・`frontend/e2e/data-export.spec.ts`・`frontend/e2e/gate-g7.spec.ts`・`frontend/e2e/gate-g8.spec.ts`・`frontend/src/pages/DataPrivacyPage.test.tsx`・`frontend/src/services/api/contract.test.ts`・`frontend/src/services/api/p6dataExport.test.ts`・`frontend/src/services/api/p9privacy.test.ts`
- **外部の提供元:** なし
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API —(外部の提供元を使わない) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** 書類の写しの添付による出典の証明

### FR-040 管理・監査

- **出典:** DOC-02 §3 FR-040(優先度 MUST・段階 G0-G6)
- **要求(抜粋):** 利用者の状態・共有の失効・外部連携の障害・ジョブ・濫用・容量・セキュリティのイベントを管理する
- **受入(抜粋):** サポートの閲覧は同意・目的・時間の制限・監査が要る
- **仕様の参照:** 画面 SC-32 / API 群 ADMIN
- **実装:** API `backend/app/api/v1/admin.py`・`backend/app/api/v1/admin_ops.py`・`backend/app/api/v1/admin_support.py` / 画面 `/admin` / 表 `audit_logs`・`support_grants`・`abuse_reports`
- **試験:** `backend/tests/test_gate_a2_admin.py`・`backend/tests/test_gate_g2_support_access.py`・`backend/tests/test_gate_g4_guest_abuse.py`・`frontend/e2e/admin.spec.ts`・`frontend/e2e/support-access.spec.ts`・`frontend/src/pages/Admin/AdminAuditLogs.test.tsx`・`frontend/src/pages/G2.features.test.tsx`・`frontend/src/services/api.surface.test.ts`・`frontend/src/services/api/a2admin.test.ts`・`frontend/src/services/api/contract.test.ts`
- **外部の提供元:** なし
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API —(外部の提供元を使わない) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** 管理の画面の外部連携の障害の表示(ADM-01)、本番での運用の確認(RELEASE-1)

### FR-041 組織・B2B

- **出典:** DOC-02 §3 FR-041(優先度 SHOULD・段階 G6)
- **要求(抜粋):** 組織・ブランド・テンプレート・旅行の配布・版の改訂・閲覧の確認・組織の役割
- **受入(抜粋):** (DOC-02 に受入の文は無い。DOC-04 SC-31 の管理項目)
- **仕様の参照:** 画面 SC-31 / API 群 ORG
- **実装:** API `backend/app/api/v1/organizations.py` / 画面 `/organizations`・`/organizations/:orgId` / 表 `organizations`・`organization_members`・`organization_domains`
- **試験:** `backend/tests/test_gate_b1_organizations.py`・`frontend/e2e/organizations.spec.ts`・`frontend/src/pages/Organizations.b1.test.tsx`・`frontend/src/services/api.surface.test.ts`・`frontend/src/services/api/b1organizations.test.ts`・`frontend/src/services/api/contract.test.ts`
- **外部の提供元:** 本番の DNS(ドメインの確認)
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API ○(実の提供元での確認なし(CI は模擬): 本番の DNS(ドメインの確認)) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** 組織の料金(FR-058 待ち)、本番の DNS でのドメインの確認(RELEASE-1)

### FR-042 API・埋込

- **出典:** DOC-02 §3 FR-042(優先度 COULD・段階 G6)
- **要求(抜粋):** 外部事業者が旅行・イベント・場所・予約の限定の操作をできる
- **受入(抜粋):** OAuth スコープ・Webhook の署名・回数制限・監査を必須にする
- **承認済みの変更 2026-10-21:** 書き込みの API は個人のデータを外へ出さない方針で配布だけ(出典: DOC-10 §3 FR-042・gate-g2-trace.md・確度 中(Gate の判断。利用者の明示の承認の記録は見当たらない))
- **仕様の参照:** 画面 SC-31 / API 群 PUBLIC_API
- **実装:** API `backend/app/api/v1/org_external.py` / 画面 `/organizations/:orgId` / 表 `org_api_clients`・`org_api_tokens`・`org_webhooks`
- **試験:** `backend/tests/test_gate_b1_organizations.py`・`backend/tests/test_gate_g2_org_api.py`・`backend/tests/test_gate_remaining5_server_exports.py`・`frontend/e2e/org-api-rotation.spec.ts`・`frontend/e2e/organizations.spec.ts`・`frontend/src/components/share/embedModel.test.ts`・`frontend/src/pages/Organizations.b1.test.tsx`・`frontend/src/services/api.surface.test.ts`・`frontend/src/services/api/contract.test.ts`
- **外部の提供元:** なし
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API —(外部の提供元を使わない) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** 旅行・予定・場所・予約の書き込み(個人データを外へ出さない方針で配布だけ)。埋め込み(iframe・JS の部品)は Remaining-5

### FR-043 Quick Plan

- **出典:** DOC-02 FR-043 / DOC-15 CA-001(優先度 MUST(P0)・段階 G1)
- **要求(抜粋):** 日付・予定・場所だけで数分以内に始められる。アカウント前でも端末内の下書き。Advanced と同じ正規モデルへ保存
- **受入(抜粋):** 説明なしで3分以内に旅行と予定を作れ、場所・時刻が未定でも保存でき、失敗しても入力を失わない
- **仕様の参照:** 画面 SC-33 / API 群 quick-drafts
- **実装:** API `backend/app/api/v1/quickdrafts.py` / 画面 `/` / 表 `quick_drafts`
- **試験:** `backend/tests/test_gate_r2_2_quickdraft_create.py`・`backend/tests/test_gate_r2_3_quickdraft_promote.py`・`backend/tests/test_gate_r2_5_concurrency.py`・`frontend/e2e/quickdraft-flow.spec.ts`
- **外部の提供元:** なし
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API —(外部の提供元を使わない) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** —

### FR-044 Guest Travel View

- **出典:** DOC-02 FR-044 / DOC-15 CA-002(優先度 MUST(P0)・段階 G2)
- **要求(抜粋):** アカウントの無い同行者へ読み取り専用の URL(期限・PIN・停止・項目の選択・閲覧回数)で旅程を共有する
- **受入(抜粋):** URL を知るだけでは RESTRICTED を取れず、停止・期限切れ後は再取得できない。共有前に公開内容を確かめられる
- **仕様の参照:** 画面 SC-35 / API 群 g/{token}
- **実装:** API `backend/app/api/v1/public_share.py` / 画面 `/s/:token` / 表 `plan_share_links`・`share_access_logs`
- **試験:** `backend/tests/test_gate_g4_guest_abuse.py`・`backend/tests/test_share.py`・`frontend/e2e/gate-g4.spec.ts`・`frontend/e2e/share-clone.spec.ts`
- **外部の提供元:** なし
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ。旅行当日に直結) / 実 API —(外部の提供元を使わない) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** モバイルの実機での確認(UX-03)、本番での確認(RELEASE-1)

### FR-045 安全な共有ポリシー

- **出典:** DOC-02 FR-045 / DOC-15 CA-003(優先度 MUST(P0)・段階 G2)
- **要求(抜粋):** PUBLIC/INTERNAL/CONFIDENTIAL/RESTRICTED の分類を共有でも強制し、URL・同行者・画像・PDF ごとに別の Policy
- **受入(抜粋):** 「すべて共有」でも機密を暗黙に公開せず、共有・Reveal・ダウンロード・印刷を監査する
- **仕様の参照:** 画面 SC-34 / API 群 shares
- **実装:** API `backend/app/api/v1/public_share.py`・`backend/app/api/v1/member_policy.py`・`backend/app/api/v1/share.py` / 画面 `/share/:planId` / 表 `plan_share_links`
- **試験:** `backend/tests/test_gate_f45_share_policy.py`・`backend/tests/test_gate_g2_member_policy.py`・`frontend/e2e/member-policy.spec.ts`・`frontend/e2e/share-policy.spec.ts`・`frontend/src/pages/G2.features.test.tsx`・`frontend/src/pages/SharePage.f45.test.tsx`・`frontend/src/pages/SharePage.test.tsx`・`frontend/src/services/api.surface.test.ts`・`frontend/src/services/api/contract.test.ts`・`frontend/src/services/api/f45sharePolicy.test.ts`
- **外部の提供元:** なし
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API —(外部の提供元を使わない) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** —

### FR-046 画像・PDFの出力

- **出典:** DOC-02 FR-046 / DOC-15 CA-004(優先度 MUST(P0)・段階 G2)
- **要求(抜粋):** 1日・旅行全体・NOW/NEXT のカードを画像・A4 PDF・縦長画像にする
- **受入(抜粋):** 出力前に含む項目を確かめ機密を既定で除き、生成日時・情報の状態・共有範囲を出し、STALE/CONFLICTED に警告
- **仕様の参照:** 画面 SC-36 / API 群 exports
- **実装:** API `backend/app/api/v1/booklet.py`・`backend/app/api/v1/server_exports.py` / 画面 `/planner/:planId/exports` / 表 `booklet_exports`
- **試験:** `backend/tests/test_gate_p4_booklet.py`・`backend/tests/test_gate_remaining5_server_exports.py`・`frontend/e2e/booklet-image.spec.ts`・`frontend/e2e/booklet.spec.ts`・`frontend/src/pages/booklet/ImageExportPanel.test.tsx`
- **外部の提供元:** 配備先の字体
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API ○(実の提供元での確認なし(CI は模擬): 配備先の字体) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** PDF・NOW/NEXT の画像はサーバーの Pillow で作る(Remaining-5。PDF は画像のページ)。生成は監査に残す

### FR-047 旅程複製

- **出典:** DOC-02 FR-047 / DOC-15 CA-005(優先度 MUST(P0)・段階 G1)
- **要求(抜粋):** 予定・複数の予定・1日・旅行全体を複製する
- **受入(抜粋):** 別の日では時差・営業時間・予約・区間を再検証し、予約番号・券・個人情報は既定で複製しない
- **仕様の参照:** 画面 SC-37 / API 群 duplicates
- **実装:** API `backend/app/api/v1/plans.py`・`backend/app/api/v1/share.py` / 画面 `/planner/:planId?` / 表 `travel_plans`
- **試験:** `backend/tests/test_gate39_plan_clone.py`・`frontend/e2e/share-clone.spec.ts`
- **外部の提供元:** なし
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API —(外部の提供元を使わない) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** —

### FR-048 Offline Travel Pack(端末)

- **出典:** DOC-02 FR-048 / DOC-15 CA-006(優先度 MUST(P0)・段階 G2)
- **要求(抜粋):** 旅行単位で旅程・住所・予約(許可の範囲)・チケット・文書・緊急連絡先を端末の暗号化領域へ
- **受入(抜粋):** 最終同期と STALE を出し、端末の紛失で失効・期限・自動削除。オフラインの更新は列に入れ再接続で競合を解く
- **仕様の参照:** 画面 SC-38 / API 群 offline-packs
- **実装:** API `backend/app/api/v1/offline_pack.py` / 画面 `/planner/:planId/today` / 表 `offline_devices`
- **試験:** `backend/tests/test_gate_g6_offline.py`・`backend/tests/test_gate_k1_offline_keys.py`・`frontend/e2e/gate-g6.spec.ts`・`frontend/e2e/offline-pack.spec.ts`
- **外部の提供元:** なし
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ。旅行当日に直結) / 実 API —(外部の提供元を使わない) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** 本番での確認(RELEASE-1)。通信しない端末は鍵の期限(30日)の後は開けない(消去は次の通信の時)。sw.js の登録は Remaining-1(実機で未確認)

### FR-049 Visited Area Layer

- **出典:** DOC-02 FR-049 / DOC-15 CA-007(優先度 SHOULD(P1)・段階 G4)
- **要求(抜粋):** 地図に予定・候補・通過・訪問・滞在・確認済み・非表示の状態を重ねる
- **受入(抜粋):** 単純なグリッドの開放をまねず、計画・通過・滞在・確認を区別する
- **仕様の参照:** 画面 SC-39 / API 群 visits
- **実装:** API `backend/app/api/v1/visits.py` / 画面 `/planner/:planId/visits` / 表 `location_area_cells`
- **試験:** `backend/tests/test_gate_v2_visits.py`・`frontend/e2e/remaining7.spec.ts`・`frontend/e2e/visits.spec.ts`・`frontend/src/pages/VisitsPage.test.tsx`・`frontend/src/services/api.surface.test.ts`・`frontend/src/services/api/contract.test.ts`・`frontend/src/services/api/v2visits.test.ts`
- **外部の提供元:** 地図タイル(OpenStreetMap)
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API ○(実の提供元での確認なし(CI は模擬): 地図タイル(OpenStreetMap)) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** 候補の層・地図タイル(OpenStreetMap)の上への表示は Remaining-7。実機の位置の記録での確認は UAT

### FR-050 訪問判定・信頼度

- **出典:** DOC-02 FR-050 / DOC-15 CA-008(優先度 SHOULD(P1)・段階 G4)
- **要求(抜粋):** GPS・滞在・速度・予定との一致・写真・手動・チケットから訪問を判定する
- **受入(抜粋):** 信頼度・根拠・判定時刻・アルゴリズムの版を保存し、低い時は確定せず確認を求める
- **仕様の参照:** 画面 SC-40 / API 群 visits/assess
- **実装:** API `backend/app/api/v1/visits.py` / 画面 `/planner/:planId/visits` / 表 `visit_assessments`
- **試験:** `backend/tests/test_gate_v2_visits.py`・`frontend/e2e/visits.spec.ts`
- **外部の提供元:** なし
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API —(外部の提供元を使わない) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** —

### FR-051 訪問訂正・除外

- **出典:** DOC-02 FR-051 / DOC-15 CA-009(優先度 MUST(P0)・段階 G4)
- **要求(抜粋):** 誤った訪問の取り消し・訪問/通過の変更・時間/地点/旅行単位の GPS 削除・守る範囲・公開時のぼかし
- **受入(抜粋):** 削除の要求の後に生の位置を監査ログへ写さない
- **仕様の参照:** 画面 SC-40・SC-43 / API 群 visits
- **実装:** API `backend/app/api/v1/visits.py`・`backend/app/api/v1/privacy_zones.py` / 画面 `/planner/:planId/visits` / 表 `visit_assessments`・`privacy_zones`
- **試験:** `backend/tests/test_gate_g6_location_memory.py`・`backend/tests/test_gate_v2_visits.py`・`frontend/e2e/visits.spec.ts`・`frontend/src/utils/protectedZones.test.ts`
- **外部の提供元:** なし
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API —(外部の提供元を使わない) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** 実機の GPS での訂正・除外の確認(PoC)

### FR-052 Personal Travel Atlas

- **出典:** DOC-02 FR-052 / DOC-15 CA-010(優先度 SHOULD(P1)・段階 G6)
- **要求(抜粋):** 複数の旅行を通して国・都道府県・市区町村・テーマ等で訪問の地域を見せる
- **受入(抜粋):** Atlas から過去の記録・未訪問の候補・次の計画へ移れ、公開範囲を旅行・地点単位で設定
- **仕様の参照:** 画面 SC-41 / API 群 atlas
- **実装:** API `backend/app/api/v1/atlas.py` / 画面 `/atlas` / 表 `location_area_cells`
- **試験:** `backend/tests/test_gate_p15_atlas.py`・`frontend/e2e/atlas.spec.ts`・`frontend/src/pages/AtlasPage.test.tsx`・`frontend/src/pages/atlas/AtlasPlacesPanel.test.tsx`・`frontend/src/services/api.surface.test.ts`・`frontend/src/services/api/contract.test.ts`・`frontend/src/services/api/p15atlas.test.ts`
- **外部の提供元:** 地域の判定(国土地理院・Nominatim)
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API ○(実の提供元での確認なし(CI は模擬): 地域の判定(国土地理院・Nominatim)) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** テーマ別は予定の種類から(Remaining-6)。国・都道府県・市区町村は Remaining-2(国土地理院・Nominatim。実通信は omega-dev2 で未確認)

### FR-053 旅の達成指標

- **出典:** DOC-02 FR-053 / DOC-15 CA-011(優先度 COULD(P2)・段階 G6)
- **要求(抜粋):** 計画・訪問・写真つき・記録の達成率、移動距離・滞在時間・再訪率
- **受入(抜粋):** 健康・安全・費用を害する競争を誘わず、ランキングは作らず、数値は隠せる
- **仕様の参照:** 画面 SC-42 / API 群 journey-metrics
- **実装:** API `backend/app/api/v1/journey.py` / 画面 `/planner/:planId/journey` / 表 `event_actuals`
- **試験:** `backend/tests/test_gate_p14_journey.py`・`frontend/e2e/journey.spec.ts`・`frontend/src/pages/JourneyPage.test.tsx`・`frontend/src/services/api.surface.test.ts`・`frontend/src/services/api/contract.test.ts`・`frontend/src/services/api/p14journey.test.ts`
- **外部の提供元:** なし
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API —(外部の提供元を使わない) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** —

### FR-054 予定と実績

- **出典:** DOC-02 FR-054 / DOC-15 CA-012(優先度 MUST(P0)・段階 G4)
- **要求(抜粋):** 計画→実行→訪問/見送り→記録を同じ ID の系列で結ぶ
- **受入(抜粋):** 予定を実績で上書きせず、予定と実績の時刻・経路と軌跡を比べ、行かなかった候補を次の旅行へ戻せる
- **仕様の参照:** 画面 SC-42 / API 群 memories
- **実装:** API `backend/app/api/v1/journey.py` / 画面 `/planner/:planId/journey` / 表 `event_actuals`
- **試験:** `backend/tests/test_gate_p14_journey.py`・`backend/tests/test_gate_v2_visits.py`・`frontend/e2e/journey.spec.ts`・`frontend/src/components/Remaining7.test.tsx`・`frontend/src/pages/JourneyPage.test.tsx`・`frontend/src/services/api.surface.test.ts`・`frontend/src/services/api/contract.test.ts`・`frontend/src/services/api/p14journey.test.ts`
- **外部の提供元:** なし
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API —(外部の提供元を使わない) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** 予定の経路と GPS の軌跡の比べ(到達・寄り道・経路からの外れ)は Remaining-7。予定の経路は直線(道の形ではない)

### FR-055 Local-first Location

- **出典:** DOC-02 FR-055 / DOC-15 CA-013(優先度 MUST(P0)・段階 G4)
- **要求(抜粋):** 位置の記録は既定で OFF。「端末内のみ」「暗号化して同期」「記録しない」を旅行単位で選ぶ
- **受入(抜粋):** 端末内のみでは生の GPS をサーバーへ送らず、AI の入力から正確な位置を既定で除く
- **仕様の参照:** 画面 SC-43 / API 群 location-batches
- **実装:** API `backend/app/api/v1/location_tracks.py` / 画面 `/planner/:planId/track` / 表 `location_point_batches`・`trip_location_settings`
- **試験:** `backend/tests/test_gate_l5_local_first_location.py`・`frontend/e2e/location-local-first.spec.ts`・`frontend/src/services/api/l5location.test.ts`
- **外部の提供元:** なし
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ。旅行当日に直結) / 実 API —(外部の提供元を使わない) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** 端末のバックグラウンド記録、端末内の点の暗号化

### FR-056 適応型GPS

- **出典:** DOC-02 FR-056 / DOC-15 CA-014(優先度 SHOULD(P1)・段階 G4)
- **要求(抜粋):** 速度・停止・電池・精度で取得の頻度を変え、geofence・写真の EXIF・手動を併用する
- **受入(抜粋):** 記録中をアプリ内でも常に示し、低電力・一時停止・旅行終了の自動停止、電池の消費と欠測を観測する
- **仕様の参照:** 画面 SC-43 / API 群 location-batches
- **実装:** API `backend/app/api/v1/location_tracks.py` / 画面 `/planner/:planId/track` / 表 `location_point_batches`
- **試験:** `backend/tests/test_gate_l5_local_first_location.py`・`frontend/e2e/location-local-first.spec.ts`・`frontend/src/services/api/l5location.test.ts`・`frontend/src/utils/adaptiveSampler.test.ts`
- **外部の提供元:** なし
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ。旅行当日に直結) / 実 API —(外部の提供元を使わない) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** OS の geofence、電池の計測

### FR-057 Memory Replan

- **出典:** DOC-02 FR-057 / DOC-15 CA-015(優先度 COULD(P2)・段階 G6)
- **要求(抜粋):** 過去の予定と実績から次の計画への提案を作る
- **受入(抜粋):** 提案は説明でき戻せて、利用者が採用するまで旅程を変えない。機微を AI へ送る時は明示の同意と最小化
- **仕様の参照:** 画面 SC-42 / API 群 memories/replan
- **実装:** API `backend/app/api/v1/memory_replan.py` / 画面 `/planner/:planId/memory-replan` / 表 `change_sets`
- **試験:** `backend/tests/test_gate_g7_memory_deletion.py`・`backend/tests/test_gate_p17_memory_replan.py`・`frontend/e2e/gate-g7.spec.ts`・`frontend/e2e/memory-replan.spec.ts`・`frontend/src/pages/MemoryReplanPage.test.tsx`・`frontend/src/services/api.surface.test.ts`・`frontend/src/services/api/contract.test.ts`・`frontend/src/services/api/p17memoryReplan.test.ts`
- **外部の提供元:** なし
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API —(外部の提供元を使わない) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** 実際の旅の記録が増えた時の傾向の確かめ(RELEASE-1)

### FR-058 Entitlement・料金

- **出典:** DOC-02 FR-058 / DOC-15 CA-016(承認済みの変更: Stripe のテストモードだけ)(優先度 SHOULD(P1)・段階 G6)
- **要求(抜粋):** Free・Trip Pass・Monthly/Annual・Family/Group。旅行中の安全に直結するオフラインの閲覧・緊急情報を課金の壁に置かない。→ 2026-11-13 決定: Stripe のテストモードで仕組みだけ・価格は仮
- **受入(抜粋):** 本番の鍵(sk_live_)は断り、価格は管理画面で変えられる
- **承認済みの変更 2026-11-13:** 料金・決済は Stripe のテストモードで仕組みだけ。価格は仮で管理画面から変える。本番の鍵は断る(出典: 利用者の決定(DOC-10 §3 FR-058 の主な不足に記録)・確度 高)
- **仕様の参照:** 画面 (DOC-04 に画面 ID なし) / API 群 entitlements
- **実装:** API `backend/app/api/v1/billing.py` / 画面 `/settings/billing` / 表 `billing_products`・`billing_subscriptions`・`billing_payments`・`entitlements`
- **試験:** `backend/tests/test_gate_remaining4_billing.py`・`frontend/src/pages/BillingPage.test.tsx`
- **外部の提供元:** Stripe(テストモードの鍵の後)
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API ○(実の提供元での確認なし(CI は模擬): Stripe(テストモードの鍵の後)) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** Stripe のテストモードだけ(本番の鍵 sk_live_ は断る。利用者の決定 2026-11-13)。価格は仮(管理画面で変える)。実の Stripe のテストの鍵での確認は鍵の登録の後。組織でまとめる支払い(FR-041)・指定した支払う人は未実装。E2E は鍵の無い時の案内だけ

### FR-059 旅程相談 API の原価上限・クラス別 Quota

- **出典:** docs/spec/FR-059_旅程相談API原価上限_利用者クラス別Quota_v6.0.md(リポジトリの正本。DOC-02 v6.0 §3 FR-059 で採番。v5.1 には無かった)(優先度 MUST・段階 —)
- **要求(抜粋):** 旅程の相談の外部 API の原価上限(1旅行あたり)と利用者クラス別の quota をサーバーで守る
- **受入(抜粋):** 同時の要求・再試行でも上限を超えず、利用者・管理者が実績を確かめられる(同書 §11)
- **承認済みの変更 2026-10-29:** DOC-02 v5.1 に無い FR-059 を追加し、リポジトリの FR-059 正本を DOC-02/04/05/06/07/09/11/13 の該当箇所より優先する(出典: DOC-10 §0.2・Gate FR059-A(r27)・確度 高)
- **仕様の参照:** 画面 (DOC-04 に画面 ID なし) / API 群 FR-059 §6
- **実装:** API `backend/app/api/v1/planning_usage.py`・`backend/app/api/v1/usage.py`・`backend/app/api/v1/paid_actions.py`・`backend/app/api/v1/trip_intents.py` / 画面 `/trip-consult`・`/admin` / 表 `usage_policy_profiles`・`usage_budget_accounts`・`provider_usage_reservations`・`provider_usage_events`・`provider_secrets`
- **試験:** `backend/tests/test_gate_fr059_cost_guard.py`・`backend/tests/test_gate_fr059_d11_free_usage.py`・`backend/tests/test_gate_fr059_tiers.py`・`backend/tests/test_gate_fr059c_shared_suspension.py`・`backend/tests/test_gate_g1_doc10.py`・`backend/tests/test_gate_providerconnect.py`・`frontend/e2e/fr059-planning-usage.spec.ts`・`frontend/src/components/planning/PlanningUsage.test.tsx`
- **外部の提供元:** OpenAI(ai.generate)・Google Places・Google Routes・Google Maps Static
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の確認の記録なし。Playwright の画面の大きさの模擬だけ) / 実 API ○(実の提供元での確認なし(CI は模擬): OpenAI(ai.generate)・Google Places・Google Routes・Google Maps Static) / 運用(本番) ○(本番での提供なし(RELEASED 0)。開発環境の横断の運用の証拠は ledger の cross_cutting.ops)
- **主な不足(fr-status.json):** OpenAI(ai.generate)・Places(places.search)・Routes(routes.element)の adapter と鍵の有効性の確認は実装済み(CI は模擬の通信。実の鍵での確認・実送信・請求の照合は omega-dev2 で未実施)。places.details・places.photo・ai.web_search・map.load(Maps Static)の adapter は Remaining-7(実の鍵での確認・請求の照合は鍵の後)、会員の機能クラス Free/Trip/Journey/Explorer の価格・販売(FR-058)、保存の数・オフライン・書き出しのクラス別の制限は未実装(既存の上限のまま)、決済(Trip Pass の購入・指定した支払う人・組織でまとめる月の枠は FR-058・FR-041)。鍵の確認は 72 時間で失効する

### FR-060 スポットモード(自由に歩くエリア)

- **出典:** DOC-02 FR-060(v6.0 で追加。利用者の決定 2026-11-18。v5.1 には無かった)(優先度 SHOULD・段階 —)
- **要求(抜粋):** 旅程に自由に歩くエリアを置き、当日は予定とスポットモードを切り替えて、エリアの中の候補を天気・体調・気分で選んで歩く
- **受入(抜粋):** エリアを作って当日に予定とスポットを行き来でき、絞り込み・次どこ？・着いた・周りを探す・方角で見るが使え、集合に間に合う戻り始めが分かる
- **承認済みの変更 2026-11-18:** FR-060 スポットモードを追加(モックアップ「TravelCanvas スポットモード」を利用者が承認)(出典: DOC-10 r59・Gate SpotMode・確度 高)
- **承認済みの変更 2026-11-18:** 別行動の集合の共有・旅帖の歩いた順を追加(利用者の指示)(出典: DOC-10 r60・Gate SpotMode-2・確度 高)
- **仕様の参照:** 画面 SC-49・SC-50 / API 群 /plans/{plan_id}/spot-areas
- **実装:** API `backend/app/api/v1/spot_areas.py` / 画面 `/planner/:planId/spot/:areaId`・`/planner/:planId/spot-areas` / 表 `spot_areas`・`spot_area_items`・`spot_area_splits`
- **試験:** `backend/tests/test_gate_spot_mode.py`・`frontend/src/pages/SpotModePage.test.tsx`・`frontend/src/pages/spot/spotModel.test.ts`・`frontend/e2e/spot-mode.spec.ts`
- **外部の提供元:** OpenStreetMap(地図の絵)・場所の検索(place_finder。周りを探す)
- **証拠:** 実機 ○(実機(iPhone・Android・iPad)の位置・地図・画面の大きさの確認の記録なし) / 実 API ○(実の場所の検索での周りを探すの確認なし(CI は模擬)) / 運用(本番) ○(本番での提供なし)
- **主な不足(fr-status.json):** エリア・候補・当日の着いた/行きたい印・周りを探す・次どこ？・方角で見る・端末への保存・別行動の集合の共有・旅帖の歩いた順は実装済み(統合試験・E2E・画面の試験)。周りを探すの実の場所の検索(CI は模擬)・実機(iPhone・Android・iPad の位置・地図・画面の大きさ)・旅行当日の確認は未実施(確認表は縦断シナリオ §10)。地図の絵の端末への保存は OpenStreetMap の方針で一括取得をしない(圏外は方角で見る)
