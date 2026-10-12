# NOVELIGHT 第1回コンテスト — ⑤エントリー受付開始 Runbook

**現在の状態：工程②③④と⑤準備の本番反映・Production DB migrationは2026-10-12に完了。一般公開・エントリー受付は未承認／未実施。**

## 3段階の独立した承認（決定済み）

1. **本番承認：コードとDBの安全な本番反映のみ。** `novelight_contests.status='draft'`、`public_visible=false`を維持する。公開ページはルート直叩きでも404、作品応募RPCは拒否、ホームバナーは非表示。これだけではエントリー受付は始まらない。
2. **受付開始承認：別の明示的な承認。** 必要な規約・技術検証後、同一トランザクションで`status='registration', public_visible=true`をセット。これで初めて特設ページ／告知が一般に見え、応募も可能になる。
3. **11月1日開幕：読書ポイント計測を開始。** ⑥読書ポイント・⑦不正対策・⑧ランキング等を本番で検証し、開幕操作を別途承認する。②〜⑤だけを本番反映してもポイントは加算されない。時刻到来を根拠に仮の集計を有効化しない。

**本番承認＝受付開始承認ではない。二つの承認を絶対に自動連結しない。**
特設ページの公開防御はブラウザCSS・リンク非表示ではなく、Vercelサーバー関数 `/api/contest-page` とDB `public_visible` の両方で判定する。`/contest.html` と `/contest` を同じ関数へrewriteし、rootに静的 `contest.html` を配置しない。DB未接続・設定欠落・認可失敗は404で非公開とする。


## 2026-10-12 実施済みの本番作業（再実行禁止）

- 統合PR #2135 merge main SHA `76edd9083aecc68124c2299edb2a8d12b60ee450`。Vercel Production build status成功。
- Supabase Productionにマイグレーション3件 `20261012130000`、`20261012131000`、`20261012132000` 適用成功（Production Approval Ledger #1433、workflow `38192350962`）。
- DB read-only確認：`draft / public_visible=false`、応募0件、公開カタログは`contest_unavailable`。
- HTTP read-only確認：`/contest.html`、`/contest`、`/api/contest-page` すべて404。
- 本リリースの『本番承認』は終了。**別途『受付開始承認』が出るまで公開操作を禁止する。**

## Source of truth / implementation order

1. Issue [#2120](https://github.com/bingohooah888-ai/novelrise/issues/2120) の12工程を確認する。
2. ②〜④および⑤の準備は統合PR #2135を通じて本番反映済み。旧スタックPR #2121/#2124/#2126/#2127は新規マージ不要。今後も `public_visible=false` を維持し、一般公開をしない。
3. ⑤はエントリー受付開始と告知のみ。⑥読書ポイント、⑦不正対策、⑧ランキング、⑨管理画面、⑩総合テストを勝手に先行実装しない。
4. `main`・MASTER・Production revision・pending migrations・PR head SHA は**実行直前**に読み直す。古いSHAで承認・実行しない。
5. mainへのmergeがProduction deploymentを起動する場合、**mergeの直前に明示的な「本番承認」**が必要。Staging / Preview費用は別途「ステージング承認」が必要。

## Product decisions already approved

- 受付締切：2026年10月31日23:59:59.999999 JSTまで（11月1日0:00開始時には締切）。
- 競技期間：2026年11月1日0:00〜12月1日0:00未満、JST。
- 各作者は自身の公開済み10話以上の作品1つだけ応募。既存作品・新作どちらも可。
- 入口①：コンテスト特設ページ。入口②：「自分の作品」の各作品カード。
- ゲスト読者の有効読書も対象。3/5/10異なる話で各1/3/5pt、最大5pt（段階置換、加算しない）。
- 上位5位以内各1万円（5位以内の同点は各作品受賞）。手動で楽天銀行から振込。
- 中間順位公開：11月7日12:00／15日12:00／22日12:00 JST。各発表から次回まで固定、11月30日まで表示。
- 本コンテストの得点・ランキングは通常PV、SCOUT XP、LIGHT SEEDと分離。

## 募集開始までの未確定・規約公開ゲート

作業用募集要項草案：`docs/reports/NOVEMBER-CONTEST-STEP05-PUBLIC-TERMS-DRAFT.md`。運営決裁シート：`docs/reports/NOVEMBER-CONTEST-STEP05-DECISIONS.md`。**どちらも未公開であり、未決裁欄がある間はサイトへ公開不可。**

現行本番コンテストカタログはR18専用ゾーン／R15の非表示設定を独立して検証していない。**非公開開発ブランチ `fix/november-contest-step05-zoning` に既存一般ゾーンとR15設定を守るSQL/JS修正・独立テストを作成中だが、本番反映済みではない。** R15/R18・AI生成主体の応募許可・公開時の取り扱いの決裁は別途必要であり、決裁と修正検証の完了まで受付開始禁止。

次は勝手に仮定せず、運営が募集要項を公開する前に明記・確認する。

- 0ptの作品の入賞対象性：上位5位以内でも有効読書0の場合をどう扱うか。
- 年齢制限・R15/R18の参加資格と作品一覧の表示区分。既存サイトの年齢警告・ゾーニングを必ず維持する。
- 同点の順位表示方法（共同○位）と賞金総額の上限なし条件。
- 応募作品が10話未満に戻った場合・非公開／削除された場合の失格または再応募条件。
- 賞金受領資格、国内・海外の銀行振込、振込先情報の安全な収集方法、税務・法令遵守、受領期限。
- 広告・宣伝の許容範囲、運営／本人／関係者による自演読書禁止、不正審査の証拠・異議申立期間・結果確定時期。
- コンテストの中止・延期、規約変更、応募作品の権利保持、審査結果の通知。

未確定事項を決定したふりをして公開したり、既存の利用規約に書かれていることにしたりしない。

## 受付開始前に確認する条件

### 技術

- [ ] 最新main上で②③④の差分とmigrationの依存を確認。重複migration versionがないこと。
- [ ] Nodeテスト、Formatting、Lint、RLS integration、rollback、CodeQL、署名付き承認ゲートを確認。GitHub CIが未実施なら「成功」と書かない。
- [ ] データベースのowner-only RPCで、本人の10話以上作品のみ応募可能。他者作品や9話の作品は不可能。
- [ ] 同時アクセス／連打で1作者1作品の一意制約が破れない。
- [ ] 状態 `draft` か `public_visible=false` 時は応募不可。受付開始操作はサービス権限だけで実施。
- [ ] 直接URL `/contest.html`、`/contest`、`/api/contest-page` のすべてが非公開状態で404を返す。rootに静的HTMLなし。
- [ ] 未公開状態の匿名RPCは参加作品を一件も返さない。ホームバナーも表示しない。
- [ ] 受付前は公開作品一覧が空、受付後は公開作品かつ10話以上の参加作品だけ表示。
- [ ] 登録が行われても `novels.pv`、SCOUT、LIGHT SEED、既存Rankは変わらない。
- [ ] 未ログインで作品を読める。作者専用操作はログイン必須。閲覧年齢区分を守る。
- [ ] 別端末・PC/スマホ、閉じる／再開、作品変更／取消と締切瞬間（JST）の動作。
- [ ] 参加ボタンがページの2入口で見つけやすく、押せる状態になる。公開導線／ヘッダーのリンクは別途リリース時確認。
- [x] 統合PR #2135と3件のProduction migration適用を2026-10-12に確認。以後の本番操作直前には再照合。障害時ロールバック手順を確保。

### 運用

- [ ] 公開募集要項・個人情報の取扱い・賞金規約を最終確認。
- [ ] 正式コンテスト要項の同意方法・適用版・同意記録（応募者に適用した版）の扱いを決定。未実装のまま「同意取得済み」と表現しない。
- [ ] ドラフト開発 `20261012134000_november_contest_terms_consent.sql` の実DB検証・本番承認・migration適用を確認。正式規約版と公式URLを管理設定し、全応募で同意記録を確認。未承認・未反映なら受付開始不可。
- [ ] 受賞者口座情報・コンテスト読者識別子の収集、保存、廃棄、案内を既存プライバシーポリシーと照合。
- [ ] R15非表示設定とR18専用ゾーンを、コンテストカタログの一覧でも維持する実装・確認。未解決なら一般公開しない。
- [ ] X告知文、正式URL、参加導線、FAQ、問い合わせ先、応募締切の正確な日付を準備。
- [ ] 賞金5万円＋同点による増額を予算上許容。
- [ ] 登録人数・応募作品・不正疑義を監視できる連絡体制を確保。

## 受付開始手順（**別途「受付開始承認」後にのみ実行**）

**Productionの現在状態を先に read-only で確認する。** `draft` であること、受付期間内であること、②③④がその環境に正しく反映されていることを検査する。

READ ONLY:
```sql
select contest_key, status, public_visible, entry_deadline_at, starts_at, ends_at
from public.novelight_contests
where contest_key = 'novelight-november-2026';
```

非公開基盤の「本番承認」は既に実行済みであり、その承認を受付開始へ流用しない。募集規約・ゾーニングなど公開前の決裁がすべて完了した後、ユーザーの明示的な**受付開始承認**を得たときだけ、今回の公開変更をProduction approval flowに従って実行する。owner署名等の安全ゲートを飛ばさない。

受付開始の操作イメージ（自動実行禁止、責任者が実行直前に再確認）：

```sql
begin;
do $$
declare
  v_updated integer;
begin
  update public.novelight_contests
     set status = 'registration', public_visible = true,
         updated_at = pg_catalog.clock_timestamp()
   where contest_key = 'novelight-november-2026'
     and status = 'draft'
     and pg_catalog.length(pg_catalog.btrim(terms_version)) between 1 and 64
     and terms_url ~ '^https://novelight[.]jp/[^[:space:]]+$'
     and public_visible = false
     and pg_catalog.clock_timestamp() < entry_deadline_at
     and pg_catalog.clock_timestamp() < starts_at;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'CONTEST_REGISTRATION_OPEN_BLOCKED';
  end if;
end
$$;
commit;
```

操作後にread-onlyで `status='registration' AND public_visible=true` を確認し、作者の**同意済みテストアカウント**で実応募・取消の疎通を確認。投稿者の通常作品を勝手に変更しない。公開済みキャンペーンページからの2入口、応募後の更新、ゲスト側の公開作品一覧をチェックする。

## 障害発生時

- 作品公開や通常PVを止めずにコンテストのみ停止させる。必要な場合は運営判断と承認により**同一トランザクションで** `status='draft'` または `status='cancelled'` と `public_visible=false` を設定する。進行中応募を消さず、監査証跡を保持する。
- 異常応募の行を一律削除しない。読者のCookie、本人確認情報等の個人データは適正な保護と最小限の取得を行う。
- 既存サイトのAuth/RLSと通常読書を最優先に復旧する。
- 受付停止・再開、延期、規約変更は運営が告知してから実施。

## 次工程への受渡し

⑤の「受付開始」完了は **Production上で登録状態を開始し、応募・取消のスモークを終えたときだけ**とする。コードを作っただけではチェックしない。受付前に工程⑥以降を進めた場合でも、⑤の本番公開が完了したことにはしない。

受付開始後、⑥読書ポイントシステムへ進む。⑦の先行PR #2119はその工程まで保留。

     and status = 'draft'
     and public_visible = false
     and pg_catalog.clock_timestamp() < entry_deadline_at;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'CONTEST_REGISTRATION_OPEN_BLOCKED';
  end if;
end
$$;
commit;
```

操作後にread-onlyで `status='registration' AND public_visible=true` を確認し、作者の**同意済みテストアカウント**で実応募・取消の疎通を確認。投稿者の通常作品を勝手に変更しない。公開済みキャンペーンページからの2入口、応募後の更新、ゲスト側の公開作品一覧をチェックする。

## 障害発生時

- 作品公開や通常PVを止めずにコンテストのみ停止させる。必要な場合は運営判断と承認により**同一トランザクションで** `status='draft'` または `status='cancelled'` と `public_visible=false` を設定する。進行中応募を消さず、監査証跡を保持する。
- 異常応募の行を一律削除しない。読者のCookie、本人確認情報等の個人データは適正な保護と最小限の取得を行う。
- 既存サイトのAuth/RLSと通常読書を最優先に復旧する。
- 受付停止・再開、延期、規約変更は運営が告知してから実施。

## 次工程への受渡し

⑤の「受付開始」完了は **Production上で登録状態を開始し、応募・取消のスモークを終えたときだけ**とする。コードを作っただけではチェックしない。受付前に工程⑥以降を進めた場合でも、⑤の本番公開が完了したことにはしない。

受付開始後、⑥読書ポイントシステムへ進む。⑦の先行PR #2119はその工程まで保留。
