# NOVELIGHT 02-07-05：実AI一回試行への接続（Draft／2026-11-14）

## 実装したもの
- `.github/staging-ai-02-07-05/protected-live-composition.mjs` は、既存のOpenAI Responsesアダプター、AI Router、Supabase原価予約・精算、One-Shot Claim、OWNER ledger、署名済み独立Watchdog、停止・cleanup、既存小説引用検証を**一本の実行経路**に接続する。importだけでは通信しない。
- 既存 `protected-stage-executor` → `approved-stage-coordinator` → `paid-trial-cleanup-runner` に、予算付きRouter呼び出しと引用検証結果を受け渡す任意の注入口を追加。従来の単体契約は維持。
- OpenAIへの送信内容は、サーバー側で再取得した管理人所有・合成第1話の**最初の1チャンク（4,096 UTF-8 bytes以下）**だけ。採用済みの引用検証コードで、出典のない候補を拒否。
- 原価は既存の原子的DB予約→Router精算/監査を使用。実験の出力は候補件数、確認済み引用件数、本文/応答ハッシュ、予約後の**会計上のマイクロ円額**だけ。実請求の確定値とは別。候補詳細はcleanup後、同一の信頼済みプロセス内の管理人用メソッドからのみ取得可能。GitHub Actionsログには出さない。
- `detached-stop-connector.mjs` は**別プロセスの独立コントローラ**が、既存の署名済みRunner終了証跡と不可逆Claimを使い、同じStaging-only停止・Auth失効・cleanup・独立残留確認を呼べるようにする。Watcher/ホスト自体は新設しない。

## 検証
- 対象のみの Node オフライン試験：`tests/ai-020705-protected-live-composition.test.mjs`、`tests/ai-020705-detached-stop-connector.test.mjs` と既存Runner/台帳回帰。
- 成功ケース：合成日本語1話から引用付き候補を取得、原価予約→DB Claim→模擬OpenAI POST1回→精算/監査→停止→cleanup→census。
- 拒否ケース：予算拒否、署名不正/独立腕章なし、同意撤回、原稿改変、引用不正、モデル異常、停止不良。失敗後に再送しない。

## 次にだけ必要な実環境接続（**本Draftでは未実施**）
1. 別途承認済みの **Staging Preview / 保護Runner** に、このコンポジションと独立停止コネクタをそれぞれ別プロセスで組み込む。既存6種のライブ証拠・署名/一回限りClaim・独立停止権限が実際に使えることを確かめる。
2. Staging-onlyのSupabaseサービス・Auth/JWT・合成作品/同意・非公開モデル資格・実アカウントの料金/換算を対象限定で照合する。提供価格はAPIの現行公式単価から承認し、`route` の算出値が10円未満になることを別途確認。
3. 対象SHA、Staging Preview ID、合成ユーザー/作品/話数、モデル、費用上限、期限、失敗時停止を固定した**一回限りの有料送信承認**を取得してから実行する。

## 変更していないもの
`.github/workflows/ai-020705-owner-staging-paid-trial.yml` は引き続き **OFFLINE PREFLIGHT ONLY**。実Runner/独立Watchdogの稼働、Staging DB書込み、Migration、JWT、Secret、Preview作成、有料AI送信、main統合、Production操作は一切行っていない。正式Gate A〜Eは実環境証明が揃うまで0/5のまま。
