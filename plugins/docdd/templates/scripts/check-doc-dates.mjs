// docdd-kit v0.16.0 — scripts/check-doc-dates.mjs（キットが管理するファイル。直すと /docdd:update-kit が差分を見せて聞く）
// docs の「更新日」が、その文書の内容を最後に変えたコミットより古くないかを検査する。
// あわせて、仕様の正本（PRD・requirements/・変更履歴の見出しを持つ文書）の冒頭 version と変更履歴が合うかを見る。
//
//   node scripts/check-doc-dates.mjs
//
// 対象: git が追跡している docs/ の .md。docs/_imported/（取り込んだ原文）・docs/requirements/00_template.md・
//       docs/decisions/0000-template.md（見本）は除く。コードブロックと HTML コメントの中は読まない。
// 終了コード: 0 = 問題なし／1 = 直すところがある（浅い clone・コミットが無いときも 1）／2 = git が使えず判定できない
//
// 更新日の行だけを変えたコミットは「内容の変更」に数えない。数えると、日付を直すコミット自身が
// 「また古い」と言われて永久に収束しない。
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

/* ---- 見出し語。表の 1 列目がこの語の行を読む（大文字・小文字は区別しない） ---- */
const VERSION_LABEL = "バージョン|version";
const DATE_LABEL = "更新日|最終更新日?|last[ _-]?updated|updated";

/** `| 更新日 | 2026-09-13 |` の行。値が日付でなくても拾う（未記入を見つけるため）。 */
const DATE_ROW = new RegExp(`^\\s*\\|\\s*(?:${DATE_LABEL})\\s*\\|\\s*([^|]*?)\\s*\\|`, "i");
/** 表ではなく `最終更新: 2026-09-13` のように書いた行。 */
const DATE_LINE = new RegExp(
  `(?<![A-Za-z])(?:${DATE_LABEL})\\s*[:：]?\\s*([0-9]{4}-[0-9]{2}-[0-9]{2})`,
  "i",
);
const DATE_VALUE = /^([0-9]{4}-[0-9]{2}-[0-9]{2})(?![0-9])/;
/** `| バージョン | v0.1 |` の行。 */
const VERSION_ROW = new RegExp(`^\\s*\\|\\s*(?:${VERSION_LABEL})\\s*\\|\\s*([^|]*?)\\s*\\|`, "i");
const VERSION_VALUE = /^v([0-9]+(?:\.[0-9]+)*)$/i;
/** 変更履歴の見出し（`## 6. 変更履歴`・`## Changelog` など）。 */
const CHANGELOG_HEADING = /^#{2,3}\s+(?:[0-9.]+\s*)?(?:変更履歴|change\s?log)(?![A-Za-z])/i;
/** 変更履歴の行。範囲表記（`v1.86〜v1.90`）は両端を読む。 */
const CHANGELOG_ROW = /^\s*\|\s*v([0-9]+(?:\.[0-9]+)*)(?:\s*[〜~～-]\s*v?([0-9]+(?:\.[0-9]+)*))?\s*\|/i;
const CHANGELOG_HEADER = new RegExp(`^\\s*\\|\\s*(?:${VERSION_LABEL})\\s*\\|`, "i");
/** 表の区切り行。GFM の寄せ指定（`|:---|` `|---:|` `|:---:|`）も区切りと認める。 */
const TABLE_DELIMITER = /^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/;

/**
 * 変更履歴を求める「仕様の正本」。変更履歴の見出しを持つ文書は置き場所に関係なく正本として扱う
 * （PRD を docs/spec/ へ移しても検査が続くように）。見出しが無くても、下のパスの文書は正本。
 * `requirements/README.md` は分け方の案内なので対象外。
 */
const SPEC_PATH = /^docs\/(?:PRD\.md$|requirements\/(?!README\.md$))/;
const EXCLUDED = [
  /^docs\/_imported\//,
  /^docs\/requirements\/00_template\.md$/,
  /^docs\/decisions\/0000-template\.md$/,
];

// ---- docdd:scan-markdown begin（check-doc-*.mjs の 3 本で同じ中身。直すときは 3 本とも直す） ----
/**
 * Markdown を行ごとに「地の文 text／インラインコード code／HTML コメント comment／コードブロック fence」に分ける。
 * 行番号を保つため、入力 1 行に対して必ず 1 要素（区間の配列）を返す。
 */
function scanMarkdown(source) {
  const result = [];
  let fence = null;
  let inComment = false;
  for (const line of source.split(/\r?\n/)) {
    if (!inComment) {
      const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (fence) {
        if (open && open[1][0] === fence.ch && open[1].length >= fence.len && open[2].trim() === "") {
          fence = null;
        }
        result.push([{ kind: "fence", raw: line }]);
        continue;
      }
      if (open && !(open[1][0] === "`" && open[2].includes("`"))) {
        fence = { ch: open[1][0], len: open[1].length };
        result.push([{ kind: "fence", raw: line }]);
        continue;
      }
    }
    const segs = [];
    let text = "";
    const flush = () => {
      if (text) segs.push({ kind: "text", raw: text });
      text = "";
    };
    let i = 0;
    while (i < line.length) {
      if (inComment || line.startsWith("<!--", i)) {
        flush();
        const end = line.indexOf("-->", inComment ? i : i + 4);
        const stop = end === -1 ? line.length : end + 3;
        segs.push({ kind: "comment", raw: line.slice(i, stop) });
        inComment = end === -1;
        i = stop;
        continue;
      }
      if (line[i] === "`") {
        let n = 0;
        while (line[i + n] === "`") n += 1;
        let close = -1;
        for (let j = i + n; j < line.length; ) {
          if (line[j] !== "`") {
            j += 1;
            continue;
          }
          let k = j;
          while (line[k] === "`") k += 1;
          if (k - j === n) {
            close = j;
            break;
          }
          j = k;
        }
        if (close !== -1) {
          flush();
          segs.push({ kind: "code", raw: line.slice(i, close + n), inner: line.slice(i + n, close) });
          i = close + n;
          continue;
        }
        text += line.slice(i, i + n);
        i += n;
        continue;
      }
      text += line[i];
      i += 1;
    }
    flush();
    result.push(segs);
  }
  return result;
}
// ---- docdd:scan-markdown end ----

/*
  `-c core.quotepath=false` を必ず付ける。付けないと日本語のパスが
  `"docs/\343\203\227…"` のように8進エスケープで返り、ファイルを開けない。
*/
const git = (args) =>
  execFileSync("git", ["-c", "core.quotepath=false", ...args], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const TODAY = today();

const probe = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
if (probe.error) {
  console.error("❌ git が見つかりません。git を入れてから実行してください（この検査は git の履歴を読みます）");
  process.exit(2);
}
if (probe.status !== 0 || probe.stdout.trim() !== "true") {
  console.error("❌ git のリポジトリの外で実行されました");
  console.error("   → プロジェクトのフォルダ（AGENTS.md がある場所）で実行してください");
  process.exit(2);
}

/*
  **浅い clone では判定できないので止める**。
  この検査は「その文書を最後に変えたコミットの日付」を git の履歴から読む。
  CI の既定（`actions/checkout` の depth 1）だと履歴が 1 件しか無く、全文書が「今日変わった」ように見える。
  黙って通すのではなく、原因と直し方を出して止める。
*/
if (git(["rev-parse", "--is-shallow-repository"]).trim() === "true") {
  console.error("❌ 履歴が浅い clone（shallow）のため更新日を判定できません");
  console.error("   → CI なら actions/checkout に `fetch-depth: 0` を付けてください");
  console.error("   → 手元なら `git fetch --unshallow` を実行してください");
  process.exit(1);
}

/*
  **コミットが 1 件も無いリポジトリでは判定できないので止める**。
  `git init` 直後は `git log` が失敗し、Node のスタックトレースだけが出てしまう。
*/
if (spawnSync("git", ["rev-parse", "--verify", "-q", "HEAD"], { encoding: "utf8" }).status !== 0) {
  console.error("❌ まだコミットが1件もありません。最初のコミットの後に実行してください");
  console.error("   （この検査は「その文書を最後に変えたコミットの日付」を読むため、履歴が要ります）");
  process.exit(1);
}

const files = git(["ls-files", "-z", "--", "docs/*.md"])
  .split("\0")
  .filter((f) => f && !EXCLUDED.some((re) => re.test(f)) && existsSync(f));

if (files.length === 0) {
  console.error("❌ git が追跡している docs/ の .md が 1 件もありません（この検査は git に追加した文書だけを見ます）");
  if (existsSync("docs")) {
    console.error("   → 新しく作った文書なら、先に `git add docs` でパスを指定して追加し、コミットしてからもう一度実行してください");
  } else {
    console.error("   → docs/ が見つかりません。プロジェクトのフォルダで実行しているか、/docdd:init を済ませたかを確認してください");
  }
  console.error("   → docs/PRD.md があり、冒頭に `| 更新日 | 日付 |` の表があるか確認してください");
  process.exit(1);
}

/**
 * 表の中で `re` に合う最初の行を探す。見出し行（次の行が区切り行）で値が `valid` に合わないものは飛ばす
 * （変更履歴の見出し `| バージョン | 日付 | 内容 |` を冒頭の version 行と取り違えないため）。
 */
function findRow(lines, re, valid) {
  for (let i = 0; i < lines.length; i += 1) {
    const m = re.exec(lines[i]);
    if (!m) continue;
    const value = m[1].trim();
    if (TABLE_DELIMITER.test(lines[i + 1] ?? "") && !valid.test(value)) continue;
    return { index: i, value };
  }
  return null;
}

/** "1.10" → [1, 10]。数値として比べる（v1.10 は v1.9 より新しい）。 */
function compareVersions(a, b) {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** C の書き方で引用された git のパス（"a\"b" など）を戻す。引用されていなければそのまま。 */
function unquotePath(p) {
  if (!p.startsWith('"')) return p;
  const body = p.slice(1, p.endsWith('"') ? -1 : undefined);
  const bytes = [];
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (c !== "\\") {
      const ch = String.fromCodePoint(body.codePointAt(i)); // 絵文字など 2 単位の文字をまとめて扱う
      bytes.push(...Buffer.from(ch, "utf8"));
      i += ch.length - 1;
      continue;
    }
    const n = body[i + 1];
    if (/[0-7]/.test(n)) {
      bytes.push(parseInt(body.slice(i + 1, i + 4), 8));
      i += 3;
    } else {
      bytes.push(({ a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 })[n] ?? n.charCodeAt(0));
      i += 1;
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

/**
 * 文書ごとに、更新日の行**以外**を変えた最後のコミット日を返す（Map。無い文書は入らない）。
 * 文書をまとめて git log を 1 回だけ呼ぶ（文書ごとに履歴をたどると、文書の数 × 履歴の長さで遅くなる）。
 * マージは --cc の差分で読み、どの親にも無い行を足した（全部 +）か、どの親にもあった行を消した（全部 -）ときだけ数える。
 * 更新日の衝突だけを解いたマージは数えず、衝突を新しい文で解いたマージは数える。
 */
function lastContentChanges(targets) {
  const result = new Map();
  if (targets.length === 0) return result;
  const out = git([
    "-c", "log.follow=false", // 利用者の設定で --follow が効くと、文書が 1 件のとき改名を数えなくなる
    "log", "-p", "-U0", "--cc", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames", "--relative",
    "--src-prefix=a/", "--dst-prefix=b/", "--format=%x01%ad", "--date=short", "--", ...targets,
  ]);
  const wanted = new Set(targets);
  let date = null;
  let file = null;
  let inHunk = false;
  let parents = 1;
  for (const line of out.split("\n")) {
    if (line.startsWith("\x01")) {
      date = line.slice(1).trim();
      file = null;
      inHunk = false;
    } else if (line.startsWith("diff --git ") || line.startsWith("diff --cc ")) {
      file = null;
      inHunk = false;
    } else if (!inHunk && line.startsWith("+++ ")) {
      // 見出しの行（hunk の外だけ。本文の「++ 」で始まる行を見出しと取り違えない）
      const raw = unquotePath(line.slice(4).replace(/\t$/, ""));
      file = raw === "/dev/null" ? null : raw.replace(/^b\//, "");
    } else if (line.startsWith("@@")) {
      inHunk = true;
      parents = /^@+/.exec(line)[0].length - 1; // 「@@」なら親 1 つ、「@@@」なら親 2 つ
    } else if (inHunk && file && date && /^[+-]/.test(line)) {
      if (!wanted.has(file) || result.has(file)) continue; // 新しい順なので、最初に見つけたものが最新
      const mark = line.slice(0, parents);
      if (parents > 1 && !/^(?:\++|-+)$/.test(mark)) continue;
      const text = line.slice(parents);
      // 更新日の行しか動いていないコミットは「内容の変更」ではない。
      if (!DATE_ROW.test(text) && !DATE_LINE.test(text)) result.set(file, date);
    }
  }
  return result;
}

/** 変更履歴の表を読んで、合わない理由を返す（合っていれば null）。 */
function changelogProblem(lines, headVersion) {
  const heading = lines.findIndex((l) => CHANGELOG_HEADING.test(l));
  let start = 0;
  let end = lines.length;
  if (heading !== -1) {
    start = heading + 1;
    const next = lines.findIndex((l, i) => i >= start && /^#{1,3}\s/.test(l));
    if (next !== -1) end = next;
  }
  const rows = [];
  for (let i = start; i < end; i += 1) {
    const m = CHANGELOG_ROW.exec(lines[i]);
    if (m) rows.push({ index: i, versions: [m[1], m[2]].filter(Boolean) });
  }
  if (rows.length === 0) {
    return "変更履歴の行が見つかりません（`## 変更履歴` の表に `| v0.1 | 日付 | 内容 |` の形で 1 行以上書く）";
  }
  /*
    **表ヘッダも見る。** 行だけ残ってヘッダが消えると Markdown の表として描画されず、履歴が読めない。
    見るのは最初の履歴行の直前 2 行だけ（ヘッダ行と区切り行）。広く見ると、別の表の区切り行で偶然通ってしまう。
  */
  const first = rows[0].index;
  if (!CHANGELOG_HEADER.test(lines[first - 2] ?? "") || !TABLE_DELIMITER.test(lines[first - 1] ?? "")) {
    return "変更履歴の表ヘッダがありません（最初の履歴行の直前に `| バージョン | 日付 | 内容 |` と区切り行 `|---|---|---|` を置く）";
  }
  // 並び順（新しい順・古い順）に頼らず、数値として最大の version を最新とする。
  const newest = rows
    .flatMap((r) => r.versions)
    .reduce((a, b) => (compareVersions(a, b) >= 0 ? a : b));
  if (compareVersions(newest, headVersion) !== 0) {
    return `冒頭 v${headVersion} に対し変更履歴の最新は v${newest}`;
  }
  return null;
}

// まとめて読む。差分が大きすぎて読めない（ENOBUFS）ときは、文書ごとに読む。
let commits = null;
try {
  commits = lastContentChanges(files);
} catch (e) {
  if (e.code !== "ENOBUFS") throw e;
}

const unfilled = [];
const noHeader = [];
const stale = [];
const drift = [];
let checked = 0;
let versioned = 0;
let outOfScope = 0;

for (const file of files) {
  // コードブロックと HTML コメントを空にした行（書き方の見本を本物の表と取り違えないため）。
  const lines = scanMarkdown(readFileSync(file, "utf8")).map((segs) =>
    segs
      .filter((s) => s.kind === "text" || s.kind === "code")
      .map((s) => s.raw)
      .join(""),
  );
  const isSpec = SPEC_PATH.test(file) || lines.some((l) => CHANGELOG_HEADING.test(l));

  // ---- 更新日 ----
  let docDate = null;
  let dateLine = 0;
  const dateRow = findRow(lines, DATE_ROW, DATE_VALUE);
  if (dateRow) {
    dateLine = dateRow.index + 1;
    const m = DATE_VALUE.exec(dateRow.value);
    if (m) docDate = m[1];
    else unfilled.push({ file, line: dateLine, hint: "今日の日付に", value: dateRow.value });
  } else {
    const index = lines.findIndex((l) => DATE_LINE.test(l));
    if (index !== -1) {
      docDate = DATE_LINE.exec(lines[index])[1];
      dateLine = index + 1;
    }
  }

  // ---- 冒頭の version ----
  const versionRow = findRow(lines, VERSION_ROW, VERSION_VALUE);
  let headVersion = null;
  if (versionRow) {
    const m = VERSION_VALUE.exec(versionRow.value);
    if (m) headVersion = m[1];
    else if (isSpec) {
      unfilled.push({ file, line: versionRow.index + 1, hint: "v0.1 のように v と数字で", value: versionRow.value });
    }
  }

  if (isSpec) {
    const lacks = [];
    if (!versionRow) lacks.push("バージョン");
    if (!dateRow && docDate === null) lacks.push("更新日");
    if (lacks.length > 0) noHeader.push({ file, lacks });
  } else if (!dateRow && docDate === null) {
    // 更新日を持たない文書（README・ADR など）は対象外。
    outOfScope += 1;
    continue;
  }

  if (docDate !== null) {
    checked += 1;
    const commit = commits ? (commits.get(file) ?? null) : (lastContentChanges([file]).get(file) ?? null);
    if (commit && docDate < commit) {
      // まとめて読んだ履歴は、文書ごとの履歴の単純化より多くの枝をたどる（日付が新しく出るだけで、古くは出ない）。
      // 置き去りと言う前に、その文書だけの履歴で確かめる。
      const exact = commits ? (lastContentChanges([file]).get(file) ?? null) : commit;
      if (exact && docDate < exact) stale.push({ file, line: dateLine, doc: docDate, commit: exact });
    }
  }

  if (isSpec && headVersion !== null) {
    versioned += 1;
    const reason = changelogProblem(lines, headVersion);
    if (reason) drift.push({ file, reason });
  }
}

const problems = unfilled.length + noHeader.length + stale.length + drift.length;
if (problems > 0) {
  console.error(`❌ docs の更新日・version で直すところが ${problems} 件あります（${files.length} 件の文書を検査）`);
  if (unfilled.length > 0) {
    console.error("\n■ 冒頭の表の値が未記入（空か、書き方の見本のまま）");
    for (const u of unfilled) {
      console.error(`   未記入: ${u.file}:${u.line}（${u.hint}。いまの値: ${u.value === "" ? "空" : u.value}）`);
    }
    console.error(`   → 今日の日付は ${TODAY}`);
  }
  if (noHeader.length > 0) {
    console.error("\n■ 冒頭の表が無い仕様の正本（PRD・requirements/・変更履歴の見出しを持つ文書）");
    for (const n of noHeader) console.error(`   ${n.file}（${n.lacks.join("・")}の行がありません）`);
    console.error("   → 冒頭に | バージョン | vX | と | 更新日 | 日付 | の表を足す。見本:");
    console.error("        | 項目 | 内容 |");
    console.error("        |---|---|");
    console.error("        | バージョン | v0.1 |");
    console.error(`        | 更新日 | ${TODAY} |`);
  }
  if (stale.length > 0) {
    console.error("\n■ 更新日が置き去り（内容を変えたコミットより古い日付のまま）");
    for (const s of stale) {
      console.error(`   ${s.file}:${s.line}`);
      console.error(`     記載: ${s.doc} / 最後に内容が変わったコミット: ${s.commit}`);
    }
    console.error(`   → 冒頭の「更新日」を今日の日付（${TODAY}）に直す`);
  }
  if (drift.length > 0) {
    console.error("\n■ 冒頭の version と変更履歴が合わない");
    for (const d of drift) console.error(`   ${d.file}\n     ${d.reason}`);
    console.error("   → 変更履歴へ行を足すか、冒頭の version を直す（履歴の並びは新しい順・古い順どちらでもよい）");
  }
  process.exit(1);
}

if (checked === 0) {
  console.log("✅ 直すところはありませんでした。ただし更新日の表を持つ文書が 0 件です");
  console.log("   → docs/PRD.md の冒頭に `| 更新日 | 日付 |` の表があるか確認してください");
} else {
  console.log(`✅ 更新日は ${checked} 件すべて最新でした（version と変更履歴の一致も ${versioned} 件確認）`);
}
console.log(`   対象外: ${outOfScope} 件（README・ADR など、冒頭に更新日の表を持たない文書）`);
