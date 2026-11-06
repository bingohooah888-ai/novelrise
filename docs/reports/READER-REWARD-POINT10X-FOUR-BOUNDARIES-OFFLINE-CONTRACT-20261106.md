# NOVELIGHT βScout Point10倍｜4境界の独立OFFLINE契約とOWNER判断（2026-11-06）

**判定：設計・オフラインテストのみ。実Staging／CONTROL／ProductionにはNO-GO。**

## 1. FULL PREFLIGHT／正規の依存と隔離

- latest main `0e4f3f594193d137d582fb693703ffdfe1d1cfd3`、正式MASTER Git blob `91d11fa367b7de64990b13397b13d4bb6e3c0230`。MASTER冒頭の2026-10-29 OWNER 8規則（4段階実証、最新状態先行、承認一回限り、Secret非表示）を優先。
- Draft PR #2766 HEAD `ebb7511311646ec34361d181ac8b59a21830f63c`：固定SQL8+3本、単一sessionの不活性read-onlyコア。
- Draft PR #2767 HEAD `fb70b5bcb66bc4335520e36864d86a1ba19a46a8`：GitHub OWNER V2／2 PRのmain祖先認証、独立CONTROL向け未実行SQL候補、ロール／監査オフライン形状確認。
- Issue #294 Open／178 comments。新OWNER scope・承認消費の変更なし。
- 本PRは**最新mainから独立**した新規Draft。#2766／#2767へ依存先コードをコピーしない。後日2PRを統合した際の接続仕様を検証するだけで、現時点で実行可能にはならない。
- 正式SQL source SHA256 2本：`740cc8c94b7e2831aae29e740282b826bee730621ab56627b03a8e1062e2ee11`、`6dd649cc7fa4c824f6f576500a5a7e44ce65bce3123e6a4990b06353114650d1`。原本は変更しない。

## 2. 4境界とコード

| 境界                      | 今回追加した最小実装                                                                                                                                                                                                                                                                                                             | 未実証・必須の実OWNER判断                                                                                                                                                                                                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub trusted-main event | `scripts/scout-point10x-offline-admission-contract.mjs` の `inspectTrustedMainEventShape`。正規repo／numeric OWNER／issue #294／`issue_comment created`／workflowRef@main／workflow SHAと最新main SHA／runAttempt=1／V2 marker／作成＝更新時刻／delivery IDを照合。追加・欠落フィールドを拒否。成功でも `NO_GO_EVENT_SHAPE_ONLY` | 現在、指定workflowは**存在せず導入・起動もしていない**。実GitHub hosted trusted-main run／immutable eventの一次取得、本人作成コメント照合、Event replay防止、独立監査へ記録する配線は**未実装**。入力内容は任意合成可能で認証済みとは扱えない                                                  |
| 独立CONTROL CAS接続境界   | `planIndependentControlCas` がrepo／scope／operation／Staging ref／11-query manifest digest／承認digest／2PR HEAD／epoch／runCount=1を閉じたschemaで検査。`scripts/scout-point10x-offline-failure-simulator.mjs` でメモリ内のduplicate claim、epoch stale、abort、commit ACK unknown、readbackを模擬。応答は全てNO-GO            | **独立CONTROL primaryがない／接続していない**。#2767の未実行DDLに実owner/GRANT、durable CAS、commit ACK不明のauthoritative primary readback、崩れたトランザクションの復旧、全Writer共通fencing・backup/restoreが必要。メモリ模擬spentは永続でない／Owner認証でない。実CONTROL導入は別OWNER承認 |
| Staging最小権限           | `inspectStagingReaderProbe` がStaging/Production ref、session/effective role、service/admin相当の特権、DML/DDL、SET ROLE／継承ロール、読書き権限、サーバfingerprintをclosed schemaで拒否。返却は `NO_GO_STAGING_ROLE_SHAPE_ONLY`                                                                                                 | 実Staging role／least privilege ACL、現行DBに実在する関数の副作用、実接続先の独立性、被監査カタログへのSELECT可能性と匿名化RLSを**測っていない**。role作成・Secret導入・実接続は別OWNERのStaging承認                                                                                           |
| 監査と保管                | `assembleRedactedAuditEvidence` は11件固定IDのrowCount/digestのみ、同一snapshot／source SQL／OWNER／CAS／roleのdigest、ROLLBACK/close ACKを閉じたshapeで要求。署名はEd25519数学検証のみ。`createEphemeralAuditSimulator` は重複runId、改変、期限切れの読み取りを拒否するメモリ内の追記専用デモ                                   | 実独立audit signer/key custody、署名鍵pinのOWNER承認、append-only外部永続storage／retention設定、改変耐性証明、S3等のobject-lock／restore／署名検証、機密削除を**実施していない**。ローカル署名成功は独立保管の証明ではない                                                                    |

## 3. Runtime・セキュリティ上の重要境界

- 本PRに**GitHub Actions workflowの追加、DB migration、PG driver／Supabase import、ネットワークfetch、実CONTROL CAS、Secret、外部監査writer、Vercel deploy script、実Staging/Production driverなし**。
- `executeTrustedReadOnly()` は無条件に `POINT10X_OFFLINE_HOLD`。4境界の模擬結果が成功しても `liveAuthorized=false`、real spent=false、実Staging実行の許可は生まれない。
- GitHub OWNER V2で要求する両PRの`merged=true`＋merge SHAの最新main祖先照合など、**強い本人性の実装はPR #2767側**。本PRの`inspectTrustedMainEventShape`だけで、GitHub本人性／承認生成／承認消費の代用禁止。
- #2767のCAS SQLは**独立CONTROL PostgreSQL用の未実行提案**。本PRのメモリ内CAS試験が、DB上のexactly-once／CONSUMEDの証拠を意味することはない。COMMIT ACK unknownなら自動再試行禁止、独立primaryの読取証拠が揃うまでHOLD。
- PRのmain統合は既存Vercel Git連携によりProduction自動ビルド対象となり得る。`vercel.json`はmainをdeploymentEnabledとしている。今回のファイルは`scripts/`を含み、`scripts/vercel-ignore-build.mjs`のdoc/test専用skip対象外。**各PRのmain統合は対象PR/HEAD指定の別の「本番承認」**が必要。これは実DBへの操作承認ではない。
- 永続Point10倍のcutover、旧5→50pt RPC、Writer/Privileged path fencing、Recovery/Backup/RLSの実証は**今回のread-onlyとは別の高リスクゲート**であり未実施。

## 4. テスト基準、品質・後片付け

- 新規focused testはイベント偽装・古いSHA・再送、CAS一回限りシミュレート／不明ACK／stale epoch、過大権限role、SQL源digest／11証拠欠落／秘密混入、監査duplicate／改変／期限切れ／鍵pin不一致／無条件NO-GOを網羅。
- GitHub CI／CodeQLやローカル品質検査は**新PRの同一HEAD**に限り結果を採用。結果・SKIPはPR本文に追記する。
- 元Windows repoに4 modified + 3 untrackedがあり、これらを移動・reset・checkout・stashしない。作業worktreeのみ削除。NLOとDCは別物として扱い、NLO direct toolsがないため隔離worktreeでDCを利用。
- **実DB・Staging・CONTROL・Production・OWNER scopeの発行・消費・main統合・デプロイは0回**。4段階実証：コード実装／自動テストのみ、実Staging未実施、Production未反映。

## 5. 次のOWNER判断

今回の新PRは「独立した非稼働のオフライン契約」として審査する。レビュー後に検討できるのは **各Draft PR #2766／#2767／新PRの個別HEADに束縛した本番統合の可否**であり、現時点ではOWNER承認がない。各main統合でProduction buildの可能性があるため、事前の範囲明示が必須。

本件は**実行権限を付与する準備が完了したという意味ではない**。真の次工程は「独立CONTROL primaryの構成・role/GRANT・durable CASの実証」「GitHub hosted trusted-main event入口の認証／証拠継続」「実Staging最小権限roleの準備」「独立audit鍵とretention／restore設計」のそれぞれを切り出し、必要なOWNERの別承認を得ることである。安全ゲートの緩和・旧承認流用・無断のDB/Preview実行は不可。

**総括：オフライン契約実装・負例確認のみGO、実運用はNO-GO。**
