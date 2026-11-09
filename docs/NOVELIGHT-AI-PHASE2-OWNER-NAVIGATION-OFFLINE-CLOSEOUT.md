# NOVELIGHT AI工程② — 作者限定章順・セッション整合 オフライン閉鎖範囲

状態: **Draft PR #2825 内のオフライン実装**。実JWT・実DB・Staging・Production・main反映はいずれも未実施。正式Gate A〜Eは0/5のまま。本書は実環境操作の承認を発行しない。

## 1. 既存の処理を再利用する

- `owner-novel-bible-preview.js`: 既存のowner-only作品カルテ。作者の正規資料と確認対象factsを返す。
- `owner-outline-internal-adapter.js`: 既存の本人確認、作品所有権確認、作者JWTを用いる章順RPC×2、`checkSession`×3。
- `owner-session-evidence.js`: 信頼できる署名検証済みJWT claims・`auth.sessions`存在証拠・サーバー時計を比較する未接続のオフライン部品。
- `owner-outline-read-window.js`: 章順データの読み取り前後差分をチェックし、公開状態や未公開タイトルを返却しない。
- `novelight-ai-bible-owner-outline.js` と作者の伏線・出来事インデックス: 既存のepisode ID→掲載話数のオフライン投影。物語内時系列は推定しない。

## 2. 今回追加した最小限の部品

- `api/_lib/ai/owner-private-session-reader.js`: 将来の**サーバー専用権限** `lookupOneSession({sessionId,actorId})` を受け取る。応答は厳密なboolean `true` のみ受理し、`false` / `null` / truthy object / 例外はfail-closed。入力はUUID2つだけ。内部で正規化した`{id,user_id}`形の**照合済み証明**に変換して既存`readExistingSession`契約に合わせる。これはDBから行を取得したという意味ではなく、将来の権限付き照会の真偽値を表す。
- `api/_lib/ai/owner-bible-offline-navigation.js`: 上記の読み取り能力を`createOfflineOwnerSessionCheck`に渡し、既存owner outline adapterを組み合わせる。**ネットワーククライアント作成やDB接続の本体は実装しない**。公開API/画面へimport・mountしない。
- `tests/ai-owner-bible-offline-navigation.test.mjs`: 合成認証・モック閲覧により、単一行boolean契約、全段連結、JWT/下書き非返却、logout前後、session rotation、所有者/別作品、期限、下書き公開状態の途中変更、匿名/例外時のfail-closed、キャッシュ無しを検証する。

## 3. 将来必要となるサーバー専用の権限・署名経路（**未実装**）

1. **事前確認（読み取り専用）**: Supabase project/region・料金プラン・JWT署名方式（JWKS非対称 / HS256）、既存Auth失効ポリシー、auth.sessions列・現行権限、サーバー側接続方式を確認する。秘密値は開示しない。
2. **署名確認**: `supabase.auth.getClaims(jwt)`等の正規の署名/issuer/audience検証済み結果だけを利用する。単純なJWTデコード・クライアント申告claims・user_metadataを権限判断に使用しない。HS256の署名検証はAuthサーバーへの問い合わせが必要な構成がある。
3. **最小権限照会**: 署名済み`session_id`とactor UUIDの組だけを受け取る、サーバー専用の行数1件/Boolean結果の照会を将来別承認で構築する。候補はDB側の安全なプライベートスキーマ・専用DBロール/狭いEXECUTE権限とパラメータ化照会。現時点で**専用ロール/プール/privilegeが利用可能かは未確認**。一般の`anon`/`authenticated`・ブラウザ・PostgRESTの exposed schemaからはアクセスさせない。汎用`public SECURITY DEFINER`や広い`auth.sessions` SELECTを採用しない。専用role/実DB権限の設計は別監査対象。
4. **判定条件**: 既存`getUser`・`novels.user_id`照合と、署名済み`sub`,`session_id`,`exp`,`iat`等を比べる。最初・章順RPC間・最後の3点で確認。失敗時は`null`、非公開データ/JWT/DB詳細を返さない。期限・公開設定・章順の最終RPC後の競合は別途トランザクション/版番号などの設計が必要。
5. **タイムアウトの限界**: `auth.sessions`の行存在だけでtime-box/inactivity期限内は証明できない。Supabaseは次のsession refreshで判断し、失効済み行が残る場合がある。ブラウザのローカルログアウトもサーバー上の失効と同義ではない。要求される保証水準はStaging計測と仕様判断が必要。

## 4. 費用・性能の上限

現状はオフラインのみで、新規Supabaseクエリ/外部AI/APIコストは**ゼロ**。将来接続時はprivate owner-onlyの閲覧時に最大3回の単一session照会、既存の本人・所有者照会×2、章順RPC×2を生じ得る。サーバーDB接続数、照会遅延/リージョン/プール上限、プロジェクトのSupabase利用枠およびエグレス・Vercel実行量を実測し、課金・性能の上限を設定する。全読者アクセスへ横展開しない。Pro以上で提供される一部のセッション期間制限を前提にしない。

## 5. 一括で実環境試験に進むための承認前ゲート

- [ ] Stagingだけで成立する専用server-only read capacityの証明・privilege一覧・`auth.sessions`に対する列/行スコープ検証
- [ ] JWKS/HS256分岐と署名/issuer/audience/expirationの実証、匿名・別作品・別ユーザー試験
- [ ] server signOut / browser-only signOut / time-box / refresh / mid-request revokeの異常系と機密防護証跡
- [ ] 最小限のアクセス回数・タイムアウト・接続上限・費用の確定
- [ ] 既存owner previewと章順の一致・下書き非公開・本番側と分離したStagingでのread-only E2E
- [ ] DB/Secret/権限・Preview/実JWT・本番反映は**対象ごと、1回限りの別承認**。本PRのコード承認はこれらに代替しない
- [ ] 不正参照/漏洩/タイムアウトに対する停止、ロールバック、事後残留権限検査
- [ ] Gate B/DPAPI凍結を維持し、別PR #2824・main・Productionへ影響しないこと

## 6. 公式仕様参照

- Supabase Auth User sessions: https://supabase.com/docs/guides/auth/sessions
- JWT getClaims: https://supabase.com/docs/reference/javascript/auth-getclaims
- Managing user data / auth schema isolation: https://supabase.com/docs/guides/auth/managing-user-data
- Securing Data API: https://supabase.com/docs/guides/api/securing-your-api
- Usage/egress: https://supabase.com/docs/guides/platform/manage-your-usage/egress

**適用判定**: オフラインの合成コード・テストを完成しても、Staging実動作・Production動作の証拠にはならない。
