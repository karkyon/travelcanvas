#!/bin/bash
# TravelCanvas データベースバックアップ
#
# [Gate O1] 旧版はホストの pg_dump と ~/travelcanvas/.env.local を前提にしており、docker compose 構成では
# 動かなかった(復元の手順・検証も無かった)。運用コマンド scripts/ops/tcops.py へ一本化し、本スクリプトは
# 互換のための入口として残す。手順は docs/ops/RUNBOOK.md。
set -euo pipefail
cd "$(dirname "$0")/../.."
exec python3 scripts/ops/tcops.py backup "$@"
