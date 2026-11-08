# アカウント削除・問い合わせ対応手順

対象：`account-settings.html` → `POST /api/delete-account`。個人のメール・ユーザーID・作品名・JWT・APIキー・決済IDをIssue/PR/ログへ転記しない。

## サポート一次対応
1. 「削除ボタンを押しても削除されない」という申告があれば、問い合わせを受理し、完了したと誤案内しない。
2. 本人確認は、認証済みの問い合わせに紐付く Auth user ID と本人の操作記録を安全な管理経路で照合する。メールの一致だけで第三者のアカウントを削除しない。
3. 自己削除の操作は「アカウント設定 → アカウントを削除 → 正確な確認文言を入力 → 完全に削除する」。現時点で失敗が再現する利用者に、同じ操作を何度も繰り返させない。
4. 失敗した場合は、画面に表示される「照会番号」（ランダムなUUID）のみ問い合わせで受け取り、Vercelログの `requestId` と照合する。認証トークンや個人情報を尋ねない。
5. 必要に応じて、本人同意と既存の公開制御を確認して作品の非公開を提案する。本人の同意なく作品やアカウントを変更しない。

## システム診断
- フロントエンドは `getSession()` で有効なアクセストークンを取得し、削除APIに送る。サーバーが必ず `auth.getUser(token)` を使って所有者を検証する。
- APIのエラー記録は `requestId` / `stage` / 正規化済み `code` / 非機密HTTP `status` のみ。error.message、email、user ID、Storage pathなどは出力しない。
- ステージ：`collect_targets`, `cancel_billing`, `storage_avatars`, `storage_illustrations`, `storage_thumbnails`, `storage_custom_covers`, `db_episode_illustrations`, `db_novels`, `db_episodes`, `auth_user`。
- `401` はセッション切れ、`400` は確認文言不一致、`500` はサーバー処理失敗として区別する。通信エラーやJavaScriptエラーでAPIに到達しないケースも確認する。

## 途中失敗への対応（必須）
- 既存の削除処理は Stripe契約停止 → Storage削除 → publicデータ削除 → Auth削除という非トランザクション手順。途中失敗しても一部の変更は戻らない。
- `500` を受けた場合、再試行前に Stripe契約、残存Storage、作品/エピソード、認証ユーザーの状態を読み取り専用で確認し、二重課金・残存データ・部分削除を避ける。
- 現在のDBスキーマには `scout_reward_campaign_claims.user_id` および `trust_reviews.reviewer_user_id` の `auth.users` に対する `ON DELETE RESTRICT` がある。これらを参照する利用者ではAuth削除が失敗する可能性がある。適正な記録保持・匿名化方針を決めるまで勝手に消去/制約解除をしない。
- 手動で `auth.users` を先に消す、関連テーブルを一律CASCADEに変える、失敗したAPIを連打する、といった回避策は禁止。

## 検証と承認
- テストケース：読者のみ／作品・エピソード・表紙・挿絵を所有する作者／Premium有効契約／削除制約対象データあり／Stripe失敗／Storage失敗／Auth削除失敗／無効セッション／確認文言不一致。
- Mock/Unitの合格は実環境検証の代替としない。Stagingでの実JWT・データ削除試験、Vercel Previewは個別の「ステージング承認」が必要。
- Auth/Stripe/個人情報を含むPRのmain統合には対象PRへの「本番承認」が必要。実利用者の本番削除はさらに別操作として対象と本人確認を固定した明示承認が必要。
- 本番成功確認前に利用者へ「退会完了」と通知しない。本人の退会希望は継続して尊重し、対応期限や次の案内を分かる形で伝える。
