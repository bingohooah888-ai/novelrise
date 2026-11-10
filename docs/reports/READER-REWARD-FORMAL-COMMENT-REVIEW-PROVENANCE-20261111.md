# NOVELIGHT LEVEL100 / 読者収益化：コメント適格性審査証跡・非公開Draft設計

基準 HEAD：e4b8ac400fbb250c913370f38220325b249c94b6（既存Draft PR #2762）。
本報告はコードと隔離テストの証拠であり、DB適用・Production/Staging実行・報酬付与の証拠ではない。

## 直前HEADのCI最終確認

- GitHub NOVELIGHT CI #42845299820：Node tests／Static quality／RLS／ブラウザE2E全5系統／依存関係監査／Actions lint成功。
- GitHub CodeQL #42845299929：JavaScript/TypeScript解析成功。
- CI全体は既存MASTER高リスク差分のOWNER head-bound main統合承認が未提出のためMerge readinessと集約checkがfailure。承認・セキュリティゲートの変更はしない。

## 新設するのは正式版Draft内の最小アプリケーション部品のみ

1. api/_lib/reader-reward/formal-admin-comment-review.js
   - **未公開のhandler factory**。api直下のルートではなく、既存GitHub Workflow/Cron/常駐workerを追加しない。
   - 既存 api/_lib/admin-auth.js の requireAdmin で、同一Origin、Bearer、Supabase Auth getUser、admin allowlistを検証。POSTと明示Originを必須とする。
   - 正式版フラグ3種＋trusted-service側のservice-role確認2条件のすべてがtrueでなければDBへアクセスしない。
   - クライアントは comment_id、適格判定、ルール、**管理者が画面で確認した本文のSHA-256**しか渡せない。reviewer IDや審査IDはリクエストで指定不可。
   - 実審査者IDは認証済みadmin.id、review_idはサーバー生成UUID。レスポンスに機密証跡・コメント本文を返さない。
2. api/_lib/reader-reward/formal-earning-runner.js と formal-earning-durable.js
   - 正規のpublic.novel_commentsから本文を取得し、サーバーでUTF-8 SHA-256を再計算。画面側の確認済みfingerprintと違えば保留。
   - 審査済み証跡の構造（reviewerId、reviewId、bodySha256）を満たさない場合は既存private DB処理に渡さない。
   - 固定SQL名・プレースホルダー型は従来3項目から7項目へ拡張。元の審査承認関数の3引数経路を残してバイパスさせない。
3. docs/drafts/SCOUT_FORMAL_EARNINGS_ATOMIC_DRAFT.sql
   - private schema に scout_comment_review_evidence を設計。1コメント1件の一意ID、審査ID、実審査者UUID、コメント著者UUID、episode ID、SHA-256、eligible、reviewer_rule、DB確定時刻を保持。元本文そのものは保存しない。
   - RLSと明示REVOKEでpublic/anon/authenticated/service_roleのテーブル直接操作を禁止。private definer functionの内部操作に限定。
   - decide_earning_review_draft は正規コメント行と未処理イベント行をFOR UPDATEでロックし、本文ハッシュ・話IDを再確認。証跡INSERTとイベントpending化が**単一SQLトランザクション**で成立。失敗時は全体ロールバック。
   - 確定済みの同一審査者／判定／本文ハッシュ／ルールは冪等で返し、異なる審査者・反転判定・本文バージョンは既存決定を書き換えず競合として保留。
   - review_comment_and_award_draft と award_comment_points_draft の双方がprivate証跡を読み、判定・著者・話ID・現在本文を検証。Point発行前の元コメント行をFOR UPDATEで固定し、内容変更なら保留。
   - 既存public.scout_point_ledgerの一意event_key、および月50件・1話1回の制限は変更しない。

## 隔離テストの確認内容

- 不正Bearer、許可リスト外のユーザー、外部Origin、クライアントの審査者ID偽装、不正判定・不正ハッシュ、フラグ無効時にDBへ触れない。
- 正常な管理者の本人IDとサーバー生成審査IDが固定SQLの束縛値に届くこと。投稿者が本文を変更した場合、事前に拒否して審査DBを呼び出さないこと。
- 直接呼び出し時に審査証跡が不足すれば拒否。レビューの重複・矛盾は保留/冪等のまま。
- Draft SQLを静的監査し、private RLS、制約、一意キー、原本再照合、row lock、atomic INSERT→transition、授権・REVOKE、両方の報酬発行関数での証跡検証を確認。

## 現時点で未完成・未立証

- SQL関数の実PostgreSQL実行、行ロックの同時トランザクション、grant/RLSの実権限挙動は**まだ実DB検証していない**。今回の隔離試験はNodeモック＋静的SQL契約テスト。真正なDB永続化はDraft設計の範囲。
- 管理画面の審査UIやAPI公開ルートは追加していない。UI上でレビュアーがどの本文を確認したかを独立して証明する操作ログは未接続。SHA-256一致は本文の整合を確認するが、人間が実際に精読したことまでは証明しない。
- 本文を編集して元に戻した場合、同一SHA-256から編集履歴までは特定できない。改稿履歴の永続保存・事後修正時の報酬取消/再付与は別のOWNER判断。
- db functionを直接実行できる高度なservice-role/DB所有者の侵害や改ざんは、このアプリケーションレベルの証跡だけでは防げない。権限と運用監査が後続のリリース条件。
- 読書報酬・コメント報酬の正式フラグ、交換、AI直接使用、予算管理は未有効。Production LEVEL上限30、β動作、現行台帳は変更しない。
- 未決定のLv100余剰XP、削除/編集後の遡及処理、正式リリース日は変更しない。

本ファイルおよび実装は既存Draft PR #2762内のみ。新規PR・Workflow・本番/Staging DB変更・main統合・実Point発行なし。
