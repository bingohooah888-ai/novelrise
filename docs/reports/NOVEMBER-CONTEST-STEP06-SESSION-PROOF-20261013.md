# NOVELIGHT 2026年11月コンテスト — ⑥読書セッションの安全な判定（Part B）

**作業中／ドラフトPR／Production未実施。** ⑤受付開始・正式要項採択・11月1日開幕は別々の承認。⑥Part Aは未マージの[PR #2179](https://github.com/bingohooah888-ai/novelrise/pull/2179)を基盤とする。

## Part Bの変更

- 新規未適用migration `20261013152000_november_contest_session_proof.sql`：②のprivate読書セッションに`reading_mode`（`scroll` / `tts`）を追加。**セッション作成・heartbeat RPCはservice_roleだけ**が実行可能。一般読者・認証済み読者に直接実行を許可しない。
- `begin_read_session`：コンテストの`active/public_visible`、開催時間、reader、参加作品、公開エピソード、R15以内・人間執筆/AI補助、作者自読、時間あたり作成上限を検証。コンテスト`draft`では必ず拒否。
- `heartbeat_read_session`：送信されたsession IDとreader IDの一致、server clockによる8〜45秒の間隔、seqの連続性、server clockベースの前景秒数（1回あたり最大15秒）、0〜1の進捗、イベント操作回数を照合。`scroll`は30秒以上、`tts`は45秒以上、進捗80%以上＋操作1回以上を満たしたときだけprivate sessionを`qualified`にする。30分を超えたセッションは失効。**クライアント側の秒数だけで加点しない。**
- `qualified`は即時受賞点ではなく、Part Aのprivateイベント記録対象となる段階。審査⑦の完了まで**仮判定**であり賞金・ランキングを確定しない。
- 既存の小説本文、PV、SCOUT、LIGHT SEED、ランキング、作者投稿、通常の読み上げ挙動は変更しない。HTTP公開口や読者画面の呼び出しは未実装のため、今回の変更だけではユーザーの得点は増えない。
- `tests/rls/november-contest-integration.sql`に使い捨てDBのスクロール/読み上げ/前景なし/異なる読者ID/即時偽報告/自作/公開前拒否の契約テストを追加。`tests/november-contest-session-proof.test.mjs`にSQL静的契約を追加。controlled rollbackスクリプトも同梱。

## 安全性の限界と次工程

**ブラウザのスクロール率・visibility・読み上げ状態は偽装可能。** サーバー時刻とレート制限だけで実在の人間の読了は証明できない。⑦のBOT/多重アカウント・不正審査と、発行から加点までの継続的な監査が不可欠。

**このRPCを直接HTTPへ公開してはいけない。** 次に必要なのは、本人のSupabase Auth tokenをサーバー側で検証、匿名ゲストはHttpOnly+Secure+SameSite Cookie署名を検証し、サーバーが導出したreader IDだけをRPCへ渡すAPI。セッション所有権、Origin/CSRF保護、バースト制限、ログ最小化、プライバシーを確認してからUI連携する。**クライアントから任意のreader IDを送らせない。**

次はこの認証APIと、既存`episode.html`・`novelight-reader-tts.js`の実読書イベント接続、ゲスト→ログインの安全な統合を実装・検証する。⑤の公開承認や②既存テーブルの再適用を意味しない。

## 運用境界

- 新migrationは**Part A #2179の後**にしか適用できない。現段階はstacked Draft PRで、mergeとProduction migrationは未承認。使い捨てDBでのテストのみ実施。
- Vercel Preview / Supabase Stagingの追加費用を発生させない。
- master/契約の本番承認と、コンテストの受付開始承認を絶対に兼用しない。
