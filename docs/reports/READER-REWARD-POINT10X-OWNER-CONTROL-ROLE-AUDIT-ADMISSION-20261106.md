# NOVELIGHT βScout Point10倍｜OWNER・独立CONTROL・read-role・監査証拠 最小実装レビュー

**2026-11-06 JST／FULL PREFLIGHT／独立Draft PR／非稼働・未承認・NO-GO**

この文書は**実行・承認・Production操作の指示ではない**。Staging／Production DB、Docker、CONTROL primary、GitHub Issue #294への承認発行・CLAIMED/CONSUMED、main merge、deployは実施していない。

## 1. 最新Source of Truth

- 開始時main `0e4f3f594193d137d582fb693703ffdfe1d1cfd3`、正式MASTER Git blob `91d11fa367b7de64990b13397b13d4bb6e3c0230`。2026-10-29 OWNER承認境界・4段階の実証評価・秘密最小化を遵守。
- 既存Draft PR #2766 HEAD `ebb7511311646ec34361d181ac8b59a21830f63c`（固定11照会コア・非稼働）、#2762 HEAD `20891ce73ae788545784c72b4eb6a1e1f900aa87`（34受入項目／SQL原本）、#2763 HEAD `58e60ef90801078e097e321590428c4b8b343486`（別rollback-only）、Issue #294 Open／178コメント。**いずれも変更しない**。
- GitHub RESTでrepo.owner `bingohooah888-ai`／numeric ID `317436651`／type `User` を確認。これは**現在のrepo owner識別**であり、将来のコメントの本人性を実証するものではない。
- NLOは旧DCとは別物。公式GitHub Bridge Issue #1837の `nlo_health` はSUCCESS、`nlo_available:true`。NLOの直接任意シェル実行権限は露出していないため、実装は許可済み別ツールのDCで隔離worktreeを使用。

## 2. 対象を4つの独立した責任境界に分割

| 領域                  | このPRで追加したコード／条件                                                                                                                                                                                                                                                                                              | **未完了**                                                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub OWNER          | `scripts/scout-point10x-owner-readonly-evidence.mjs`：固定repo／OWNER numeric ID／Issue #294／コメント一意性／編集／削除／全ページ件数／trigger actor／最新main・#2762・#2766 HEAD／TTL／runCount=1／scope・SQL hash の厳密照合。GitHub REST GET専用collectorは明示呼出しのみ。canonical JSONで重複キー・曖昧な本文を拒否 | TRUSTED main event／GitHub Actions identityと本モジュールのsecure wiring、本人による**新規明示承認**、実イベントの完全性は未実証。offline合格でもOWNER承認済みにはならない |
| 独立CONTROL spent CAS | `docs/plans/POINT10X-INDEPENDENT-CONTROL-CAS-CANDIDATE-20261106.sql`：**CONTROL専用独立PostgreSQL向け未実行DDL候補**。domain epoch行ロック、unique(repo,issue,comment)、永続spent tombstone、同一関数内の原子CAS／fencing epoch増分、PUBLIC実行権限REVOKE、grantなし                                                      | CONTROL primaryの独立性、専用NOLOGIN owner、Invoker role・DB権限／Backup／commit ACK確認／authoritative readback／全writer共通domainは未実装・未実証                       |
| Staging 最小read role | `scripts/scout-point10x-role-audit-boundary.mjs`：Production／endpoint drift、superuser／BYPASSRLS／service_role／SET ROLE／DML／DDL／TRUNCATE／unapproved function／継承権限を拒否                                                                                                                                       | 専用ロール発行・実ACL/role attrs・catalog可視性・独立Staging endpoint/ref実測、実証用DB connectionなし                                                                     |
| 監査証拠              | 同モジュール：closed-schemaの11 section ID／rowCount／digest、固定source digest、single-snapshot digest、rollback/close ACKと最小metadataのみ許可。Ed25519と**外部固定された公開鍵digest**で署名数学的照合                                                                                                                | 独立監査主体による公開鍵承認、秘密鍵custody、永続ストレージ／保持／アクセス台帳、実署名保存・取出し・完全性／実DB結果の証拠が未実証                                        |

### CONTROL SQL候補の重要な前提

- これは**Staging/Production用migrationではない**。現行mainで動作するDB migration runnerに紐付けない。独立CONTROL primaryに別途OWNER承認を得た管理者だけが検討する。
- 提案関数の`SECURITY DEFINER`は独立CONTROLにのみ限定。許可対象roleは一切GRANTしていない。将来の導入前に固定search_path、関数owner、NOLOGIN owner、EXECUTE権限、DDL安全性、実PostgreSQLロールを独立審査する。
- `SELECT ... FOR UPDATE` と唯一制約`(repo, issue_number, comment_id)`で同時要求と再利用を拒否する設計。**実原子性／クラッシュ耐性／commit ACKは未実証**。COMMIT ACK unknownならspentを「未使用」と推定せず、authoritative CONTROL primaryのread-only照会により確定できない限りHOLD。rollbackや再CLAIMでspent tombstoneを戻さない。
- GitHub本人性をSQLパラメータの自己申告で代用しない。trusted-mainのGitHub verifierを**CONTROL claim前**に信頼主体として接続する必要がある。Issueへの`CLAIMED/CONSUMED`コメントは一次spentではない。

## 3. 動作しない境界／未統合の依存

- 本PRのコードにはGitHub自動workflow、DB接続アダプタ、Secret注入、CONTROL function呼出し、Staging SQL実行、監査署名・保存サービス、OWNER承認発行／消費処理を結線していない。**module importだけでは外部I/Oなし**。唯一のGitHub GET collectorもこの工程では実ネットワークに接続していない。
- offline fixtureによる有効形の戻り値は`NO_GO_*`に固定。`OWNER`を名乗る文字列、形式の整ったコメント、fixtureから任意DB実行権限を生成しない。
- #2766の不活性11照会コアはmain上に存在せず、本PRのブランチも**mainから独立**している。将来の組み合わせ／依存SHAとmanifest digestは別レビューが必要。#2766のコード・SQL原本を複製したりmainへ統合しない。
- 既存対象SQLの固定SHA256は8本パック `740cc8c94b7e2831aae29e740282b826bee730621ab56627b03a8e1062e2ee11`、3本パック `6dd649cc7fa4c824f6f576500a5a7e44ce65bce3123e6a4990b06353114650d1`。**両原本を今回変更していない**。
- read-only admissionと永続cutoverは別：9 Writer＋5 privileged path fencing、Backup/Restore、5→50 SECDEF RPC、Point ledger変更、持続的Staging writer停⽌、Production変更は未実装／未承認。

## 4. 今回の自動検証／OWNER次判断

- `tests/scout-point10x-owner-control-audit-admission.test.mjs` はOWNER本人性・編集/削除・pagination・偽trigger・replay・古いSHA・誤ref、role DML/DDL/権限昇格、秘密混入、11行結果改ざん、Ed25519鍵pin不一致、CONTROL candidateの制約を**offline negative tests**で確認する。
- focused Node・Repo quality・syntax・Runtime Gate・新HEAD CI/CodeQLは独立Draft PR本文に**実測値で追記**する。初期設計の34項目を再生成したり、Staging実証と誤認しない。
- 次に実施可能なのはOWNERによる、**この独立Draft PRのSHA／安全面／main統合可否**と、CONTROL独立primary導入／GitHub trusted-main event／監査鍵・retention方針の**別途設計承認**。main統合はそのPRの「本番承認」を別に要求し、既存自動Vercel Production deployの可能性を説明する。統合許可はStaging read-only実行許可ではない。

**最終結論：非稼働の最小セキュリティ部品とCONTROL SQL候補のレビューに進める。OWNER本人認証の実環境成功、CONTROL spent消費、Staging実観測、Production反映はいずれも未実施。NO-GO継続。**
