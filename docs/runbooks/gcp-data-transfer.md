# omega-dev2 の試験データを GCP の VM へ丸ごと移す — Gate DataTransfer

- 日付: 2026-11-17
- 決めたこと(利用者): omega-dev2 の DB を**丸ごと**(アカウント・旅行・写真・文書・データ鍵)GCP(travelcanvas-dev)へ移す。
  暗号化したデータを読むために、**GCP の .env の暗号の鍵を omega-dev2 と同じ値にする**(`gcp_vm.sh env` の
  「環境ごとに別の鍵」の方針の、この 2 つの開発環境の間だけの例外)
- 道具: `scripts/ops/tc_transfer.py`(標準ライブラリだけ。試験 `backend/tests/test_ops_tc_transfer.py`)

## 1. 何が移り、何が変わるか

| 物 | GCP の移した後 | GCP の元の物 |
|---|---|---|
| DB(アカウント・旅行・行きたい場所・しおり・運用コンソールの鍵 等) | omega-dev2 と同じ。**ログインは omega-dev2 のアカウント・パスワード** | 別名の DB `travelcanvas_gcp_before_<時刻>` に残る(消さない) |
| 保存ファイル(写真・文書・音声) | omega-dev2 と同じ | 移す前のバックアップ(`tcops backup`)に入っている |
| `.env` の鍵(ENCRYPTION_KEY・LOOKUP_INDEX_KEY・JWT_SECRET_KEY・MFA_KEY・OFFLINE_PACK_KEY_SECRET・文書の署名・共有の署名・通知の署名 等 11 個) | omega-dev2 と同じ値(omega-dev2 で未設定の鍵は消す) | `~/tc-artifacts/env.gcp-before-transfer-<時刻>` に控え |
| `.env` のそれ以外(DB・Redis のパスワード・サイトの名前・監視の合言葉・SMTP) | **変えない** | — |

注意:
- GCP で登録した開発メンバーのアカウントは、移した後の DB には無い(元の DB には残る)。omega-dev2 にあるアカウントでログインするか、登録し直す
- 運用コンソールの外部 API の鍵(OpenAI・Google 等)も omega-dev2 の登録になる
- ログイン中の人は全員ログインし直しになる(JWT の鍵が変わるため)

## 2. 手順

前提: GCP と omega-dev2 が**同じ main の commit**(DB の版が同じ)であること。違うと import は何もせずに止まる。

```bash
# ① omega-dev2: main を反映(この道具を入れる)
cd ~/projects/travelcanvas && TC_BRANCH=main bash scripts/ops/local_dev_apply.sh

# ② GCP の VM(tailnet の中から。omega-dev2 からでも): 同じ main を反映
ssh <VM のユーザー>@travelcanvas 'cd ~/projects/travelcanvas && git fetch -q && bash scripts/ops/gcp_vm.sh deploy $(git rev-parse origin/main)'

# ③ omega-dev2: 束を作る(合言葉を 2 回入れる。12 文字以上。GCP で同じものを入れる)
cd ~/projects/travelcanvas && python3 scripts/ops/tc_transfer.py export
#    → ~/tc-artifacts/tc-transfer-<ID>.tar.enc と .sha256

# ④ omega-dev2 → GCP の VM へ運ぶ(tailnet の中の scp。暗号化した束なので途中で見られても中身は読めない)
scp ~/tc-artifacts/tc-transfer-*.tar.enc ~/tc-artifacts/tc-transfer-*.tar.enc.sha256 <VM のユーザー>@travelcanvas:

#    tailnet の SSH が使えない時: 束を手元の PC へ取り(PowerShell: scp karkyon@192.168.1.11:~/tc-artifacts/tc-transfer-* .)、
#    GCP のブラウザの SSH の「ファイルをアップロード」で送り、sudo install -o <VM のユーザー> -m 600 ~/tc-transfer-* /home/<VM のユーザー>/

# ⑤ GCP の VM: 入れる(合言葉を入れ、確認で IMPORT と入力)
ssh -t <VM のユーザー>@travelcanvas 'cd ~/projects/travelcanvas && python3 scripts/ops/tc_transfer.py import ~/tc-transfer-<ID>.tar.enc'
```

`import` の順(どこかで失敗したら止まり、戻し方を表示する):
SHA-256 → 束の復号 → DB の版が omega-dev2 と同じか → **GCP のバックアップ(検証つき)と .env の控え** → 画面を止める →
.env の鍵を替えて backend を作り直す → omega-dev2 のバックアップを別名の DB(`travelcanvas_restore_omega_<時刻>`)へ復元して
件数・保存ファイル・復号・DB の版・鍵の指紋を確かめる(**合わなければ切り替えない**)→ 保存ファイルを入れ替える →
DB の名前を入れ替える(元 → `travelcanvas_gcp_before_<時刻>`、復元 → `travelcanvas`)→ 起動(migrate が tc_app の権限を付け直す)
→ `gcp_vm.sh check`。復号した束(鍵が入っている)は最後に消す。

⑥ 終わったら:
- 画面(`https://travelcanvas.<tailnet>.ts.net`)に omega-dev2 のアカウントでログインして、旅行・写真・予約番号が見えることを確かめる
- 運んだ束(VM の `~/tc-transfer-*`、omega-dev2 の `~/tc-artifacts/tc-transfer-*`)を消す: `shred -u <ファイル>`
- `.env` の鍵が変わったので、Secret Manager の控え(`gcp-vm-tailscale.md` §6)を新しい版にする:
  `gcloud secrets versions add tc-gcpvm-env --data-file=/tmp/tc-gcpvm.env`(取り方は §6 と同じ。後で `shred -u`)

## 3. 戻す

```bash
ssh -t <VM のユーザー>@travelcanvas 'cd ~/projects/travelcanvas && python3 scripts/ops/tc_transfer.py rollback ~/tc-artifacts/transfer-import-<時刻>.state.json'
```

DB の名前を元に戻し(移した DB は `travelcanvas_omega_<時刻>` として残す)、.env を控えに戻し、保存ファイルを移す前の
バックアップから戻す。途中で止まった import も、記録(`.state.json`)の段階に合わせて戻す。

## 4. 守ること

- 合言葉・鍵の値を画面・チャット・Git に出さない(道具は表示しない。openssl へは環境変数で渡す)
- 束を Google ドライブ・メール等へ置かない(tailnet の中の scp で運ぶ)
- 移した後の GCP の元の DB は、確かめ終わるまで消さない。消す時は名前を 2 回確かめる:
  `docker compose exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" travelcanvas_gcp_before_<時刻>'`
