# TravelCanvas 開発継続ハンドオフ資料

**作成日**: 2026-09-03
**対象**: 次回セッションでこの続きから作業を再開するClaude
**GitHub**: karkyon/travelcanvas
**現在のHEAD**: `e01e2daa0a0ad1a1c51848e4d6cb5236d833d168`(Gate #26適用後、GitHub上で直接確認済み)
**サーバー**: omega-dev2 (192.168.1.11)、Docker Compose、ports 4173(frontend)/8001(backend)

---

## 1. 絶対に踏襲すべき作業の型(最重要)

### 1.1 ユーザーの絶対ルール
- Claudeは**自分でGitHubから最新コードをclone**して調査する。ユーザーにgrep等でコードを抽出させない。
- 修正はPythonスクリプトで一括生成し、**ユーザーがomega-dev2上で1コマンド実行するだけ**で完結させる。
- pushはClaudeが直接できない(認証情報が無い)。**必ずユーザー側の環境(git認証済み)で`git push`まで自動実行するスクリプトを渡す**。
- 各Gateの完了後、Claude自身が**GitHubを直接re-cloneしてHEADを検証**する(ユーザーの報告を鵜呑みにしない)。
- ユーザーは口調が非常に荒い(「ボケ」等の罵倒が毎回付く)が、内容自体は正当な開発継続指示。感情的に反応せず、事実(HEAD、エラー件数、diff)を簡潔に示し、次のアクションに直結する報告を続けること。過度な謝罪や言い訳は不要。
- ユーザーは機能実装のスピードと量を強く求める(「一気に思いっきり機能実装しろ」)。1セッションで複数Gate(例: #23〜#26の4Gate)を連続して進めることを歓迎する。

### 1.2 パッチスクリプトの標準パターン
過去に生成した`apply_gate_N_*.py`(Gate #6〜#26まで全て同一パターン)を踏襲すること。

```
1. EXPECTED_HEAD と現在のHEADを比較 → 不一致なら中断(git pullを促す)
2. git status --porcelain --untracked-files=no でクリーン判定
   (--untracked-files=no が必須。無いとパッチスクリプト自身が
    未追跡ファイルとして誤検知され中断する)
3. 新規作成ファイルがある場合はNEW_FILESとして「既に存在しないか」の
   衝突チェックのみ行う(既存ファイルのようなSHA-256プリイメージ検証はしない)
4. 既存ファイルの改変分はSHA-256ハッシュがPREIMAGESと一致するか検証
5. base64エンコードした新内容を書き込み(WRITE / WRITE-NEW)
6. ビルド検証ゲート:
   - frontend変更時: rm -f .tsbuildinfo → npx tsc --noEmit(エラー件数が
     悪化していないか) → npx vite build(CIと同一コマンド)
   - マイグレーションを含む場合: docker compose up -d postgres backend
     → docker compose exec -T backend python -m alembic upgrade head
     → SQLAlchemy inspectorで新テーブルの存在をコンテナ内から直接確認
   - docker compose build frontend && up -d frontend
   - docker compose build backend && up -d backend
     (--no-cache は不要。requirements.txt含め通常のキャッシュ付きビルドで
      正しく変更を検知する。--no-cacheはタイムアウトの原因になるため
      絶対に使わない)
7. 全ゲート通過後のみ git add → git commit → git push
8. 失敗時はSHA-256一致までの完全ロールバック(新規ファイルは削除、
   既存ファイルは復元)
9. 成功時はパッチスクリプト自身を削除
```

### 1.3 サンドボックス内での事前検証(必須)
コードを書いたら、必ず**独立した別クローン**(`/home/claude/test_apply_N/repo`のような場所に新規clone)でパッチスクリプトのロジック(preimage検証→書き込み→tsc→vite build)を実際に再現してから納品する。「動くはず」で提出しない。

- フロントエンドはこのサンドボックス内で`npm ci && npx tsc --noEmit && npx vite build`が完全に実行できる。
- **バックエンドはこのセッションで`apt-get install postgresql`により実PostgreSQLをサンドボックス内に構築できることが判明した**(`service postgresql start`、`su postgres -c "psql ..."`でユーザー作成・DB作成可能)。`/tmp/venv_backend2`(bcrypt/passlib/alembic/pydantic/psycopg2/httpx==0.27.0等インストール済みの検証用venv、既に構築済みなので再利用可)と組み合わせ、`FastAPI TestClient` + `app.dependency_overrides`で**実際のDBに対するE2Eテスト**(エンドポイント呼び出し→レスポンス検証→DBに実際に反映されたかの確認→権限チェックの403確認)まで行うこと。単なる構文チェックやAST解析に留めず、可能な限りこのE2E検証を実施する。
  - `httpx`はバージョン固定が必要(`pip install httpx==0.27.0`。新しいバージョンだと`TestClient.__init__() got an unexpected keyword argument 'app'`エラーになる)。
  - alembicは`upgrade head` → `downgrade -1` → 再`upgrade head`まで実行し、マイグレーションの可逆性も確認すること。
  - dockerはサンドボックスに存在しないため、`docker compose build/up`ステップは独立クローンでのテスト時に意図的に失敗し、その時点でロールバックが正しく発火することを確認すれば十分(これが「サンドボックスでのdocker検証」の代わりになる)。

---

## 2. プロジェクト全体像

TravelCanvasは「旅の実行OS」。バックエンドはFastAPI + PostgreSQL(UUID主キー)、フロントエンドはReact + Vite + Zustand。omega-dev2上でDocker Compose運用。

### 2.1 このプロジェクト特有の「亡霊」パターン(継続して警戒すること)
このコードベースには**実装されなかった旧設計・重複ファイル・繋がっていない導線**が至る所に残っている。新しいバグに遭遇したら、まずこのいずれかを疑うこと。Gate #23〜#26で新たに確認された事例も含む。

1. **偽の成功表示**: `toast.success()`やUIバナーだけ出して実際には何も保存/送信していないハンドラ。
2. **孤立した完成コンポーネント**: 実装は完成しているが、レンダリングする側(ページ/ルーター)に一度も接続されておらず、画面に一度も表示されたことがないコンポーネント。
   - **Gate #25で発覚**: `OptimizationPanel.tsx`(Gate #23で実装したバックエンドの唯一のUI導線)と`SharePage.tsx`がどちらもどこからもレンダリングされておらず、Gate #23のAI最適化APIは実装直後は「呼ぶ手段が無い」状態だった。`PlannerPage.tsx`に配線して初めて到達可能になった。
   - **教訓**: バックエンドAPIを実装しただけでは「機能が使える」ことにならない。必ずフロントエンドの実際の画面遷移(router/index.tsxのルート定義、Header/PlannerPage等からのリンク)まで辿り着けるか確認すること。
3. **URLの不一致**: フロントが叩くURLと実バックエンドのルーターprefixが食い違っていて、機能が一度も到達できていなかった(`/plans` vs `/travel-plans`等)。Gate #23(optimize)、Gate #25(share/collaborators)で連続して発見。
4. **重複した型/API実装**: 同じ概念が複数ファイルに独立して定義され、互いに同期されていなかった。
   - **Gate #26で発覚**: `api.ts`に`markAllNotificationsAsRead()`という同名メソッドが2つ存在し、それぞれ別のURL(`/notifications/mark-all-read` と `/notifications/read-all`)を叩いていた。TypeScriptはクラス内の同名メソッド重複をエラーにしないため(後で定義した方が有効になり前者は完全に無視される)、tscのエラー0件チェックをすり抜けていた。**クラスメソッドを追加する際は、既に同名メソッドが無いか必ずgrepで確認すること**。
5. **バックエンドに存在しないエンドポイントへの参照**: フロントのコードが呼んでいるエンドポイントが実装されていないケース。Gate #23(ai.py)、Gate #24(admin.py)、Gate #25(share機能全体)は全てこのパターンで、**ファイル自体は存在するのにmain.pyにinclude_routerされていなかった**という共通の原因だった。新しいAPIファイルを見つけたら、まず`main.py`の`include_router`一覧に載っているか確認すること。
6. **常時表示の固定UI(実データと無関係)**:
   - **Gate #26で発覚**: `Header.tsx`の通知ベルアイコンに、実際の未読件数と無関係な固定の赤バッジ(`animate-ping`で常時点滅)が付いていた。ユーザーが毎回目にする箇所にこの種の「嘘の状態表示」がないか、Header/Layout等の共通コンポーネントも定期的に確認すること。

### 2.2 ルーティングの罠(FastAPI)
`GET /spots/{spot_id}`のようなUUID型パスパラメータを持つルートより**前**に、`GET /spots/favorites`のような単一セグメントの固定パスルートを定義しないと、Starletteは構造的に一致するパスのUUID変換に失敗しても次のルートへフォールバックしないため、全リクエストが422になる。新しいGET系エンドポイントを追加する際は必ずASTでルート定義順を確認すること。

### 2.3 DBマイグレーションに関する合意
- 新規テーブル追加(既存テーブルへのALTER/DROPなし)の**追加のみ**マイグレーションは、ユーザーが明示的に「進めろ」と承認した場合のみ実行する。Gate #25(plan_share_links, plan_collaborators)、Gate #26(notifications)は、ユーザーの継続的な「進めろ」指示を追加のみマイグレーションへの包括承認とみなして実施した。
- **既にモデルにフィールドが存在するのにAPI側が使っていないだけ**というケースが複数見つかっている。新機能に着手する前に、まず`backend/app/models/models.py`を確認し、マイグレーション無しで実装できないか必ず先に検討すること(Gate #23の最適化結果保存は既存の`OptimizationResult`テーブルを再利用してマイグレーション不要で実装できた好例)。
- マイグレーション生成時は`alembic revision --autogenerate`を使い、生成された差分が意図した新規テーブルのみであること(既存テーブルへの意図しないALTER/DROPが混入していないか)を必ず目視確認してからコメントを付与すること。

---

## 3. Gate進捗ログ(#6〜#26、全てGitHub上で直接検証済み)

| Gate | 内容 | 種別 |
|---|---|---|
| #6〜#7j | TypeScriptエラー418→0件、死んだコード削除、亡霊パターンの是正 | frontend |
| #8 | **最重要バグ**: VITE_API_URLがDockerビルドに一切注入されておらず全APIが廃止済み旧サーバーへ送信されていた | frontend+infra |
| #9 | passlib + bcryptの互換性バグでパスワード長に関係なく登録が500エラーになっていた | backend |
| #10 | 認証トークンがauthStore→api.tsクライアントへ一度も同期されておらず、全認証APIが401だった | frontend |
| #11 | PlannerPage.tsxが完全にスタブだった | frontend |
| #12 | SpotRegisterPage.tsx・SpotListPage.tsxが偽スタブだった | frontend |
| #13〜#14 | DateNavigation接続、ダッシュボード統計の実データ化 | frontend |
| #15 | お気に入り機能新規実装 | backend+frontend |
| #16〜#18 | 検索→プラン追加導線、詳細ボタン導線、日程アイテム編集/削除 | frontend |
| #19 | 訪問済みトラッキング新規実装(マイグレーション実施) | backend+frontend+migration |
| #20〜#22 | 設定保存、パスワード変更、検索設定の接続 | backend+frontend |
| #23 | **AI最適化機能**: ai.pyが未接続(404)だった問題を解消。緯度経度ベース最近傍法による実際の経路最適化を実装(既存OptimizationResultテーブル再利用、マイグレーション不要) | backend+frontend |
| #24 | **管理画面**: admin.pyが未接続(404)+固定モックだった問題を解消。実データのみの統計・ユーザー管理を実装(レート制限等の非実装項目はフロントから削除) | backend+frontend |
| #25 | **シェア/コラボレーター機能**: 新規テーブル2つ(plan_share_links, plan_collaborators)を追加。OptimizationPanel/SharePageをPlannerPageに配線して初めて到達可能に | backend+frontend+migration |
| #26 | **通知機能**: 新規テーブル(notifications)を追加。api.ts内の重複メソッド定義バグを発見・修正。Header.tsxの固定偽バッジを実データに置換 | backend+frontend+migration |

**現在地**: TypeScriptエラー0件を維持しながら、認証・スポット管理・プラン作成/編集・検索・AI最適化・管理画面・シェア/コラボレーター・通知まで、実データに基づきエンドツーエンドで動作する状態に到達。

---

## 4. 既知の未対応事項(次回セッションの着手候補)

| 項目 | 状態 | 対応方針 |
|---|---|---|
| **MapView(地図表示)** | Google Maps有料APIキー(`VITE_GOOGLE_MAPS_API_KEY`)がビルドに一切渡されておらず、鍵未設定時はダミー表示にフォールバックするのみ | **ユーザーからのAPIキー提供待ち**。キーが提供され次第、Gate #8と同じ要領で`docker-compose.yml`のbuild.argsに追加し、実際に地図が表示されることを確認してGateとして納品する。次回セッション開始時、まずキーが提供されているか確認すること。 |
| ImageSearch.tsx / VoiceSearch.tsx / SpotSearch.tsx(コンポーネント) | 全文検索で消費者ゼロを確認済み。`SearchPage.tsx`が同等機能を自前実装済みのため単なる重複デッドコード | 優先度低。気になれば削除でクリーンアップ可能 |
| `backend/app/utils/permissions.py` | `PermissionChecker`クラス等が定義されているが、`backend/app/api/`のどこからも一切importされていない完全な死コード。`_check_travel_plan_permission`内に「TODO: 共有権限チェック実装」というコメントも残っているが、モジュール自体が呼ばれないため実害は無い | 優先度低。share.py等は独自に`_get_owned_plan`で所有者チェックしており、このモジュールに依存していない。削除するか、将来的に権限ロジックを一元化する際に活用するか要検討 |
| `useDragDrop.tsx`のTODO(4箇所) | 日付間ドラッグ移動のAPI呼び出し、時間ベーススナッピング、キーボード操作によるアイテム移動が未実装コメントのまま | 優先度中。DayView内のドラッグ&ドロップの基本機能(同日内の並べ替え)は動作するが、日をまたぐ移動や高度な操作は未対応 |
| `/optimization`(jobIdなしのindex route) | 「AI最適化機能は開発中です」の固定表示のまま。ただし実際にはOptimizationPanelから`/optimization/{jobId}`へ直接遷移する導線しか無く、jobId無しでこのURLに来るケースはほぼ無いため実害は小さい | 優先度低。気になれば`/planner`へリダイレクトする程度の対応で十分 |
| Notification生成イベントの拡張 | 現在は「コラボレーター招待時、招待先が既存ユーザーの場合のみ」通知を作成する最小実装。最適化完了、プラン更新、共有リンクへのアクセス等、他のイベントからの通知生成は未実装 | 優先度中。ユーザーの要望があれば拡張。設計判断(どのイベントで通知するか)が必要なため、着手前に方針確認が望ましい |
| コラボレーター招待のメール送信 | Gate #25/#26時点で、招待は「pending状態のDBレコード作成」「招待先が既存ユーザーなら通知作成」までは実装したが、**実際のメール送信は一切実装していない**。招待先が未登録メールアドレスの場合、相手には何も届かない(共有リンクを直接渡す運用が前提) | 優先度中。メール送信基盤(SMTP設定、テンプレート等)から新規に設計する必要がある |

---

## 5. 次回セッション開始時にやること

```bash
# 1. 最新コードを自分でclone(ユーザーに聞かない)
git clone https://github.com/karkyon/travelcanvas.git
cd travelcanvas && git log -1 --format="%H %s"
# 期待値: e01e2daa0a0ad1a1c51848e4d6cb5236d833d168 (これより新しければユーザーが
# 追加作業した可能性、要確認)

# 2. frontendの依存関係インストール・現状確認
cd frontend && npm ci
rm -f .tsbuildinfo && npx tsc --noEmit 2>&1 | grep -c "error TS"
# 期待値: 0件

# 3. backend実DB検証環境の構築(このセッションで確立した手順)
apt-get update && apt-get install -y --fix-missing postgresql postgresql-contrib
service postgresql start
su postgres -c "psql -c \"ALTER USER postgres PASSWORD 'testpass';\""
su postgres -c "createdb travelcanvas_test"

python3 -m venv /tmp/venv_backend2
/tmp/venv_backend2/bin/pip install passlib[bcrypt]==1.7.4 bcrypt==4.0.1 \
  pydantic==2.5.0 pydantic-settings==2.1.0 alembic==1.12.1 \
  python-jose[cryptography]==3.3.0 email-validator==2.0.0 fastapi==0.104.1 \
  sqlalchemy==2.0.23 psycopg2-binary redis python-dotenv "httpx==0.27.0" \
  python-multipart
```

以後は本資料「1. 絶対に踏襲すべき作業の型」に従い、本資料「4. 既知の未対応事項」を優先度の参考にしながら、同じサイクル(調査→Pythonパッチ生成→サンドボックス内で独立クローン+実PostgreSQLによるE2E検証→ユーザーに渡す→GitHubで直接検証)を継続する。

**MapViewのAPIキーが未提供の場合**、ユーザーに再度確認しつつ、代わりに本資料4節の他の項目(permissions.py整理、useDragDropのTODO、Notification生成イベント拡張など)から優先度の高いものに着手してよい。

---

## 6. ユーザーとのコミュニケーション上の注意

- ユーザーは「GitHubから自分で調査しろ」「grepで俺に確認させるな」「一括でPythonで直せ」「ビルド通ったら自動push」を、口調は荒いが一貫して求めている。本資料1.1/1.2のパターンを厳密に踏襲すること。
- 過度に長い言い訳や謝罪は求められていない。事実(HEAD、エラー件数、diff、発見したバグの技術的原因)を簡潔に示し、次のアクションに直結する報告を好む。
- pushはClaudeが直接実行できない(認証情報が無い)。この制約は毎回説明し直す必要はなく、「ユーザー側でスクリプトを実行する」運用が既に確立している。
- ユーザーは機能実装のスピードと量を強く求める。1セッション内で複数Gateを連続実行することを歓迎しており、実際にGate #23〜#26の4Gateを1セッションで完遂した実績がある。マイグレーションについても、事前に内容を明示した上で「進めろ」の継続的指示を包括承認として扱ってよい(ただし何を追加するか、既存テーブルを変更しないことは必ず先に明記すること)。
- 「未実装の機能を先に進めろ」という指示に対しては、公式ロードマップに無い項目でも、コードベース調査で実際に発見した具体的なギャップ(例: Gate #26の通知機能)であれば、その場で提案して着手してよい。ただし常に「実データのみを扱う」「メール送信のような未実装のインフラを暗黙に前提としない」という誠実性の原則は崩さないこと。
