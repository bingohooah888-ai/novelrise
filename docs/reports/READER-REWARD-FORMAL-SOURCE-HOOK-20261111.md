# LEVEL100＋読者収益化：正式版コメントイベントの脱落修正と既存起動・審査証跡調査

対象：Draft PR #2762、基準コミット f05e5d7b238eeee073465718ede1a8182901d33f。
本ファイルはDraft内の実装・監査記録。新規PR・Workflow・Production/β変更・main統合・Point発行は実施しない。

## 指定HEADのGitHub結果

- NOVELIGHT CI run 42841486325：Node tests、Static quality、RLS integration、全ブラウザE2E、Dependency audit、Actions semantic lintすべてsuccess。
- 同runのMerge readinessと集約checkはfailure。既存の高リスクMASTER差分に対する当該HEAD固定OWNER main統合承認がないための意図したfail-closed。承認を代理投稿・バイパスしない。
- CodeQL run 42841486619：success。

## 実装不整合：エピソードコメントの二段階登録

既存の supabase/migrations/20260930030000_episode_comments.sql の novelight_post_episode_comment は、先に novelight_post_novel_comment でコメントをINSERTし、その後で public.novel_comments.episode_id をUPDATEして話別コメントに確定する。

正式版Draftの scout_formal_comment_enqueue は従来 AFTER INSERT のみだったため、INSERT時点で episode_id がNULLの場合には return new となり、review_pendingイベントを登録しない。投稿が正常でも、コメント報酬の審査対象に届かない可能性があった。

対策（適用先は docs/drafts/SCOUT_FORMAL_EARNINGS_ATOMIC_DRAFT.sql のみ）：

- AFTER INSERT OR UPDATE OF episode_id の形式へ変更。
- INSERT時にepisode_idがある場合、またはNULLから初めて設定されたUPDATE時のみイベントを登録。既に非NULLの行への再UPDATEでは再登録しない。
- 同一のevent_type/event_id主キーと ON CONFLICT DO NOTHING を継続して使用。
- 正式版Level状態の行がまだ存在しなくても、コメントのレビュー待ちイベントを消失させない。報酬を自動付与するのではなく、状態が整うまで保留・再試行する。
- 原因が一時的な formal_state_missing は既存の永続再試行ステータスへ含める。DB台帳を使って実行後の重複付与を避ける既存構造を維持する。

## 既存の起動機構：接続可否

| 既存資産 | 実測した用途 | 今回の結論 |
|---|---|---|
| PostgreSQL pg_cron | 予約公開等のSQLをDB内で定期実行 | JavaScriptのregisterTickコールバックを直接呼べない。SQLだけで動く正式版のDB内実行器を設計・承認した場合には候補 |
| GitHub Actions beta-ops-inbox.yml | Productionの問い合わせ/通報件数を読み取り監視 | 現行は運営監視用。報酬台帳の書込器への流用は禁止 |
| Vercel API | リクエスト起点のサーバーレス処理、独立した既存Cron認証ルート例あり | 常駐プロセスではない。既存のコンテスト用Cron等を報酬処理に流用しない |
| formal-earning-runner.js | 前回追加した未登録の内部ランナー | 起動する既存の常駐ホストと登録器が特定できていないため、現在は自動起動不可 |

新規Cron/Workflow追加なしで自動再処理を実働させたと主張できる証拠はない。現時点の最小実装は手動・明示的な信頼済み内部サーバー呼出しまで。既存pg_cronの拡張案には別途、SQL専用の安全な処理実装・権限・監査・有効化承認が必要。

## コメント審査証跡：接続可否

- 既存の admin-auth.js の requireAdmin は管理者ID/メールallowlist、Supabase Auth getUser、同一Originを確認する。審査担当者の認証構成は再利用候補。
- public.novel_comment_moderation_events は作者によるpin/hide/replyなどの管理行動履歴。コメントの意味的な報酬適格性を証明しない。
- public.trust_reviews はユーザー不正リスクのレビューであり、話別コメントの報酬判定記録ではない。
- 現在の正式版Draftは scout_earning_delivery に適格/不適格とルールを記録するが、審査担当者のID・証跡ID・対象本文バージョン/ハッシュを**永続的に関連付けていない**。
- 前回の verifyModeratorReceipt callback は注入可能なインターフェースのみ。現行のβ版に、実際に認証された審査結果を独立した改ざん耐性のある記録から読み出すプロバイダーは接続されていない。

したがって「コメント審査の運用経路完成」とは認定しない。今後は既存admin認証の再利用に加え、レビュアーID、レビュー原本ID、対象コメントID/内容の版、適格判定、判定理由、時刻、重複・取消規則、DB確定トランザクションでの再照合が必要。本人以外の作者のhide/pin判断やクライアントBooleanを報酬審査へ使わない。

## 検証と安全境界

- 新しい静的結合テストは実際のエピソード投稿SQLの INSERT → UPDATE と、正式版Draftのトリガーを同時に照合する。
- 既存のローカルNodeテストは再実行する。PostgreSQL構文とトリガー挙動の実DB証明は、この作業では実施していない。接続済みDocker Engine / ローカルPostgreSQLが利用できないため、実DBでの新規証明が完了したとは表現しない。
- このDraft SQLは supabase/migrations 以下へ移動しない。旧Scout・β版、Vercel Production/Staging、Stripe、外部交換、AIの運用変更は行わない。
- 未決定の削除/編集後の遡及取消・再付与、Lv100余剰XP、正式公開日、会計予算と交換条件は維持。
