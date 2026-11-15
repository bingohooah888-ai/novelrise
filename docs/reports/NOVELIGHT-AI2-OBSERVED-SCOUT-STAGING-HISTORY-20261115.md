# NOVELIGHT AI工程②：SCOUT Staging-only履歴4件の未承認証拠隔離

- 監査日：2026-11-15（JST）
- このDraftの基準main：`dfb32ca0748b634c7e1253d81f2c161c7285e651`
- Staging ref：`wmlzjgvxgoyrovdhbqbg`（読み取り済みの過去の証拠のみ利用）
- 既存許可4件は `supabase/staging-migrations/` のまま。Production正本 `supabase/migrations/` は変更しない。
- **本変更はGitHubのオフライン準備だけ**。Staging/Production・実SQL・Secret・Preview・migration repair・Git mainの変更なし。

## 実歴史とSQL原本の照合（過去の読み取り結果を再利用）

| Version | Name | Statements | SQL SHA-256 | Bytes | 判定 |
| --- | --- | ---: | --- | ---: | --- |
| `20261114062717` | `scout_formal_30day_safe_staging_disabled_20261114` | 1 | `a979cfd89ee84d3675aa04c741e5006f199878eb3460e01771dc646f2ed35c7f` | 11414 | **本文同一だけ確認** |
| `20261114065015` | `scout_formal_e2e_cutover_held_20261114` | 1 | `bc4ed82c754cc055687f405ed316733cef2815865d79de501d8684b9481921d8` | 16187 | **本文同一だけ確認** |
| `20261114070855` | `scout_formal_finality_compensation_held_20261114` | 1 | `b43d0ac7d97a70758885aeae3261a5e1bb7d4cdd6c7687212b46ea3304936388` | 13117 | **本文同一だけ確認** |
| `20261114091324` | `scout_formal_single_window_restore_held_20261114` | 1 | `680850dce1b36320ec8e4c54cd82f0417a7213dc41e5c57c7f8786e5bbe18173` | 7776 | **本文同一だけ確認** |

- `20261114062717` の実行原本はコミット `886b3f6be4f83861a08b99fd4721b0a27132a569` の `docs/drafts/SCOUT_FORMAL_30DAY_STAGING_SAFE_SQL_20261114.sql` で、`LANGUAGE plpgsql STABLE SECURITY DEFINER` を `LANGUAGE plpgsql VOLATILE SECURITY DEFINER` に1か所置き換えた **11,414 bytes**。実履歴のSHA-256が64桁一致する。PR #2862の現行原本11,567 bytesは、その後の適用済みコメント追加等で異なる。
- 他の3件は PR #2862 HEAD `7a21013cbee5fe374f7a56620160f8afe427def6` のSQLと、過去のStagingメタデータのSHA-256/バイト数が一致。
- StagingメタデータはVersion/Name/Statement count/SHA-256/Bytesのみに限定。SQL本文・ユーザーデータをStagingから取得していない。実行時点の承認・適用トランザクションは別途未確認。

## 承認証跡：未確認（合格へ昇格しない）

- GitHub Issue #294（198コメント）とIssue #188（74コメント）の過去の調査で、4 versionを明示する正式な承認・実行記録が見つかっていない。
- PR #2862は適用済みと記載する **Draft/未統合**。記述だけでOWNER承認・権限・Staging安全性を証明しない。
- 別承認経路が存在し得るため「無断実行だった」と断定しない。
- 実環境の停止ゲート・実トリガー挙動・後続影響、AI工程②の `auth.sessions` / `novels` 権限は **未実証**。

## このDraftで固定するFail-closed境界

1. `supabase/staging-migrations-observed/` は実SQLの**証拠アーカイブ**。Supabase CLIの実行対象ではなく、既存の `STAGING_ONLY_SCOUT_FILES` の正式許可4件とは厳密に分離。
2. 新しいオフライン照合関数は4件の名前・statement件数・hash・byte長、Production正本への混入、改変・欠損・重複を拒否する。
3. 既存の本番Migration parity checkは観測4件がStagingにあれば本文を照合しても **承認台帳未確認によって常にNO-GO**。承認を自動推定しない。
4. 既存Staging同期shell・承認workflow・Production migration planの適用操作は一切変更しない。新しいStaging/ProductionのMigrationを実行しない。
5. PRをDraftのまま維持し、mainへ統合しない。CodeQL/CIの結果は実環境証拠・承認の代用ではない。

## 次の必須判断

1. 追加4Migrationの **正式な実行承認・実行経路・権限・事後監査** を、元の運用記録から確認する。証拠が見つからなければOWNERによるリスク受容・回復方針の判断を先に得る（履歴の削除、番号変更、再適用は禁止）。
2. 監査と再承認が成立した場合に限り、現行4件からの **正式な allowlist・Staging同期計画変更** を別スコープで審査。Production向け `supabase/migrations/` に移さない。
3. Migration整合性を正式に合格できた後、AI工程②のS0権限カタログSELECTを別の対象限定承認で進める。現状はS0 **NO-GO**。
