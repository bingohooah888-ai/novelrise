# NOVELIGHT AI 02-07-05 Gate A — signed Watchdog one-use admission OFFLINE handoff

基準: mainにある独立Watchdog受領証の形状検査、署名検査、独立停止の合成試験を維持する。**この文書・コードだけでGate AをPASSにしない。**

## 今回追加した契約（実環境未接続）

- 署名付き受領証を検証した**後**にだけ、保護Runnerから注入された \`consumeChallengeOnce\` を呼ぶ。独立した信頼根（公開鍵・key ID・Challenge nonce）をRunnerが持つことが前提。受領証自身やその配信者から信頼根を採用しない。
- 消費要求には repository、Staging project、main SHA、Preview ID、actor、novel、episode、GitHub run ID、OWNER approval comment ID、controller key ID、challenge nonce を結び付ける。正しい署名でも一回限り消費が失敗した場合、モデル呼出しには進まない。
- 消費済みか不明、消費APIの例外、署名不一致、古いHeartbeat、lease期限切れ、消費後の期限切れ、時計の逆行はfail closed。失敗で同一nonceを再利用しない。
- Node単体試験では**メモリ内の合成Set**で重複・同時実行20件・改ざん・消費中期限切れを模擬。実装は読み取り専用モジュールで、既存RunnerとWorkflowの起動経路は変更しない。

## 実実装前の必須条件 — 全て未確認 / NO-GO

1. **信頼根**: Runnerとは独立したOWNER承認済みcontrollerが秘密鍵を所有し、保護されたRunnerの固定公開鍵とkey IDの配布が外部証拠で確認できること。Secret値や秘密鍵はPR/ログに出さない。
2. **原子的消費**: ChallengeはRunnerの正確なSHA・scopeに合わせ外部で新規発行し、永続・一意の条件付きclaimで複数Runner/別job/再起動にまたがる再利用を拒否すること。メモリSet、コメント、boolean stubは不可。失敗・中断時もclaimを戻さない。
3. **独立停止**: RunnerのSIGKILL後に外部controllerが残ること、実際のモデル処理停止、Staging AI OFF・4予算0、合成Auth/JWT revoke、fixture cleanupと**独立zero census**を実権限で証明すること。Runner内finallyだけは不可。READ ONLY監視とkill権限の役割を分離すること。
4. **隔離/費用**: Productionと別のStaging専用project・認証・Preview・Provider資格/請求/10円上限/合成原稿1話1chunk/60分/リトライなしを各対象の別承認で検証すること。実AI・Staging・Preview・Secretへ自動移行しない。
5. **承認**: 今回のオフラインコードPRの統合は、head SHAを固定した別の本番承認が必要。Staging/外部controller配備/新Preview/Secret/実JWT/有料AIの実行承認を兼ねない。

## 安全な既存成果物

- \`.github/staging-ai-02-07-05/independent-watchdog-arm.mjs\` — scope/lease形状
- \`.github/staging-ai-02-07-05/signed-watchdog-arm.mjs\` — Ed25519とchallenge照合
- \`tests/ai-020705-independent-process-offline.test.mjs\` — runner SIGKILL後の合成独立停止
- 今回の \`watchdog-arm-one-use.mjs\` と専用Nodeテスト — 一回限り消費の注入契約とfail-closed

**現段階：コード実装・合成CIは判定可能、Stagingの独立制御・実モデル停止は未実証、ゲートA/C・工程②はNO-GO。**
