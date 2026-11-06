# NOVELIGHT β Scout Point10倍・第3.6段階／既存インフラのみの実行準備

**判定：レビュー可能なコード・オフライン試験のみGO。実Staging切替はNO-GO。**

## 固定前提・既存資産

- 基準main `2da42909e2d5c906446dbcae955cee4526581924`、正式MASTER Git blob `91d11fa367b7de64990b13397b13d4bb6e3c0230`。後続main変更時はfreshnessと対象SHAを再確認する。
- 既存GitHub OWNERの**旧read-only専用** `scripts/scout-point10x-owner-readonly-evidence.mjs` を再利用する（数値のOWNER ID／repo／issue）。旧V3 scope／承認文面を新しい切替権限へ転用しない。
- 既存の10倍候補SQLと安全前提は `scripts/scout-point10x-staging-cutover-adapter.mjs` から読み込む。SQLのSHA256は `325d1f9514186ba869a17514db0e54339c2fed4d4bd9eb296df2a764cd3dc23e`。SQLはmigrationにも実稼働workflowにも追加しない。
- 既存Preview Branch Staging ref `wmlzjgvxgoyrovdhbqbg`、Production ref `fiepaguycecrredwrcwx`。NLO direct toolは本作業の接続一覧に露出していない。旧Bridge #797 は #1837 へ移行済みで、healthのためのOWNERコメント投稿は未承認のため行わない。NLOをofflineと断定しない。

## 今回新設した境界（無通信、非稼働）

`scripts/scout-point10x-stage36-admission-review.mjs` は最小3用途だけを提供する。

1. **OWNERイベントの新scope検証**：新しい `NOVELIGHT_POINT10X_STAGING_CUTOVER_V1` 形式を厳格なキー集合・canonical JSON・owner id/repo/issue 294・exact SQL sha/main SHA/runCount=1・短期TTLで検証する。GitHub issue/comment/REST ref・comment履歴と `issue_comment.created` の単発実行形も照合するが、**現在新しいtrusted-main workflowは存在せず、本人証明の実装完了ではない**。既存read-only V3イベントは必ず拒否する。入力オブジェクトを合成できる以上、成功形も `NO_GO_GITHUB_REST_SHAPE_ONLY` で終了。
2. **単発消費のGitHub内CAS候補**：追加有料CONTROLの代わりに、将来既存GitHub repo内のOWNER承認済み保護ledger refへ、nonforce fast-forward commitを行う案だけ生成する。ブランチ新設・保護設定・参照更新・承認消費は**今回0回**。将来は原本ref状態、完全な既消費履歴、branch protection／改ざん耐性、同時実行の衝突と未知ACK readbackを実証しなければならない。GitHub管理者によるref書換えや履歴削除を防ぐ保証がなければ独立耐改変spent要件は満たさず、NO-GO。
3. **失敗時復旧・Writer再開判定**：COMMIT成功応答が不明な場合は再実行せず、認証済みprimary markerと独立ledgerの読み取り待ち。明確なROLLBACKでもWriter fence解除前に復旧確認。COMMIT成功でも台帳・称号・RPC権限・XP不変・独立監査が確認されるまでWriter再開不可。**自動resumeコマンドは持たない**。

## Staging専用実行前に残る実証・承認

1. GitHub trusted-mainによる新scope OWNER本人認証、単発spent更新とACK不明時のauthoritative readback、Protected GitHub ledgerの高権限改変対策。GitHubの単純なconcurrencyだけでは永続CASは成立しない。
2. Staging refの実接続先／TLS／サーバー同一session照合、最小権限Writer範囲、Production拒否、PostgreSQL 17以上を実証。Supabaseのbranch一覧上のACTIVE_HEALTHYとDB接続検証は別。
3. 現行Stagingの検証可能なバックアップを確保し、別の隔離復旧先で本物のrestore成功とデータ一致を証明。新規有料DBなしで安全にできる経路がなければ、費用や設計の新たなOWNER判断を要する。今回は作成・復元ゼロ。
4. Application API／PostgreSQL RPC・trigger／特権セッション／pg_cron等のschedule／キュー・再試行workerを停止し、書き込み再開入口を防ぎ、進行中transactionゼロを観測する、可逆的なWriter fencingと復旧動線。今回は停止ゼロ。
5. `SERIALIZABLE` + 6表 `ACCESS EXCLUSIVE`、`transaction_timeout=90s`、`lock_timeout=2s`、`statement_timeout=120s` の本物の実行時間計測、部分失敗とCOMMIT未知ACKの取り扱い。90秒上限は成功を約束せず、長いSQLをabortさせ得る。
6. 実SQL・Backup/Restore・Writer停止・Secret・OWNER承認消費・Production更新には**それぞれ独立の承認**が必要。外部ギフト交換とAI Point消費は引き続き無効。

## 完了のレベルとリリース境界

- 今回は新規モジュール＋focusedテスト＋この報告書だけ。no migration、no workflow、no API wiring、no outbound network、no Supabase/DB、no Writer drain、no GitHub OWNERコメント／spent更新。
- GitHub CI/CodeQLの結果は最新の対象HEADで判断する。Draft PR統合はVercelの自動Production buildがあり得るため**対象HEAD限定の別本番承認**とする。main統合だけでは切替有効化やStaging/Production DB操作を承認しない。

**第4段階の実DB切替：NO-GO。次の許可対象はDraft PRのレビュー・統合、または個別に範囲を絞った実Staging準備。**
