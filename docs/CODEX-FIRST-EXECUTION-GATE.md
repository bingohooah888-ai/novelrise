# CODEX-FIRST EXECUTION GATE

最終更新: 2026-08-31

この文書はNOVELIGHTの開発実行時に適用するFail-Closed契約である。MASTER、WORK-EXECUTION-PREFLIGHT、EXECUTION-TURN-CARD-GATE、EVIDENCE-FRESHNESS-GATE、AGENTS.md、およびProduction/Secret/High-Risk承認境界を弱めるものではない。競合する場合は上位の安全制約を優先する。

## 1. 原則

Codexに適したリポジトリ開発作業では、Codexを「推奨」ではなく最初の実装経路として必須にする。

対象には少なくとも次を含む。

- 実装に結び付くコード調査
- 実装、バグ修正、リファクタ
- 回帰テストの追加・修正
- CI / GitHub Actions調整
- 開発スクリプト、自動化
- PR準備のためのコード変更・検証

ChatGPT等が変更内容を理解していること、変更が小さいこと、手動の方が速そうであることはCodexを飛ばす理由にしない。

## 2. implementation phaseのFail-Closed

`npm run runtime:gate -- --phase=implementation ...` はCodex routing証跡がなければFAILしなければならない。

実装phaseで許可されるroutingは次の2種類だけとする。

1. `used`: Codexを実際に利用した。
2. `bypass`: Codexを直前に利用確認したが、列挙された実行不能条件のため最小限の代替実装へ進む。

実装phase以外ではCodex routingを自動的に`not-applicable`として扱い、既存のread-only、verification、Production、image、evidence freshness等のphaseを不必要に止めない。

## 3. Codex使用証跡

`used`では次をすべて必要とする。

- `codex-route=used`
- 許可されたevidence source
- 非空のevidence
- 直近のavailability / execution確認時刻

許可するevidence sourceは次とする。

- `github-codex-connector`
- `codex-work`
- `codex-cli`

証跡にはSecret、token、API key、credentialを含めない。

## 4. bypassを許可する条件

`bypass`は次のcategoryだけを許可する。

- `usage-limit`: Codex利用上限・quota到達
- `service-outage`: CodexサービスまたはConnector障害
- `auth-permission-network`: 認証、権限、network等によりCodex実行が不可能
- `unsupported-operation`: Codexがその操作を実行できないことが具体的に確認できる

bypassでは、categoryに加えて、直近の確認時刻、非空のevidence、具体的なreasonを必須にする。

次はbypass理由として認めない。

- 手動の方が速い / `manual-faster`
- 小さい変更 / `small-change`
- すでに修正方法が分かっている
- 簡単、軽微、すぐ終わる
- 過去ターンでCodexが失敗したというだけで、現在ターンに利用可否を再確認していない

Codexが復旧した後の残作業は、Codexに適した範囲を再びCodex経路へ戻す。

## 5. 代替実装の範囲

正当なbypass時も、代替経路は「Codexを使えない間に必要な最小限」に限定する。

- Production承認、High-Risk merge承認、Secret、課金、DB mutation等の既存承認をbypassしてはならない。
- Codex unavailableを理由に既存のテスト、CI、CodeQL、RLS、E2E、Evidence Freshnessを省略してはならない。
- High-Risk変更は従来どおりfinal head SHAに固定した個別OWNER承認までmergeしない。

## 6. Runtime evidence interface

CLI引数または同等の環境変数を使用する。

### Codexを使用した場合

```text
--codex-route=used
--codex-evidence-source=github-codex-connector
--codex-evidence="Issue #123 / Codex task completed"
--codex-checked-at="2026-08-31T00:00:00Z"
```

### Codex利用上限によるbypass例

```text
--codex-route=bypass
--codex-bypass-category=usage-limit
--codex-evidence-source=github-codex-connector
--codex-evidence="Issue #252 comment 5469570431: usage limit"
--codex-bypass-reason="Codex connector rejected the fresh execution request because the account usage limit was reached."
--codex-checked-at="2026-08-31T00:00:00Z"
```

同等の環境変数は `NOVELIGHT_CODEX_ROUTE`、`NOVELIGHT_CODEX_EVIDENCE_SOURCE`、`NOVELIGHT_CODEX_EVIDENCE`、`NOVELIGHT_CODEX_BYPASS_CATEGORY`、`NOVELIGHT_CODEX_BYPASS_REASON`、`NOVELIGHT_CODEX_CHECKED_AT` とする。

## 7. Freshness

Codex routing証跡は現在の実行判断を表す必要がある。Runtime Gateは確認時刻が古すぎる、未来すぎる、または不正な形式の場合にFAILする。

過去チャット、過去PR、過去Codex失敗は、現在の利用可否確認の代用にしない。

## 8. Runtime state

implementation Runtime GateがPASSした場合、`.git/novelight-runtime-gate.json` にSecretを含まないCodex routing metadataを記録する。

少なくとも次を記録する。

- required
- route
- evidenceSource
- evidence
- checkedAt
- bypassCategory / bypassReason（bypass時のみ）

これにより、後続工程で「Codexを使ったか」「正当なbypassだったか」を監査可能にする。

## 9. 回帰要件

CIは少なくとも次を証明する。

- implementation phaseでrouting証跡が無ければFAIL
- `used` + 正しいsource/evidence/fresh timestampはPASS
- 列挙外のbypass categoryはFAIL
- bypass reason/evidence不足はFAIL
- `manual-faster`、`small-change`等の便宜理由はFAIL
- stale evidenceはFAIL
- implementation以外のphaseはCodex証跡不足だけではFAILしない
- Runtime stateへCodex routing metadataが保存される

## 10. 現在のCodex利用上限中の扱い

Codex usage limitが実際に確認された場合、その事実は`usage-limit` bypassの正当な証拠になり得る。ただし、その確認を将来のターンへ無期限に流用してはならない。次回のCodex適合実装ではfresh availability checkを行い、利用可能なら直ちにCodex-firstへ戻す。
