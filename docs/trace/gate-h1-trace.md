# Gate H1 トレース(他の PC から画面を開く)

基準: Gate C2 v2(omega `af7de3d`)。migration なし。

## 不具合
omega-dev2 の画面を他の PC から `http://omega-dev2:4173` で開くと、vite preview が「Blocked request. This host ("omega-dev2") is not allowed」を返した。
仮にこれを通しても、画面の API の宛先は `http://localhost:8001`(ビルド時の既定)で、ブラウザは開いた PC 自身の localhost を呼ぶ。backend の CORS も
localhost:4173 だけを許していた。サンドボックス・CI・omega の E2E はすべて localhost で開くため、見つからなかった。

## 修正
| # | 内容 | 証拠 |
|---|---|---|
| 1 | `.env` の `TC_PUBLIC_HOSTS`(カンマ区切りの名前・IP)を vite preview の `allowedHosts` にする。それ以外の名前は従来どおり 403 | `src/test/publicHost.h1.test.ts`、サンドボックスで `Host: other-host` が 403 |
| 2 | 設定の API が localhost の時だけ、画面を開いた名前の `:8001` を API にする(本番のドメインは変えない)。CSP の通信先・報告先も要求の Host に合わせて付ける(vite のプラグインで要求ごと) | 同上。`apiUrlForHost`・`contentSecurityPolicy` |
| 3 | backend の CORS・CSRF の許可に `http://<TC_PUBLIC_HOSTS の名前>:4173` を足す。本番の設定の検査では TC_PUBLIC_HOSTS を問題として報告(本番は https の CORS_ORIGINS だけ) | `backend/tests/test_gate_h1_public_hosts.py` |
| 4 | パッチが `.env` に TC_PUBLIC_HOSTS が無ければ、この機械の名前と LAN の IP(docker・lo を除く)で足し、最後に画面の URL を表示する | パッチの雛形 |
| 5 | 通しの確認: サンドボックスで名前 `vm`(localhost 以外)で開き、会員登録 → 再読み込み(cookie で取り直す)→ 組織の画面。CSP の違反0、API の呼び出しはすべて `vm:8001` | 手元の Playwright |

Cookie は SameSite=Lax で、画面(:4173)と API(:8001)は同じ名前の別ポート=同じサイトのため送られる。HTTPS は無い(本番では HTTPS の前段と CORS_ORIGINS を https で設定する)。
