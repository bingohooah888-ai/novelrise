# NOVELIGHT 工程②-①：NLO Cloudflare 管理接続・権限計画

基準：2026-11-02 JST。実装ベースmain `893d630fd36ecb9dce52c296c85b368de4affa4b`。

## 許可されていることと絶対に許可されていないこと

OWNERは「NLOのCloudflare機能をまとめて実装」を指示した。Cloudflareアカウント作成・課金・API token/Secret登録・Staging接続・新Preview・実AI試験・Worker実配備・既存Worker変更は承認していない。既存MASTER/AGENTS/FULL PREFLIGHTが上位。今回のコードはNLOに**読み取りおよび変更計画の能力**を足すものであり、実稼働Watchdogではない。Gate AはNO-GO。

- Cloudflareアカウント ID（スクリーンショットから確認済）：`6831b18fe814232fa2dd4c470b95aa15`。
- Billing画面でWorkers Free Active / 支払い方法未登録を観測済。ただしNLO側のCloudflare API認証はまだ設定していない。
- 対象は名前の前方一致 `novelight-ai-gatea-` のWorkersと、その対象Workersに対応するDO namespaceだけ。
- Production Supabase `fiepaguycecrredwrcwx`、Staging `wmlzjgvxgoyrovdhbqbg` と本実装コードは接続しない。
- ユーザーのCloudflareブラウザログインはNLOのAPI tokenではない。トークンのチャット送信禁止。

## NLO追加アクション（直接MCPとGitHub Bridge共通）

| 名称 | 役割 | 現在の権限 |
| --- | --- | --- |
| `cloudflare_account` | アカウントIDと種別を確認（サブスクリプションは推測しない） | read-only |
| `cloudflare_workers` | Gate A名に限定してWorkers一覧を読む | read-only |
| `cloudflare_worker_deployments` | 個別対象Workerのデプロイ履歴 | read-only |
| `cloudflare_durable_objects` | Gate AのDO namespace一覧 | read-only |
| `cloudflare_do_object_count` | 対象namespaceのオブジェクト件数（ID/保存データは返さない） | read-only |
| `cloudflare_worker_observability` | ログ/Trace収集の設定状況のみ確認 | read-only |
| `cloudflare_worker_metrics` | 過去5〜1440分のrequest/error件数を固定GraphQL集計（生ログなし） | read-only |
| `cloudflare_watchdog_status` | 実配備の有無・NO-GO未実証を明示 | read-only |
| `cloudflare_plan_change` | 作成/更新/削除/DO管理/停止の承認計画のみ作成 | **mutation 0** |

すべての操作は固定 Cloudflare API host を使用し、任意のURL、任意のCloudflare GraphQL、秘密情報付き引数、別Worker名、別account ID、任意のShellコマンドを禁止する。外部エラー/ヘッダー/生JSONは一切返さず、非機密コードのみ返す。リクエストのタイムアウトとrate limitは再試行せず停止する。GraphQLはPOSTだが静的な閲覧専用クエリであり設定変更しない。Workerの作成前はWatchdog未実証と返す。

## ローカルNLOへの接続手順（本タスクではまだ行わない）

1. CloudflareのAccount API tokensから、対象アカウントのWorkers製品 `Metadata Read-Only` 相当を最小範囲で割り当てたトークンを**本人が発行する**。Workersが作成済みなら個別Workerのみのscopeを検討。Workers/DO対象外のDNS・Billing Write・Token管理権限は付けない。
2. Windows上のNLO起動用のGit管理外環境変数に `NLO_CLOUDFLARE_ACCOUNT_ID`、`NLO_CLOUDFLARE_READ_TOKEN` と `NLO_CLOUDFLARE_READONLY_ENABLED=true` を指定。トークンをGitHub Issue、CloudflareのWorkerスクリプト、チャットへ貼らない。
3. NLOが最新mainで更新された後、既存のNLO MCP tunnel/Bridgeサービスを通常手順で再起動する。接続前のシステムでは新toolは見えない。再起動も現段階では未実施。
4. NLOで `cloudflare_account` → `cloudflare_workers` → `cloudflare_watchdog_status` を読み取り専用で実行し、無権限/失敗時にはNO-GOのまま停止。Direct MCPが見えないときはNLO Bridgeを別途診断する。DCのofflineだけでNLOをoffline扱いしない。
5. GitHub Bridgeに返すデータは**非機密メタデータのみ**。GitHubのIssueで原文ログ/トークン/認証cookieを扱わない。

## 本PRの安全検証

- 許可済みaccount IDが一致するまで通信0。
- トークン未設定・opt-in未有効は失敗。
- Workers/DOの名前と戻り値を合成テストで最小化・制限。
- GraphQLクエリの固定・数値集計、rate-limit/403/GraphQL errorsは非機密の失敗コード。
- 変更計画は外部mutationなし。
- GitHub Bridgeと直接MCPの操作名・Capability Registryを整合。
- Nodeテスト/CI/CodeQL後もStaging・Production/Cloudflare実実行の証拠にはならない。

## Gate Aの次の承認（今回要求しない）

A0: 本PRのexact HEAD 変更ファイルのmain Squash Merge（通常Production自動deployの可能性は別途説明）。

A1: NLOへの**read-only API token のローカル登録/明示opt-in**。トークン実値は絶対にチャットに出さず、対象アカウント・権限・登録先・再起動1回を指定したOWNER承認が必要。

A2: Cloudflare Worker + DOの新規作成、料金限度/公開性/削除手順を固めてから別の明示承認を求める。Workersを作成するには製品単位のAdmin権限が要るため、read-onlyトークンをWorker管理用として使い回さない。

A3: Watchdogに必要なGitHub read-only、署名、永続復旧台帳、Staging停止/Auth失効/清掃/censusの**別の最小権限と厳密な承認**。ブラウザ・main merge・read-only tokenをもって、実操作を許可したとみなさない。

### 注意事項

Workers `Metadata Read-Only` 権限はWorkers/DOのメタデータ・監視参照向けであり、実Workerのデプロイや編集・削除権限ではない。ログ/メトリクスの参照には別のAnalytics権限が必要なケースもあるため、アクセス拒否時は勝手にscopeを拡大せず別承認で対応する。

CloudflareのDO Alarmは重複実行され得る。NLOから監視できるだけでは、Runner death/kill、署名真性、外部停止、残留0を証明しない。

公式：
- https://developers.cloudflare.com/workers/authorization/workers/
- https://developers.cloudflare.com/workers/authorization/durable-objects/
- https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/list/
- https://developers.cloudflare.com/api/resources/durable_objects/subresources/namespaces/methods/list/
- https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/
