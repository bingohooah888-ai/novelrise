# NOVELIGHT 読者報酬 Gate 09 — Provider Outbox冪等性と復旧（Draft）

記録：2026-11-05 JST
対象：Draft PR #2762 / feature/reader-reward-gate01-20261104
FULL PREFLIGHT。非公開の純粋関数・focused test・レポートのみ。DB migration・DB書き込み・Staging・Production・Stripe・実送金・AI呼出し・main統合なし。

## 1. 継続境界

main 03f64b14138ec5c6a90c0d8231a0784f878e78fa、開始時PR HEAD 75aee4eea400e7fefe66a35f9787078a753af79e。正式MASTER／Preflight／Continuation／AGENTS／NLO方針確認済み。Gate 01〜08を再構築しない。
OWNER確定済み：1 Scout Point＝1円相当、外部交換最低3,000pt、AI直接利用に3,000pt下限なし・AI Creditへの事前交換なし、βLv30上限と既存βPoint運用は維持。
未確定（Lv31-100必要XP、Lv100余剰、読書報酬端数、β残高の換金適格性、AI必要pt、予算額・対象期間、交換先・手数料・KYC・法務税務、正式公開日）を決めず実装しない。

## 2. 非公開コード（設計・試算のみ）

追加：api/_lib/reader-reward/provider-outbox-simulation.js

### quoteScoutProviderOutboxEnqueue
Gate07予約候補、Gate08のconnection_design_only、同一operationKeyを検証。server側の認証済み予約・台帳、承認予算とPoint適格性、リスク／本人確認、provider冪等契約、不可変payload digest（支払先・金額・AI条件を含む将来の認可済み契約）、予約とoutbox同一transactionという要件を検査する設計。
provider idempotency keyはユーザー／操作IDごとに固定。既存outboxと同一ならnoop。再送時に金額・目的・提供経路・payload digestが変われば衝突保留。別オペレーションキーの使い回しは禁止。provider名・送金先・AIモデルは未決定のまま。
既存scout_point_ledger.UNIQUE(event_key)だけで永続outboxの一回性は保証できない。実装には固有のdurable claim／CAS／outbox原子性が別途必要。

### quoteScoutProviderDispatch
queuedのときだけ、認証済みworker、排他lease、outbox revision CAS、予約Claim、独立したprovider側重複排除、最新の不正・予算審査、監査保存などの条件に基づく「設計候補」を返す。leased／送信不明／lease切れ／delivered／cancelledは自動再送しない。
どんな入力でもmayInvokeProvider=false、mayConnectDb=false、mayMovePointsOrMoney=false。

### quoteScoutProviderNotification
providerイベントID、operationKey、payload digest、provider route、署名・提供元、サーバー履行照会、完全通知履歴、残高・台帳CASの照合条件を設計。
同一ID同一内容はnoop、ID再使用で内容が違えば停止、別イベントIDでも同じ外部transaction IDなら再照合。pendingは保留、partialは人手確認。successは外部履行証拠付きcommit候補、definitive failureは外部未履行の独立証拠がある場合だけrelease候補。確定済み・解放済み・返金済み操作の二重精算禁止。
各候補はGate07の将来トランザクションに渡す設計値であり、台帳書き込み・外部サービス実行ではない。

### quoteScoutOutboxCrashRecovery
予約・予約台帳・outboxが全て永続／全て未永続であることを将来のatomicity invariantとして検証。片方しか存在しない場合manual hold。未確定送信はprovider照合まで保留。確定済み操作はproviderを再呼出ししない。テスト用の真偽フラグは本番DBや外部契約の検証証拠ではない。

## 3. focused testsと安全上の限界

追加：tests/reader-reward-provider-outbox-simulation.test.mjs（29件）。Gate07・08結合、同一操作リプレイ、operation key衝突、AI 1pt試験（正式価格ではない）、外部交換3,000pt、各証拠の欠落、lease競合／障害、署名／同一通知／重複取引／部分履行、外部履行未知時のhold、途中クラッシュ、予約・台帳・outbox原子性不整合を検証。
隔離Node focused tests：既存126＋新規29＝155件PASS／0件FAIL。
未実証：実DB原子性、現行RLS／一意制約、provider冪等契約／実通信／Webhook署名検証／支払結果照会、正規AIの価格・原価・利用結果、cash回収、交換先・法務。通信タイムアウトを未履行証拠として扱わない。

## 4. 4段階と次の工程

| 対象 | 結果 |
| --- | --- |
| Draft純粋関数・設計 | 実装 |
| focused Node | 155 PASS / 0 FAIL |
| Staging実接続・DB migration | 未実施 |
| Production・実送金・実AI・公開 | 未実施 |

次のGate10候補は、非公開の状態空間／障害注入テストと実DB構造のread-only監査。OWNER未決定値やDBテーブル名を推測せず、実DB更新・Staging・Production・PR main統合の独立承認を守る。
