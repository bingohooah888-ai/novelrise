# NOVELIGHT 工程②-① / Gate A — 独立Watchdog本実装前の一括設計

2026-11-02 JST。起点main: 3516b89179dbca6814bd463fa9224bb9ff99f330。

## 0. 状況・実行禁止

この資料と同一PRは「オフラインの回復リース判断契約・合成テスト・実装設計」の3ファイルのみ。公式MASTER・工程2クローズアウトゲート・FULL PREFLIGHTが優先する。DB migration、実行Workflow、Preview、Vercel、Supabase、JWT、Secret、実AI呼び出しへの接続や変更は行わない。

**②-①はNO-GO**。オフラインテストPASSを独立Watchdogの実配備・権限実証とは扱わない。
Staging project wmlzjgvxgoyrovdhbqbg。Production project fiepaguycecrredwrcwx は接続・変更禁止。
有料AI試行は一回限り。クラッシュや結果不明でも二度目の有料POSTを認めない。

## 1. 既存の仕組みと区別

- 20261101060000_novelight_ai_020705_one_shot_claim.sql: 有料AIの一度限りの使用記録。停止・清掃の復旧リースは含まない。
- signed-watchdog-arm.mjs と watchdog-arm-one-use.mjs: 署名付き受領証と外部原子消費の契約。独立Controllerや実台帳は未接続。
- signed-runner-death-offline.mjs / detached-recovery-offline.mjs: 死亡報告署名と復旧順序の合成検証。実停止権限はない。
- github-runner-exit-readonly.mjs / staging-synthetic-cleanup.mjs: 読み取りと清掃アダプターの部品。実認証・実接続・独立censusは未証明。
- ai-020705-owner-staging-paid-trial.yml: OFFLINE PREFLIGHT ONLY。実AI起動口に変更しない。
- 新しい recovery-lease-plan-offline.mjs は独立復旧の「次ラウンド候補」を厳格に判定するだけ。leaseの取得もmutationの許可もしない。最大3回はオフライン試験用暫定上限。OWNERによる実運用上限の採用ではない。

## 2. 独立Controllerを選ぶ必須条件

1. GitHub ActionsのRunner、Vercelアプリ本体とは異なる故障・実行・認証境界で稼働すること。Runner finallyや子プロセス、同じhost上の監視に依存しない。
2. 別の独立heartbeat・ジョブ状態の確実な観測、状態喪失時のfail-closedと監査可能な記録を提供すること。
3. GitHub GET、Staging SELECT、緊急停止、合成Auth清掃、署名秘密鍵を異なる最小権限に分離し、Productionに接続できないこと。
4. 継続稼働費用上限・停止方法・資格情報の失効/ローテーションと障害時の責任境界を決定すること。
5. 実Providerの発行済みリクエストキャンセル可否を実証すること。不可能なら「発行済みモデルが停止する」とは報告しない。

**外部Controllerの配置先は現時点で未決定**。環境を新規作成・設定する場合は対象と費用/rollbackを明示した別OWNER承認が必要。

## 3. 台帳は有料消費と停止専用を分離

### 有料試行（既存）
- 承認ID、main SHA、Preview ID、合成ユーザー・作品・話、モデル、費用上限を一回限りの原子claimに固定。
- POST失敗、応答不明、TIMEOUT、Runner死亡でも消費済みを永続保持。復旧を理由に再claimや新しいモデルPOSTを認めない。

### 回復リース（新設候補、まだ設計のみ）
- Staging限定の永続共有ストアに専用テーブル/原子的APIを将来追加する。OWNER承認前にmigrationを作成・適用しない。
- 固定キー：approval ID / run ID / main SHA / Preview ID / 合成actor・novel・episode / controller ID / 最新challenge。
- 同一トランザクションで直前ラウンド終了・active lease不在・新規nonce・回数上限・単調増加fence generationを検証。重複・競合・不明状態は拒否。
- 実停止の全操作先でfenceを原子的に照合する必要がある。checkFenceして別HTTP操作するだけでは古いControllerの遅延操作を防げない。
- APIがfenceを受け付けない場合は独立した単一ワーカー排他と停止結果の証拠が必要。それが不明なら復旧自動再試行をしない。
- 前回実行の結果が不明、まだactive、部分完了を安全に区別できない場合は自動リースを取らない。OWNERの復旧専用承認が必要。
- 回復リースで許されるのは停止・認証撤回・合成清掃・独立censusのみ。AI POSTの再実行を禁止する。

## 4. 役割・権限の分離

| 境界 | 用途 | 完了証拠 |
| --- | --- | --- |
| GitHub read-only | 承認台帳/Actions run/jobs再照合 | actor、run attempt、exact SHA |
| Staging read-only | AI OFF、4予算0、合成データ集計 | READ ONLYの固定SELECT、Production絶縁 |
| 外部署名者 | アーム受領・Runner死亡のEd25519署名 | Runner外秘密鍵、別経路固定公開鍵、nonce失効 |
| Recovery ledger | 共有原子claim・リース・fence・監査 | 競合/クラッシュ後の一意性 |
| Stop-only権限 | モデル新規POST遮断、AI OFF、Preview停止 | 外部の実停止・readback |
| Auth cleanup権限 | 合成session撤回・合成データのみ削除 | 他ユーザー不変・JWT残存検証 |
| Independent census | 予算0、合成残留0、墓標保持 | 停止実行と独立したreadback |

Authのユーザー削除だけで、既発行JWTアクセストークンの即時失効を証明したことにはしない。

## 5. 復旧の正しい順序と失敗処理

1. 対象OWNER承認、環境・ロール、main/Preview/Run/合成対象、外部Controllerの独立性と鍵信頼を確定。
2. GitHub run/jobsと独立heartbeatの両方で本当のRunner死亡を確認。単なる心拍遅延だけで停止指示を出さない。期限付き署名・nonceを再検証。
3. 復旧専用の共有原子台帳で有効なfence付きリースを獲得。有料POSTの墓標は不変。
4. 新規の有料POSTを拒否した上で、止められる実処理を停止、AI OFF・予算0、対象Preview無効化、対象合成session撤回を試みる。
5. 一つの停止措置が失敗してもその他の安全な停止は試すが、完全停止まで破壊的なfixture清掃を実行しない。
6. 停止完了を証明できたときだけ検証済み合成データを清掃。最後に独立ロールでzero census、墓標、請求試行数を検査。
7. 不明状態や部分失敗はNO-GO。新ラウンドには別の署名・nonce・新しいfence・完了証跡を必須とし、無制限retryをしない。

## 6. 実環境合格に必要な故障注入（まだ未実施）

- Runnerを本当にSIGKILLしても、別ドメインのWatchdogが生きて停止・清掃・独立censusに到達する。
- 偽造署名、鍵誤り、重複nonce、期限切れ、stale heartbeatを拒否。
- Controller二台競合で同一リース取得は一台だけ、古いfenceによる停止・削除は拒否。
- モデルPOST直後のRunner死亡、レスポンス不明、遅延完了でも二度目POSTは0。
- Preview、AI OFF、Auth撤回、清掃、censusの各故障で未成功を正しく報告し、他の停止は試みる。
- 安全な停止・清掃の有限再実行は独立claimがある場合のみ許容。失敗した旧ラウンドで有料POSTを発行しない。
- 最終：Staging AI OFF・4予算0・合成残留0・不正データ削除0・墓標保持・実行費用が予定範囲と一致。

## 7. 次回の具体的な承認順序

1. **今回のDraft PR**：設計、オフライン判定コードとテストだけ。別のSecret/環境変更は伴わない。
2. **別OWNER承認**：外部Controllerの配置先/故障分離/料金/rollback/ロールを固定し、独立実行環境を構築する。
3. **別OWNER承認**：Staging専用復旧リースDB migration/RLSと原子的フェンス、最小権限を限定実装・検証する。
4. **各操作の別ステージング承認**：Preview新規作成、Staging write、実JWT、保護環境へのSecret配置、実停止実証を個別に固定する。
5. **②-④専用の別承認**：1 chunk、1回、モデルgpt-5.6-luna、10円以下、最大60分、retry0。②-①証拠は有料AI実行承認の代わりにならない。

## 8. 工程②の進捗

- **②-①：独立Watchdog** — オフライン設計・検証は進行。実Controller、鍵信頼、原子リース、実停止、独立census未実証 → NO-GO。
- **②-②：Staging Preview** — 新Previewの別承認待ち。
- **②-③：保護Runner/JWT** — 実アダプター未接続、実JWT別承認待ち。
- **②-④：有料AI合成1回** — 未実施。
- **②-⑤：品質と最終判定** — 未完了、一般公開不可。
