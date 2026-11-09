# GCP の開発の共有環境(VM 1 台 + Tailscale)— Gate GcpVm

- 日付: 2026-11-09
- 状態: 手順と設定の用意まで(VM の作成・配備は未実施。Claude の作業環境には GCP の権限が無い)
- 決めたこと(利用者): VM は **e2-small** で始める・入口は **Tailscale** 方式・開発メンバーは利用者のほかに 4 名

以前の設計(`gcp-dev-runtime.md`・`gcp-dev-limited-access.md` の Cloud Run 案)は、外部の DB・Redis の契約と frontend の配備が
未完了で止まっている。開発の段階では、omega-dev2 と同じ Docker Compose を VM 1 台で動かす方が早く、今の運用の道具
(`tcops`・バックアップ・migration の検査)をそのまま使える。Cloud Run 案は本番を考える段階で見直す(消さない)。

## 1. 全体の形

```
開発メンバーの端末(Tailscale のアプリ)
   │  WireGuard で暗号化(tailnet の中だけ)
   ▼
https://travelcanvas.<tailnet>.ts.net   ← Tailscale Serve(正式な証明書。tailnet の外からは開けない)
   ▼ http://127.0.0.1:8080
gateway(caddy)  /api/*・/health・/ready → backend、他 → 画面(同じ origin)
   ▼
backend・frontend・postgres・redis(docker-compose.yml + docker-compose.gcp.yml)
```

| 層 | 対策 |
|---|---|
| インターネット → VM | **外部 IP なし**。受け付けの規則は IAP の SSH(Google の認証つき)だけ。外へ出る通信は Cloud NAT |
| tailnet → VM | Tailscale のアクセス規則で、開発メンバーは 443(画面)だけ、管理者は SSH も |
| VM の中 | backend(8001)・画面(4173)・gateway(8080)は 127.0.0.1 だけで待つ。DB・Redis はコンテナの網の中だけ |
| アプリ | 今のログイン・管理者の多要素認証・CORS/CSRF(許すのは `https://<tailnet の名前>` だけ) |
| GCP | OS Login・サービスアカウントの鍵を作らない・Shielded VM・ディスクの毎日のスナップショット(7 日) |

費用の目安(東京・2026-11): e2-small 月 約 15.7 ドル + ディスク 30GB(pd-balanced)+ Cloud NAT(数ドル)。
予算の通知は Cloud コンソールで設定する(通知であり、自動では止まらない)。

## 2. Tailscale の準備(管理者・1 回だけ)

1. https://login.tailscale.com で tailnet を作る(Google アカウントなどでログイン)
2. 管理画面の **DNS** で **MagicDNS** を有効にし、**HTTPS Certificates** を有効にする(Serve の証明書に要る)
   - 注意: 証明書の名前(`travelcanvas.<tailnet>.ts.net`)は公開の証明書の記録(Certificate Transparency)に載る。
     名前が知られても、tailnet の外からは開けない
3. **Access controls**(ポリシーファイル)を次の形にして保存する(メールアドレスは実際の値に置き換える)

```json
{
  "groups": {
    "group:tc-dev": ["owner@example.com", "member1@example.com", "member2@example.com",
                     "member3@example.com", "member4@example.com"]
  },
  "tagOwners": {
    "tag:travelcanvas": ["autogroup:admin"]
  },
  "acls": [
    // 開発メンバーは画面(443)だけ
    {"action": "accept", "src": ["group:tc-dev"], "dst": ["tag:travelcanvas:443"]},
    // 管理者は SSH(Tailscale SSH)も
    {"action": "accept", "src": ["autogroup:admin"], "dst": ["tag:travelcanvas:22"]}
  ],
  "ssh": [
    {"action": "check", "src": ["autogroup:admin"], "dst": ["tag:travelcanvas"], "users": ["autogroup:nonroot"]}
  ]
}
```

- 既定のポリシー(全員が全部の端末に届く)はこれで置き換わる。VM 以外の端末同士は届かなくなる
- `check` は SSH の時に Tailscale へのログインの確認を求める(12 時間ごと)
4. **Users → Invite users** で 4 名を招待する。各自は PC・携帯に Tailscale のアプリを入れ、招待のアカウントでログインする
   - 無料の Personal プランは 6 名まで(利用者 + 4 名 = 5 名)。**非商用に限る**。仕事として関わる人が入るなら
     Standard プラン(1 名 月 8 ドル)にする

## 3. VM を作る(Cloud Shell・1 回だけ)

```bash
git clone https://github.com/karkyon/travelcanvas.git ~/travelcanvas 2>/dev/null || (cd ~/travelcanvas && git pull --ff-only)
cd ~/travelcanvas
TC_GCP_PROJECT=<project ID> bash scripts/ops/gcp_vm_create.sh
```

- 最後に「外部 IP: なし」と出ることを確かめる
- project は `gcp-dev-limited-access.md` の新しい project(`project-c883e9da-6ebc-4d0d-a23`)を想定。違う project に
  作る時はその ID を入れる
- 変えられる値: `TC_GCP_ZONE`(既定 asia-northeast1-b)・`TC_VM_NAME`(travelcanvas-dev)・`TC_VM_TYPE`(e2-small)・
  `TC_VM_DISK_GB`(30)

## 4. VM の中の準備(1 回だけ)

```bash
gcloud compute ssh travelcanvas-dev --zone=asia-northeast1-b --project=<project ID> --tunnel-through-iap
# ここから VM の中
git clone https://github.com/karkyon/travelcanvas.git ~/projects/travelcanvas
cd ~/projects/travelcanvas
bash scripts/ops/gcp_vm.sh bootstrap   # スワップ 4GB・Docker・Tailscale。途中に出る URL を管理者のブラウザで承認
exit                                   # docker の組を効かせるため入り直す
```

```bash
# 入り直して(以後は tailnet の中から ssh <VM のユーザー>@travelcanvas でも入れる)
cd ~/projects/travelcanvas
bash scripts/ops/gcp_vm.sh env         # .env を作る(鍵・パスワードは乱数。値は表示しない)
bash scripts/ops/gcp_vm.sh deploy "$(git rev-parse origin/main)"   # 初回(数分〜十数分。e2-small で build する)
python3 scripts/ops/tcops.py schedule install                      # 毎日のバックアップ等の cron
```

最初の管理者: 画面(`https://travelcanvas.<tailnet>.ts.net`)で利用者登録をしてから、VM の中で

```bash
docker compose exec -T backend python scripts/security_incident.py grant-admin --email <自分のメール> --yes --reason "GCP 開発環境の最初の管理者"
```

次に管理者の画面を開くと多要素認証の設定を求められる。外部 API の鍵(Yahoo!・ホットペッパー・YouTube・楽天)は
**この環境の運用コンソールでも登録し直す**(鍵は環境ごとの DB に暗号化して持つ。omega-dev2 から写さない)。

## 5. 日々の流れ

| 段階 | 場所 | 誰が | 内容 |
|---|---|---|---|
| ① 開発・PR | GitHub(CI で試験) | Claude | |
| ② 取り込み | GitHub の main | 利用者 | |
| ③ 検証 | omega-dev2 | 利用者 | いつもの `consultai_apply.sh deploy` |
| ④ GCP へ反映 | VM | 利用者 | ③ で確かめた SHA を指定する |

```bash
# ④ tailnet の中のどこからでも(omega-dev2 からでも)
ssh <VM のユーザー>@travelcanvas 'cd ~/projects/travelcanvas && bash scripts/ops/gcp_vm.sh deploy <③ の SHA>'
```

`deploy` は次を行い、どれかが失敗したら止まる:
main に入った commit か → VM の作業ツリーに変更が無いか → バックアップ(`tcops backup`・検証)→ その commit を checkout
→ build・migration → DB の revision が head → Tailscale Serve → 画面・API・CSP・CORS・待ち受けの確認(`check`)

戻す: `bash scripts/ops/gcp_vm.sh deploy <前の SHA>`(記録 `~/tc-artifacts/gcp-deploy-*.state` に前の SHA がある)。
DB は自動では戻さない(戻す時は `python3 scripts/ops/tcops.py restore <backup>`。その後のデータは消える)。

## 6. 鍵の控え(重要)

- `.env` の `ENCRYPTION_KEY`・`MFA_KEY`・`LOOKUP_INDEX_KEY`・`OFFLINE_PACK_KEY_SECRET` をなくすと、暗号化したデータ・
  多要素認証・予約の検索・オフラインのデータが読めなくなる
- ディスクのスナップショットに `.env` も入るが、別の控えも持つ。VM のサービスアカウントには Secret Manager の権限が
  無いので、管理者が Cloud Shell で(値は表示されない):

  ```bash
  gcloud compute scp --tunnel-through-iap --zone=asia-northeast1-b travelcanvas-dev:projects/travelcanvas/.env /tmp/tc-gcpvm.env
  gcloud secrets create tc-gcpvm-env --replication-policy=automatic --data-file=/tmp/tc-gcpvm.env
  shred -u /tmp/tc-gcpvm.env
  ```
- 値を画面・チャット・Git に出さない

## 7. 確認と緊急の止め方

- 確認だけ: `bash scripts/ops/gcp_vm.sh check`(何も変えない)
- 画面だけ止める: `sudo tailscale serve --https=443 off`(tailnet からも開けなくなる。データはそのまま)
- VM を止める(費用も止まる。ディスクの分は残る): `gcloud compute instances stop travelcanvas-dev --zone=asia-northeast1-b`
- **Funnel(インターネットへの公開)は使わない**。`check` は Funnel が有効なら NG にする

## 8. まだ無い物(次の Gate)

- GitHub Actions からの反映(今は ssh 1 行。自動にするなら Tailscale の GitHub Action と OAuth クライアントが要る)
- 画面の build を GitHub 側で行い、Artifact Registry から取る形(e2-small での build が遅い・落ちる時)
- バックアップを Cloud Storage(別の場所)へ写す(今は VM のディスクとスナップショット)
- 独自ドメインでの一般公開(Cloudflare Tunnel + Access などへ移す。DDNS で 443 を開ける形は採らない)
