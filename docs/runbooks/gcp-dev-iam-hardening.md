# GCP開発環境 IAM 強化手順

対象は `travelcanvas-development`（project number `142651556966`）だけです。組織内の他プロジェクトには変更を加えません。

## 実装内容

| 項目 | 変更後 | 検証 |
|---|---|---|
| GitHub WIF | repository ID `1351842847`、owner ID `20151723`、`main`、`.github/workflows/deploy-gcp-dev.yml` の組合せだけ許可 | providerの`attributeCondition`とSAポリシーを表示 |
| SA鍵 | 新規のユーザー管理鍵の作成と外部公開鍵のアップロードをプロジェクト組織ポリシーで禁止 | effective policyを表示。既存ユーザー管理鍵一覧が空であることも確認 |
| Artifact Registry | deployerのWriterをプロジェクトから削除し、`travelcanvas-dev`リポジトリだけへ付与 | リポジトリIAMとプロジェクトIAMを両方表示 |
| イメージ公開 | 手動起動・main限定・WIF限定。commit SHAタグだけをpush | Artifact Registryからdigestを再取得 |

## 適用順序

1. この変更をmainへマージし、専用workflowがmainに存在する状態にする。
2. Google Cloud Shellでリポジトリを取得または更新する。
3. `bash scripts/ops/harden_gcp_dev_iam.sh` を実行する。
4. 最後が `PASS` であることを確認する。
5. GitHub Actionsの `GCP dev image publish` をmainから手動実行する。

```bash
gcloud config set project travelcanvas-development
git clone https://github.com/karkyon/travelcanvas.git 2>/dev/null || true
cd travelcanvas
git fetch origin main
git switch main
git pull --ff-only origin main
bash scripts/ops/harden_gcp_dev_iam.sh
```

## 権限不足になった場合

組織ポリシーだけが403になる場合は、組織 `552296876955` に対する `roles/orgpolicy.policyAdmin` が不足しています。プロジェクトOwnerだけでは付与できないことがあります。IAMを緩めたり鍵を作成したりせず、組織管理者が当該ロールを一時付与して再実行します。スクリプトは冪等なので、成功済み項目を含めてそのまま再実行できます。

## 意図的に未作成のもの

Cloud Runサービスは、DB・Redis・本番相当の暗号鍵・アプリのSecret Manager設計が未確定のため、まだ作成しません。設定不足のサービスを公開すると安全性と可用性を下げるためです。現段階のworkflowはproductionイメージを改変不能なcommit SHAで保存するところまでに限定します。
