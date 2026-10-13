# NOVELIGHT 2026年11月コンテスト：工程⑥ 読書ポイント・サーバー集計基盤（作業案）

> **Production未適用／作業PR。** 読書イベント記録やポイント算出を本番で開始しない。応募要項の法的採択・応募受付・開幕を自動化しない。

## ⑤→⑥の順序例外（2026-10-13 オーナー決定）

⑤は「技術準備完了・公開待ち」とし、一般公開・応募受付・公開後の実応募/取消テストは依然**未完了**のまま⑥の開発を先行させる。正式応募要項の最終確認は最後に実施する。⑥の技術開発許可は本番承認、受付開始承認、11月1日の開幕承認にはならない。根拠：[管理Issue #2120](https://github.com/bingohooah888-ai/novelrise/issues/2120#issuecomment-6138596826)。

## Part A：得点集計コア（このPR）

- 新規migration `20261013150500_november_contest_reader_scoring_core.sql` は基盤②のprivate tablesを再利用し、専用の読書イベント・読者別作品得点以外に書き込まない。
- `novelight_contest_episode_points`：作品×読者の異なる有効話数が0〜2話なら0、3〜4話なら1、5〜9話なら3、10話以上なら5pt。段階の合計ではなく到達段階で置き換える。
- `novelight_contest_record_qualified_session`：既に**信頼できるサーバー処理でqualifiedと確定されたprivate read session**だけを受理する。公開済みの参加作品・作品内公開話・開催時刻・作者の自作読書・審査除外を再確認し、同一読者・同一話を一回のみ記録。UI・JSが送った任意の話数やポイントの自己申告は受けない。
- `novelight_contest_recompute_reader_score`：privateイベント台帳のprovisional/acceptedの話数から再計算。review_hold/excludedは得点に含めない。読者review_holdも0pt。**provisional点は仮ポイントで、入賞確定と混同しない**。
- 書き込みRPCは**service_role専用**。anon/authenticatedの関数EXECUTEを取り消し、基盤②のprivate tables/RLS/GRANTを維持する。
- 重複した読了セッション、繰返し呼出し、同一話の再読を採点増加につなげない。既存作品PV、SCOUT RECORD、LIGHT SEED、通常ランキングは一切更新しない。
- PostgreSQLの使い捨てmigration replayとrollback付きfixtureで3/5/10各閾値、10話上限、重複なし、ゲスト資格、作者自読拒否、審査保留、draft禁止、role権限、通常PV非変更を検証する。

## まだ実装していない範囲（Part B以降）

1. サーバー発行の読書セッション、実読了を判定するheartbeat/前景時間/進捗の真正性検証、ログイン読者とゲスト署名Cookieの発行と統合。**現段階では新規qualified sessionを一般読者が生成できず、得点は本番で発生しない。**
2. 読み上げ・通常スクロールとの整合、プライバシー告知と同意、通信断・再接続・マルチ端末・ゲスト→ログイン時の本人性検証。Cookieだけでは一人の実在を証明できないため⑦の不正対策と協調して設計する。
3. ⑦のBOT/多重識別子/不正読書リスク審査後に`provisional`を受賞対象の承認結果にする処理、⑧固定時刻スナップショット・順位生成。**現段階で公表ランキングや賞金確定に使用しない。**
4. コンテスト開始前の実運用通しテスト、停止/復旧、private→publicゲート、明示的な本番承認と本番migration適用。Preview/Staging費用は別承認が必要。

## リスク境界

- まだmigrationは未適用。現行Productionのコンテストは`draft/public_visible=false`・応募0件・規約版とURLが空。
- コードがmainに入っても、既存の②private schemaは読者が直接書けず、開催期間まで点数は加算されない。**ただしmain mergeはVercel本番処理を開始し得るため、事前にユーザーの明示「本番承認」が必要。**
- 現在の⑥は「サーバー集計コアを実装した」段階。⑥全体完了ではない。新たな本番migrationの適用にも正規Approval LedgerのOWNER承認が必須。
