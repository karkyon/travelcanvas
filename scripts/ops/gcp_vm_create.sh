#!/usr/bin/env bash
# [Gate GcpVm] GCP の開発の共有環境の VM を作る(Cloud Shell で 1 回だけ実行する。もう一度実行しても、ある物は作らない)。
#
#   TC_GCP_PROJECT=<project ID> bash scripts/ops/gcp_vm_create.sh
#
# 作る物(docs/runbooks/gcp-vm-tailscale.md):
# - 専用のネットワーク tc-dev-net(受け付けるのは IAP 経由の SSH だけ。他の受け付けの規則は作らない=全部拒否)
# - VM(e2-small・Ubuntu 24.04・ディスク 30GB・Shielded VM・OS Login)。**外部 IP は付けない**
#   (インターネットから VM へ届く道が無い。外へ出る通信は Cloud NAT。画面への入口は Tailscale だけ)
# - ディスクの毎日のスナップショット(7 日分。03:00 JST ごろ)
# - VM 用のサービスアカウント(ログ・監視の書き込みだけ。鍵のファイルは作らない)
# 作らない物: 予算(請求先のアカウントの権限が要る。Cloud コンソールで設定する。手順は Runbook)・削除・既存の変更
set -euo pipefail

P="${TC_GCP_PROJECT:?TC_GCP_PROJECT に project ID を入れてください(例 TC_GCP_PROJECT=project-xxxx bash $0)}"
R="${TC_GCP_REGION:-asia-northeast1}"
Z="${TC_GCP_ZONE:-asia-northeast1-b}"
VM="${TC_VM_NAME:-travelcanvas-dev}"
TYPE="${TC_VM_TYPE:-e2-small}"
DISK_GB="${TC_VM_DISK_GB:-30}"
NET=tc-dev-net
SUB=tc-dev-subnet
SA_NAME=tc-dev-vm
SA="$SA_NAME@$P.iam.gserviceaccount.com"
POLICY=tc-dev-daily

say() { printf '%s\n' "$*"; }
has() { "$@" >/dev/null 2>&1; }
g() { gcloud --project="$P" --quiet "$@"; }

say "== project $P・$R/$Z・VM $VM($TYPE・${DISK_GB}GB)"
[ "$(gcloud billing projects describe "$P" --format='value(billingEnabled)' 2>/dev/null)" = "True" ] \
  || { say "NG: $P は請求先が有効ではありません(何も作っていません)"; exit 1; }

say "1: API を有効にする(compute・iap・oslogin・logging・monitoring)"
g services enable compute.googleapis.com iap.googleapis.com oslogin.googleapis.com logging.googleapis.com \
  monitoring.googleapis.com

say "2: ネットワーク $NET(受け付けは IAP の SSH だけ)"
has g compute networks describe "$NET" || g compute networks create "$NET" --subnet-mode=custom
has g compute networks subnets describe "$SUB" --region="$R" || g compute networks subnets create "$SUB" \
  --network="$NET" --region="$R" --range=10.60.0.0/24 --enable-private-ip-google-access
# IAP(Google の認証を通った人だけ)の SSH。Tailscale が止まった時の予備の入口。35.235.240.0/20 は IAP の送り元
has g compute firewall-rules describe tc-dev-allow-iap-ssh || g compute firewall-rules create tc-dev-allow-iap-ssh \
  --network="$NET" --direction=INGRESS --action=ALLOW --rules=tcp:22 --source-ranges=35.235.240.0/20 \
  --target-tags=tc-iap-ssh --description="IAP 経由の SSH だけ(他の受け付けの規則は作らない)"

say "3: 外へ出る通信(Cloud NAT。VM に外部 IP を付けないため)"
has g compute routers describe tc-dev-router --region="$R" || g compute routers create tc-dev-router \
  --network="$NET" --region="$R"
has g compute routers nats describe tc-dev-nat --router=tc-dev-router --region="$R" || g compute routers nats create \
  tc-dev-nat --router=tc-dev-router --region="$R" --auto-allocate-nat-external-ips --nat-all-subnet-ip-ranges

say "4: VM のサービスアカウント $SA(ログ・監視の書き込みだけ。鍵は作らない)"
has g iam service-accounts describe "$SA" || g iam service-accounts create "$SA_NAME" \
  --display-name="TravelCanvas dev VM"
for role in roles/logging.logWriter roles/monitoring.metricWriter; do
  g projects add-iam-policy-binding "$P" --member="serviceAccount:$SA" --role="$role" --condition=None >/dev/null
done

say "5: ディスクの毎日のスナップショット $POLICY(7 日分。18:00 UTC = 03:00 JST)"
has g compute resource-policies describe "$POLICY" --region="$R" || g compute resource-policies create \
  snapshot-schedule "$POLICY" --region="$R" --max-retention-days=7 --on-source-disk-delete=keep-auto-snapshots \
  --daily-schedule --start-time=18:00 --storage-location="$R"

say "6: VM $VM"
if has g compute instances describe "$VM" --zone="$Z"; then
  say "  ある(作らない)"
else
  g compute instances create "$VM" --zone="$Z" --machine-type="$TYPE" \
    --network-interface="network=$NET,subnet=$SUB,no-address" \
    --image-family=ubuntu-2404-lts-amd64 --image-project=ubuntu-os-cloud \
    --boot-disk-size="${DISK_GB}GB" --boot-disk-type=pd-balanced \
    --shielded-secure-boot --shielded-vtpm --shielded-integrity-monitoring \
    --metadata=enable-oslogin=TRUE,block-project-ssh-keys=TRUE \
    --service-account="$SA" --scopes=logging-write,monitoring-write \
    --tags=tc-iap-ssh --deletion-protection
fi
DISK="$(g compute instances describe "$VM" --zone="$Z" --format='value(disks[0].source.basename())')"
if ! g compute disks describe "$DISK" --zone="$Z" --format='value(resourcePolicies)' | grep -q "$POLICY"; then
  g compute disks add-resource-policies "$DISK" --zone="$Z" --resource-policies="$POLICY"
fi

say "7: 確認(受け付けの規則・外部 IP)"
g compute firewall-rules list --filter="network~/$NET\$" --format='table(name,direction,sourceRanges.list(),allowed[].map().firewall_rule().list(),targetTags.list())'
EXT="$(g compute instances describe "$VM" --zone="$Z" --format='value(networkInterfaces[0].accessConfigs[0].natIP)')"
[ -z "$EXT" ] && say "  外部 IP: なし(インターネットから VM へ届く道が無い)" || say "  NG: 外部 IP $EXT が付いています"

cat <<EOF

OK: VM $VM を用意しました。次は VM の中で(Runbook の 3 章):
  gcloud compute ssh $VM --zone=$Z --project=$P --tunnel-through-iap
  # VM の中で:
  git clone https://github.com/karkyon/travelcanvas.git ~/projects/travelcanvas
  cd ~/projects/travelcanvas && bash scripts/ops/gcp_vm.sh bootstrap
予算(月の上限と 50%・90%・100% の通知)は Cloud コンソールの「お支払い → 予算とアラート」で設定してください。
EOF
