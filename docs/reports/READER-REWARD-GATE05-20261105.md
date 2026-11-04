# NOVELIGHT 読者報酬 Gate 05 — 既存SCOUT実装・本番DBとの接続前整合監査

確認日：2026-11-05 JST
作業ブランチ：`feature/reader-reward-gate01-20261104` ／ Draft PR #2762
正式main：`03f64b14138ec5c6a90c0d8231a0784f878e78fa`
実行境界：**GitHub既存コードとSupabaseスキーマ・既存関数の読み取り専用確認、およびDraft PR内の純粋関数／テスト／文書の追加のみ**。本番・Staging・DBの書き込み、migration、RPC置換、Cron、課金、公開、main統合なし。

## 1. 本番DB・実コードで実測できた事実（読み取り専用）

| 対象 | 実測結果 |
| --- | --- |
| `public.scout_xp_ledger` | `id`, `user_id`, `source_event_id`, `xp_kind`, `xp_value`, `rule_version`, `occurred_at`。既存XP獲得根拠として再利用可能 |
| 重複防止 | `UNIQUE(user_id, source_event_id, xp_kind)`、`scout_event_ledger.event_key`の一意制約を確認 |
| RLS | `scout_xp_ledger`、`scout_event_ledger`、`scout_level_thresholds`でRLS有効 |
| β経験値テーブル | `scout_level_thresholds`はLv.1〜30のみ、`rule_version=beta-2026-09-21`。Lv.30累計閾値は9,570XP |
| βレベル計算 | `novelight_scout_record_summary()`がXP台帳合計から表示用XP・Level・ゲージを計算、`novelight_scout_level_for_xp()`が累積XPからLvを求める |
| ブラウザ | `novelight-scout-record.js`が`novelight_scout_record_summary`を呼び、`total_xp`、`xp_into_level`、`xp_for_next_level`、`beta_level_max`を参照 |
| β上限トリガー | `scout_xp_beta_level_cap`が`novelight_cap_scout_xp_beta()`をXP挿入前に呼ぶ。Lv.30上限を維持 |
| レベルアップPoint | `scout_xp_level_up_points`が`novelight_award_level_up_points()`をXP挿入後に呼び、従来の累計XPのLevel差でPointを付与 |
| 称号 | `scout_xp_refresh_reader_badges`がXP挿入後に称号処理を呼ぶ |
| 読書XP | `scout_event_valid_read_xp`が`novelight_award_valid_read_scout_xp()`を呼ぶ。日次上限やユーザー別advisory lockを利用 |
| 管理分析 | `api/_lib/admin-scout-progression.js`のbetaレベル計算はXP合計→Lv.30上限。既存管理画面・分析も正規切替時に照合が必要 |

**重要な既存差異：** βの`novelight_scout_record_summary`と`novelight_cap_scout_xp_beta`には`light_seed_discovery`を集計から除外／挿入対象外とする分岐がある。一方、OWNER確定の正式版維持ノルマは、正式付与された発掘成功XPも含む**30日間の確定Scout XP**を使う。従来の「レベル計算に用いるXP表示値」をそのまま200XP集計へ転用してはいけない。Gate02の台帳集計を独立維持し、正式稼働時の発掘XP付与経路を別途監査する。

## 2. Gate 05で新規追加したもの

### `api/_lib/reader-reward/scout-db-compatibility.js`

**`auditScoutDbCompatibility`**
- サーバー側で取得されるべき**テーブル列・RLS・一意制約・既存トリガー／関数のメタデータ**を入力する純粋な監査関数。
- 既存XP一意制約、RLS、読書イベント／称号トリガーを確認し、欠落や変更時は安全にブロック。
- 従来βのレベル上限トリガー、旧累積XP表示RPC、旧レベルアップPoint処理と、正式レベル状態／単一トランザクション確定の不足を**明示的なCutover blocker**として列挙。
- 将来のDBテーブル名を勝手に確定しないため、正式状態／一意Review Claimは**抽象契約**として判定。メタデータがそろって見える場合でも、この関数から本番承認を付与しない。結果は常に`productionCutoverAllowed: false`。

**`validateScoutBetaThresholds`**
- 実測済みβ版Lv.1〜30の30行・昇順・同一ルール版とLv.1=0／Lv.30=9570を検証。
- Lv.31以降を補外した値は**正式値として受け入れない**。

**`quoteScoutBetaToFormalHandoff`**
- βログインユーザーの既存RPC概要と確認済みβ閾値を照合し、現在Level・次Lv XPゲージ・最高到達Lv・正式初回判定起点の**非永続候補**だけを算出。
- Lv.30のβ上限超過値や`raw_recorded_xp`をLv.31向け進捗として繰り越さない。独立の生涯総XPカウンターを追加しない。
- βの`total_xp`とLevel／ゲージが矛盾する場合は拒否。
- 正式リリース後の**新規登録者にはβ移行を適用しない**。新規登録起点は別の既存Gate01の30日初回判定ルールで管理する。
- 未来の本人認証・Server Ledger突合・formal threshold承認・OWNER正式公開許可が必要であり、本関数だけでは移行を実行できない。

### `tests/reader-reward-scout-db-compatibility.test.mjs`

本番から個人情報や秘密を取得せず、**実測したスキーマ構造のメタデータのみ**をテスト入力に再現。β上限トリガー残存、累計XP依存、RLS不備、一意制約欠落、β閾値の改ざん・31以降の推測値、Lv.29/30の移行試算、βレベルとXP不整合、正式新規アカウントのβ移行拒否、仮の準備完了フラグを理由とする承認偽装禁止を確認。

- Gate01〜04：66件
- Gate05追加：10件
- **合計76件 PASS／0 FAIL**（隔離Node focused tests、Prettier整形済み）

## 3. 正式接続前に必ず解消する項目（未実装・未承認）

1. **既存βとの切替境界**：βの累計XP→Level表示RPC、Lv.30 XP cap、従来Level-up Point付与トリガーを、正式版の新たな進捗Stateと二重に作動させない。βは正式公開までそのまま維持する。
2. **既存ユーザーの初期化**：既存β Level/XPゲージ・最高到達歴のサーバー証拠、β上限超過分の非引継ぎ、初回30日判定起点、既存称号・Point・Rank実績との整合。
3. **新規ユーザー経路**：正式リリース後に作成されたアカウントはβ RPC移行を通さず、正式ユーザー新規状態を別に初期化する。登録日時から30日後の初回判定を維持。
4. **XP付与と30日判定の整合**：`scout_xp_ledger`の既存uniqueと新しいLevel/進捗状態のAtomic CAS、判定済みWindowの一意Claim、遅延XP・取消・不正・重複・同時更新をDBトランザクションで実証する。
5. **発掘XPのβ差異**：`light_seed_discovery`等の現在のβ非反映／非公開処理と正式の獲得・維持ノルマを明確に分離し、正式リリース後の自動付与・Point/称号への副作用を監査。
6. **Lv.31〜100の必要XP、Lv.100余剰XP処理**：正式値がまだOWNER未確定。βの曲線を勝手に延長して稼働しない。
7. **公開と支払の独立承認**：報酬月上限・予算・交換・法務税務・公開・Production/Stagingは今後別の承認ゲート。

## 4. 実証状況

| 区分 | 状態 |
| --- | --- |
| コード | Draft純粋監査・β移行試算関数追加、実接続なし |
| 自動テスト | **76件PASS／0件FAIL** |
| Production DB | **読み取り専用のメタデータ・関数定義・閾値確認のみ**。データ更新なし |
| Staging live proof | 未実施 |
| 本番反映 | 未実施 |
| PR | **Draft維持。main未統合。一般公開なし** |

正式切替の可否は将来の実環境監査・Owner承認でのみ判断し、このレポートのチェック結果を本番適用許可に転用しない。
