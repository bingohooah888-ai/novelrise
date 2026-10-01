# NLO SELF-EXPANSION POLICY

Version: 1.0

## 1. 目的

NLOは、NOVELIGHT作業で必要な能力が不足したときに「機能がないため実行できない」で終了しない。

安全に代替手段を使える場合は現在の依頼を継続しつつ、再利用価値のある不足能力を `capability_gap` として記録し、NLO自身の恒久能力として追加できる状態へ進める。

目標は、NOVELIGHTに関する反復作業を通じて、NLOがチャット単位ではなくリポジトリ単位で能力を蓄積し、同じ不足を繰り返さないことである。

このポリシーはMASTER、`AGENTS.md`、`docs/NLO-EXECUTION-POLICY.md`、Runtime Gate、Production承認境界を弱めない。

## 2. 「機能がない」は終了状態ではない

NOVELIGHT作業で必要な能力が現在のNLOに存在しない場合、既定動作は次の順序とする。

1. Capability Registryで既存能力を検索する。
2. 直接NLO MCPが見えない場合は、Issue #797の正式Bridge status経路を確認する。Remote Desktop Commanderの状態だけでNLO状態を決めない。
3. 既存能力があればそれを使用する。
4. 能力がなければ `capability_gap` を作成する。
5. 安全な既存fallbackがあれば、現在の依頼を止めずにfallbackで進める。
6. gapを実行リスクA/B/Cへ分類する。
7. 許された範囲で再利用可能な能力として実装・テスト・登録する。
8. 能力が利用可能になったら、可能なら元の依頼をNLO能力で再試行する。

「別の方法を探します」だけで終わらせず、同じ不足が将来も発生するならNLOへ学習結果を残す。

## 3. Capability Registry

正式な能力台帳は `.novelight/nlo-capabilities.json` とする。

schemaは `.novelight/nlo-capability-registry.schema.json`。

各能力は最低限以下を持つ。

- `id`
- 説明
- 対応intent / alias
- executor / adapter
- execution risk
- 必要permission
- focused test
- version
- status
- provenance

status:

- `proposed`: まだ実行不可
- `testing`: 実装済みだが検証中
- `enabled`: 利用可能
- `quarantined`: 問題検知により自動利用停止
- `disabled`: 明示停止

能力はコードが存在するだけで `enabled` にしない。必要testと安全ゲートを通過して初めて有効化する。

## 4. Capability Gap

Capability Registryに適合する能力がない場合、NLOは `capability_gap` を生成する。

同じgapは重複作成せず、fingerprint / intent単位で回数と最終発生時刻を更新する。

runtime gap stateはGit管理外の `.git/novelight-nlo-capability-gaps.json` に保存できる。これは高速化・学習用stateでありSource of Truthではない。

再利用価値の低い一回限りの特殊処理は能力化を強制しない。繰り返し発生する作業、NOVELIGHT運営で汎用性が高い作業、手作業を大きく減らす作業を優先する。

## 5. リスク階層

### Tier A — 自動拡張可能

主にread-only、解析、変換、診断、ローカル一時生成など、低リスク・可逆・権限拡張を伴わない能力。

例:

- repository / document / logのread・parse・search
- 小説本文取得用の新規provider parser（外部規約・認証境界を破らないもの）
- static analysis
- report生成
- deterministic data conversion
- local cache / temporary helper
- focused diagnostic

Tier A gapは、既存のbranch / test / CIルールに従い、自動で実装候補を作成できる。安全境界を変更しない通常PRで、既存の自動merge条件を満たす場合はconditional auto-merge対象にできる。

### Tier B — 自動実装・PRまで

write action、code mutation、外部state更新、依存・workflow等、影響はあるが既存安全境界内で管理可能な能力。

例:

- repository/file write helper
- code patch automation
- non-Production external write
- dependency追加・更新
- CI/workflow変更
- DB write helper（Productionやschema/securityを除く）

Tier Bは自動でbranch上へ実装・テストしてPRを作成できるが、検証前に自己有効化しない。影響範囲に応じてFULL PREFLIGHTへ昇格する。

### Tier C — 明示承認必須

以下を含む能力は、NLOが自分の判断だけで権限を増やしたりProductionへ自己昇格しない。

- Auth / session / identity
- Stripe / billing / entitlement
- Supabase RLS / role / permission
- Secret / credential / API key
- Production deploy / mutation / destructive operation
- schema / migration / destructive data change
- security boundary
- approval / Runtime Gateの変更
- user/作品データの削除
- permission scopeの拡大
- rollback困難またはrisk不明

Tier Cでは安全な実装計画・必要diff・テスト計画まで自動作成してよいが、既存の明示承認境界を越えて実装・merge・Production実行しない。

## 6. 自己拡張フロー

標準フロー:

`request`
→ `capability resolve`
→ capabilityあり: `execute`
→ capabilityなし: `capability_gap`
→ `risk classify`
→ `builder`
→ `focused tests`
→ `risk gate`
→ `registry update`
→ `retry original request`

重要原則:

- 一回の場当たり的shellではなく、再利用可能adapterとして能力化する。
- 既存能力と同等なら重複実装しない。
- 能力追加のために安全ゲートを無効化しない。
- 新能力が失敗した場合はquarantineし、既存fallbackへ戻せるようにする。
- 自己拡張失敗がNOVELIGHT本体を壊さないよう、work branchとrollback可能性を維持する。

## 7. 接続状態と能力不足を分離する

NLOは以下を別状態として扱う。

- `NLO_DIRECT_AVAILABLE`: 直接NLO MCPが利用可能
- `NLO_BRIDGE_AVAILABLE`: Issue #797 Bridge経由で利用可能
- `NLO_UNAVAILABLE`: NLO自身のhealthが明示的に利用不能
- `CAPABILITY_MISSING`: NLOは利用可能だが必要能力がない
- `CAPABILITY_BLOCKED_PERMISSION`: 能力はあるが現在permissionでは実行不可
- `CAPABILITY_FAILED`: 能力実行が失敗
- `FALLBACK_AVAILABLE`: 別経路で現在依頼は継続可能

Remote Desktop Commanderのofflineは、それ単独では `NLO_UNAVAILABLE` の根拠にしない。

「NLOがない」「NLOがoffline」「必要能力がない」を同じエラー文にまとめない。

## 8. 自動成長の優先順位

新能力の優先順位は次で決める。

1. 同じgapが繰り返されている
2. NOVELIGHT固有で今後も高頻度に使う
3. 人手・チャット往復を大きく減らせる
4. 安全に自動化できる
5. fallbackより再現性が高い
6. 実装・保守コストに対して効果が大きい

能力数そのものをKPIにしない。使われないadapterを大量に増やさない。

## 9. ChatGPT / Agentの固定動作

NOVELIGHT作業では、Agentは次を守る。

- 「その機能がありません」を即終了理由にしない。
- NLO statusとcapability statusを分けて確認する。
- 安全なfallbackがあれば現在依頼を先に進める。
- gapが再利用価値を持つならCapability Registryへ昇格する。
- Tier Aは可能な限り同一workstream内で能力化まで進める。
- Tier Bはbranch / PR / testまで自動で進める。
- Tier Cは必要な承認点まで進めて停止する。
- 新しいチャットでもrepo policyから同じ動作を復元する。

## 10. 最終原則

NLOの目標は「何でも無制限に実行できること」ではない。

**NOVELIGHTの仕事で必要になった能力を、安全境界を保ったまま継続的に獲得し、同じ不足を二度繰り返さないこと**を目標とする。
