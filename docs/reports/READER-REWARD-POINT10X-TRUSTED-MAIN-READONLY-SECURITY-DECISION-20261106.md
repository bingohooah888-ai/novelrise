# NOVELIGHT βScout Point10倍｜trusted-main read-only最終セキュリティレビュー・OWNER判断票

**2026-11-06 JST / FULL PREFLIGHT / Draft PR #2762 / source-only / NO-GO**

> この資料は**承認票の判断材料**であり、承認コメント・実行器・権限付与・運用runbookの有効化ではない。実Staging/Production接続、Docker/実PostgreSQL、SQL実行、CONTROL mutation、Issue #294 CLAIMED/CONSUMED、main merge、deployは行っていない。

## 1. 判断対象と確定した根拠

- 対象repo: `bingohooah888-ai/novelrise`。確認したmain `0e4f3f594193d137d582fb693703ffdfe1d1cfd3`。正式MASTER `docs/NOVELIGHT-MASTER.md` Git blob `91d11fa367b7de64990b13397b13d4bb6e3c0230`。2026-10-29 OWNER規則を優先。
- 本体Draft #2762の**本レビュー着手前**HEAD `977daa70825ddbfd9e532f07e5adc4d04645c228`。独立rollback候補Draft #2763 HEAD `58e60ef90801078e097e321590428c4b8b343486`（変更対象外）。Issue #294はOpen、read-only新scopeは**未登録・未承認**。
- 変更禁止原本: 8 SELECT SQL `docs/plans/READER-REWARD-POINT10X-STAGING-CATALOG-READONLY-20261105.sql` SHA256 `740cc8c94b7e2831aae29e740282b826bee730621ab56627b03a8e1062e2ee11`、追加3 SELECT SQL `docs/plans/READER-REWARD-POINT10X-STAGING-PRIVILEGED-CATALOG-ADDENDUM-20261105.sql` SHA256 `6dd649cc7fa4c824f6f576500a5a7e44ce65bce3123e6a4990b06353114650d1`。どちらも改訂しない。
- レビュー対象は既存の`scripts/scout-point10x-prestaging-acceptance-matrix.mjs`の**34項目・5段階**、同一snapshot計画、trusted read-only境界、OWNER/CAS/Writer脅威モデル、11照会監査計画。既存内容の再実装・採番変更はしない。
- 既存Stage refとして資料が識別する対象は `wmlzjgvxgoyrovdhbqbg`、Productionは `fiepaguycecrredwrcwx`。これは**設計上の識別子**であり、現在の接続先・資格情報を実証したことにはならない。

## 2. 最終セキュリティ判定（read-onlyへの入場可否）

**判定：NO-GO（read-only Staging接続不可）。** 34項目のうち非稼働A（D01–D05）は設計レビュー対象、B（R01–R08）は**read-only入場条件**、C（P01–P06）は**入場後に初めて収集できる証拠**。Bを満たさない現在、Cの実証済みを宣言できない。

| 重大度       | 未解決依存・必要な信頼主体                                                                                                                                                                                                                          | read-only入場時の判定 |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| BLOCKER-01   | **trusted-main実行器が未設置**。PR HEADのworkflow/script、任意CLI、自己申告の`trusted`は実行権限にならない。main上のレビュー済み入口、固定artifact digest、非任意コマンド・接続先制御が必要。                                                       | HOLD / R03            |
| BLOCKER-02   | **本人認証済み新scopeが未登録・未承認**。GitHub APIからIssue #294、repo、comment ID、author id/login/association、created/edited/deleted状態、triggering actor、全ページ履歴、expires、最新mainとPR HEADをfresh照合。コメント本文だけの主張は不可。 | HOLD / R01            |
| BLOCKER-03   | **独立CONTROL primaryの永続spent CASが未実装・未実証**。一取引で一意comment/operation/scope・revision・monotonic fencing epoch・spent tombstoneを確定。Actions concurrency、Issue read→append、メモリfixtureでは代用不能。                          | HOLD / R02            |
| BLOCKER-04   | **Staging専用最小権限roleと接続先が実証されていない**。project/refと実接続先を独立識別。DB owner、superuser、BYPASSRLS、service_role、DML/DDL/TRUNCATE、権限昇格、任意関数EXECUTEを拒否。必要なカタログの可視範囲も検証。                           | HOLD / R04–R05        |
| BLOCKER-05   | **11 SELECTの同一snapshot実行・監査保存の信頼済み実装がない**。2原本は別BEGIN/ROLLBACKのため連続実行は不可。原本byte hash・抽出器/11 manifest digest固定、正確な1物理接続/1 transaction、結果上限と監査の秘密最小化が必要。                         | HOLD / R06–R08        |
| EVIDENCE-GAP | **実PostgreSQL、実権限・実SQL parser、catalogの完全性、実Owner/CAS ACKとROLLBACK/close ACK**は一件も実証していない。成功fixtureはライブ証拠ではない。                                                                                               | P01–P06は未実施       |

**証拠への先行GOは禁止。** 既存の`DESIGN_MATRIX_COMPLETE_NO_GO`等は設計形状の結果であり、R/PをPASSへ昇格させない。

## 3. 必要な最小実装・責任分界（責任主体の自己証明を禁止）

| 面           | 実装・責任主体                                                                                                                   | 信頼できる証拠 / HOLD                                                                                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 配布境界     | OWNERが別途承認した**trusted main**の専用workflow/executor。PR差分の任意実行禁止、実行器・parser・依存・manifest・SQL hash固定。 | main上の実コードとCodeQL/CI、権限制限・実行入口/アクションの独立レビュー。未統合＝HOLD                                                                                   |
| GitHub本人性 | 信頼済みGitHub event/API verifier。OWNER本人の新しいIssue #294 eventと一回限りcomment ID、全履歴確認。                           | GitHub真正レスポンス、comment edited/deleted/replay/foreign actor拒否。OWNER署名風文字列・トークンのチャット転送はHOLD                                                   |
| 独立CONTROL  | Staging Data Planeと別のprimary PostgreSQL及び専用権限。spent/lease/domain/epochを同一原子transactionで永続化。                  | unique制約、競合時単一winner、監査可能なreadback、失敗・ACK unknownではspentを消さずHOLD                                                                                 |
| Staging接続  | Staging管理者が専用のmetadata-only roleを払い出し、runnerは短命でscope固定の資格情報のみ受領。                                   | endpoint/refの接続前後独立照合、role属性/ACL/EXECUTE実測、Production refはdeny。SECRET値は出力しない                                                                     |
| 監査実行     | trusted-main readonly executor。固定2 SQLを全byte照合し、抽出済み11クエリのみを最小権限で実行。                                  | 1物理接続・1 `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`、`NL-CATALOG-01..08`→`NL-GAP-01..03`、同一snapshot識別、最後`ROLLBACK`＋close ACK。接続切替・再試行はHOLD |
| 独立audit    | 実行権限と分離されたauditor及びアクセス制御された永続証拠保管。                                                                  | 11 section IDs、原SQL/派生digest、row count、匿名化結果digest、context、署名付きreceipt、結果欠落0、retentionとアクセス台帳。生レコード/JWT/URL/SQL行値/Secret禁止       |

### 設計レビューで追加確認が必要な攻撃面

1. **SELECT文字列の安全性は先頭キーワードだけでは証明できない。** 静的抽出器はSQLパーサーではない。任意関数・拡張・`search_path`解決・実行権限を審査し、approved query 11本とPostgreSQL role許可を厳密に束縛する。SQL実行前に意味上の副作用を排除できなければHOLD。
2. **catalog不可視＝経路不在ではない。** 列挙した関数/trigger/ACLに隠れた対象がないか、roleの`pg_catalog`可視性・結果件数・対象schema・名前解決・未知オブジェクトを独立auditが確認。NULL/空結果を安全性の証拠に変換しない。
3. **監査結果digestだけでは真正性や非漏洩を証明しない。** 低カーディナリティ値推測の余地、保管先と鍵、署名の主体、digestの再現手順、保持期間・閲覧主体を承認対象に含める。
4. **GitHub Issueに書く`CLAIMED/CONSUMED`は一次spentではない。** CONTROL CASとIssue報告の更新順・障害時の非対称性を明示し、後者の書込み不能を承認未消費とみなさない。

## 4. CONTROL commit/ACK不明・障害時の確定動作

1. OWNER event照合、原本SQL hash、manifest digest、main/PR HEAD、Staging identityに一つでも不一致があれば**秘密取得前HOLD**。別承認へ自動フォールバックしない。
2. CONTROLのspent CAS開始後に timeout/COMMIT ACK unknown → **承認を未使用と推定せず停止**。信頼済み独立CONTROL primaryの唯一のjournal/unique spentをread-only再照会。証拠が確定しなければHOLD（再CLAIM・承認再利用・epoch解放・自動retry禁止）。
3. CASが確定しても、Staging接続失敗・SELECT失敗・session/snapshot drift・ROLLBACK ACK unknown・close ACK unknownなら**その実行の証拠全件を無効**。新しい接続による残りの照会補完、承認再消費は禁止。
4. CONTROLとStagingの状態は別のトランザクション。read-only操作のために**Staging全Writer停止済みと宣言しない**。既存と将来のmutation workflowが共通mutation-domainとepochを守ることは別途レビューする。
5. rollback/closeと保管状態が判定不能なら監査結果を受理せず、失敗コード・correlation ID・本当に終了した範囲だけ秘密なしで記録。次回は**新規OWNER判断**を要する。

## 5. read-onlyで必要な条件／後続cutoverだけの条件

| read-only catalog admission（R01–R08）                                                                               | read-only実証（P01–P06）                                                                          | 別OWNER永続切替のみ（C01–C09 / Q01–Q06）                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 新scopeの本人認証、1回だけのCONTROL spent、trusted-main実行器、専用Staging read-role、単一snapshot計画、監査保管契約 | 実role/接続先・同一snapshot 11 SELECT・全結果完全性・ROLLBACK/close・監査署名/retentionの**実証** | 旧5→50 SECDEF RPC、Point ledger/称号/調整/取消/イベントの原子的変換、9 Writer分類+5特権経路の**Data Plane強制fencing**とdrain、独立backup/別DB restore、private marker、atomic COMMIT、再開判断 |

- **read-only入場前に独立Restoreや9 Writer停止を要求しない。** それは永続cutover用。逆に、read-onlyでcatalog取得に成功してもWriter fence、Point10倍化、復旧可能性の実証にはならない。
- 永続切替の承認は read-only 承認から**絶対に昇格・流用しない**。既存#2763 rollback-only SQLも5→50 SECDEF RPCを含まず、永続cutover成果物に転用しない。
- **Point10倍の残高/台帳/RPCのProduction動作は未達。** read-only証拠で得るのは実DB構造と権限の安全な観測情報に限る。

## 6. OWNER向け段階別判断票（今は依頼も承認発行もしない）

**決裁A（最初に検討）：trusted-main専用read-only実行器をどう配備するか。** 推奨は、Draft #2762（MASTERを含む142差分）を一括mergeせず、最小権限の専用workflow/executor・CONTROL primary設計・監査保管・負例を**独立レビュー可能な最小PR**に分離する方式。新しい実装PRのexact HEADと最新main、公開・自動Production deployの有無、依存/Secret/権限変更をOWNERが確認した後、**そのPRのmain統合だけ**を別途本番承認する。現時点で承認可能とする最終SHAは**未確定**。

**決裁B（Aの後、read-only実行直前）：Issue #294の新しい専用Staging監査承認。** 承認対象を次の完全なタプルに固定する： `{repo, issue:294, commentId, authorId, operation:'read-catalog-11-same-snapshot', scope:'reader-reward-beta-point-10x-staging-catalog-single-snapshot-readonly', latestMainSHA, PR2762HEAD, 8sqlSHA256, 3sqlSHA256, 11manifestSHA256, executorCodeDigest, stagingRef:'wmlzjgvxgoyrovdhbqbg', expiry, runCount:1, evidencePolicyDigest}`。実際の値は**直前にfresh取得**。新scopeの受理/永続CONTROL CASが未実装の間は承認コメントを書かない。これはStaging DBではSELECTだけだが、独立CONTROLには一回限りspentの書込みが発生するため、**完全無変更操作ではない**。

**決裁C（実カタログ監査の後）：** 関数owner/SECDEF、service_role、triggers、旧RPC、可視性と実Writer全経路の不明を分析し、永続切替が必要な場合にのみ別のrollback-only→persistent cutover承認を検討。独立Backup/Restore、実fencing、5→50 RPC、障害復旧の証拠を先に取得。Productionはさらに別の対象・承認。

**残留リスクと推奨：** 現状の最も大きな未管理リスクは「PR内の非稼働モデルをtrusted-mainの実権限実装と誤認すること」「独立CONTROL CASなしの承認再利用」「catalog queryだけをWriter遮断の証拠と誤認すること」。次の実装単位は新モデルの追加ではなく、上記BLOCKER-01〜05を解消する**最小trusted-main実装の独立セキュリティレビュー**。この資料の承認欄は空欄のまま維持する。

## 7. 変更差分と検証ステータス

- この工程は**本レビュー資料1ファイルだけ**を新規追加する。既存34項目／モデル／テスト／2 SQL／MASTER／workflow／#2763／Issue #294を変更しない。未実装の実器は実装済みと扱わない。
- 自動テスト、Prettier、ESLint、構文、Runtime Gate、CI/CodeQLについては**新規HEADで別途検証した記録をPR #2762本文に付す**。過去HEADのPASSを流用しない。
- 実Staging SELECT 0、Production操作0、実DB/CONTROL接続0、OWNER新承認0、Issue #294のCLAIMED/CONSUMED 0、main merge 0、deploy 0。**NO-GO**を維持する。
