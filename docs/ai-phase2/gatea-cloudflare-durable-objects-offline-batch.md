# NOVELIGHT 工程②-① / Gate A：Cloudflare Workers + Durable Objects 実装準備（OFFLINE）

2026-11-02 JST。起点main: `65b3c544009af1d0e7d0281793ca007f605e84ca`。

## 採用範囲・未承認操作

OWNERがCloudflare Workers + Durable Objectsを**第一候補**として採用。これは設計選択のみであり、環境作成・課金・Cloudflare Secret登録・Staging操作・新Preview・実AI試験を承認しない。正式MASTER、AGENTS、FULL PREFLIGHT、工程②のクローズアウトゲートが上位。**②-①は引き続きNO-GO**。

- Staging Supabase: `wmlzjgvxgoyrovdhbqbg`
- Production Supabase（除外、変更禁止）: `fiepaguycecrredwrcwx`
- 実接続状態：Supabase連携でProductionのみ表示され、Staging接続は未確認。過去の観測記録を現在の資格証明と取り違えない。
- 今回の3ファイルは**純粋なオフライン設計・合成コード**。Cloudflare Workerの公開エントリーポイント、wrangler設定、binding、alarm、Secret、HTTPクライアント、DB migration、Actions workflowを追加しない。

## Cloudflare公式仕様の適用点

- SQLite-backed Durable Objectsの `ctx.storage.sql.exec()` と `ctx.storage.transactionSync()` を将来の原子台帳に利用する。同期SQL操作を同じトランザクション内で行う。
- DO Alarmはat-least-onceで、例外後の再実行もある。**Alarmイベントの1回限り実行を前提にせず**、全イベントを台帳状態・nonce・fenceで再審査する。
- 各DOに同時設定できるAlarmは1件。複数対象ならscope別DOか永続スケジューラが必要。不要な短間隔pollingは料金を増やす。
- 新規DOはSQLite storageを利用。Workers Freeでも使用可能だが無料枠上限を超えると操作失敗し得る。無料枠を停止・復旧保証にしない。
- 最新Wranglerは宣言的 `exports` 推奨（旧 `migrations` 配列と排他）。配備用設定は**別承認後**に作成する。

公式資料：
https://developers.cloudflare.com/durable-objects/api/alarms/
https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
https://developers.cloudflare.com/workers/wrangler/configuration/
https://developers.cloudflare.com/durable-objects/platform/pricing/

## 今回の3ファイル

1. `.github/staging-ai-02-07-05/cloudflare-do-ledger-offline.mjs`：DO SQL Storage API準拠の**合成専用**SQLite原子台帳。Watchdog challengeの一回消費、復旧ラウンドの排他・一意nonce・単調fence・最大3回の暫定上限・終了の一方向遷移を確認。すべて `authorizesMutation=false`、`authorizesPaidCall=false`。実行モードは `offline-synthetic-only` 固定。
2. `tests/ai-020705-cloudflare-do-ledger-offline.test.mjs`：Node SQLiteで32個の論理Controller、1件消費、復旧fence、期限ではなく状態による再開拒否、合成scope分離、Production ref拒否を検証。**実Cloudflare・マルチホスト・クラッシュ時永続性の実証ではない**。
3. 本設計資料。すべてGitHub Draft PRに限定する。

既存 `recovery-lease-plan-offline.mjs` / `signed-runner-death-offline.mjs` / `protected-stage-executor.mjs` 等は不変更。今回の台帳APIは本人のOWNER承認、外部署名者の真正性、Runnerの実死亡、Stagingの対象資格、外部停止権限を認証**できない**。合成fixtureの `checkedSignedDeathOffline=true` 等は本物の認可情報にしてはならない。配備には別の認証済みアダプターが必要。

## 将来の実Controllerの構成（未配備）

1. GitHub Actions RunnerとVercelアプリとは**別のCloudflareアカウント・実行境界**を確認する。仮称Worker `novelight-ai-gatea-watchdog`。所有Cloudflare account ID、Workersプラン、月額上限、workers.dev公開設定、削除方法、運用責任を確定。
2. DO IDは固定OWNER approval+main SHA+Preview ID+run+合成actor/novel/episodeから全クライアント共通に導く。呼び出し側任意DO IDで台帳を分割させない。
3. 独立GitHub read-only run/jobsと独立heartbeat、Staging read-only censusを照合。**心拍遅延だけでRunner死亡と決めない**。外部Controllerが実死亡を観測した後に署名した、対象固定・短期限・nonceつき証拠を検査する。
4. Watchdog署名秘密鍵はRunner外。独立に固定された公開鍵、key ID、rotation、失効を事前承認。SecretsをPR・ログに入れない。
5. 有料AIの既存DB one-shot墓標と、停止・清掃専用のDO recovery leaseを区別。有料AIはtimeout/クラッシュ/不明結果でもPOST再試行0回。復旧のみ有限・冪等。DOのSQL一意性は**外部HTTP操作のfencingを保証しない**ため、操作先でfenceを原子的に強制できない場合は不明な旧操作の並走を自動再試行しない。
6. 実停止は新規POST遮断、Staging AI OFF/4予算0、特定Preview無効化、合成Auth session失効、検証済み合成fixtureの清掃、別IDでのzero census。各権限はStaging限定・最小scope。Auth user削除を既発行JWTの即時失効の証明とはしない。
7. DO Alarmはat-least-once前提で毎回台帳確認。実Provider発行済み処理のキャンセル可否は未確認。「必ず処理停止」と断言しない。危険な清掃の前に停止成功のreadbackを求める。
8. 失敗時はsanitized phase/code/相関ID・停止証跡・清掃残留件数だけ監査。OWNER承認の再使用、予算超過、Production到達、PII/Secret記録を禁止。

## 後続承認の境界

| 区分 | 対象 | 現時点 |
|---|---|---|
| A0 | 本PRのオフライン3ファイルのmain統合 | 別途exact PR + HEAD本番承認が必要（通常自動Production deploy可能性） |
| A1 | Cloudflare上に**新規・外部権限0の検証用Worker+SQLite DOを1回だけ作成** | **未承認**。Cloudflare account ID/プラン/請求・公開条件・rollback確認後、環境作成だけの個別承認 |
| A2 | 外部署名者、GitHub観測トークン、Staging read-only | 未承認。Secret/権限ごとに対象と回数を特定 |
| A3 | Staging停止・Auth失効・合成清掃・独立zero census・強制終了試験 | 未承認。各対象/停止権限/rollback/費用のステージング承認 |
| B〜E | 新Preview、保護Runner、合成1回有料AI、品質評価 | それぞれ別承認 |

Cloudflare account ID/現行プランや停止APIの実権限はまだ照合できていないため、**今はA1の実行承認を求めず、環境の特定ができてから提示する**。

## ②の現在地

②-① Cloudflareのオフライン台帳・設計まで、実Controller・alarm・署名・kill・Auth撤回・独立censusは未実証（NO-GO）。②-② Staging新Preview未完。②-③ 保護Runner/JWT未接続。②-④ 有料合成1回未実施。②-⑤ 品質評価/最終判定未完。
