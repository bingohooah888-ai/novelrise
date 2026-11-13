# NOVELIGHT β Scout Point 10倍｜Staging一括切替・ロールバック実行手順（承認前Draft）

作成日：2026-11-05 JST  
対象：Draft PR #2762、GitHub main `03f64b14138ec5c6a90c0d8231a0784f878e78fa`、Staging専用Supabase branch `wmlzjgvxgoyrovdhbqbg`。  
**本書自体はSQL実行権限を付与しない。Supabase Staging変更・migration sync・smokeには別途1回限りの「ステージング承認」が必要。Production DBの書込み・main統合・本番デプロイは禁止。**

## 0. 認証・費用・誤接続を最初に遮断

- Production project `fiepaguycecrredwrcwx`、Staging branch project `wmlzjgvxgoyrovdhbqbg` は**異なるproject ref**。各DB接続が現在どちらを指すかをConnectorのproject_idとread-onlyカタログから独立に照合する。接続先のSQL変数のみを根拠にProduction除外を証明しない。
- Issue #188の従来の`full-smoke`承認は、**Point台帳一括更新・RPC変更の権限を含まない**。対象限定scope `reader-reward-beta-point-10x-staging` について、最新main SHA＋Draft PR HEAD＋対象Staging ref＋一回限りの機械証跡をOWNER認証済み経路で作成できることを先に確認。既存の過去コメント・「はい」「続けて」「本番承認」を再利用しない。
- 本scopeを受理可能な機械可読Approval Gateが未整備／Issueが閉じている等で確認できなければ**Fail Closed**。安全ゲートを迂回してSQLを直接実行しない。Staging branchをrebase/reset/mergeせず、Vercel Previewや実JWT操作を勝手に起動しない。
- Supabase Branchは`with_data=false`と報告されても既存レコードを持つ。**StagingデータをProductionのバックアップとみなさない**。Production実データを無承認でコピーしない。

## 1. 更新前の全件読み取り専用証跡（承認不要）

- DBカタログ：`pg_class`／`pg_attribute`／`pg_constraint`／`pg_trigger`／`pg_proc`、Table/RLS/Policies、FunctionのSECURITY DEFINER・search_path・EXECUTE権限を確認。最新のStagingとProductionで該当カラム・10関数・10トリガーの署名／定義ハッシュが一致することを確認。*2026-11-05時点の読み取り専用監査では対象カラム・10関数・10トリガーの差異なし。*
- 対象テーブルは `scout_point_ledger.point_value`（confirmed/pending/frozen/cancelled・reversalを含む全行）、`scout_badge_definitions.point_reward`（reader/author/limited全定義）、`scout_badge_definitions.target_value`のうち`metric_key='scout_point_earned_total'`（現在2定義）、`user_scout_badges.progress_value`のうち前記2称号、`scout_point_operator_actions.amount`のNULL以外。
- 独立して確認する非変更表・列：`scout_xp_ledger`、レベル閾値、その他称号の`progress_value`、作品PV、全レコードの`user_id`・`event_key`・`source_*`・`reversal_of`・`status`・`progress_percent`・`earned_at`・metadata。
- `novelight_award_level_up_points()`が現状5ptの固定値で新規付与するため、切替と同時に50ptへ変更し、署名・SECURITY DEFINER・search_pathを維持する必要あり。称号付与は`novelight_apply_scout_badge_evaluation()`が定義表を参照する。その他のポイント発行・運営調整経路も最終監査対象。
- 読者称号再評価で`p_award_reader_points`をTRUEのまま全件走査しない。換算が新たな報酬発行や称号earnedを発生させないことを独立検証する。
- 再照合の全件検査：ID重複ゼロ、全状態の件数とPoint和、符号／制約超過、現行残高、既存のPoint獲得閾値、全Point関連進捗の行数・和・earned人数、付与RPC定義ハッシュ、各ユーザーの監査可能なPoint残高の整合、二重変換マーカーの存在を確認。
- `point_value`には既存 `[-1,000,000,+1,000,000]`、運営調整額には`[-100,000,+100,000]`のCHECKがある。10倍後の全行制約をSQL上で検査し、1件でも違反があれば停止する。

## 2. 本当のバックアップと復旧試験（Staging承認後のみ）

1. 読者Point付与経路を旧・新ともに停止し、該当トリガー／RPCの呼び出し競合と予約送金の有無をチェック。**単にWeb UIを隠すだけでは不十分**。古いCronや直接RPCも止める。
2. Staging専用DBについて**全体バックアップ**（適切に暗号化されたpg_dump / データ＋schema・function権限・トリガー・extensions等）を安全な保存先に取得。機密データやキーをチャット／CIログに流さず、保存期限と責任者を定義。
3. 独立した廃棄可能DBへ復元し、必須テーブル・トリガー・RPC・制約とPointサマリーが一致することをテスト。**バックアップの取得成功だけでは復旧可能性を証明できない**。
4. Ledger・称号定義・称号進捗・運営調整額の全行単位の復元用スナップショットを整合した時点で確保。再実行防止の一意な永続切替マーカーの既存有無をチェック。複数バージョンや途中状態があれば停止。

## 3. 原子的切替アルゴリズム（非実行設計・承認後にSQL化）

次の処理は**1つのSERIALIZABLE相当の隔離トランザクションで、明示的な全書込み停止とロックを確保してから**行う。分割コミット／部分的なmasterデプロイは禁止。

1. Staging接続先と新旧Point版を再確認し、適切な権限・監査記録・単一実行ロックを取得。**先に永続一意マーカーを確認し、二重変換を拒否**。最新row-count、sum、event-keyハッシュ、badge/progress集計が承認時のsnapshotと一致しなければ中止。
2. 全台帳の`point_value`を旧値×10（負数／pending／frozen／cancelled含む）。同じトランザクションで`point_reward`全件×10、Point獲得条件`target_value`2件×10、対象の`progress_value`×10、運営調整`amount`（NULL除く）×10。
3. 同じ切替境界で`novelight_award_level_up_points()`の新規レベル報酬5→50へ変更。称号の付与経路は新しい`point_reward`に揃える。将来の読書1〜11pt／コメント20ptを**未承認のうちにProductionへ開放しない**。
4. `event_key`一意性、状態／符号／参加者／参照元／earned称号／Point以外の進捗、既存称号の獲得日付等を変更せず、DB CHECK/RLS・付与ログを再検証。次の全件照合が全PASSする場合のみ同一トランザクションをcommit。
5. commit後、旧単位の付与経路が一切残っていないこと、ダブルAwardがないこと、Stageの閲覧専用RPC（`novelight_scout_record_summary`、`novelight_scout_point_history`）が新Pointで返すことを確認。許可済みのStaging操作としてのみ新規レベルアップ・称号授与・取消・運営調整の試験を実施。
6. 任意時点で条件不一致・例外・不明状態なら、Staging Point書込みを停止したままrollback。commit後に問題が出たらバックアップから隔離環境へ復元し、全件差分を監査してから安全な復旧経路を決める。**新規付与を再開した後に旧スナップショットで上書きするのは禁止**（正当な新規Pointが消える）。

## 4. 完了判定：全件一致の必須不変条件

- 台帳row数・distinct event_key数・user数・Point種別・status・reversal・参照元不変。各行`point_value_after=old*10`、総和同率。二重変換の再実行は必ず失敗し、結果は変化しない。
- 称号定義数・badge_id・分類・難易度等不変。各行`point_reward_after=old*10`。Point累積称号のみ`target_value_after=old*10`。
- 既存`user_scout_badges`の行数・user/badge対応・earned件数・progress_percent・earned_at不変。Point累積称号の`progress_value_after=old*10`、その他の称号進捗は不変。表示と獲得閾値の経済的意味も不変。
- 運営調整の金額×10、RLS・RPC・trigger signaturesの安全特性不変。新規Point付与はレベル50pt、称号報酬は新定義を参照。
- 意図的な途中失敗を注入して原子的に0変更になること、切替マーカーを含む二重適用防止、バックアップからの復元と旧関数復元を実証。
- 新旧のPoint値が混在する行・機能・利用者表示なし。**これらをStagingで実測し、結果をPRに記録するまで実環境完了と報告しない。**

## 5. 承認待ちの範囲

**Staging用1回限りの承認が未確認。** Issue #188にはPoint10倍DB切替を許可する有効な`mainSha=03f64b14...`かつ当該scopeのOWNER承認コメントは確認できない。既存の`full-smoke`をPoint台帳UPDATEの権限に読み替えない。現行のApproval workflowが本scopeを処理できないなら、承認ルートの整備自体を安全審査する。

実際のStaging DBには一切書き込まず、2026-11-05は**カタログ・集計SELECTによるread-only shadow**および**ローカルの合成PostgreSQLモデル**だけ検証した。ローカルモデルはPGlite 0.5.15（PostgreSQL 18）であり、Supabase PostgreSQL 17実環境の代用ではない。再現テストは`docs/plans/READER-REWARD-POINT10X-LOCAL-PGLITE-PROOF.mjs`を、機密情報を持ち込まずに**別の一時フォルダにコピーし、同フォルダへ`@electric-sql/pglite@0.5.15`をスクリプトなしでインストール**して実行する。

**Production DB／main統合／本番デプロイは別の独立承認が必要であり、今回のStaging承認があっても一切実施しない。**
