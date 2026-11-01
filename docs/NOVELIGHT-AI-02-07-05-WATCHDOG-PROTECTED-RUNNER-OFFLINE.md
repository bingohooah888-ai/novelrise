# NOVELIGHT AI Phase 2: Watchdog/Protected Runner A・C オフライン引継ぎ
基準main：`219a5b4423cc01798eb3ef982111f64b26e64adb`。正式 `docs/NOVELIGHT-AI-PHASE2-CLOSEOUT-GATES.md` のゲートA・Cに従う。

## 本PRの安全な差分
- 保護Runnerの既存6証拠に続き、独立Watchdogのarm受領証を**GitHub OWNER CLAIM・DB claim・モデル呼出しより前**に検査する。欠落・例外・Scope差・他環境・古いHeartbeat・独立停止能力未確認は拒否する。
- scopeはmain SHA、承認コメント、run ID、Preview ID、Staging、合成ユーザー・作品・話数で固定。観測・heartbeatは15秒以内、arm leaseは最大30秒、Runner自身による自己証明は禁止。
- テスト用データは合成のみ。例外を固定エラーへ正規化し、秘密値やモデル出力を記録しない。
- `.github/workflows/ai-020705-owner-staging-paid-trial.yml` は OFFLINE PREFLIGHT ONLY のまま変更しない。実行入口・外部API・秘密値・DB書込みは一切追加しない。

## このPRで完成しないもの（NO-GOの理由）
- 受領証の**発行元認証・独立コントローラの実配備・外部kill権限**は未実装。オブジェクトの形が合うだけでは本物のWatchdogを証明できない。実Runnerに接続するときは独立保護経路で証拠を認証し、別々の資格を使用する。
- Runnerが異常終了しても自律停止できる監視（heartbeat、kill、Staging AI OFFと4予算0、合成Auth撤回、fixture cleanup、独立zero census）、失敗時の二重監査は実環境で未実証。Runner内finallyだけでは不十分。
- Staging Preview、実JWT、実AI原価・請求、Provider Secret、DBの変更、Productionへの統合はそれぞれ既存OWNER承認ゲートが必要。
- **本PRのCI成功はゲートA/C実環境PASSでも工程②完了でもない。** 別の承認までNO-GO、1回有料試験は起動しない。

## 次の受入れ条件
1. 独立コントローラの信頼できる認証済み受領証をProtected Runnerへ接続し、SHA/Preview/one-use claim等を照合。
2. Watchdog消失・資格不備・heartbeat期限切れがGitHub CLAIM/DB/モデル前に拒否されること。
3. Runner kill後、外部コントローラが実際に停止・撤回・清掃・独立zero censusを実行できること。
4. その後のみ、最新SHAでの限定Staging実JWT・合成原稿1回実AI試験を各別承認で行うこと。
