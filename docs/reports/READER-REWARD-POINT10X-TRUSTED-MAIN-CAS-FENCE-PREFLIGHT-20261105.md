# NOVELIGHT Point10倍｜第8工程NO-GO最優先ブロッカー監査

2026-11-05 JST。**結論：非稼働の安全契約と反証テストは前進。trusted-mainの稼働実行器、永続CAS、Data Plane fencingは未実装・未実証。**

## FULL PREFLIGHT

| 対象                  | 読取りによる確認                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------- |
| 正式main              | 03f64b14138ec5c6a90c0d8231a0784f878e78fa                                                 |
| MASTER blob           | 91d11fa367b7de64990b13397b13d4bb6e3c0230                                                 |
| main運用規則          | AGENTS.md、WORK-EXECUTION-PREFLIGHT、AUTOMATION-CONTINUATION-GATE、NLO-EXECUTION-POLICY  |
| Draft PR #2762        | 開始HEAD 90a858ea53f263cdf1cd51a310d987f2026db8dd、open／Draft／未統合                   |
| SQL候補Draft PR #2763 | 58e60ef90801078e097e321590428c4b8b343486、未変更／未統合                                 |
| Issue #294            | [Staging Control] Supabase migration sync、open                                          |
| 旧排他                | admit: novelight-reader-point10x-admit-issue294 / stage: supabase-staging-migration-sync |
| 非稼働排他案          | novelight-issue294-staging-atomic-review-inert                                           |
| 実環境                | DB、Secret、Staging、Productionへの接続・書込み・承認消費なし                            |

## 確認した本質的な未解決問題

1. 新しいtrusted-main atomic実行器はmain上で有効化されていない。Draft PRの承認scopeはそのままでは稼働しない。
2. 旧admitと旧stageのconcurrency groupは別、新非稼働案も別。Actions concurrencyは永続CASではなく、Issueコメントのread→appendも原子的取得を保証しない。
3. SECURITY DEFINER、service_role、直接SQL、Edge／Cron／queueなどを含む全Point writerに、DB側で単調epochを強制する実際のfenceは未導入。
4. CAS応答喪失、DB COMMIT不明、Stagingでの独立backup／Restoreは実環境未実証。

## 今回追加する非稼働ファイル

- scripts/scout-point10x-cas-fencing-handoff-model.mjs：一回限りの仮想spent tombstone＋active domain＋単調fencing epoch、9種類Writer＋5種特権経路の閉鎖条件、ack消失／古いtoken／不明commitの拒否。
- tests/scout-point10x-cas-fencing-handoff-model.test.mjs：OWNER偽装、scope/HEAD/ref、既使用承認、2 runner競合、privileged bypass、未drain queue、復旧の負例。
- docs/plans/READER-REWARD-POINT10X-TRUSTED-MAIN-CAS-FENCE-ADAPTER-CONTRACT-20261105.md：独立線形化可能台帳、GitHub副監査、全DB特権書込み強制遮断とStaging別承認の設計条件。
- 本レポート。旧workflow／DB migration／SQL安全フィルター／MASTER／既存scope／SQL Draft PR #2763は変更しない。

## 実装が別途必要な理由

OWNERイベントを正規GitHub APIからtrusted-mainだけで認証し、固定main SHA／候補HEAD／Staging project／scope／mode／実行回数に限定した新規承認を一回だけ受け付ける必要がある。

本物のCAS primaryはspent・active domain・epochを単一の原子的transactionで確定し、GitHub CLAIMED・CONSUMEDは副監査に限定する。ack不明なら使い切りをread-only再照会し、再試行しない。

DB側Writer fenceは9種類・旧SECDEF・service_role・trigger・Edge／Cron・queue・outbox・inflightを漏れなく閉鎖する。アプリ側チェックとRLS単独では特権書込み遮断の証明にならない。

独立Backup/Restoreを実測し、Point／XP／逆仕訳を消さないこと、private unit marker＋旧5pt→50pt RPC＋5表が単一COMMITで完結すること、COMMIT不明時に自動retry／古いbackup復元／writer再開をしないことが必要。

## 実証区分

今回の設計・模擬テストは**コード／自動テスト層だけ**。Staging実証は別OWNER承認で実施するまで未完了。Production反映なし。完全PASSでも安全条件を解決済みと判定しない。

**禁止継続：** 実DB read/write、Staging起動、Secret取得、Production変更、Issue #294へのOWNER承認・CLAIMED・CONSUMED実投稿、main統合、デプロイ、有料API実行を行わない。

テスト件数・同一HEADのCI／CodeQL結果はDraft PR #2762へ追記する。
