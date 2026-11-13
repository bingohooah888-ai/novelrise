# NOVELIGHT 正式版：正規Point台帳・LEVEL100・返金 一括実装記録（2026-11-11）

## 今回増えた機能（非公開・オフライン）

- 既存 public.scout_point_ledger の確定済み残高を正式版ウォレットの「利用可能＋予約中」と照合。未承認の10倍換算や残高不一致は利用停止し、β期間の旧単位を勝手に換算しない。
- 既存 private scout_level_state と public.scout_xp_ledger を読者のLEVEL100表示に接続。現レベル・最高到達・次レベル必要XP（Lv.30以降400）・現在の30日間の確定XP／維持条件200・次の維持判定日時を返す。期限超過／負の調整があれば実証なしに確定レベルと表示しない。
- 正規Point履歴を読者の獲得・消費・返金表示に変換。未決済の予約と解除済みの申請は非公開利用履歴を合成して表示。確定したPoint消費を二重表示しない。
- 交換・AI使用のPoint予約時は正規台帳に減算せず、引渡し／利用成功が独立して確認された時だけ同一PostgreSQLトランザクションで確定減算する。
- 返金証跡・元の確定取引を検証した時だけ、正規台帳に元の減算を reversal_of 参照した加算として追記し、正式版交換対象Pointの元の配分を戻す。予算枠は自動再加算しない。
- 管理者向け未公開画面に確定済みの返金候補と「返金・回収を照合」の操作を追加。既存Supabase Auth/管理者Allowlistのサーバー確認を再利用し、ブラウザーからの架空の返金承認・ユーザーID指定は拒否。
- 正式読書・コメント・初回レベル到達の正規Point発行直後に、同一トランザクションで私有ウォレットへクレジットするDraft SQL接続。canonical Point ID を一意キーとして二重加算を防止。

## 変更した主な箇所

- 新設 api/_lib/reader-reward/formal-canonical-reader.js
- 改修 api/_lib/reader-reward/formal-usage-postgres-repository.js、formal-usage-host.js、formal-usage-service.js、formal-usage-http.js、formal-usage-offline-repository.js
- 改修 assets/formal-scout-reward-admin.js
- 改修 docs/drafts/SCOUT-FORMAL-POINT-USAGE-PRIVATE-DRAFT.sql、SCOUT_FORMAL_EARNINGS_ATOMIC_DRAFT.sql、SCOUT_FORMAL_XP_CUTOVER_DRAFT.sql（すべて未適用）
- 追加・改修テスト：正規LEVEL/XP・台帳照合・DB同一トランザクション・返金・管理者確認

## MASTER準拠と未実証事項

- OWNER 2026-11-09の「まず機能実装を完成→総合安全検証→限定試用・公開」を優先し、追加Watchdog／保護Runner／Workflowは作成しない。
- 10 Point＝1円、外部最低30,000 Point、βPointは外部交換不可、AIはPoint直接消費。未決定の事業者・運営予算・AI価格・βPoint引当順は仮決めしない。
- 作成したDB操作コード／SQLは実行していない。**Staging・Production DB未接続、実PostgreSQLの競合・RLS・ロールバック検証未実施**。模擬トランザクションは正式な実環境証拠ではない。
- 正式版のβPoint10倍切替、ウォレット初期シード、既存正規台帳との一括開通、他writerとの同時負の調整・撤回、実ギフト提供事業者と返金検証、実AI worker／価格／AI費用上限、法務・税務、公開前の統合監査が残る。
- 未登録Server factory／非公開プレビューのみ。新規PR、main統合、本番・Staging DB変更、実Point発行、外部交換、AI実行、公開切替はしていない。
