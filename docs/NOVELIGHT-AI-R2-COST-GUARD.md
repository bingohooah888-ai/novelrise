# NOVELIGHT AI コストガード — R2 Gate B 準備仕様（未配備）

確認済みの作業開始時 main: `ff58694e9e5feb4b705f145d37a3db36e3924b7b`（2026-11-06）。後続のmain進行はPR側で別途最新差分を照合する。
OWNER意向: **無料枠に近づいた時点で警告し、追加課金前に新規処理を安全停止。再開はOWNERの個別判断**。

## スコープと現在の実証

- 対象: Cloudflare account `6831b18fe814232fa2dd4c470b95aa15` のR2 Standard storageとClass A / B operations。
- **R2契約のみ完了**。2026-11-06 JST、Cloudflareの確認画面で `Purchase complete / The subscription is active` を読み取り確認。別途R2 Overviewで **Bucket 0、保存量0 B、Class A/B 0、今期の請求対象使用額 $0.00** を読み取り確認。期間は表示上11月6日～12月6日。実環境リソースの作成・動作確認は別工程。
- これはローカルの**判定ロジックと管理画面通知導線・事前予約プラン**。Bucket・D1・Workerの作成、クラウド用資格登録、実データ取得、R2物理停止、メール配信は **未実施**。
- カード登録は完了したが、無料枠超過分は原則自動請求。「超過してから承認」はCloudflareに存在しない。**現在のPRをマージしても利用料金が止まる状態ではない**。
- Gate A～Eは従来通りNO-GO。Gate Aの合成証拠の再試験やDO3件削除を目的としない。

## 判定の契約（ローカルコード）

| 対象 | Standard無料枠 | 70% | 85% | 90% |
|---|---:|---:|---:|---:|
| 保存量 | 10 GB-month / 月 | 注意 | 緊急予告 | 新規対象処理停止を要求 |
| Class A | 100万操作 / 月 | 注意 | 緊急予告 | 新規対象処理停止を要求 |
| Class B | 1,000万操作 / 月 | 注意 | 緊急予告 | 新規対象処理停止を要求 |

- 各指標を**独立して**評価。一つでも90%以上なら停止要求。80%などの数値を他指標と合算しない。
- **10 GB-monthは瞬間的な10 GBの容量制限とは異なる**。R2の請求期間全体のGB-month実測のみを使用。カレンダー月を推測してカウンタをリセットしない。
- Cloudflare側の公式計測は非同期・反映遅延があり得る。数字の急増、同時実行、単位丸め、保存継続の影響により、90%停止だけで追加請求ゼロを保証することはできない。実運用では追加の悲観的なローカル予算予約と十分な安全余裕を設ける。
- Infrequent Accessは無料枠対象外。クラス不明・未対応クラス混在、アカウント全体未集約、未検証の永続停止機構、欠損・負数・古いデータ（15分超）、請求期間不一致・通信障害は「未検証」とし、**新規課金対象のAI処理を許可しない**。
- 「停止を要求した」と「クラウド側で停止済み」は**別の状態**。実停止の証拠なしに「停止済み」と表示しない。
- 監視の `admissionPermitted` は常に `false`。正常表示やローカル予約プラン `eligible-for-atomic-reservation` は実際のR2操作許可ではない。原子的に永続化した操作前予約が未実装なら無条件で拒否する。
- `r2-cost-guard-reservation-plan.js` は**オフラインの試算のみ**。今期の既使用GB-month、アカウント全体のStandard保存総バイト、これからの保存期間、予約済みClass A/B操作と追加バイトの全てが分からなければ拒否。別経路の直接R2アクセスや解析遅延を制御する本物の停止装置ではない。
- 既に停止状態なら、翌月の利用量が0でも自動解除しない。

## 必須の実環境実装（未着手・別承認）

1. **契約**: 完了（2026-11-06）。追加の有料プラン移行や課金上限引き上げは未承認。
2. **計測**: CloudflareのR2 Analytics GraphQLからアカウント全体の**Standard**保存量/操作数を取得。請求境界と日次ピーク、遅延を把握し、操作前のローカル利用予約と定期照合。R2の他サービス経由操作・S3 API直接操作も必ず対象にする。
3. **停止**: 監査記録R2書込みの**直前**に、D1等の原子的・永続化済みadmission gateで操作種別と予約数を判定する。停止判断や永続化に失敗した場合はAIの新規処理自体をfail closed。監査なし実行禁止。停止にはR2読み書きの残った経路も考慮する。権限分離し、制限外の直接アクセスを禁止。
4. **通知**: 認可済みの運営管理画面に緊急表示を設置済みの導線に接続し、別途メール送信経路を構築。停止確認、測定鮮度、停止原因、対象指標を表示。通知失敗時でも停止は維持する。
5. **再開**: OWNERの個別承認で対象期間・対象費用・正確な操作を記録して解除。管理画面の単なる表示・押下で課金承認とみなさない。承認後も既存Gate A～Eの実証要件を維持。
6. **試験**: Cloudflareの契約・Bucket・D1・Worker・Secret・Stagingを実際に変更する前に、それぞれの対象限定承認を要求。実環境で並行リクエスト、誤単位、グラフの遅延、失敗時停止、他経路からの直接書込み禁止、メール配信、後片付けを個別検証する。Productionへは無断反映しない。

## 接続インターフェース（未接続）

- サーバー用環境変数: `NOVELIGHT_CF_R2_COST_GUARD_STATUS_URL` と `NOVELIGHT_CF_R2_COST_GUARD_STATUS_TOKEN`。
- URLは `https://<dedicated-worker>.workers.dev/internal/novelight-cost-guard/status` に限定。Bearer tokenはサーバー内のみ、管理画面へ返さずログにも残さない。
- 状態API `GET /api/admin-ai-cost-guard` は既存管理者認証と同一権限。未接続時は `not-configured` と表示し、監視・停止できていると偽らない。
- ステータスSnapshotは `source: cloudflare-r2-account`, `scope: account`, `storageClass: STANDARD`, 請求期間UTC start/end, `observedAt`, `usage: {storageGbMonth,classAOperations,classBOperations}`, `enforcement: {allAccountR2OperationsCovered,durableAtomicStopVerified,state}`。必須項目の欠損時はfail closed。
- 運営HOMEの状態は最初と画面表示中の60秒ごとに読み直す。**ブラウザーの定期取得は停止機構ではない**。裏側の永続的な admission/監視処理が実装・実証された場合のみ実運用に切り替える。

## 費用とCloudflare側の限界

- R2 Standard: 10 GB-month, Class A 100万, Class B 1000万 / 月の無料枠。超過は有料。Cloudflare公式: https://developers.cloudflare.com/r2/pricing/
- Cloudflare Budget Alertは通知のみで支出の強制上限ではない。https://developers.cloudflare.com/billing/manage/budget-alerts/
- D1（Workers Free）は**既存Free枠内では**1日500万行読取、10万行書込、全DB合計5GB、DBは10件まで・1DB最大500MB。無料枠超過はクエリ拒否される。https://developers.cloudflare.com/d1/platform/pricing/ と https://developers.cloudflare.com/d1/platform/limits/
- Workers Freeは1日10万リクエスト上限、超過時のfail-open設定は安全ゲートに不適切。**必ずfail-closed**。https://developers.cloudflare.com/workers/platform/limits/
- 新規R2 Bucket 1個の作成自体は現行の無料Bucket枠内。ただしその後のR2保存・操作は超過課金対象。2026年版R2ではアカウント10万Bucket超が有料。https://developers.cloudflare.com/r2/pricing/
- Cloudflare Spend Policiesのusage_block対象はWorkersとDurable Objectsで、**R2のブロックは対象として示されていない**。R2の原価ゼロ保証に流用しない。https://developers.cloudflare.com/api/resources/billing/
- アカウント全体でR2を他機能が使う場合、単一Bucketだけを監視していても請求保護にならない。管理画面に出る利用率はあくまでAPIの観測値であり請求確定値ではない。

## 依頼外変更・承認境界

- このコードの完成は **コード実装／ローカル試験** に限られる。Staging実証・Production反映を完了と記載しない。
- 本PRのmain統合、Cloudflare D1/R2 Bucket/Worker作成、課金設定、Secrets、Staging Preview/DB、Production反映は各scopeに対する独立のOWNER承認が必要。R2**契約そのものは完了済み**で承認待ちではない。
- 次の候補は**Workers Freeに限定したGate B用D1台帳DBの新規作成1回**。現行Free枠に収まること、既存D1 0件、CPU・1日読書き制限などを事前に再確認してから、DB名・対象アカウント・無料枠・削除範囲・0リクエストを示した専用OWNER承認を受ける。許可が出てもBucket・Worker・Secret・Stagingを続けて作らない。
