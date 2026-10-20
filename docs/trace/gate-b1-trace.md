# Gate B1 トレース(FR-041 組織・B2B / FR-042 API・Webhook の最小形)

基準: Gate F45。migration `e6b4c8d2f3a5`(新しい表8つの追加だけ)。B = backend `tests/test_gate_b1_organizations.py`、
U = vitest(`services/api/b1organizations.test.ts`・`pages/Organizations.b1.test.tsx`・契約 fixture)、E = `frontend/e2e/organizations.spec.ts`(2人・2画面)。
規則の正本は `backend/app/services/organizations.py`・`org_api.py`。画面 `/organizations`・`/organizations/:orgId`・`/organizations/:orgId/distributions/:distId`。

## FR-041(DOC-02「組織、ブランド、テンプレート、旅行配布、版改訂、閲覧確認、組織役割」、DOC-03 §24、DOC-01 §15.4/15.6)

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 組織・組織役割 | IMPLEMENTED | owner・admin・member。メンバーでなければ 404(存在を推測させない)、役割が足りなければ 403、役割の変更は owner だけ、最後の owner は降格・脱退・削除できない(409)。ゲストは 401。B・U・E |
| 2 | ブランド | PARTIAL | 名前と色(画面の帯)。ロゴ・独自ドメインは無い |
| 3 | 旅行配布 | IMPLEMENTED | 自分(owner)の旅行の写しを配布。写すのは旅行名・目的地・期間・説明・日程の見出し・予定名・種類・時刻だけ(予約・番号・住所・メモ・位置・内部IDは写さない。B・E で本文を検査) |
| 4 | 版改訂 | IMPLEMENTED | 元の旅行から写し直して版+1(元の旅行の editor 以上が必要、base_version が違えば 409)。変わった件数(予定の追加・削除・変更)を示す。配布をやめる(メンバーから見えない) |
| 5 | 閲覧確認 | IMPLEMENTED | 版を指定して確認(古い版の指定は 409)。古い版の確認は「改訂があります」。管理者は誰がどの版を確認したかを見る(メールアドレスは出さない) |
| 6 | テンプレート・個人フォーク | IMPLEMENTED | 「自分の旅行として複製」。複製はメンバーのもので、後の改訂で変わらず、組織の管理者からも見えない(B・E) |
| 7 | 組織管理者でも個人旅行を見られない | IMPLEMENTED | 管理者が見られるのは写しと確認の有無だけ。複製した旅行は 403/404(B・E) |
| 8 | 退会(FR-039)との整合 | IMPLEMENTED | 所属・確認を外す。最後の owner なら最も古い admin を owner に、誰もいなければ組織を閉じ外部連携を止める(B) |
| 9 | 組織の監査 | IMPLEMENTED | 作成・変更・メンバー・配布・改訂・やめる・複製・外部連携の作成/停止を ID・役割・件数だけで記録(メールアドレス・秘密・内容は残さない。B) |
| 10 | 組織向けの料金・容量の割り当て | NOT STARTED | FR-058(料金)の判断待ち |

## FR-042(DOC-02「外部事業者が旅行、イベント、場所、予約の限定操作」「OAuthスコープ、Webhook署名、レート制限、監査を必須」、DOC-06 §16/§17)

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | OAuth スコープ | IMPLEMENTED | client_credentials(RFC 6749 §4.4、Basic/本文)。秘密は作成時だけ表示・DB はハッシュ。1時間の不透明トークン(ハッシュ)。スコープ `distributions:read`・`acknowledgements:read`、要求で絞れる。誤りは RFC の error 形式(invalid_client 401・invalid_scope・unsupported_grant_type)、不足は 403 insufficient_scope。期限切れ・クライアントの停止で即無効。B・E |
| 2 | 限定操作 | PARTIAL | 読み取りだけ(配布の一覧・写し・確認の件数)。旅行・予定・場所・予約の書き込みは無い(個人データを外部へ出さない方針の最小形) |
| 3 | Webhook 署名 | IMPLEMENTED | `X-TravelCanvas-Signature: t=…,v1=HMAC-SHA256(secret, "t.本文")`、`X-TravelCanvas-Event-Id`(受け手の冪等化)。鍵は作成時だけ表示・暗号化して保存。受け手の検証の見本 `verify_signature`(期限300秒)。B |
| 4 | Webhook の安全 | IMPLEMENTED | https だけ・資格情報入りの URL・localhost・内部の IP(直書き)は登録を拒否、送る直前の名前解決で内部のアドレスなら送らない(SSRF)、リダイレクトを追わない、5秒で打ち切り。本文は ID・版・件数だけ(個人・秘密の値なし。B で検査) |
| 5 | 再送・記録 | IMPLEMENTED | 送信の記録(状態・回数・応答コード)、失敗は5回まで送り直し、接続の確かめ(ping)。自動の再送の予定・dead-letter の隔離は無い(PARTIAL) |
| 6 | レート制限 | IMPLEMENTED | トークンは接続元ごと1分20回、外部 API はクライアントごと1分120回(429)。B |
| 7 | 監査 | IMPLEMENTED | トークンの発行・外部 API の呼び出しをクライアント ID と経路の型だけで記録(トークン・秘密は残さない。B) |
| 8 | 鍵の切り替え(secret rotation) | NOT STARTED | 作り直して古いものを止める運用で代える |
| 9 | 埋め込み | NOT STARTED | — |

→ FR-041 INTEGRATED(部分)、FR-042 INTEGRATED(部分)(E2E 有)。
