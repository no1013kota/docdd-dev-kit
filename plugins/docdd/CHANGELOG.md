# 変更履歴（docdd）

版ごとの変更と、プロジェクトに置いた雛形への影響をまとめます。
「雛形への影響: あり」の版へ上げたら、プロジェクトのフォルダで `/docdd:update-kit` を打ちます（プラグインを更新しただけでは、置いた雛形は変わりません）。

## 0.16.0（2026-09-30）

**`AGENTS.md` の「キット共通の約束」を、決まりを変えずに短くした（6,637字 → 5,827字、約12%減）。**

仮説: 「キット共通の約束」は Claude Code と Codex が会話のたびに読み込む。言い回しの重複を削れば、毎回の読み込み量が減る。見出し・表の行・番号付きの項目・決まりの中身は変えないので、読んだ AI の動きは変わらない。

### 変更

- `templates/AGENTS.md` の「キット共通の約束」: 見出し・表の行の名前・番号はそのままにして、説明の重複と言い換えだけを削った。
  - 前提（530字 → 463字）・最重要ルール（655字 → 510字）・開発の進め方（1,433字 → 1,216字）・変更影響 → 必須の検証（2,825字 → 2,513字）・Definition of Done（433字 → 411字）・規約（543字 → 496字）。
  - 「変更影響 → 必須の検証」の表のあとの注意（公開先・migration・戻し方・実物を1周）は、段落から箇条にした。

### 雛形への影響: あり

- `/docdd:update-kit` で置き換わる: `AGENTS.md` の「キット共通の約束」（印の間だけ）と、検査スクリプト 5 本（刻印だけ）。

### 今回やらなかったこと

- evals（`claude plugin eval`）: 言い回しを短くしただけで決まりを変えていないため、運営者の判断で回していない。
- 「変更影響 → 必須の検証」の表を `docs/` へ移す案: `docs/` は利用者のファイルで update-kit が置き換えないため、表の改善が届かなくなる。GitHub Actions の AI はプラグインを持たないので、プラグインの中へ移すこともしない。

## 0.15.1（2026-09-26）

**未記入欄の検査が、埋める欄ではない `{{…}}` を拾わないようにした。**

仮説: `{{…}}` は AI へ渡すプロンプトの本文（`{{変数}}` の埋め込み）や、終わったタスクの控えに出てくる。これを「未記入」と数えると検査が永遠に赤くなり、本当の未記入が埋もれる。

### 変更

- `scripts/check-doc-placeholders.mjs`: `tasks/archive/`（終わったものの控え）を検査しない。
- 同: 文書の中に `<!-- docdd:placeholders:off -->` と書くと、その文書を検査しない（`{{…}}` を別の意味で使う文書用）。
- 同: `.docdd/manifest.json` に `"placeholdersIgnore": ["docs/prompt/**"]` を足すと、そのパスを検査しない（本文に印を書けない文書＝コードの定数と一字一句そろえる必要があるプロンプトなど、フォルダごと外したいとき）。`/docdd:update-kit` はこの設定を消さない。

### 雛形への影響: あり

- `/docdd:update-kit` で置き換わる: 検査スクリプト 5 本（`check-doc-placeholders.mjs` は中身、ほかは刻印だけ）と、`AGENTS.md` の「キット共通の約束」（印の版だけ）。
- `docs/README.md` の検査の表に、印のことを 1 行足した（手付かずなら update-kit が足す）。

## 0.15.0（2026-09-26）

**配布元の名前を `docdd-dev-kit` にした。**

仮説: Codex でも同じように使えるようになったので、道具の名前を含まない短い名前のほうが、どちらの道具から入れるときも迷わない。

### 変更

- 配布元（マーケットプレイス）の名前は **`docdd-dev-kit`**、GitHub のリポジトリは `no1013kota/docdd-dev-kit`。入れ方は [README](./README.md#入れ方) のとおり。
- プラグインの名前（`docdd`）とスキルの呼び方（`/docdd:…`・`$docdd:…`）は変わらない。

### 雛形への影響: あり

- `/docdd:update-kit` で置き換わる: 検査スクリプト 5 本（刻印だけ）と、`AGENTS.md` の「キット共通の約束」（印の版だけ。文面は変わらない）。
- そのままでよいもの: `docs/PRD.md` の冒頭にある見本へのリンク（いまのままでも開ける）。

## 0.14.0（2026-09-26）

**Codex でも同じスキルが使えるようにした。約束と表は `AGENTS.md` の 1 か所にまとめた。**

仮説: 手順書（スキル）・見張り（hook）・雛形はそのままで、「毎回読む約束」を Claude Code と Codex が共通で読む `AGENTS.md` に移せば、どちらの道具からでも同じ流れで進められる。ファイルを二重に持たなければ、どちらで直しても食い違わない。

### 追加

- **Codex 対応**: `codex plugin marketplace add no1013kota/docdd-dev-kit` → `codex plugin add docdd@docdd-dev-kit` で入り、`$docdd:init` のように `$` で呼ぶ（Claude Code は `/docdd:init` のまま）。スキル 14 本はそのまま動く。Codex 用の hook（`hooks/codex-hooks.json`）を同梱し、取り消しにくい git 操作と秘密の値の入ったコミットは Codex でも止める（Codex では `/hooks` で信頼するまで動かない）。Codex には「確認を出す」が無いので、`rm -r` などは注意書きを返す。
- `AGENTS.md` が 30 KiB を超えたら、init が知らせる（Codex は 32 KiB までしか読まず、超えた分＝末尾の約束が切れるため）。
- 運営者が自分で打つスキル（init・release・update-kit）は、Codex でも会話の流れで勝手に動かない（`agents/openai.yaml` の `allow_implicit_invocation: false`）。
- 同じプロジェクトを Claude Code と Codex で併用できる（約束も表も `AGENTS.md` の 1 か所にあるため）。

### 変更

- **`CLAUDE.md` と `.claude/rules/docdd-kit.md` を `AGENTS.md` にまとめた**。`AGENTS.md` の下半分に「キット共通の約束」が印（`<!-- docdd:rules:begin -->`〜`<!-- docdd:rules:end -->`）で囲んで入る。`CLAUDE.md` は `@AGENTS.md` を読み込む 1 行だけになる（Claude Code は `CLAUDE.md` があると `AGENTS.md` を読まないため）。
- init の `--claude-md` は `--agents-md` になった（`--claude-md` も当分は受け付ける）。status・apply の JSON の `claudeMd` は `agentsMd` になった。
- 既に自分の `CLAUDE.md` があるプロジェクトでは、その中身を消さず、末尾に `@AGENTS.md` の 1 行だけを足す（表と約束は新しい `AGENTS.md` に入る）。

### 雛形への影響: あり

- `/docdd:update-kit` が一度に入れ替える: `CLAUDE.md` の中身 → `AGENTS.md`、`.claude/rules/docdd-kit.md` → `AGENTS.md` の印の中（手を入れていなければ新しい版、手を入れていればそのまま運ぶ）、`CLAUDE.md` → 読み込む 1 行、`docs/`・`tasks/` にある `.claude/rules/docdd-kit.md` への参照 → `AGENTS.md`。`AGENTS.md` を適用すると、この 4 つが一度に済む。
- `/docdd:update-kit` で置き換わる: 検査スクリプト 5 本（刻印だけ）。
- 手で直すもの（任意）: `AGENTS.md` の「ディレクトリ構成」表に `.claude/settings.json` などの行が残っていれば、いまの構成に合わせて直す。

## 0.13.2（2026-09-21）

### 変更

- **ui-polish も doc-sync を呼ぶ**: 画面を直したあと、`/docdd:doc-sync` を回して仕様書を合わせる（dev-loop・refactor・speed-up・security-audit の中で使ったときは、呼んだ側が最後に回すので飛ばす）。これで、コードを直すスキルはどれも中で doc-sync を呼ぶ。自分で打つのは、スキルを通さずにコードを直したときだけ。
- **ルートの README の「全体像」**: 図と表で分かることを箇条書きから消し、図に無いスキルの見つけ方・本番へ出す操作と戻し方・hook の 3 つに絞った。

### 雛形への影響: あり

- `/docdd:update-kit` で置き換わる: `.claude/rules/docdd-kit.md`（doc-sync を中で呼ぶスキルに ui-polish を足した）と検査スクリプト 5 本（刻印だけ）。
- 手で直すもの（任意）: `CLAUDE.md` のスキルの表の「スキルを通さず自分で直した・ui-polish だけで直した」行を「スキルを通さず自分で直した」に戻す。

## 0.13.1（2026-09-21）

**何も書かずに `/docdd:add-task` を打ったときの動きを、説明どおりにし、決まりを単純にした。**

### 変更

- **読む範囲**: コミットしていない書き換えが 1 つでもあると、その節しか読まず、まだタスクになっていない機能が下書きに出なかった（例: init のあと PRD の料金の欄だけを埋めて打つと、機能のタスクが 0 件になる）。いつも仕様書の全体を読み、書き換えのある節は「書き換えた所」として扱うようにした。新しく置いた、まだ git に入っていない文書も拾う。
- **書き換えた所は必ずタスクにする**: 上限 7 件に数えない（あふれた書き換えが、あとでコミットされて見つからなくなるため）。意味の変わらない表記の直し、冒頭の版・更新日の表、変更履歴は、タスクにしない。PRD では、機能一覧に加えて、主な画面と利用者の流れ（§3.3）と料金・上限（§4）の書き換えもタスクにする（参照は `PRD §3.3 主な画面と利用者の流れ`・`PRD §4 料金・上限`）。
- **節や行を消したとき**: 実装が残っていれば「取り除く」タスクにする（参照に「（削除）」を付ける。requirements の節は、決まりどおり「（廃止）」の 1 行を残す）。
- **タスクにならない書き換え**: 仕様書でない docs（`docs/operations/`・`docs/decisions/`・`docs/README.md`）や表記の直しは、タスクにせず、報告に並べる。コミットしたいときは Claude に「コミットして」と頼む（更新日を直し、キット共通の約束の「ドキュメントのみ」の行に従って検査してからコミットする）。タスクになる書き換えを含む文書は、そのタスクの dev-loop がまとめてコミットする。要決定の書き戻し先に運営者の書き換えがあるときも、D 決定のコミットには混ぜず、そのタスクのコミットに回す。add-task 自身は docs をコミットしない（0.12.1 の tasks-from-docs は承知を得てコミットしていたが、場合分けが多く、止まり続ける道が残ったため）。`/docdd:release` が止まったときの案内も合わせた。
- **消した節を、進行中のタスクが指しているとき**: そのタスクを取り下げるか、取り除くタスクに直すかを下書きの表に出す。dev-loop は、運営者が消した節を起こし直さずに止まって聞く。
- **そのほか**: 仕分けの表を、上の行から当てはめる順に並べ直した。範囲を絞って打ったとき、範囲の外にも書き換えがあれば、dev-loop の前に何も書かずに add-task を打つよう案内する。

### 雛形への影響: あり（刻印だけ）

- `/docdd:update-kit` で置き換わるのは、`.claude/rules/docdd-kit.md` と検査スクリプト 5 本（中身は同じ）。
- 手で直すもの（任意）: `tasks/BACKLOG.md` の運用ルール「参照の書き方」に、`PRD §3.3 主な画面と利用者の流れ`・`PRD §4 料金・上限` と「（削除）」の書き方を足す。`docs/README.md` の一文も直した。そろえたいときは、Claude Code に「docdd の新しい雛形と見比べて、文言をそろえて」と頼む。

## 0.13.0（2026-09-21）

**`/docdd:tasks-from-docs` を `/docdd:add-task` にまとめた。** タスクを作るスキルは add-task だけになった。やりたいことを書けば 1 件、何も書かなければ仕様書からまとめて起票する。

### 変更

- **add-task**: 何も書かずに打つと、仕様書（PRD・requirements・自分で置いた仕様書）の書き換えと、まだタスクになっていない所から、まとめて起票する（0.12 の tasks-from-docs と同じ動き。下書きを見せて、承認を得てから書く）。`/docdd:add-task docs/requirements/`・`/docdd:add-task HEAD~1` のように範囲も絞れる。書き換えも、まだタスクになっていない所も無ければ「何をしたいですか」と聞く。
- **説明書・雛形・ほかのスキルの案内**: 「docs を書き換えたら、何も書かずに `/docdd:add-task`」に合わせた。スキルは 14 本（`/docdd:` の一覧に出るのは 13 本）。

### 置いた仮説

- 利用者は「1 件か、まとめてか」ではなく「タスクを作りたい」で考える。入口を 1 つにして、書くか書かないかで分けるほうが迷わない。

### 雛形への影響: あり

- `/docdd:update-kit` が置き換えを提案する: `CLAUDE.md` のスキルの表の「起票する」行（0.12 の tasks-from-docs の行や、それより前の tasks-from-prd の行が雛形のまま残っていれば）。
- `/docdd:update-kit` で置き換わる: `.claude/rules/docdd-kit.md`（中身の変更あり）と検査スクリプト 5 本（刻印だけ）。
- 手で直すもの（任意。Claude Code に「docdd の新しい雛形と見比べて、文言をそろえて」と頼んでもよい）:
  - `CLAUDE.md`「スキルへの追加指示」表に `/docdd:tasks-from-docs` の行があれば、その中身を `/docdd:add-task` の行へ移す。「起票する」行を自分で書き換えていたら、`/docdd:tasks-from-docs` の案内を「何も書かずに `/docdd:add-task`」に直す。
  - `tasks/BACKLOG.md` の冒頭の 1 行と、`docs/README.md`・`docs/PRD.md` にある `/docdd:tasks-from-docs` の案内を「何も書かずに `/docdd:add-task`」に直す。
  - `docs/operations/development-and-testing.md` §4 の「無ければ `/docdd:add-task` で起票する」を「`/docdd:add-task テスト基盤の導入`」に直す（何も書かずに打つと、仕様書からまとめて起票するほうになるため）。
- 打ち方が変わる: `/docdd:tasks-from-docs` は無くなった。何も書かずに `/docdd:add-task` と打つ。

## 0.12.1（2026-09-21）

**0.12.0 の変更が届いていなかった所を直した。** 説明書だけでなく、スキルの説明文・雛形・利用者に出るメッセージまで、0.12.0 の流れ（docs を自分で書き換えたら `/docdd:tasks-from-docs` → `/docdd:dev-loop`）に合わせた。

### 変更

- **tasks-from-docs**: 表記の直しなど、タスクにならない書き換えは、承知を得てその文書だけをコミットする（残ったままだと `/docdd:release` が止まり続けるため）。コミットしていない書き換えがあるかは、仕様書だけを見て決める。ID を付けない requirements の文書（システム構成など）は、見出しの節で読む。
- **doc-sync**: あなたが先に書き換えた仕様（コミットしていない書き換えや、これから作るタスクが指す節）を、いまの実装に合わせて元へ戻さない。`--full` で雛形のままの docs を起こしたときは、報告の最後に次の一手を書く。
- **refactor・speed-up・security-audit**: あなたがコミットせずに書き換えた docs は直さず、コミットにも含めない（その書き換えは `/docdd:tasks-from-docs` で取り込む）。`/docdd:refactor --audit` は、タスクを `done` にしない。
- **ui-polish**: ほかのスキルから呼ばれず単独で使ったときは、コミットの前に `/docdd:doc-sync` を打つよう添える。
- **dev-loop**: タスクの参照が自分で置いた仕様書なら、仕様が無いときはその文書に節を起こす。
- **タスクの「参照:」**: ID を付けない requirements の文書は `requirements/<ファイル名> <見出し>` で指す（add-task・tasks-from-docs・`tasks/BACKLOG.md` の運用ルール）。
- **security-audit**: 本番ビルドでしか出ない設定（CSP など）は、『ビルド』行で作ってから『本番モード起動』行で起動して確かめる（変更影響表と speed-up に合わせた）。
- **release**: コミットしていない変更で止まったとき、docs の書き換えなら `/docdd:tasks-from-docs` を案内する。テスト無し・控え無しで反映するかの問いを、平らな言い方にした。
- **maintenance**: 点検の表に「控えの古さ」と月次の手順を足した。
- **メッセージ**: init の「Web 以外のプロジェクトです」と、更新のお知らせに、README・CHANGELOG の URL を付けた（プロジェクトの中には無いため）。
- **説明書**: `/docdd:ui-polish` だけで画面を直したときも `/docdd:doc-sync` を打つ、コミットしたあとの書き換えは `/docdd:tasks-from-docs HEAD~1` のように指す、など。

### 雛形への影響: あり

- `/docdd:update-kit` で置き換わる: `.claude/rules/docdd-kit.md`（中身の変更あり）・`scripts/audit-check.mjs`（出力の 1 行を消した）・ほかの検査スクリプト 4 本（刻印だけ）。
- 手で直すもの（任意）: `tasks/BACKLOG.md` の運用ルール「参照の書き方」に、ID を付けない requirements の文書の書き方を足す。`CLAUDE.md`・`docs/README.md` の文言を新しい雛形にそろえたいときは、Claude Code に「docdd の新しい雛形と見比べて、文言をそろえて」と頼む。

## 0.12.0（2026-09-21）

**`/docdd:tasks-from-prd` を `/docdd:tasks-from-docs` に改名し、PRD 以外の仕様書からもタスクを作れるようにした。** あわせて、説明書と雛形を仕組み（スキル・スクリプト・hook）と 1 文ずつ突き合わせて直した。

### 追加

- **`/docdd:tasks-from-docs`**（旧 tasks-from-prd）: PRD の機能一覧に加えて、`docs/requirements/` の各文書と、自分で `docs/` に置いた仕様書を読む。まだタスクになっていない所と、書き換えた所をタスクに下書きし、承認後に起票する。
  - 引数なしなら、`docs/` にコミットしていない書き換えがあればその節、無ければ仕様書の全体を読む。`/docdd:tasks-from-docs docs/requirements/` や `HEAD~3` で範囲を絞れる。
  - 終わったタスクの節が書き換わっていたら「変更を反映する」タスクにする。コードを検索して実装済みに見える所は起票しない。
- **dev-loop**: タスクの参照先の文書に、自分で書き換えたままコミットしていない変更があれば、そのタスクのコミットに含める（更新日と変更履歴も直す）。docs を書き換えたら、コミットせずに `/docdd:tasks-from-docs` → `/docdd:dev-loop` と進めばよい。
- **タスクの「参照:」**: 自分で置いた仕様書を `<docs/ からのパス> <見出し>`（例: `specs/booking.md 予約の取り消し`）で書けるようにした（add-task・tasks-from-docs・dev-loop）。
- **security-audit**: 直すときに `/docdd:doc-sync` を回し、権限の決まりやエラーの応答が変わったら仕様書も同じコミットで直す。

### 変更

- **`"notifyUpdates": false` が残るようにした**（不具合の修正）: `/docdd:update-kit` や init で `.docdd/manifest.json` を書き直しても、この設定（更新のお知らせを止める）を残す。止めていたお知らせがまた出るなら、もう一度足す。
- **説明書と仕組みの食い違いを直した**。主なもの:
  - 「スキルは `CLAUDE.md` の表のコマンドだけを実行する」→ 実際は git や gh も使う。「検証と反映のコマンドは表から使う」にした。
  - doc-sync を中で呼ぶスキルは dev-loop・refactor・speed-up・security-audit（README は 2 本だけ挙げていた）。
  - 公開のしかたが「自動公開」なら PR は作らない。gh で自動になるのは「確認してから公開」「コマンドで公開」のとき。
  - `/docdd:` と打って出るスキルは 14 本（playwright-cli は Claude が中で使うだけで、一覧に出ない）。
  - `CLAUDE.md` はこのプロジェクトの約束（あなたが直す）、`.claude/rules/docdd-kit.md` はどのプロジェクトにも共通の約束（update-kit が新しくする。直さない）と書き分けた。
- **不安にさせる言い回しを減らした**: 何をすればよいかを書く形にした。使える条件（何が要るか・何に対応していないか）は残した。
- **表の最初の列を、その行が何についての行か（ファイル・フォルダのパス、スキル、道具など）にした**。見出しの空欄も無くした。
- **詳しい説明書の見出しを「控えと戻し方」に短くした**（リンクも合わせた）。

### 雛形への影響: あり

- `/docdd:update-kit` で置き換わる: `.claude/rules/docdd-kit.md`（中身の変更あり）と検査スクリプト 5 本（刻印だけ）。
- `/docdd:update-kit` が置き換えを提案する: `CLAUDE.md` のスキルの表の「起票する」行（雛形のままなら、新しい名前 `/docdd:tasks-from-docs` の行にする）。
- 手で直すもの（任意。update-kit は、上の「起票する」行のほかは既存の節の中の文言を変えない）:
  - 「起票する」行を自分で書き換えていたら、`/docdd:tasks-from-prd` を `/docdd:tasks-from-docs` に直す。
  - `tasks/BACKLOG.md` の運用ルール「参照の書き方」に、そのほかの仕様書の書き方 `<docs/ からのパス> <見出し>` を足す。
  - ほかの文言や表の見出しを新しい雛形にそろえたいときは、Claude Code に「docdd の新しい雛形と見比べて、文言をそろえて」と頼む。
- 打ち方が変わる: `/docdd:tasks-from-prd` は無くなった。`/docdd:tasks-from-docs` を打つ。

### 置いた仮説

- docs を書き換えた人は、コミットせずにそのまま `/docdd:tasks-from-docs` を打つ。そのため、引数なしではコミットしていない書き換えを読み、書き換えた文書はそのタスクの `/docdd:dev-loop` がコミットに含める。

### 今回やらなかったこと（理由）

- コミットしたあとの書き換えを、引数なしで見つけること。前回どこまで読んだかを残す仕組みが要るため。`/docdd:tasks-from-docs HEAD~1` のように範囲を渡せば読める。

## 0.11.2（2026-09-21）

**このプラグインを使うための制約**を、導入前に判断できる場所へまとめた。約 60 種の見本のプロジェクトで init を実際に動かし、README の記述ではなくコードとスキルの動きから確かめた。

### 追加

- **ルートの README に「使える条件」**: 有料プラン・使える場所（claude.ai/code ではこの手順で入れられない）・git と Node.js・OS・1 人で日本語で使う前提・技術による違い・release に要るもの、を 5 つの箇条にした。
- **詳しい説明書に「どこまで使えるか」**: 使える場所の表（Desktop の WSL・クラウドのセッション・Cowork を含む）、hook に要る Claude Code の版（PowerShell では 2.1.147 以上）、表の見出し・行の名前は訳さずにそのまま使うこと、プロジェクトの種類ごとに検証コマンドがどこまで自動で埋まるかの表、機能ごとに要るもの（release・本番 DB の控え・依存の脆弱性・DB の検証・操作の検証・refactor と speed-up）、気をつけること（モノレポ・Python の仮想環境・テストのコマンドは終わる形にする・Windows の改行）。

### 変更（実際の動きと違っていた説明を直した）

- **全体像の図**: 入口に「docs を自分で書き換えたとき」を足した（docs → add-task へ進む）。「自分でコードを直したとき → doc-sync」を下へ移し、doc-sync から docs と仕上げの両方へ矢印を引いた。dev-loop が中で doc-sync を呼ぶことを箱に書いた。「CLAUDE.md の表」は dev-loop と release にだけ矢印があり、ほかのスキルは使わないように見えていたので、init が埋める表として箱を書き直した。
- **docs を自分で書き換えたとき**: add-task で変えた所をタスクにする、と両方の README に書いた（0.12.0 で `/docdd:tasks-from-docs` に変えた）。
- **release に要るもの**: 「GitHub のリポジトリが必須」と書いていたが、実際に要るのは git の push 先（`origin`）。GitHub と gh は、PR の作成と CI の待ちを自動にするためのもの。
- **refactor・speed-up**: 「単体テストが無ければ監査だけ」と書いていたが、実際は `--audit` を付けないと止まる。スキルの説明文と README を本文の動きに合わせた。
- **依存の追加の確認**: 「必ず確認が出る」と書いていたが、確認が出るのは `npm install`・`pnpm add`・`yarn add`・`pip install` の形。
- **init が検証コマンドを聞くか**: 「聞きません」と「推定できなかった行を聞く」が食い違っていた。「まず推定し、推定できなかった行だけ聞く」にそろえた。
- **Desktop アプリの入れ方**: 「配布元の追加はターミナルで」と書いていたが、Desktop（＋ → Plugins）と VS Code（`/plugins`）は画面からも入れられる。画面で入らないときのために、ターミナルでの入れ方も残した。
- **見分け方の取り違え**: 「Electron は Web と見なされる」は Vite か React を使うときだけだった。Vue CLI・下のフォルダにだけ .csproj がある ASP.NET・package.json も置いた Python／Go／Rails／Laravel の扱いを足した。
- **「技術は問いません」**: 流れはどの技術でも使えるが、検証コマンドが自動で整う範囲と画面のスキルが動くかは技術で変わる、と書き分けた。
- **検査スクリプト 5 本と `.claude/rules/docdd-kit.md`**: 刻印を v0.11.2 にした（中身の変更は無い）。

### 雛形への影響: あり（刻印だけ）

- `/docdd:update-kit` で置き換わるのは、検査スクリプト 5 本と `.claude/rules/docdd-kit.md`（中身は同じ）。

### 今回やらなかったこと（理由）

- 制約の一部は直せる（例: 依存の追加の確認を `pip3 install` などにも出す、update-kit が改行の違いだけの差分を同じとみなす、Node.js と Python が同じフォルダにあるとき両方を推定する）。今回は説明に留め、直すかは別に決める。

## 0.11.1（2026-09-21）

文書を読み手の目で見直し、**いまの読み手に要らない記述**を減らした（README 2 本・RELEASING.md・雛形の文書）。消したのは、次の種類のものだけ。利用者が困ったときに行動を決める情報（止まったときの直し方・確認への答え方・費用と安全の注意）は残した。

- 同じことを何度も言い直している所（「4 つの置き場」「表のコマンドだけを実行」など）
- 利用者が行動を変えない内部の仕組み（init の処理の順番、`.gitignore` の塊の分け方、Claude Code の版番号、hook の条件の考察など）
- 同じ説明が別の場所にもある所（Unity のビルドの細かい書き方、依存の脆弱性の据え置き方、控えと戻し方）。正本を 1 か所に寄せ、ほかはリンクか 1 行にした
- 作者向けの事情（配布のしくみ、リリースの手順の細部）。`RELEASING.md` に寄せた
- 古くなった記述（申請の材料の版の例、目次の写し）

### 変更

- **ルートの README**: 冒頭と全体像の言い直しを減らし、詳しい説明書への導線を「最初に開く 3 つの節」へのリンクにした。「GitHub のアカウントは要らない」と「本番反映は GitHub 前提」の食い違いを直した（入れるだけならアカウントは要らない、release はリポジトリが要る）。不具合の報告の書き方は Issue の画面に任せた。
- **プラグインの README**: 前提・init がすること・英語で出る確認・Web 以外・中身・注意の各節から、内部の仕組みと重複を減らした（約 110 行減）。「依存の脆弱性の行と、据え置きの書き方」の節は「依存の脆弱性の行が落ちたとき」にし、`/docdd:maintenance` を打てばよいことを先に書いた。
- **`RELEASING.md`**: 申請の材料の版の例を今の版に合わせ、CI・スクリプトの中身の説明は、それぞれのファイルのコメントに任せた。
- **雛形**: `CLAUDE.md` の表のセルに入っていた内部事情（playwright-cli の話・`.mcp.json` の初期設定の例など）を外した。`docs/README.md`・`development-and-testing.md`・`tasks/BACKLOG.md`・`requirements/README.md`・`PRD.md`・`backup-and-restore.md` の重複した説明を短くした。`.claude/rules/docdd-kit.md` の「スキルを通さずに直したら doc-sync」を、同期の決まりの 4. に 1 つにまとめた。
- **init**: 手順書を写したいと言われたときの案内を、README の「手順書を直したいとき」の節へ寄せた。
- **検査スクリプト 5 本と `.claude/rules/docdd-kit.md`**: 刻印を v0.11.1 にした（中身の変更は rules の 1 か所だけ）。

### 雛形への影響: あり（文面だけ）

- `/docdd:update-kit` で置き換わる: `.claude/rules/docdd-kit.md`・検査スクリプト 5 本（手付かずなら。スクリプトは刻印だけの差）。
- ほかの雛形（`CLAUDE.md`・`docs/`・`tasks/`）は利用者のファイルなので置き換わらない。直さなくても動く（新しく導入するプロジェクトから短くなる）。

## 0.11.0（2026-09-21）

scripts・skills・hooks の役割分担を点検し（4 観点で監査し、指摘は反証にかけた）、直す価値のあるものをまとめて直した。大枠（プラグイン側・雛形側・配布しない側の 3 層）は妥当で、変えていない。

### 実害のあったもの

- **決まった判断が、正本へ書き戻されないままアーカイブへ移ることがあった**: dev-loop は、要決定の回答を記録するコミットで**先に正本（PRD・requirements・ADR）へ書き戻す**ようにした（書き戻した文書は更新日と変更履歴も直す）。1〜2 行で済まないときは「D-番号を正本へ書き戻す」タスクを起票し、状態は未決のまま残す（書き戻す前にアーカイブへ移らない）。
- **init が「途中まで導入済み」と誤判定していた**: 既存の `tasks/BACKLOG.md` や `scripts/audit-check.mjs` があるだけで partial になり、ヒアリングを飛ばしうった。導入の痕跡をキット固有の名前（manifest・rules・check-doc-*）だけにした。
- **`.env` の判定が init と hook で食い違っていた**: init の precommit を hook と同じ規則にした（ファイル名だけを見る・大文字小文字を区別しない・末尾が .example／.sample／.template なら見本）。直し方の案内も `git rm --cached` にそろえ、外したあとに同じ指摘が出続けないようにした。
- **ログイン状態のファイルが、導入のあとはコミットに入りえた**: hook が、ログイン状態のファイル（`.auth/` の下の JSON、名前に auth-state・storage-state を含む JSON、`.playwright-cli/`）を含むコミットを止めるようにした。見本・スキーマ（名前に `.example.json`・`.sample.json`・`.template.json`・schema を含む）は止めない。判定は init の precommit と同じ規則で、サブフォルダから add しても git のルートからのパスで判定する。雛形の `.gitignore`（Web）に `/playwright/.auth/` を足した。
- **hook が `git commit <パス>` で、git が入れない未追跡のファイルを理由に止めていた**: 未追跡のファイルは `git add` した分だけを見るようにした。

### 効率

- **docs の検査（更新日）を速くした**: 文書ごとに履歴をたどるのをやめ、文書をまとめて `git log` を 1 回だけ呼ぶ形にした（試験用リポジトリで 2〜9 秒 → 0.2 秒前後。文書がとても多いと伸びる）。置き去りと判定した文書だけ、その文書ひとつの履歴で確かめ直す。差分が大きすぎて読めないときは、文書ごとに読む形へ戻る。
  - マージは、どの親にも無い行を足した・どの親にもあった行を消したときだけ内容の変更に数える。**更新日の衝突だけを解いたマージは数えなくなった**（衝突を新しい本文で解いたマージは今までどおり数える）。
  - 前の実装で見逃していた置き去りを、新しく見つけることがある（利用者の git の設定で差分の出力が変わる場合など）。上げたあとで初めて「置き去り」と言われたら、その文書の更新日を直す。
- **`CLAUDE.md` の「書き方の見本」を HTML コメントに入れた**: 毎回の会話で約 3,400 字を読み込まないようにした（ファイルを開けば見える）。
- **release と dev-loop の「ルール」節を先頭へ移した**: 会話の圧縮のあとも、本番へ出す前の約束が残るようにした。途中までしか見えなければ SKILL.md を読み直す、と書いた。
- **init の status から、どのスキルも読まない出力（道具の有無・キットのファイル一覧・.env の状態）を外した**: 毎回の起動を減らした。

### 棲み分け

- **playwright-cli を `/` メニューから外した**（`user-invocable: false`）。あなたが打つことはなく、Claude が ui-polish・verify-e2e・release の中で使う道具箱なので。`CLAUDE.md` のスキルの表からも外した。
- **maintenance が、Claude からは読めない release の中身を参照していた**: `${CLAUDE_PLUGIN_ROOT}/skills/release/SKILL.md` を Read で読むと書いた。控えの鮮度の判定は、merge で取り込んだ migration も拾うようにした（`--first-parent -m`）。要決定の雛形に `- 状態: 未決` の行を足した。
- **release の migration 判定が、初めての反映で失敗していた**: 「変更したファイル」を §0 に 1 か所だけ定義し、本番ブランチをまだ push していないときは全ファイルを変更とみなすようにした。
- **サブフォルダで起動したとき、hook と init の答えが食い違っていた**: init・update-kit は上のフォルダの導入を見つけて `installed-above` と答え、**apply・update --apply はそこに書かずに止まる**（入れ子の導入を作らない）。起動したフォルダそのものも、hook と同じ条件（`tasks/BACKLOG.md` と `/docdd:` を含む `CLAUDE.md`）で docdd とみなす。hook の案内にも、開き直す場所を「」の中に書くようにした。
- **v0.1 からの移行を一部だけ適用すると、manifest の版が空になり、hook の案内が止まっていた**: 版が分からない（manifest が無かった）ときは、どの順で移行しても「0.1.0〜0.1.4」と書くようにした。
- **README の「保守する人へ」に、フォルダの役割の表を足した**（templates は置くもの、examples は置かない読むだけの見本、プラグインの scripts は利用者のプロジェクトに置かない、など）。

### そのほか

- 雛形の `.claude/settings.json` の allow から `git branch:*` を外した（消す操作まで通していた。読み取りは行が無くても通る）。
- 雛形の `tasks/BACKLOG.md` の入口を `node scripts/backlog-archive.mjs` の 1 つにした。
- update-kit の古い記述（「検査スクリプト 3 本」）を直した。
- リリース前に差分を 4 観点でレビューし、再現できた指摘（マージの中の本文変更の見落とし、ログイン状態の名前の取りこぼしと誤検知、上に導入があるときの入れ子の導入、ほか）を直した。
- テスト: 新しい判定と境目（空白を含む名前・改名・マージ・「++」で始まる本文、4 つの .env の名前、ログイン状態、サブフォルダ、移行の途中）を足し、init.mjs の Markdown の読み取りの写しも同じ中身かを確かめるようにした。

### 雛形への影響: あり

- `/docdd:update-kit` で置き換わる・足されるもの: 検査スクリプト 5 本（手付かずなら。check-doc-dates の高速化を含む）・`.claude/rules/docdd-kit.md`・`.gitignore` の `/playwright/.auth/`。
- 手で直すもの（update-kit は既存の節の中の行は変えない）: `CLAUDE.md` の見本を HTML コメントに入れる（雛形と見比べる。入れなくても動く）、`CLAUDE.md` のスキルの表から `/docdd:playwright-cli` を外す、`.claude/settings.json` の allow から `Bash(git branch:*)` を消す（消さなくても動く）。v0.8 以前から上げたプロジェクトは、`docs/operations/development-and-testing.md` §3 に「一度も赤くなっていない検査は信じない」の箇条を足す。

### 置いた仮説

- `.env` の判定は、プラグインの中で共通の部品に切り出さず、同じ規則を 2 か所に書いてテストで固定した。hook が部品の読み込みに失敗すると、止めるべきものを素通りさせるおそれがあるため。
- release の手順は、経路ごとに別ファイルへ分けなかった。圧縮の対策にはならず、承知の項目は経路ごとに意図して違うため。ルール節を先頭へ移すだけにした。

### 今回やらなかったこと（理由）

- `init.mjs`（約 2900 行）の分割: 急ぐ理由が無く、入口を変えずに段階的に切り出すほうが安全なため。
- 「docdd のプロジェクトか」の判定の共通化: 約 20 行で、両方にテストがあるため。
- package.json に足す npm の別名をやめること: 人や CI が `npm run` で打つ入口として残す。

## 0.10.0（2026-09-21）

**スキルを通さずに自分でコードを直したとき**と、**本番へ出す前の仕上げ**を、流れの中に書いた。これまでは `/docdd:doc-sync` や `/docdd:refactor`・`/docdd:speed-up`・`/docdd:security-audit` が一覧にあるだけで、いつ打つのかが流れのどこにも書かれていなかった。

### 追加

- **雛形 `CLAUDE.md` に「スキル（何を使うか）」の表**: 起票／開発／自分で直したあと／検証／仕上げ／反映・点検の 6 つに分けて 15 本を並べた。プロジェクトの中から全部のスキルへ辿れるようにする（これまでは `/docdd:` と打つまで存在を知られなかった）。
- **release §0 手順9「仕上げの確認」**: ログイン・課金・外部連携・権限に関わる変更が含まれるのに `/docdd:security-audit` を回していなければ、報告に「未実施」と書く（**止めない**。回すかは運営者が決める）。

### 変更

- **雛形 `.claude/rules/docdd-kit.md`「開発の進め方」**: 「スキルを通さずに直したら、コミット前に `/docdd:doc-sync`」と「本番へ出す前に、必要なら仕上げを回す」の 2 行を足した。
- **doc-sync**: 説明と本文に「`/docdd:dev-loop` を通さず自分で直したときにも使う」を書いた。
- **ルートの `README.md` の全体像の図**: 「スキルを通さず自分で直したとき → `/docdd:doc-sync` → 仕様書」と、「依頼が全部終わった → 仕上げ（必要なときだけ）→ `/docdd:release`」を足した。
- **`plugins/docdd/README.md`**: 全体像の流れに仕上げと doc-sync を書き、スキル一覧の前に 6 つの場面の表を置いた。
- **検査スクリプト 5 本と `.claude/rules/docdd-kit.md`**: 刻印を v0.10.0 にした。

### 雛形への影響: あり

- `/docdd:update-kit` で足されるもの: `CLAUDE.md` の「スキル（何を使うか）」の節（新しい `##` の節なので自動で足せる）・`.claude/rules/docdd-kit.md`・検査スクリプト 5 本（手付かずなら）。
- 手で直すものはなし。

### 置いた仮説

- スキルの地図は雛形の `CLAUDE.md` に置いた（毎回読まれるが、6 行の表なので負担は小さい）。同じ表をプラグインの README にも置くが、正本は使う人の手元にある `CLAUDE.md` とする。
- 仕上げの 3 本のうち、release で確かめるのは `/docdd:security-audit` だけにした。refactor と speed-up は「必要と感じたときに運営者が打つ」もので、機械的に判定できないため。

## 0.9.0（2026-09-21）

実運用しているプロジェクト（x-system）の docs・tasks・スキルを読み、**どのプロジェクトでも効く形に一般化できるものだけ**を取り込んだ。柱は 4 つ: **戻せるようにする**・**公開先でしか壊れないものを見る**・**検証の取りこぼしを塞ぐ**・**docs と tasks の構造を整える**。

### 追加

- **雛形 `docs/operations/backup-and-restore.md`（新規）**: 控えに何が入り・何が入らないか（利用者が上げたファイル・外部サービス側の設定は入らないことが多い）、置き場所、データの戻し方、公開した版の戻し方、**戻せることを確かめた記録**の表。`/docdd:maintenance monthly` の復元テストがこの §5 に 1 行足す。
- **`CLAUDE.md`「反映コマンド」表に『戻し方』行**: 公開した版が壊れたときに前の版へ戻す手順（ホスティングの画面／`git revert` して push／機能を止める切り替え／配り直す／「無い」）。バックアップは壊れた**データ**を戻すため、『戻し方』は壊れた**版**を戻すためで別物（版を戻しても DB は戻らない）。
- **release「公開先が壊れていたら（前の版へ戻す）」**: 原因を調べる前に戻すかを決める。行の手順だけを使い、運営者の「はい」を得てから実行する。行が未記入なら候補を 1 つ示して聞き、その行へ書く。
- **release「公開先で確認する」に、手元では絶対に出ないものの表**: 外部サービス側の許可設定（環境ごとに登録が要りコードに現れない）・本番ビルドでしか出ない設定（HTTP 200 のまま画面だけ壊れる）・環境変数の欠落や migration の未適用・エラーの記録の増減。**触った行だけ**を見る。
- **maintenance の週次に「控えの鮮度」**: 反映が間遠だと控えも古くなるので、直近 1 か月に migration を含む反映があったかを見て、無ければ「控えを取る間隔」を要決定へ 1 回だけ積む。
- **`docs/decisions/README.md` に「ADR 一覧」**: 手書きの索引。**書き忘れは `scripts/check-doc-refs.mjs` が落とす**（一覧を書いたら検査もセットで作る、という docs の規約に合わせた）。
- **ADR の「改訂」行**: 一部だけ変わったら本文を書き換えず、冒頭の「改訂」行を足す（なぜそう決めたかを消さない）。判断ごと置き換わるときだけ新しい ADR を作る。

### 変更

- **release**: §0 の最初に `node scripts/backlog-archive.mjs` を回す。承知の提示と報告に『戻し方』と「外部準備の残り（未決の D-番号とタイトル）」を足した。
- **doc-sync**: 検査で `node scripts/backlog-archive.mjs --check` も回し、アーカイブ漏れをこのあとのコミットに含める。変更履歴には**きっかけ**（`T-01`・`D-1`・運営者の指示の日付）を添える。ADR を足したら同じコミットで「ADR 一覧」にも 1 行。
- **refactor**: 監査を**毎回その場で取り直す**。承認を得た単位は `tasks/BACKLOG.md` へ起票し、却下は `dropped` にしてアーカイブへ移す（作業キューを 1 本に保つ）。
- **雛形 `tasks/REFACTOR_PLAN.md` を廃止**: リファクタの作業キューも BACKLOG 1 本に寄せた。過去の監査結果を持ち越すと、直したものが `todo` のまま層になって空振りするため。
- **雛形 `tasks/BACKLOG.md`**: 完了時に「実装メモ:」「検証:」の 2 行を足す（アーカイブが「何をどう確かめたか」の記録になる）。並べ替えの基準（黙って壊れる → 実害 → 保守性 → 見た目）と、リファクタも同じキューに起票することを足した。
- **雛形 `.claude/rules/docdd-kit.md`**: 変更影響表に「**検査そのもの**を足した・変えた」（わざと違反を入れて落ちることを 1 度確かめる）と「**古いものを消す処理**」（参照ありと参照なしを 1 件ずつ置いて確かめる）の 2 行。表の前に「触った層は、未コミットの変更と直近のコミットの両方から特定する」。戻し方と控えの段落も足した。
- **雛形 `docs/requirements/README.md`**: 消した ID は繰り上げない。やめた画面・データ・処理は見出しごと消さず `（廃止 2026-10-01 → S-14 へ）` の 1 行を残す。
- **雛形 `.gitignore`**: 共通に `*.pem`・`backups/`・`*.dump`（控えを git に入れない）、Web と Python にカバレッジの出力を足した。
- **dev-loop・add-task**: 完了時の 2 行、リファクタ単位は仕様の門の対象外、並べ替えの基準への参照。
- **検査スクリプト 5 本と `.claude/rules/docdd-kit.md`**: 刻印を v0.9.0 にした。

### 雛形への影響: あり

- `/docdd:update-kit` で置き換わる・足されるもの: `docs/operations/backup-and-restore.md`（新規）・`scripts/check-doc-refs.mjs`（ADR 一覧の検査）・検査スクリプト 5 本・`.claude/rules/docdd-kit.md`・`CLAUDE.md` の『戻し方』行とディレクトリ構成の行・`docs/decisions/README.md` の新しい 2 節・`docs/decisions/0000-template.md` の「改訂」行。
- **`docs/decisions/README.md` に「ADR 一覧」を受け取ったら、既存の ADR を表へ書き出すまで『docs の検査』が落ちる**（1 度だけの作業）。
- 手で直すもの（update-kit は**節ごと足すことはしても、既存の節の中の表の行や箇条は足さない**。雛形を見ながら手で足す）: `tasks/BACKLOG.md`（完了時の「実装メモ:」「検証:」の 2 行・並べ替えの基準・リファクタの起票）、`docs/README.md`（§1 の地図に「控えと戻し方」の行、§3 の `check-doc-refs.mjs` の説明、§4 の変更履歴の「きっかけ」）、`docs/requirements/README.md`（§2 の「番号を繰り上げない」「廃止の 1 行を残す」）。
- `tasks/REFACTOR_PLAN.md` はもう配らず、`/docdd:refactor` も読み書きしない。消すときは `CLAUDE.md`「ディレクトリ構成」表のその行も同じコミットで消す（**ファイルだけ消すと『docs の検査』が落ちる**）。残すなら説明を「過去のリファクタ計画（もう使わない）」に直す。update-kit はどちらも消さない。

### 置いた仮説

- x-system 固有のもの（Supabase・Vercel・X API に依存する手順、監視や CI の個別文書、公開前チェックリスト、AGENTS.md の写し）は取り込まない。一般化すると中身が消えるか、雛形が長くなるだけのため。
- 「ADR 一覧」は**検査とセット**でだけ入れた。手書きの索引だけを規約として足すのは、キット自身の「一覧を書くなら突き合わせる検査も作る」に反する。
- `tasks/REFACTOR_PLAN.md` は雛形から消すだけにして、既存プロジェクトのファイルは触らない（利用者のファイルを消さない方針のまま）。
- `.gitignore` の Unity 向けの塊は入れない。Unity のプロジェクトは `/[Ll]ibrary/` の形の .gitignore を既に持っていることが多く、重複した別表記が増えるだけになる。
- ADR 一覧の検査は、**「ADR 一覧」の見出しの下の表の行だけ**を見る（説明の中の書き方の例を「載っている」と数えない）。リンクは `./` 無し・`#見出し` 付き・`%xx` でも数え、見出しが無いプロジェクトでは突き合わせをせずにその旨を出力する（黙って無効にしない）。

### 今回やらなかったこと（理由）

- 調査で挙がった提案のうち、雛形を長くするだけのもの・既に docdd にあるもの・特定の技術に依存するものは見送った（例: 監視／CI／公開前チェックリストの文書化、プロジェクト root の README 雛形、要決定の「暫定」行、許可設定の細かな追加）。必要になった時点で個別に検討する。
- evals の実行: 費用が出るため。挙動はテスト 139 件で固定した。

## 0.8.0（2026-09-21）

プラグインを更新しても、プロジェクトに置いた雛形は古いままになる。これまでは、その**ずれに気付く手段が無かった**（CHANGELOG を見に行くしかなかった）。セッションの開始時に版を比べ、ずれていれば `/docdd:update-kit` を 1 行だけ案内する hook を足した。

### 追加

- **hook `scripts/notify-update.mjs`（SessionStart）**: docdd のプロジェクトで Claude Code を起動（または再開）したとき、プラグインの版と `.docdd/manifest.json` の `kitVersion` を比べ、プラグインのほうが新しければ 1 行だけ伝える。v0.1 系（manifest が無い構成）なら移行を案内する。
  - **何も直さない。** 文の中で「Claude は雛形を勝手に更新しない」ことも伝える（`/docdd:update-kit` はもともと運営者が打ったときだけ動く）。
  - 黙るのは、docdd のプロジェクトでないとき・版が同じかプロジェクトのほうが新しいとき・`kitVersion` が読めないとき・manifest が壊れているとき。読めない入力や例外でも、セッションの開始を邪魔しない（常に exit 0）。
  - 知らせを止めたいときは、`.docdd/manifest.json` に `"notifyUpdates": false` を書く。
  - git のルートより上は見ない（docdd のプロジェクトの中に別のリポジトリがあるときは黙る）。Claude の文脈（トークン）はこの 1 行だけを使う。

### 変更

- **`hooks/hooks.json`**: `SessionStart`（matcher `startup|resume`）を足し、説明にセッション開始時の案内を書いた。
- **README 2 本**: hook の表と「更新」の節に、版のずれを知らせることと、止め方（`notifyUpdates: false`）を書いた。
- **検査スクリプト 5 本と `.claude/rules/docdd-kit.md`**: 刻印を v0.8.0 にした。

### 雛形への影響: あり（刻印だけ）

- `/docdd:update-kit` で置き換わるのは、検査スクリプト 5 本と `.claude/rules/docdd-kit.md`（手付かずなら。中身の変更は刻印だけ）。
- hook はプラグイン側にあるので、プロジェクト側の操作は要らない。**更新してから docdd のプロジェクトを開くと、この案内が出る。**

### 置いた仮説

- 知らせる場所は Claude Code の中（SessionStart の hook）にした。GitHub の Release 通知は、リポジトリを Watch している人にしか届かず、非エンジニアの利用者には届かないため。
- 出力は stdout の 1 行（Claude の文脈に入る）にした。JSON の `systemMessage` などの細かな出し分けは、公式ドキュメントでユーザーに見えるかどうかが確かめられなかったため、確実に動く形を選んだ。Claude が勝手に更新しないよう、文の中で明示する。
- matcher は `startup|resume` にした（`/clear` や compact のたびに繰り返さない）。
- 版の比較は数値（メジャー・マイナー・パッチ）で行い、プロジェクトのほうが新しいときは黙る（プラグインを手元で作っている人を邪魔しない）。

### 今回やらなかったこと（理由）

- GitHub の Release の作成（`gh release create`）: 通知としては弱いが、費用も手間も小さい。必要になったら `RELEASING.md` の手順に 1 行足せばよい。
- 更新の自動適用: 雛形の書き換えは運営者の承知を得てから行う方針を変えない。
- 「この版はもう案内しない」という個別の抑止: いまは `notifyUpdates: false` で全部止める形だけにした。

## 0.7.0（2026-09-20）

migration（DB の構造変更）を本番へ当てる前に、**本番 DB のバックアップを取ってから反映する**ようにした。これまでは「migration が含まれます」と伝えて「はい」を取るだけで、戻せるかは運営者の記憶に任せていた。取り消しにくい手順を記憶に頼らせない（キット共通の約束の 5 原則 3）に合わせ、`/docdd:release` の中に組み込む。

### 追加

- **雛形 `CLAUDE.md`「反映コマンド」表に『本番 DB のバックアップ』行**: 書ける値は 4 つ。バックアップのコマンド（例: `pg_dump …`・`supabase db dump …`）／「自動（DB サービス側）: <戻せる範囲>」／「無い」／「無い（DB を使わない）」。接続先は `.env` の変数で渡し、値は書かない。出力先はリポジトリの外。
- **release §0 手順8（バックアップの門）**: `git diff --name-only origin/<本番ブランチ>...HEAD` に migration が含まれるときだけ動く。行の値ごとに、取る／取らない／止まって聞く を表で決める。
  - 未記入なら、プロジェクトの DB に合う候補コマンドを 1 つ示して聞き、答えを行へ書いて `CLAUDE.md` だけをコミットしてから §0 をやり直す。
  - 「取らない」を選んだら、`**D-<番号>: バックアップ無しで migration を本番へ当てる**` として要決定に 1 回だけ記録し、次からはその記録を見て進む（「テスト無しで本番反映する」と同じやり方）。
- **release 共通の手順「本番 DB のバックアップを取る」**: 行のコマンドをそのまま 1 回実行し、終了コードと出力ファイルの大きさ（0 バイトでないか）まで見る。失敗したら本番へ進まない。控えがリポジトリに入っていないか `git status` で確かめ、場所・日時・大きさを報告に載せる（中身は開かない）。

### 変更

- **release の経路**: 「自動公開」は承知（手順2）の直後・push の前に取る（push がそのまま公開で、ホスティング側の反映で migration が当たる作りがあるため）。「確認してから公開」「コマンドで公開」は、本番へ出す前の承知の直後・PR の前に取る。どちらの承知の提示にも、バックアップの予定（取る／自動／取らない（D-番号）／migration 無しで対象外）を足した。
- **release の報告とルール**: 報告にバックアップの結果の行を足した。バックアップも『本番 DB のバックアップ』行のコマンドだけを使い、自分で組み立てない。
- **init**: 『本番 DB のバックアップ』は、問 6 で「③ DB を使わない」を選んだときだけ「無い（DB を使わない）」と書く。それ以外は未記入のまま残す（init では聞かない。migration を含む反映のときに release が聞く）。
- **maintenance §8（月次の復元テスト）**: 控えの取り方は『本番 DB のバックアップ』行にあると示し、その行が未記入か「無い」なら、復元テストの前に手段を決めるよう伝える。
- **雛形 `.claude/rules/docdd-kit.md`**: 変更影響表のあとに、migration を含む反映ではバックアップを取ってから反映する（取れなければ反映しない）ことを足した。
- **README 2 本**: release の説明にバックアップを足した。プラグインの README の「注意」に、キットは DB のコマンドを持たないこと、取れたかと戻せるかは別（復元テストは maintenance）を書いた。
- **検査スクリプト 5 本と `.claude/rules/docdd-kit.md`**: 刻印を v0.7.0 にした。

### 雛形への影響: あり

- `/docdd:update-kit` で足されるもの: `CLAUDE.md`「反映コマンド」表の『本番 DB のバックアップ』行（新しい行なので、update-kit が差分を見せて足す）。検査スクリプト 5 本・`.claude/rules/docdd-kit.md`（手付かずなら置き換え）。
- 足したあとは未記入のままでよい。**migration を含む反映のときに `/docdd:release` が候補を示して聞き、その場で書き込む。** migration を含まない反映では今までどおり何も聞かない。

### 置いた仮説

- バックアップを取る場所は「本番 DB を変える直前」ではなく「運営者の『はい』の直後・本番へ触れる最初の操作の前」にした。push やマージでホスティングが反映と migration を始める作りがあり、『本番へ反映』行の実行を待つと遅いため。
- migration の判定は、変更されたファイルのパス（`supabase/migrations/**`・`prisma/migrations/**`・`db/migrate/**`・`migrations/**`・`alembic/versions/**` など）で行う。プロジェクトごとの置き場は `docs/` と既存ファイルの並びで確かめる。
- 「無い（DB を使わない）」のまま migration が出てきたら、矛盾として止めて聞く（勝手に取る手段を決めない）。
- init では聞かない。導入時の質問を増やさず、実際に必要になった 1 回だけ聞く。

### 今回やらなかったこと（理由）

- バックアップのコマンドの同梱: キットは DB に触るコマンドを持たない方針（表に書かれたコマンドだけを実行する）。候補の提示までに留めた。
- 復元手順の雛形（`docs/`）: 復元の手順は DB とサービスで大きく違う。無ければ `/docdd:maintenance monthly` §8 がタスクとして起票する。
- 取った控えの世代管理・保管場所の決め（保持期間・暗号化）: 個人情報を含むため運営者の判断が要る。必要なら要決定として積む。
- evals のケース追加: 費用が出るため。

## 0.6.0（2026-09-20）

反映の方式の呼び名を、記号（A・B・C）から、何が起きるかが分かる言葉にした。非エンジニアが `CLAUDE.md` の表や `/docdd:release` の報告を読んだときに、「いまどの経路で公開されるのか」がその場で分かるようにする。あわせて、リポジトリの README に全体の流れの図を足した。

### 変更

- **雛形 `CLAUDE.md`「反映コマンド」表**: 『反映の方式』に書く値を「自動公開」「確認してから公開」「コマンドで公開」「まだ公開しない」の 4 つにした（説明は書かず、言葉だけを書く）。表の下の例も新しい呼び名にした。
- **release**: 経路の見出しと本文を新しい呼び名にした（「方式 A の短い経路」→「『自動公開』の経路」、「方式 B・C の経路」→「『確認してから公開』『コマンドで公開』の経路」）。古い書き方（「A: 本番ブランチへ push すると…」など）は読み替えてそのまま動かし、報告で「新しい呼び名に書き換えると読みやすい」と 1 行添える（勝手に書き換えない）。
- **init**: 問 5（反映の方式）の選択肢と、`CLAUDE.md` への書き込み方を新しい呼び名にした。作業ブランチを聞くのは「確認してから公開」のときだけ。
- **リポジトリの `README.md`**: 「全体像」の節を足した。init → PRD → add-task → dev-loop →（要決定）→ release の流れの図（Mermaid）、4 つの置き場の表、公開のしかたと hook の要点。詳しい説明書は `plugins/docdd/README.md` にあると節を分けて示した。
- **プラグインの `README.md`**: 全体像から流れの図はリポジトリの README へ送り、「この README の読み方」（どの節から読むか）を足した。許可のモード（defaultMode）の説明を、箇条書きから「したいこと → 頼むこと」の表にまとめた。スキル一覧の `/docdd:release` の行を新しい呼び名にした。
- **検査スクリプト 5 本と `.claude/rules/docdd-kit.md`**: 刻印を v0.6.0 にした（中身の変更は無い）。

### 雛形への影響: あり

- `/docdd:update-kit` で置き換わるもの: 検査スクリプト 5 本・`.claude/rules/docdd-kit.md`（手付かずなら。刻印だけの差）。
- 手で直すもの: `CLAUDE.md`「反映コマンド」表の『反映の方式』の値と、表の下の例（あなたのファイルなので、update-kit は文面を変えない）。**直さなくても `/docdd:release` は古い書き方のまま動く。**

### 置いた仮説

- 呼び名から記号（A・B・C）を外し、スキルの中の分岐も同じ言葉で書いた。記号は短いが、報告に「方式 A のため CI は無し」と出ても意味が伝わらないため。
- 古い値は release が読み替えるだけにし、update-kit では自動で書き換えない（利用者のファイルの文面を勝手に変えない方針のまま）。
- 流れの図は Mermaid で、リポジトリの README に 1 つだけ置いた（2 か所に置くと、片方が古くなる）。プラグインの README にはリンクだけを置く。

### 今回やらなかったこと（理由）

- 変更に関係するテストだけを自動で選ぶ仕組み（`vitest related` など）: いまは「触った層で検証の種類を決め、タスクの完了前と push 前は全部回す」作り。関係するテストの選び損ねで壊れるより、全部回して遅い方を選ぶ。テストが増えて遅くなったときに、「検証コマンド」表の任意の行として検討する。
- evals のケース追加: 費用が出るため。既存の `release-not-published` は『反映の方式』が「まだ公開しない」なので、呼び名の変更では変わらない。
- 空のリポジトリでの `/docdd:init` の通し確認: init の変更は問 5 の選択肢の文言と書き込み方だけで、雛形を置くスクリプト（`init.mjs`）の処理は変えていないため、テスト 129 件で代替した。

## 0.5.0（2026-09-19）

BACKLOG を小さく保つ。終えたタスクまで `tasks/BACKLOG.md` に残すと、ファイルが育ち続け、「BACKLOG を読む」スキル（dev-loop・add-task・tasks-from-prd）が読むだけで作業の場所（コンテキスト）を使い、末尾の未着手のタスクを見落とす。1 人で長く開発を続けたプロジェクトで、BACKLOG が 1 万行・2MB 近くまで育った実例がある。終わったものは別のファイルへ移し、BACKLOG にはまだ動いているものだけを置く。

### 追加

- **雛形 `scripts/backlog-archive.mjs`**（キットが管理するファイル）: `tasks/BACKLOG.md` から、見出しの末尾の状態が `done`・`dropped` のタスクと、「要決定」の節で「- 状態: 決定…」の行がある判断を、`tasks/archive/BACKLOG-done.md` へ移す。
  - 運用ルールの書式の見本（コードブロックの中）は移さない。未決（「状態: 未決」）の判断は、本文に「解決」などの語があっても移さない。
  - 判断は「決定済み」の節の末尾へ、タスクはアーカイブの末尾へ足す。アーカイブが無ければ作り、見出しを消してあれば足す。移す文の相対リンクは、1 段深いアーカイブから同じ所を指すように直す。
  - `--check` は移さずに、移すものがあれば一覧を出して exit 1。改行（CRLF）は元のファイルに合わせる。
- **雛形 `tasks/archive/BACKLOG-done.md`**: 移した記録の置き場（見出し 2 つだけ）。丸ごと読まず、ID や言葉で検索して使う。
- **`package.json` の scripts**: `backlog:archive`（`node scripts/backlog-archive.mjs`）。
- **雛形 `.claude/settings.json`**: allow に `node scripts/backlog-archive.mjs`（と `--check`）・`npm run backlog:archive`。

### 変更

- **dev-loop**: 最初に `node scripts/backlog-archive.mjs` を回してから BACKLOG を読む。完了時にも回し、タスクのコミットに BACKLOG とアーカイブを含める。依存先が BACKLOG に無ければアーカイブを ID で検索して、`done`・「決定」かを確かめる。テスト基盤の門の「`done` がある」「`dropped` だけ」「どこにも無い」は、BACKLOG とアーカイブの両方で見る。スクリプトが無い（まだ update-kit していない）ときは移さずに進み、`/docdd:update-kit` を案内する。
- **add-task**: 二重の起票の確認で、アーカイブを要望の言葉で検索する（丸ごとは読まない）。T-番号・D-番号はアーカイブも含めた最大の次にする。
- **tasks-from-prd**: 既存のタスクと番号を、アーカイブも含めて見る。
- **release**: 「テスト無しで本番反映する」の決定を、BACKLOG とアーカイブの両方で探す（決まった判断はアーカイブへ移るため）。
- **init（スクリプト）**: 定型タスクの番号をアーカイブも含めた最大の次にし、アーカイブにある「アプリの土台を作る」（終えたもの）を足し直さない。
- **init（スキル）**: 取り込んだ仕様を分けるタスクの番号も、アーカイブを含めて数える。
- **雛形 `tasks/BACKLOG.md`** の運用ルール: 終えたら移す・番号はアーカイブも含めた最大の次・アーカイブは検索して使う、に書き換えた（「完了タスクは消さず `done` にする」をやめた）。
- **雛形 `.claude/rules/docdd-kit.md`**: 開発の進め方と Definition of Done に、アーカイブへ移すことを足した。
- **雛形 `CLAUDE.md`**: ディレクトリ構成に `tasks/archive/BACKLOG-done.md` の行を足し、`scripts/` の行に BACKLOG の整理を足した。
- **検査スクリプト**: 4 本の刻印を v0.5.0 にした。

### 雛形への影響: あり

- `/docdd:update-kit` で置き換わる・足されるもの: `scripts/backlog-archive.mjs`（新規）・`tasks/archive/BACKLOG-done.md`（新規）・`.claude/rules/docdd-kit.md`・検査スクリプト 4 本（手付かずなら）・`package.json` の `backlog:archive`・`CLAUDE.md` のディレクトリ構成の行。
- 手で直すもの: 既にある `tasks/BACKLOG.md` の「運用ルール」の文面（あなたのファイルなので、update-kit は節を足すだけで文面は変えない。直さなくてもスキルは新しい手順で動く）。`.claude/settings.json` の allow の追加（update-kit が差分を見せる）。

### 置いた仮説

- 移すのは「状態: 決定」の判断だけにした。書き戻し（PRD・ADR）が済んだかは見ない。書き戻しは、その判断に依存するタスクを dev-loop が選んだときに確かめる（アーカイブの「状態」行に書き戻し先がある）。
- アーカイブは `tasks/` の下に置いた。`check-doc-placeholders` は `tasks/*.md` として見るが、`check-doc-refs`・`check-doc-dates` は見ない（終えたタスクが、もう無いファイルを指していても落とさない）。

### 今回やらなかったこと（理由）

- evals のケース追加: 費用が出る（1 回約 4 ドル）ため。挙動はテスト（`tests/template-scripts.test.mjs`・`tests/init.test.mjs`）で固定した。
- アーカイブの分割（年ごとなど）: 1 人のプロジェクトでは検索で足りる。育って検索が遅くなったら考える。

## 0.4.0（2026-09-15）

コミュニティのマーケットプレイスへの申請の前に、許可設定・配布の手順・安全の柵を見直した。あわせて、検査が黙って合格する所（Vite の型検査、yarn v2 以上の監査）と、Web 以外で聞かなくてよい問いを直した。これまでの「やらなかったこと」のうち、秘密の値の検査（hook の第 2 段）、Windows の CI、URL の検査、脆弱性の ID での照合、`check-doc-refs` の for example の箇条、playwright-cli の `references/` の置き換えを、今回行った。

### 追加

- **hook: 秘密の値の検査**: docdd のプロジェクトで、`git commit` を含むコマンドの直前に、コミットに入る中身を調べる。見るのは、stage 済みの追加した行と、同じコマンドの中で `git commit` より前に `git add` したファイル（`cd`・`git -C` も追う。バイナリは飛ばす）。`git commit --dry-run` では調べない。
  - 止める: `.env`・`.env.*` のファイル（末尾が `.example`・`.sample`・`.template` のものは除く）、`git add -f`／`--force` での `.env` の形のファイル、秘密鍵（見出しと本体）、AWS のアクセスキー ID、Anthropic・OpenAI・Stripe（本番）・GitHub・Slack・Google の API キーやトークン、Slack の Webhook の URL、Supabase の秘密キー（`sb_secret_`）、role が service_role の JWT。
  - 確認を出す: 秘密らしい名前（`api_key`・`secret`・`token`・`password` など）に 16 文字以上の文字列を入れた行、調べた中身が 2MB を超えたとき。
  - 見本の値（`example`・`dummy`・`your-`・`xxxx` など）と、環境変数から読む行は通す。`docdd-allow-secret` を書いた行は飛ばす（`.env` のファイルには効かない）。止めるときも、キーそのものは表示しない。
  - `hooks.json` の git の handler の timeout を 30 秒にした（時間切れだと通してしまうため。macOS での実測は 1 回 0.5 秒未満）。
- **hook: PowerShell**: matcher を `Bash|PowerShell` にし、`PowerShell(git *)`・`PowerShell(Remove-Item *)` の handler を足した。git の判定と秘密の値の検査は Bash と同じ。`Remove-Item` の `-Recurse`・`-Force` で確認を出す（`guard-bash.mjs` は別名の `rm`・`del`・`erase`・`rd`・`rmdir`・`ri` も同じに扱う）。根拠は公式の hooks・tools-reference・permissions の頁で、Windows の実機では確かめていない。別名で hook が呼ばれるかも確かめていない（公式で別名を同じに扱うと書かれているのは許可の規則で、hook の `if` ではない）。macOS・Linux の pwsh の `rm` は OS の `rm` なので、`PowerShell(Remove-Item *)` に合わない見込み。
- **init**: Python を見つけたときだけ、`.gitignore` に「# docdd: Python」の塊（`__pycache__/`・`*.py[cod]`・`.venv/`・`.pytest_cache/`・`.mypy_cache/`・`.ruff_cache/`）を使う。update-kit も同じ選び方。
- **init**: Unity では『型検査』『lint』を「無い」と推定する。
- **init**: Vite のプロジェクトで `start` が無く `preview` があれば、『本番モード起動』を `<build> && <preview>`（`npm run build && npm run preview` など）と推定する。
- **雛形 `CLAUDE.md`**: 検証コマンドの例に「Unity のビルドの例」（ビルド用のスクリプト無しの `-build` と `-buildTarget`／`-activeBuildProfile`。docdd では確かめていない）。
- **雛形 `docs/operations/development-and-testing.md`** §4: 「Unity のビルドと PlayMode テスト」の箇条。
- **配布リポジトリ**:
  - `scripts/check-version-bump.mjs`（`npm run check` に追加）: 最新のタグ `docdd--vX.Y.Z` から `plugins/docdd/` の中身が変わったのに、版が同じなら落とす（`README.md`・`CHANGELOG.md`・`evals/` だけは数えない）。版を下げても落とす。
  - `scripts/check-urls.mjs`（`npm run check:urls`。CI には入れない）: README 2 本・CHANGELOG・RELEASING・skills・templates・examples の外部リンクを開けるか。
  - `scripts/run-tests.mjs`: `npm test` から `tests/*.test.mjs` を並べて `node --test` に渡す（macOS の Node 18・20・22・24 で同じ結果を確かめた。シェルの `*` の展開に頼らないので Windows の npm でも動く形だが、Windows の実機では確かめていない）。
  - `.gitattributes`: 改行を LF に固定した（Windows で取り出しても、テストと evals の scaffold が動く）。
  - Issue テンプレート: 「質問・分かりにくい所」（必須は「困っていること」だけ）と「要望」、`config.yml`（空の Issue は出さない）。どれも日本語でも英語でも書ける。
  - CI: `test-node18`（Node 18 で `npm test`）と `test-windows`（Windows で `npm test`。落ちても CI は止めない）。
- **evals**: grader 2 本（`init-unity-project` で『型検査』『lint』が「無い」、`init-new-node-project` で `.gitignore` に Python の塊が無い）。
- **テスト**: guard-bash に 16 本（秘密の値・PowerShell）。init に settings の差分・`.gitignore` の塊・Unity・監査のコマンド・Vite・CRLF。template-scripts に据え置きの ID と見本の箇条。新しく `tests/repo-scripts.test.mjs`（版の上げ忘れ・URL の検査）。
- **RELEASING.md**: 「main と配布」と「コミュニティのマーケットプレイスへの申請」（フォームに入れる値、説明と使い方の例 3 つを日本語のあとに英語で）。

### 変更

- **雛形 `.claude/settings.json`**: 始まりのモード `defaultMode`（`acceptEdits`）を外した。Pro・Max・Team の既定の auto モードを上書きしない。`allow`・`ask`・`deny` は変えていない。
- **init**: 問 8（settings を置くか）は、`.claude/settings.json` が無いときだけ聞く。既存の settings の差分から `defaultMode`・`missingMarketplace`・`missingEnabledPlugin` の欄を外し、始まりのモード（`currentDefaultMode`）を報告する。update-kit の報告も同じ。
- **init: 依存の脆弱性の推定**: npm 以外も本番の依存だけを見る。pnpm は `pnpm audit --audit-level=high --prod`、yarn v1 は `yarn audit --level high --groups dependencies`、yarn v2 以上は `yarn npm audit --recursive --severity high --environment production`（前は直接の依存しか調べず、依存の依存にある high を見落としていた）、bun は `bun audit --audit-level=high --prod`。npm は変えていない。yarn v2 以上は、`.yarnrc.yml` や `packageManager` の指定が無くても、`yarn.lock` の `__metadata:` で見分ける。
- **init: Vite の型検査の推定**: `tsconfig.json` が references の形で、`build` が `tsc -b`／`vue-tsc -b` を使い、参照先がどれも JS を書き出さなければ、`npx tsc -b`（Vue は `npx vue-tsc -b`。パッケージマネージャに合わせた形）にした。前の `npx tsc --noEmit` は、この形では 1 ファイルも調べずに合格していた。include の形（Next.js など）は今までどおり `npx tsc --noEmit`。
- **init: 開発サーバーのアドレス**: Vite・SvelteKit・Astro・Nuxt の『開発サーバー起動』に書くアドレスを `http://localhost:<ポート>` にした。これらは既定で localhost だけで待ち受け、macOS では 127.0.0.1 だと接続を断られるため。Next.js は今までどおり `127.0.0.1`。preview の『本番モード起動』にもアドレスを添える（`http://localhost:4173`、または `scripts.preview` の `--port`）。
- **init: Windows での git の一番上の判定**: 今いるフォルダと git の一番上のパスを、OS が返す正式な名前にそろえてから比べる。短い名前（`RUNNER~1` など）や大文字小文字の違いで「一番上ではない」と誤り、モノレポの位置もずれていた（CI の `test-windows` で見つかった）。
- **init・update-kit: `.gitignore`**: 新しく置くときも、プロジェクトに合う塊だけを並べる（雛形の丸写しをやめた）。
- **audit-check**: 据え置きを、パッケージの単位から脆弱性の ID（GHSA）の単位にした。
  - 一覧の形は `{ "<パッケージ名>": { "ids": ["GHSA-xxxx-xxxx-xxxx"], "why": "<なぜ今直さないか>", "until": "YYYY-MM-DD" } }`。3 つとも必須で、欠けや古い書き方（値が文字列）は exit 2 で書き方を示す。「期限なし」の警告は無くした。
  - 一覧にあるパッケージでも、`ids` に無い high は落ちる。critical は据え置けない。期限切れは落ちる（どちらも今までどおり）。
  - 依存の脆弱性が伝わって high になっただけの親（例: express）は数えない。npm audit の経路と、bulk endpoint に直接問い合わせる経路で、合否と出力が同じ。
  - 落ちたときに、一覧に貼れる JSON を出す。合格したときに、据え置き中の ID と、一覧から消せる ID を出す。
  - 件数の行は、脆弱性を持つパッケージの数から、脆弱性の数になった（前の報告と比べるときは、数え方が違う）。
- **check-doc-refs**: 行末が `for example`・`for instance`・`e.g.`・`例えば`・`たとえば` の行（末尾のコロンは無視）に続く箇条を、見本として検査しない。「例外」の「例」は数えない（「例外」のほかに「例」が無い行は検査する）。落ちたときの案内を 2 行にした。
- **検査スクリプト**: 4 本の刻印を v0.4.0 にした。
- **playwright-cli・ui-polish・verify-e2e**: プロジェクトの Playwright で代用できるかを、`npx --no-install playwright cli --help` の出力に `playwright-cli` を含む行があるかで決める（古い Playwright は、別のヘルプを出して終了コード 0 で終わるため、終了コードでは決めない）。playwright-cli の `allowed-tools` に `Bash(npx --no-install playwright cli *)` を足した。
- **playwright-cli**: 詳しい使い方は、`playwright-cli --help` の `Agent skill:` 行が指す公式の手順書を読む。行が無い・読めないときは `--help` で進める。公式の手順書と違う所（`@latest` での入れ方・保存先・`playwright-cli install`）は docdd の決まりに従う。固定の版は 0.1.17 のまま。
- **playwright-cli・ui-polish**: 開発サーバーのアドレスの例を、『開発サーバー起動』行のアドレス（例: `http://localhost:5173`）に合わせた。127.0.0.1 で開くときは、Vite などの開発サーバーを `--host 127.0.0.1` で起動する、を足した。
- **maintenance・security-audit**: 据え置きの説明を、ID の単位と「一覧が効くのは npm の audit-check だけ」に合わせた。npm 以外は `tasks/BACKLOG.md` の要決定に、ID・理由・期限を書く。
- **雛形 `CLAUDE.md`**: ディレクトリ構成の `.claude/settings.json` の行から「プラグインの取得元」を消した。Unity の例の PlayMode テストに「docdd では確かめていない」を足した。pnpm の『依存の脆弱性』の例に `--prod` を足した。据え置きの一覧の説明を、npm の audit-check だけに効き、ID・理由・期限を書く形にした（npm 以外は `tasks/BACKLOG.md` の要決定に書く）。
- **雛形 `docs/README.md`**: 参照の検査で見本として見ない所を、3 つの箇条にした（「例」の字がある行、コメントとコードブロックの中、前置きの行に続く箇条）。据え置きの一覧の説明を、雛形 `CLAUDE.md` と同じにした。
- **雛形 `docs/operations/development-and-testing.md`**: Godot には標準のテスト道具が無いので、アドオンの GUT か gdUnit4 を入れる、にした。
- **雛形 `.claude/rules/docdd-kit.md`**: 刻印を v0.4.0 にした。
- **hook の説明**（`hooks.json` の description）に、秘密の値と PowerShell を足した。`rm` の確認の文面に `Remove-Item` を足した。
- **CI**: `ci.yml` の冒頭を「main はいつ配布されてもよい状態に保つ。PR の CI で緑にしてから入れる」にした。
- **Issue テンプレート `bug.yml`**: 必須を「起きたこと」と「docdd の版」の 2 つにし、冒頭の文と揃えた。
- **evals**: `init-unity-project` の期待する結果に、『型検査』『lint』が「無い」を足した。
- **テスト**: `tests/init.test.mjs` を、Windows の改行（CRLF）で取り出しても通るようにした（chmod のテストは Windows では飛ばす）。
- **マニフェスト**: `plugin.json` を 0.4.0 にした。`plugin.json`・`marketplace.json` の説明の日本語のあとに、英語を 1 文足した。プラグインの説明の hook に、秘密の値を足した。
- **README 2 本**: 冒頭に使える環境（Claude Code 向け。Cowork では確かめていない）と英語の要約。確認の出方（auto モード、allow・ask・deny、hook、`defaultMode` の足し方と、消したときに始まるモード）。入れ方・更新・やめ方で、`@` の右の名前を `/plugin list` で確かめる書き方。hook の表（秘密の値・PowerShell）と Windows の注意。Unity のビルドのコマンド。依存の脆弱性のコマンドの表と、据え置きの書き方。Issues のリンクを、種類を選ぶ画面（`issues/new/choose`）にした。「手順書を直したいとき」に写すときの注意 4 点。
- **NOTICE**（2 本）: `references/` の同梱をやめた書き方にした。
- **RELEASING.md**: main へのマージを配布として扱う手順にした（PR の CI で緑にしてからマージ、版の上げ忘れの検査、`npm run check:urls`）。

### 削除

- 雛形 `.claude/settings.json` の `permissions.defaultMode`・`extraKnownMarketplaces`・`enabledPlugins`。別の PC でフォルダを開いたときに入れ方を案内する働きは、無くなった（ほかの配布元から入れた人のプロジェクトに、違う配布元の docdd を有効にする指定を置かないため）。
- init の問い「既存の settings.json に 2 つのキーを足すか」と、そのための Edit の手順。
- `skills/playwright-cli/references/` の 9 本（上流の `@playwright/cli` 0.1.17 の写し）。
- `scripts/audit-allowlist.json` の古い書き方（値が理由の文字列、ID の無い形）と、「期限なし」の警告。

### 雛形への影響: あり

- `/docdd:update-kit` で置き換わる（手付かずのとき。手を入れていれば、差分を見せて聞く）: `.claude/rules/docdd-kit.md`（刻印だけ）、`scripts/audit-check.mjs`・`scripts/check-doc-refs.mjs`（中身）、`scripts/check-doc-dates.mjs`・`scripts/check-doc-placeholders.mjs`（刻印だけ）。
- update-kit が、足してよいかを聞く: `.gitignore` の足りない行（Python のプロジェクトなら「# docdd: Python」の塊）。
- 変わらない（利用者のファイル）。要るなら、雛形（リポジトリの `plugins/docdd/templates/`）と見比べて、手で直す。
  - `scripts/audit-allowlist.json`: 中身を書いていたら、`ids`・`why`・`until` の形に書き直す。古い書き方のままだと、置き換わった `audit-check.mjs` が exit 2 で止まる（`{}` のままなら直さなくてよい）。
  - `.claude/settings.json`: auto モードで始めたいなら、`defaultMode` の行を消す。消したあとに auto モードで始まるのは、Pro・Max・Team で、`~/.claude/settings.json` にも別の `defaultMode` が無いとき。Enterprise・Console の API キーでは Manual で始まるので、`~/.claude/settings.json` の permissions に `"defaultMode": "auto"` を書く（README「英語で出る確認と答え方」）。ほかの配布元から入れたなら、`extraKnownMarketplaces`・`enabledPlugins` の docdd の行を消す。update-kit は、始まりのモードを報告する。
  - `CLAUDE.md`「検証コマンド」表: Vite で『型検査』が `npx tsc --noEmit` なら `npx tsc -b`（Vue は `npx vue-tsc -b`）に。pnpm・yarn・bun の『依存の脆弱性』行を、上の新しいコマンドに。Unity で『型検査』『lint』が未記入なら「無い」に。Vite・SvelteKit・Astro・Nuxt で『開発サーバー起動』のアドレスが `http://127.0.0.1:<ポート>` なら `http://localhost:<ポート>` に。表の下の例（Unity のビルドの例、PlayMode の注記、pnpm の例の `--prod`、据え置きの一覧の説明）と、ディレクトリ構成の設定の行の文言。
  - `docs/README.md`: 参照の検査で見本として見ない所の説明と、据え置きの一覧の説明。
  - `docs/operations/development-and-testing.md` §4: Godot の書き方と、「Unity のビルドと PlayMode テスト」。
- hook とスキルの変更は、プラグインを更新すれば効く（update-kit は要らない）。

### 仮説（決まっていない点を、こう置いた）

- H1: `plugins/docdd/` の中でも、`README.md`・`CHANGELOG.md`・`evals/` だけを変えたときは版を上げない（入れている人の動きが変わらないため）。版の上げ忘れの検査も、この 3 つは数えない。
- H2: Cowork では動作を確かめていない。README と申請の文面には「Claude Code（ターミナル・Desktop・IDE）向け。git・Node.js・ターミナルが要るので、Cowork では確かめていない」と書く。
- H3: 秘密の値は、確実な形（秘密鍵・既知の形のキー・`.env` の追加）なら止め、怪しい形なら確認を出す。誤検知のときの逃げ道は、その行に `docdd-allow-secret` と書くこと（止めるときの文面で、運営者に確かめてから書くよう求める）。
- H4: 据え置きの一覧は `ids`・`why`・`until` を必須にし、古い書き方は exit 2 で書き方を示す（利用者がまだいないので、移行の仕組みは作らない）。
- H5: `.gitignore` の Python の塊は、Python を見つけたときだけ足す。Web の塊の選び方は変えない。
- H6: Godot では『型検査』『lint』を推定しない（「無い」と決める根拠が無い）。
- H7: 必要な Node.js は 18 以上のまま（今の中身で正しい）。CI で 18 を回して確かめる。
- H8: Vite のプロジェクトで `preview` があれば、それを『本番モード起動』とみなす。
- H9: playwright-cli の固定の版は 0.1.17 のまま（新しい版を、実際のブラウザで確かめていないため）。
- H10: 「事例」「比例」なども「例」を含むので、今までどおり見本として飛ばす。「例外」だけは語として除いて判定する。
- 実装で置いた決定: Vite の references の形で、`build` に `tsc -b` が無いとき、`extends` の先を読めないとき、参照先が JS を書き出すときは、『型検査』を推定しない（ヒアリングで聞く）。1 ファイルも調べずに合格するコマンドを、表に書かないため。

### 今回やらなかったこと（理由）

- 脆弱性を非公開で知らせてもらう窓口（`SECURITY.md`・GitHub の非公開の報告）: 置かない。審査では求められておらず、利用者の多くは非エンジニアで、使う場面がほぼ無い。置くと、通知を見て返事を続ける負担が出るため。知らせは Issues で受ける。
- Unity の PlayMode テストとコマンドでのビルドの実測: 今回も Unity を起動していない。README と雛形は「docdd では確かめていない」と揃え、書き方は Unity 6000.3 の公式ドキュメントに合わせた。Unity CLI は experimental のままなので、紹介しない。
- どの配布元から入れたかを init が調べ、設定を書き分けること: キャッシュの置き場所の形が、公式に保証されていないため。README は「`@` の右の名前は `/plugin list` で確かめる」書き方にした。
- main のブランチ保護（CI の合格を必須にする）: 1 人の運用で手間が増えるため。代わりに、版の上げ忘れを CI で落とし、手順で PR の CI を緑にしてからマージする。
- 雛形の許可設定に、PowerShell 用の規則を足すこと: `allow`・`ask`・`deny` は変えない決定のため。PowerShell では hook だけが柵になる。
- 秘密の値の検査を push の直前にも行うこと: コミットの直前で止めれば、push には入らないため。npm のトークンと Stripe のテスト用のキーの形も、今回は対象外。
- 動作の評価（evals）を GitHub 上で回すこと: 1 回約 4 ドルの API の請求と、キーの管理が要るため。今のまま、手元で手動で回す。
- playwright-cli が手元以外のサイトを開くときに、hook で確認を出すこと: クリックやリダイレクトでの移動は hook から見えず、「確認が出るから安全」と誤解させるおそれがあるため。本番での入力や送信は、スキルの文章で禁じている。使った人の声を待つ。
- 手順書を写す専用のスキル（eject）: 作らず、README「手順書を直したいとき」に注意 4 点を足した。丸ごと写すと update-kit で新しい版に追随できず、キットの利点を失うため。
- `CONTRIBUTING.md`・行動規範: 外部からの貢献者がまだいないため。最初の PR や声が来てから考える。
- ゲームエンジン向けの変更影響表・専用スキル: 今のまま（汎用の行と「スキルへの追加指示」で合わせる）。PlayMode もビルドも実測していないため。
- 導入済みかを判定するスクリプト（`docdd-status.sh`、0.2.0 の宿題）: 宿題から外した。`init.mjs` の `status` で置き換え済み（スキルの前置きも、init の前なら止まって `/docdd:init` を案内する）。
- 英語の要約の一致を見る検査: 足していない。README 2 本の英語の要約は同じ文にし、RELEASING.md の申請の節に、変えるときは揃えると書いた。
- Windows の実機での確認（PowerShell の hook・CI の `test-windows`）と、evals の本実行（新しい grader 2 本を含む）: 実機が無く、evals は費用が出るため。`test-windows` は、落ちても CI を止めない。

## 0.3.0（2026-09-14）

Web 以外のプロジェクト（Unity などのゲーム・ネイティブアプリ）で害が出ないように直した。細部は `CLAUDE.md`「スキルへの追加指示」と README「Web 以外のプロジェクトで使う（例: Unity）」で合わせる。

### 追加

- **init**: `status` の `stack` に `kind`（`web`・`unity`・`godot`・`flutter`・`android`・`apple`・`dotnet`・`unknown`）・`web`（`true`／`false`／`null`）・`unity`（`editorVersion`）を足した。目印は Unity が `ProjectSettings/ProjectVersion.txt`、Godot が `project.godot`、Flutter が `pubspec.yaml` の `flutter:`、Android が gradle ファイルの `com.android`、Apple が一番上の `*.xcodeproj`・`Package.swift`、.NET が一番上の `*.sln`・`*.csproj`。Web のフレームワークが無く、これらの目印があれば `web` は `false`。
- **雛形 `.claude/rules/docdd-kit.md`**: 変更影響表に「画面・操作（Web 以外）」行（『E2E（実際に動かす）』行の自動テスト。自動テストで確かめられない見た目・操作は、運営者に確かめてもらう手順を示して「運営者確認待ち」）と、「エンジンやツールが保存するファイル」行（手で書き換えず、対になるファイルの増減を `git status` で確かめる）を足した。
- **雛形 `CLAUDE.md`**: 検証コマンドの例に「Unity の例」を足した。
- **verify-e2e**: `references/pitfalls.md` に 3 行（テストが 0 件でも成功の終了コード、Editor が同じプロジェクトを開いている、`-runTests` と `-quit` を一緒に使う）。
- README に「Web 以外のプロジェクトで使う（例: Unity）」（init の判定・Unity の検証コマンドの例と注意・おすすめの追加指示・許可設定の直し方・Web 以外で変わる動き）。
- evals に 3 ケース: `init-unity-project`・`tasks-from-prd-waits-for-approval`・`release-not-published`。
- テスト: Unity・Godot・Flutter・Android・Apple・.NET の判定、Web 以外の `.gitignore`、旧い行名「E2E（実ブラウザ）」の読み取り、`check-doc-refs` の Web 以外の拡張子。

### 変更

- **行名**: `CLAUDE.md`「検証コマンド」表の「E2E（実ブラウザ）」を「E2E（実際に動かす）」にした（トークン `{{E2E}}` は同じ）。`init.mjs` は旧名の行も読んで埋める（行名は書き換えない）。変更影響表の「画面」行を「画面（Web）」にした。
- **init**: Web 以外（`stack.web` が `false`）では、『開発サーバー起動』『本番モード起動』を「無い」と推定する（Unity と Godot では『依存の脆弱性』も）。『単体・DBテスト』『E2E（実際に動かす）』『ビルド』は推定しない。`.gitignore` は「# docdd: 共通」の塊だけを使う。`status.next` と報告で README の節を案内する。ファイルの走査で `Library`・`Temp`・`Logs`・`UserSettings`・`obj`・`Build`・`Builds`・`.godot`・`Pods`・`DerivedData`・`.gradle` の中を見ない。仕様書の候補から `ProjectSettings/`・`Packages/`・`Assets/`・`addons/`・`Pods/`・`android/`・`ios/` の下を外し、`.txt` はファイル名に仕様らしい語があるときだけにした。既存コードの判定で `Assets/TutorialInfo/`・`Packages/` の下を数えず、Godot の `.gd`・Flutter の `.dart`・C/C++・Lua も数える（Godot の `addons/` と、Flutter の `android/`・`ios/`・`linux/`・`macos/`・`windows/`・`web/` の下は数えない）。Web のプロジェクトで `dev` が無いときは `serve`・`start` を開発サーバーとみなし、どちらも無ければ『開発サーバー起動』を未記入のまま聞く（「無い」にすると Web 専用のスキルの門で止まるため）。`docs/_imported/` へ移すのは Markdown の仕様書・メモだけにした。参照の検査がキットの置いていない既存の文書で落ちたら、勝手に直さず、報告して進めてよい。
- **update-kit**: 参照の検査がキットの置いていない既存の文書で落ちたら、勝手に直さない。
- **雛形 `.gitignore`**: 「# docdd: 共通」と「# docdd: Web（Node.js・ビルド出力・Playwright）」の 2 つの塊に分けた。
- **雛形 `.claude/rules/docdd-kit.md`**: DoD の UI 行を Web と Web 以外に分けた。規約の言語は、既存の文書・コミットが別の言語ならそれに合わせる。コミットの承知・決まったブランチ運用は「スキルへの追加指示」に書く、の 1 行を足した。規約の一時ファイルの行は、`.playwright-cli/` が .gitignore 済みなのを Web のプロジェクトだけにした（Web 以外では Web の塊を足さないため）。
- **雛形 docs・tasks**: PRD の §3.3 を「主な画面（ゲームならシーン）と利用者の流れ」にし、§2 の例に「プレイヤー」を足した。`development-and-testing.md` §4 に Unity Test Framework（EditMode／PlayMode）と Unity の注意 2 点。`requirements/README.md` に、見出し ID の接頭辞は文書ごとに足してよい（例: RULE-01）。`docs/README.md` は、参照の検査の拡張子を `scripts/check-doc-refs.mjs` に任せる書き方にした。BACKLOG の基盤タスクの見本の行名を揃えた。
- **検査スクリプト**: `check-doc-refs` の対象の拡張子に 33 個を足した（Web の `html`・`vue` など、Unity の `cs`・`unity`・`prefab`・`asset` など、Godot の `gd`・`tscn` など、ネイティブアプリの `swift`・`kt`・`dart` など、C/C++ など）。既存の文書に、まだ無いファイルを「例」の字なしで書いた行があると、新たに「無いファイル」と出る。4 本の刻印を v0.3.0 にした。
- **ui-polish・speed-up・playwright-cli**: 手順の最初に「Web の門」を置いた。『開発サーバー起動』行が「無い」なら「該当なし」と報告して止まる。
- **verify-e2e**: Web 以外は『E2E（実際に動かす）』行のコマンドで確かめる。合否は終了コードだけでなく、結果の件数・失敗数でも見る（0 件は合格にしない）。Editor のロックなどで動かせなければ、Claude はエディタを閉じず、運営者に確かめてもらう（探索的確認）。
- **release**: 「実ブラウザで確認する」を「公開先で確認する」にした。Web 以外はブラウザで開かず、運営者に確かめてもらう手順を示す（まだなら「運営者確認待ち」）。ホスティングを使わないなら、ビルド成功を待つ手順を飛ばす。
- **add-task**: 要望の形を「誰が・どの画面（ゲームならシーン・モード）で・何ができるようになるか」にした。見出し ID の接頭辞を文書ごとに足してよい。
- **refactor**: 振る舞いの保存に、エンジンが保存する値と参照（例: Unity のシリアライズされた値・.meta の GUID）を含めた。
- **dev-loop**: 行名を揃え、報告に「運営者確認待ち」を載せる。
- **マニフェスト**: `plugin.json` を 0.3.0 にした。`plugin.json`・`marketplace.json`・README 2 本の説明を「Web アプリやゲームなど」に広げた。
- **CI**: `actions/checkout` と `actions/setup-node` を v7（Node.js 24 で動く版）にした。
- 0.2.0 の項の evals の記述を、事実に合わせて直した。

### 雛形への影響: あり

- `/docdd:update-kit` で置き換わるのは、キットのファイルの `.claude/rules/docdd-kit.md` と `scripts/*.mjs`（4 本）だけ。
- 利用者のファイル（`CLAUDE.md` の行名と Unity の例、`docs/PRD.md` の §3.3 の見出しと §2 の例、`docs/README.md`、`docs/requirements/README.md`、`docs/operations/development-and-testing.md`、`tasks/BACKLOG.md`、`.gitignore` の 2 つの塊）は、update-kit では変わらない（update-kit が足すのは新しい版で増えた節と行だけで、既存の節の中の文言は変えない）。要るなら、雛形（リポジトリの `plugins/docdd/templates/`）と見比べて手で直す。特に v0.2.0 で置いた `CLAUDE.md` の行名「E2E（実ブラウザ）」は、`init.mjs` は旧名も読むが、スキルは新しい行名で書いてあるので、手で「E2E（実際に動かす）」に直す。

### 今回やらなかったこと（理由）

- スタック別の変更影響表・エンジン専用のスキル: Web 以外で害が出ないように直すことを優先した。細部は「スキルへの追加指示」と README の案内で合わせる。
- v0.2.0 で置いた行名「E2E（実ブラウザ）」と `.gitignore` の見出し「# docdd」を update-kit で移すこと: 既存の利用者がいないため。
- Unity の PlayMode テストとコマンドでのビルドの実測: README と雛形の例は、Unity 公式ドキュメントと、別の検証用プロジェクトでの EditMode テストの実測に基づく。
- `check-doc-refs` で、英語の for example に続く箇条を見本として飛ばすこと: 判定は行ごとなので、飛ばすにはその行に「例」の字を入れる。
- 新しい evals 3 ケースの本実行: ケースの読み込みと、scaffold・grader の形だけ確かめた。本実行は `RELEASING.md` の手順で行う。
- Unity CLI・MCP サーバーの案内: experimental で、docdd では確かめていない。
- playwright-cli の `references/` の置き換え（0.2.0 の「次の版の予定」）: 今回は Web 以外への対応を優先した。次以降の版で行う。

## 0.2.0（2026-09-13）

### 追加

- スキル `tasks-from-prd`: PRD の機能一覧から最初のタスク群を下書きし、承認後に `tasks/BACKLOG.md` へ起票する。
- スキル `update-kit`: プラグインを更新したあと、置いた雛形を新しい版へ追随させる。手付かずのファイルは置き換え、手を入れたファイルは差分を見せて 1 件ずつ聞く。v0.1 系からの移行もこれで行う。
- `scripts/init.mjs`: init と update-kit が使う決まった処理（`status`・`apply`・`dates`・`precommit`・`update`）。雛形を Claude が手でコピーしなくなった。
- hook（`hooks/hooks.json`・`scripts/guard-bash.mjs`）: docdd のプロジェクトで、まとめて全部を stage する `git add`、`git commit -a`・`--amend`・`--no-verify`、角括弧つきの CI 省略の印、強制 push を止める。`rm -r`／`rm -f` の前には確認を出す。
- 雛形: `.claude/rules/docdd-kit.md`（キット共通の約束。`CLAUDE.md` から移した）、`.gitignore`、`docs/requirements/00_template.md`、`scripts/check-doc-placeholders.mjs`（未記入の欄 `{{…}}` の検査）。
- 記入済みの PRD 見本 `examples/PRD.sample.md`。
- `references/pitfalls.md`（症状・見る場所・対策の表）: verify-e2e・verify-integration・ui-polish・security-audit・speed-up。
- evals（3 ケース。手動で回す）、`LICENSE` のコピー、`NOTICE`（playwright-cli の出典）、この `CHANGELOG.md`。

### 変更

- **init**: 雛形は `init.mjs` が上書きせずに置く。検証コマンドは `package.json`・`pyproject.toml` などから推定して埋め、ヒアリングは分からない欄だけを、選んで答える問い（選択の画面）と書いて答える問い（番号付きの 1 メッセージ）に分けて聞く。何度実行しても安全（答えられる欄を聞き直し、推定できない行は一覧で示す）。引数で答えを渡すと質問せずに進む。既存の `CLAUDE.md` は 3 択（置き換え／表だけ追記／そのまま）。既存の `.claude/settings.json`・`.mcp.json` は触らず差分を報告する。既存の `tasks/BACKLOG.md` に書式の節が無ければ、足すかを聞く。置き場所がふさがっていれば（例: `tasks` という名前のファイル）、何も置かずに止まる。Claude Code のサンドボックスなどで `.claude/settings.json`・`.mcp.json` を書けなくても、残りの雛形は置き切り、書けなかったファイルを報告する。`package.json` の `audit:check` は npm（`package-lock.json`、または lock がまだ無い）のときだけ足し、同じ条件で『依存の脆弱性』行を `node scripts/audit-check.mjs` と推定する。コミットの前に git の名前とメール、`.env` の除外を確かめる。土台（アプリのコード）が無いときは先に作るかを聞く。「アプリの土台を作る」「テスト基盤の導入」を起票する。必要な Node.js を 18 以上にした（v0.1 系の説明では 20 以上）。
- **雛形 `CLAUDE.md`**: このプロジェクトのコマンドの表だけにした（154 行 → 83 行）。表をマーカー `<!-- docdd:tables:begin -->`〜`<!-- docdd:tables:end -->` で囲む。「検証コマンド」表に 開発サーバー起動・テスト用 DB・本番モード起動・未記入欄の検査・実物1周の費用上限、「反映コマンド」表に 作業ブランチ・本番ブランチ・反映の方式 の行を足した。「スキルへの追加指示」の節を足した。埋める欄の書き方を `<...>` から `{{…}}` にした。
- **雛形 `.claude/settings.json`**: まとめて消す削除・`git add -A`・`--amend`・`git push`・依存の追加を確認ありに、強制 push・`--no-verify`・`sudo`・`.env` の読み取りを禁止に、検査コマンドを確認なしにした。プラグインの取得元（`extraKnownMarketplaces`・`enabledPlugins`）を足した。
- **雛形 `.mcp.json`**: 版を固定した（`shadcn@4.21.0`・`next-devtools-mcp@0.4.0`）。
- **雛形 docs・tasks**: PRD に ID の規則・§3.3「主な画面と利用者の流れ」・記入例へのリンク。`development-and-testing.md` に §4「テスト基盤が無いとき」と §5「落とし穴」。requirements に見出し ID の規則。BACKLOG にステータス `dropped` と要決定の「状態」行（見本は運用ルールのコードブロックの中へ移し、実タスクと番号が重ならないよう `T-NN`・`D-N` で書く）。`docs/_imported/`（取り込んだ原文）の扱い。
- **検査スクリプト**: `check-doc-dates` は未記入の日付を「未記入」と列挙し、正本を見出しでも判定し、変更履歴の並び順を問わない。`check-doc-refs` は対象の拡張子・`](./…)` のリンク・`.claude/rules/` を足し、`.gitignore` 済みのファイルは警告にした。`audit-check` は allowlist に理由（`why`）と期限（`until`）を持てるようにし、古い lock の形式・モノレポの lock・古い Node.js を見分ける。4 本とも先頭に版の刻印。
- **全スキル**: 前置きを「前提（docdd）」に統一した（init の前なら止まる、「無い」と未記入の行は実行せず報告、「スキルへの追加指示」を優先、無い機能は「該当なし」）。`model: inherit` を削除し、`argument-hint` を足した。`init`・`release`・`update-kit` は自分で打ったときだけ動く（`disable-model-invocation`）。description を日本語の「何をする＋いつ使う」にした。著者のプロジェクト固有の事故談を除いた。
- **dev-loop**: テスト基盤の門と仕様の門を足した。決まった要決定を BACKLOG と正本へ書き戻す。報告に「テスト基盤: 単体=有/無・E2E=有/無」。
- **add-task**: 基盤タスクは PRD との照合を免除。要決定でタスクを増やしすぎない。参照の書式を固定。
- **doc-sync**: 検査は `CLAUDE.md` の表の行を実行する。`--full` に「docs が雛形のままのとき」を足した。
- **release**: 反映の方式（A／B／C／まだ公開しない）で経路を分けた。本番へ出す前に必ず運営者の「はい」を得る。push の前に `gh` のログインを確かめる。公開先の確認は playwright-cli で読むだけ。
- **security-audit**: 直す前に 1 件ずつ承知を得る。`/loop` の推奨を削除。無人で動いているときは報告と要決定の起票だけ。
- **maintenance**: 実物1周は費用上限の行に従う。溜まったデータは件数と dry-run の報告まで（本番データの削除は適用しない）。
- **refactor・speed-up**: 単体テストの基盤が無いときは監査（speed-up は計測と候補出し）だけ。
- **verify-integration**: 『テスト用 DB』行（① ローカル／② ホスト型の開発専用（`CLAUDE.md` に『本番と別・開発専用・破棄可能』と明記した接続先だけ）／③ DB 無し）で分岐する。実物1周は費用上限の行に従う。
- **verify-e2e・ui-polish**: playwright-cli の有無を確かめる順と、手作業の確認への切り替えを決めた。E2E の基盤が無ければ起票を案内する。
- **playwright-cli**: `allowed-tools` から runner 単体（`npx`・`npm`）を外した。インストールの案内を 0.1.17 に固定。ログイン状態・trace・スクショの保存先を決めた。description を日本語にした。
- **マニフェスト**: `plugin.json` を 0.2.0 にし、`displayName`・`homepage`・`repository` を足した。説明からスキルの本数を外した。`marketplace.json` の説明を `metadata.description` からトップレベルの `description` へ移した（`metadata` の下は後方互換の扱い）。
- README 2 本を書き直した（前提・全体像・入口の分岐・英語の確認・更新・やめるとき・困ったら）。

### 削除

- `.claude-plugin/marketplace.json` の `version`（`plugins[0]` と `metadata`）。版は `plugin.json` だけに書く。
- 雛形 `CLAUDE.md` の「スキルの地図」（README へ）、「いつ回すか」「落とし穴」（`development-and-testing.md` へ）、キット共通の約束（`.claude/rules/docdd-kit.md` へ）。
- 雛形 `tasks/BACKLOG.md` の見本タスク `T-00`。
- 各スキルの旧い前置き（配布リポジトリの URL と、手順書の写し方）。

### 雛形への影響: あり

- 対象: `CLAUDE.md`、`.claude/rules/docdd-kit.md`（新規）、`.claude/settings.json`、`.gitignore`（新規）、`.mcp.json`、`docs/**`、`tasks/**`、`scripts/*.mjs`（`check-doc-placeholders.mjs` は新規）、`package.json` の scripts（`check:doc-placeholders` を追加）。
- → v0.1 系で導入したプロジェクトは `/docdd:update-kit`（`CLAUDE.md` の移行を含む）。`.claude/settings.json` と `.mcp.json` は変えずに差分を報告するだけなので、必要なら手で直す。

### 今回やらなかったこと（理由）

- GitHub のリポジトリの説明・トピックの設定（`gh repo edit`）、push・タグ・GitHub Release: 外部への書き込みなので、著者が手で行う（`RELEASING.md`）。
- evals を CI で回すこと: 費用が出るので CI には入れず、`RELEASING.md` の手動の手順で回す。公開前に 3 ケースを本実行した。サンドボックスが設定ファイルの書き込みを止めて init が雛形を置き切らない不具合が見つかり、直したあとに 3 ケースとも合格した。
- playwright-cli の `references/` 9 本の置き換え: 次の版で行う（下の「次の版の予定」）。今回は `NOTICE` で出典を示した。
- `eject` スキル: README「手順書を直したいとき」の写し方で代替する。次以降の版で検討。
- 導入済みかを決まった形で判定するスクリプト（`docdd-status.sh`）: スキルの前置きの文章で代替する。次以降の版で検討。
- hook の第 2 段（stage 済みの差分の秘密値の検査、playwright の localhost 以外への接続の確認）: 今回は取り消しにくい git 操作と `rm` を止める第 1 段を優先した。次以降の版で検討。
- `SECURITY.md`・`CONTRIBUTING.md`・行動規範: 受け付けは Issues のテンプレートで代替する。次以降の版で検討。
- 複数 OS（Windows・macOS）の CI、README などの URL の死活の検査、audit-check の advisory ID での照合（allowlist はパッケージ名の単位）: 今回は導入の手順と安全の柵を優先した。次以降の版で検討。

### 次の版の予定

- playwright-cli の `references/`（英語 9 本）を、上流の公式スキル（`playwright-cli install --skills` で入るもの）へ置き換える。英語の手順書を丸ごと同梱するより、上流の版に合わせて更新できるため。

## 0.1.5（2026-09-13）

### スキルの変更

- なし。

### 雛形の変更

- なし（README の記事リンクの題名を更新しただけ）。
- 雛形への影響: なし。

## 0.1.4（2026-09-06）

### スキルの変更

- release: 軽量化の印（例: light ci）が効くのは、CI の側に「印があれば本体を飛ばす」仕組みがあるときだけと明記した。CI があれば軽量化でも完了を待つ。GitHub 公式の省略の印は使わない。
- init: ヒアリングに「反映コマンド」表の 3 行（staging へ反映・本番へ反映・公開先 URL）を足した。

### 雛形の変更

- `CLAUDE.md` の落とし穴に「コミットメッセージに角括弧付きの CI 省略の印を書かない」を 1 行足した。
- 雛形への影響: あり（`CLAUDE.md`）。

## 0.1.3（2026-09-05）

### スキルの変更

- release: CI を省略する空コミットの印を、GitHub 公式の省略の印から「light ci」（CI の本体だけを飛ばす軽量化）に変えた。省略の印をコミットメッセージに書かないルールを足した。

### 雛形の変更

- なし。雛形への影響: なし。

## 0.1.2（2026-09-05）

### スキルの変更

- スキル `release` を追加した（CI の要否を差分から判断 → push 1 回 → staging → 本番へ反映 → 実ブラウザで確認）。

### 雛形の変更

- `CLAUDE.md` に「反映コマンド」表（staging へ反映・本番へ反映・公開先 URL）を足し、スキルの地図と「流れ」に release を足した。
- 雛形への影響: あり（`CLAUDE.md`）。

## 0.1.1（2026-09-05）

### スキルの変更

- スキル 12 本（init を含む）の文面から、キットの元になったアプリ固有の文言（アプリ名・タスク ID の例・機能 ID・画面 ID など）を除き、どのプロジェクトでも読める書き方にした。
- 各スキルの前置きを、zip 版への切り替え案内から「配布リポジトリのスキルを `.claude/skills/` へ写す」案内に変えた。
- 配布をプラグインだけにした（README から zip 版の案内を削除）。

### 雛形の変更

- `CLAUDE.md`: 固有の文言を除き、スキルの切り替え方と「全検査」「依存の脆弱性」行の例を直した。
- `docs/README.md`: 検査の説明を直した。
- `scripts/check-doc-dates.mjs`: 正本の判定から固有の文書名を外した。`scripts/check-doc-refs.mjs`・`scripts/audit-check.mjs` はコメントだけ。
- `tasks/BACKLOG.md`: 見本タスクを `T-00`（`done`）にした。
- 雛形への影響: あり（`CLAUDE.md`・`docs/README.md`・`scripts/` の 3 本・`tasks/BACKLOG.md`）。

## 0.1.0（2026-09-05）

- 初版。スキル 11 本（add-task・dev-loop・doc-sync・verify-integration・verify-e2e・ui-polish・refactor・speed-up・security-audit・maintenance・playwright-cli）と `init`。
- 雛形: `CLAUDE.md`、`.claude/settings.json`、`.mcp.json`、`docs/`（README・PRD・requirements・decisions・operations）、`tasks/`（BACKLOG・REFACTOR_PLAN）、`scripts/`（check-doc-dates・check-doc-refs・audit-check と allowlist）、`package.json` に足す scripts。
