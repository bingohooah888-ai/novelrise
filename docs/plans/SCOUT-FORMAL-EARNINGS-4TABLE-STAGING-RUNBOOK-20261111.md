# 正式読書・コメント報酬：4テーブル Staging反映手順（承認待ち）

対象：Draft PR #2762 の `docs/plans/SCOUT-FORMAL-EARNINGS-4TABLE-STAGING-APPLY-20261111.sql` のみ。

- Staging ref: `wmlzjgvxgoyrovdhbqbg`。Production ref: `fiepaguycecrredwrcwx`（禁止）。
- 適用名：`scout_formal_earnings_private4_20261111`。OWNER承認の対象をPR HEADとSQL blobに固定する。
- 追加テーブル：`scout_read_level_evidence`、`scout_comment_eligibility`、`scout_comment_review_evidence`、`scout_earning_delivery`。いずれも `novelight_formal_private`。
- 原案 `docs/drafts/SCOUT_FORMAL_EARNINGS_ATOMIC_DRAFT.sql` から**テーブル定義だけ**を抜粋。報酬トリガー、関数、仮運用データ、権限付与、既存LEVEL・Point DB資産への変更なし。
- SQLは既存Migration操作によるトランザクション一括実行とする。実行前に指定PR HEAD・SQL blob、Staging ref・対象テーブル4件未作成を確認する。
- 実行後の**読み取り専用**確認：4件すべて存在、RLS有効、ポリシー0、anon/authenticated/service_roleのDML権限なし、各行数0、PK・FK・CHECK・UNIQUEおよびMigration履歴1件。
- 通信・初期Point同期・正式報酬の実行はこの承認に含まない。

## 逆操作（未実行）

追加4件すべて空で、外部依存が生まれていないことを確認し、個別の復旧承認が得られた場合のみ、以下を**逆順で**実行する。CASCADEと共有schema DROPは行わない。

```sql
drop table novelight_formal_private.scout_earning_delivery;
drop table novelight_formal_private.scout_comment_review_evidence;
drop table novelight_formal_private.scout_comment_eligibility;
drop table novelight_formal_private.scout_read_level_evidence;
```

データまたは依存がある場合は削除せず停止する。バックアップ・復元実証を要件から外す場合は、対象と代替条件をOWNERが明示承認すること。**この文書自体はStaging承認ではない。**
