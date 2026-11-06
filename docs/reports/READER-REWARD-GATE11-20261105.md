# NOVELIGHT 読者報酬 Gate 11 — 外部取引の矛盾検出・Durable Atomic Resource Contract（Draft）

記録日：2026-11-05 JST
対象：Draft PR #2762 / feature/reader-reward-gate01-20261104
区分：FULL PREFLIGHT・非公開の純粋関数とfocused tests、設計報告のみ。

## 1. 正式基準・差分範囲

最新main 03f64b14138ec5c6a90c0d8231a0784f878e78fa／着手時HEAD c071b203f1d5bed202f5198a9019789b3ff5ba8d。mainの正式MASTER（blob 91d11fa367b7de64990b13397b13d4bb6e3c0230、1〜5089行）とAGENTS、Preflight、Continuation Gate、NLOポリシー、development-workflowを確認。Draft維持、Gate01〜10の実装に変更なし。

OWNER確定値（1pt＝1円相当、外部交換最低3,000pt、AI直接利用には3,000pt下限なし、βLv30維持ほか）を維持。Lv31〜100必要XP、Lv100余剰XP、0.1円端数、β既存Point交換適格性、AI価格、原資予算／期間、交換先・手数料・KYC・法務税務、正式公開時期はOWNER未決定のまま。テスト中の価格・provider取引・正当化証拠は架空データで、現実の承認や提供者契約を意味しない。

## 2. 新規：外部取引ID／矛盾通知の集約型安全判定

追加：api/_lib/reader-reward/durable-reconciliation-contract.js
export quoteScoutReceiptConsistency。

- Gate09で導入した通知単位の候補だけに依存せず、同一予約Claim／Outboxの完全な検証済み履歴と、提供者への独立した認証済み状態照会を**一体として**判断する設計。
- 同一event ID・同一内容の再通知は重複証拠に数えない。同一IDの異なる内容、同じ操作への異なる外部transaction ID、成功と確定失敗の混在、payload digestやprovider route／idempotency key／operationKeyの不一致はmanual hold／fail closed。
- pending、unknown、partial、署名・履歴・本人・risk・provider回答の鮮度／最終性の証明不足、照会結果と通知結果の矛盾は保留。外部の単発成功通知だけでポイントを引き落とさない。
- successful履行は独立履行証拠と一致した提供者transaction ID、完了の最終性／取消条件を検討済みである場合に**commit_candidate_only**、確定非履行かつ取消証拠のある失敗は**release_candidate_only**。すでにcommitted／released／refundedは再精算しない。
- 重要な残余リスク：履歴の「完全」は観測時点の完全性であり、**将来届く矛盾通知を予防しない**。提供者のfinality SLA、独立照会、回収・補償ルール、遅延通知時の隔離手順、法務を実サービス開始前に別途確定する必要がある。相手先がexactly-onceを保証すると断定しない。

## 3. 新規：Wallet／Budget／Claim／Outboxの原子的接続条件

同モジュールのexport quoteScoutAtomicResourceContract。

- Gate07の予約／commit／release／refund proposalとrevision recheck、Gate08の接続前設計、Gate09の固定冪等Outbox、Gate11の全件照合結果、返金時はGate08の独立recovery候補を操作ID・action・ledger event keyで一致確認する。
- 共有Wallet→予算scope→Operation Claimの固定ロック順、単一serializable transaction、Wallet/Budget/Claim revision CAS、同じ操作Claimの一意制約、phase台帳event key一意、reverse-ofの一回性、Outboxの一意・不可変payload、通知ジャーナル監査と同一commit、legacy Point付与経路との整合、SECURITY DEFINER / RLS実監査、提供者冪等契約、提供者の最終性・取消ポリシー、外部ネットワークはDB commit後のみ、等の**22条件**を個別にfail closedで確認する設計。
- Gate10の実Supabase read-only監査で確認したものはscout_point_ledgerのRLS、UNIQUE(event_key)、reversal_of FKなどの既存構造のみ。reversal_ofのunique、永続operation claim、共有wallet CAS、原子的Budget・Outbox、外部提供者契約は依然**未実装／未実証**。実DB照合が必要な点はモックのtrue値で代替できない。
- 既存Point ledger.statusのconfirmed/pending/frozen/cancelledを新たなOperation Claim phaseのnew/reserved/committed/released/refundedと同一視しない。実DBの新規テーブル名・DDL／migration／RPCは作らない。
- 成功時ですらstatus=atomic_contract_design_only、realDatabaseAtomicityProven=false、mayConnectDb=false、mayInvokeProvider=false、mayMovePointsOrMoney=false、maySettle=false。

## 4. focused tests・品質・実行しない範囲

追加：tests/reader-reward-durable-reconciliation-contract.test.mjs（38件）。Gate07〜09の純粋関数との結合、外部transaction IDの二重成功と順序入替、success/failure矛盾、event ID再利用、署名・本人・提供者鮮度・finality条件欠落、異なるprovider routeとpayload fingerprint、terminal double-settlement、21+1＝22のatomic guardを個別無効化、wallet/budget/claim CAS改ざん、outboxの置換、refundの独立回収証拠を試験。

隔離Node24：既存Gate01〜10 191件 + Gate11 38件 = **229件PASS / 0 FAIL**（後続の整形・全件検証にて最終確認）。Prettier／ESLint・GitHub CI／CodeQLは対象HEADの検証証拠を別途確認。

## 5. 段階区分と次工程

| 段階 | 状態 |
| --- | --- |
| 非公開純粋関数・設計 | Gate11追加 |
| 自動focused tests | 229件を予定、CI結果は別途 |
| Staging実環境証拠・DB原子的接続・外部提供者実証 | 未実施 |
| Production・実送金・AI実呼び出し・main統合 | 未実施・未承認 |

今回の変更は既存Draft PRに限定する。実DBに対するSELECTも含め新たなSupabaseアクセスはしていない。DB migration／DB DDL／DML、Staging、Production、実送金、実AI、main統合、プラン・報酬の公開を行わない。OWNERの承認まで高リスクPRのMerge readinessはFail Closedを維持する。

次工程は単一操作の永続claim／outbox設計を具体化する前に、提供者のfinality・再試行・照会仕様とKYC／予算／適格性・法的な現実条件を確定するためのread-only要件表・リスク判定が適切。コードの実配線はOWNERの別承認なしに実施しない。
