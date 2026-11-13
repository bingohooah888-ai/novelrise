# NOVELIGHT LEVEL100 / Scout Point：正式版再処理・審査受渡し Draft

対象：既存 Draft PR #2762、基準 HEAD fc28241249578727c468aee1c0649feb9802f349。
新規PR、実行ワークフロー、公開API、タイマー、既存βルート、正式版migrationは追加しない。

## 今回の最小接続

- api/_lib/reader-reward/formal-earning-runner.js：既存の formal-earning-durable.js にだけ処理を委譲する正式版用・未登録の内部サーバーランナーを追加。
- drainDue：1回1〜25件の処理上限、同一ランナー内の多重起動防止。PostgreSQL側の既存 FOR UPDATE SKIP LOCKED・lease token・再試行時刻・Point event_key 一意制約が、異なるサーバー／再起動をまたぐ整合性の根拠。
- bindExistingScheduler：**承認済みの既存常駐サーバーの登録器**を受け取るアダプター。独自のCron、タイマー、Vercel関数、GitHub Actionsを作らない。サーバー起動時または既存スケジューラへの実配線は**まだ行っていない**。登録器が無ければ自動起動しない。
- submitModeration：本人性・審査権限・原本との結合などの**独立した審査証跡**を、将来の信頼済みサーバーが提供する verifyModeratorReceipt で検証できた場合のみ受理。コメント本文・履歴を正規DBから再読し、判定結果を既存 decide_earning_review_draft へパラメータ化して渡す。審査未完了なら保留。
- 空白・非表示コメントを人間が不適格と確定した場合には審査結果を記録できる。これにより先行不適格コメントの未審査状態が後続の適格コメントを塞ぐのを防ぐ。
- 他作品への同文反復は審査前に保留するが、**信頼済みの審査で適格と確認できた場合は機械的に拒否しない**。
- 追加の formalWorkerEnabled は起動のための独立したオフ・バイ・デフォルト設定。既存の formalEarningsEnabled、productionCutoverApproved、service-role＋trusted-server認証と**すべて**一致しなければDB操作もスケジューラ登録も実施しない。

## フェイルクローズ

- 期限切れleaseの回復、同一event_keyの二重付与防止、審査済み結果の再投入は既存SQL候補で制御する。新しいポイント台帳・交換通貨は作らない。
- claim/finalizeが不正・DB応答が未知・接続が失敗した場合は処理を中断し、実残高の確認済み付与をランナー側で宣言しない。
- レビュー受渡しのサービス実装・審査担当者の認証証跡の形式は未確定。verifyModeratorReceipt がないとコメント審査結果をDBに渡せない。ブラウザのBooleanやAIの単純な語句一致では適格判定をしない。
- Vercelのリクエスト実行は常駐ワーカーではないため、**現在の実行環境で勝手に自動実行可能になったとは扱わない**。正式版の起動元を確実に実働させるには、既存の稼働ホストを特定し、このアダプターをそのホストに結び付けた結合試験が必要。

## テストと未完了のゲート

- tests/reader-reward-formal-earning-runner.test.mjs：無承認時の無作用、審査証跡の拒否・受理、正規DB再読、重複コメントの人手適格承認、空白コメントの不適格記録、1回の件数上限・多重起動防止、障害時の保留、将来の既存スケジューラへの登録、再起動をまたぐモック上の再処理。
- tests/reader-reward-formal-earning-delivery.test.mjs：同文反復が未審査では保留／明示審査後は適格も可能であることに合わせて既存期待値を修正。
- これらは**隔離Nodeモックの統合テスト**であり、実Staging DB、実稼働スケジューラ、実審査サービス、金銭決済、AI呼出しの成功証拠ではない。
- 今後の必須ゲートは既存ホストへの起動元接続・審査証跡の真正性保証・隔離Staging End-to-End・Point会計予算・交換/AI直接利用・正式公開日・本番承認。
- OWNERが保留した「削除・編集後の遡及取消／再付与」「Lv100余剰XP」は変更しない。正式版まで非公開のまま、ProductionのLv30上限・β動作を維持する。

本番SQL、Production／Staging DB変更、実Point/金銭/AI処理、main統合、正式公開はこのDraft差分の対象外。
