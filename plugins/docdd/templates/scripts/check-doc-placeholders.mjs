// docdd-kit v0.16.0 — scripts/check-doc-placeholders.mjs（キットが管理するファイル。直すと /docdd:update-kit が差分を見せて聞く）
// 雛形の「埋める欄」（二重波かっこの {{…}}）が、書き換えられずに残っていないかを検査する。
// 残った欄をスキルが読むと、未記入の値を前提に動いてしまう。
//
//   node scripts/check-doc-placeholders.mjs
//
// 対象: git が追跡している AGENTS.md・CLAUDE.md・.claude/rules/ の .md・docs/ の .md・tasks/ の .md。
//   docs/_imported/（取り込んだ原文）・docs/requirements/00_template.md・docs/decisions/0000-template.md（見本）・
//   tasks/archive/（終わったものの控え。当時の文をそのまま残す場所）は除く。
//   文書の中に <!-- docdd:placeholders:off --> と書くと、その文書は検査しない。
//   .docdd/manifest.json の "placeholdersIgnore": ["docs/prompt/**"] でも、フォルダごと外せる
//   （{{…}} を別の意味で使う文書用。例: AI へ渡すプロンプトの本文で {{変数}} を埋め込みに使う）。
// 数えない所: バッククォートの中、コードブロックの中、HTML コメントの中（書き方の説明に {{…}} を書けるように）。
// 終了コード: 0 = 残っていない／1 = 残っている・対象の文書が git に無い／2 = git が使えない
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const TARGETS = ["AGENTS.md", "CLAUDE.md", ".claude/rules/*.md", "docs/*.md", "tasks/*.md"];
const EXCLUDED = [
  /^docs\/_imported\//,
  /^docs\/requirements\/00_template\.md$/,
  /^docs\/decisions\/0000-template\.md$/,
  /^tasks\/archive\//,
];
/** この印がある文書は検査しない（{{…}} を埋める欄ではない意味で使う文書）。 */
const OPT_OUT = "<!-- docdd:placeholders:off -->";

/**
 * .docdd/manifest.json の "placeholdersIgnore"（パスの並び）も検査から外す。
 * 例: "placeholdersIgnore": ["docs/prompt/**"]（フォルダごと外したいとき。* は 1 階層、** は何階層でも）。
 */
function ignoreFromManifest() {
  try {
    const data = JSON.parse(readFileSync(".docdd/manifest.json", "utf8"));
    const list = Array.isArray(data?.placeholdersIgnore) ? data.placeholdersIgnore.filter((s) => typeof s === "string") : [];
    return list.map((pattern) => {
      const re = pattern
        .split("**")
        .map((part) => part.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "."))
        .join(".*");
      return new RegExp(`^${re}$`);
    });
  } catch {
    return []; // manifest が無い・読めないときは何も外さない
  }
}
const PLACEHOLDER = /\{\{[^{}\n]*\}\}/g;

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

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const probe = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
if (probe.error) {
  console.error("❌ git が見つかりません。git を入れてから実行してください（この検査は git が追跡しているファイルを見ます）");
  process.exit(2);
}
if (probe.status !== 0 || probe.stdout.trim() !== "true") {
  console.error("❌ git のリポジトリの外で実行されました");
  console.error("   → プロジェクトのフォルダ（AGENTS.md がある場所）で実行してください");
  process.exit(2);
}

/* `-c core.quotepath=false` を付けないと、日本語のパスが 8 進エスケープで返りファイルを開けない。 */
const docs = execFileSync("git", ["-c", "core.quotepath=false", "ls-files", "-z", "--", ...TARGETS], {
  encoding: "utf8",
  maxBuffer: 256 * 1024 * 1024,
})
  .split("\0")
  .filter((f) => f && !EXCLUDED.some((re) => re.test(f)) && existsSync(f));

if (docs.length === 0) {
  const present = ["AGENTS.md", "CLAUDE.md", ".claude/rules", "docs", "tasks"].filter((p) => existsSync(p));
  console.error("❌ 検査する文書が git に 1 件もありません（対象: AGENTS.md・CLAUDE.md・.claude/rules/・docs/・tasks/ の .md）");
  console.error("   この検査は git に追加したファイルだけを見ます。作ったばかりのファイルはまだ数えられません");
  if (present.length > 0) {
    console.error(`   → 先に \`git add ${present.join(" ")}\` のようにパスを指定して追加してから、もう一度実行してください`);
  } else {
    console.error("   → AGENTS.md も docs/ も見つかりません。プロジェクトのフォルダで実行しているか、/docdd:init を済ませたかを確認してください");
  }
  process.exit(1);
}

const found = [];
const skipped = [];
const ignored = ignoreFromManifest();
for (const doc of docs) {
  if (ignored.some((re) => re.test(doc))) {
    skipped.push(doc);
    continue;
  }
  const source = readFileSync(doc, "utf8");
  if (source.includes(OPT_OUT)) {
    skipped.push(doc);
    continue;
  }
  scanMarkdown(source).forEach((segs, i) => {
    for (const seg of segs) {
      if (seg.kind !== "text") continue;
      for (const m of seg.raw.matchAll(PLACEHOLDER)) found.push(`${doc}:${i + 1}  ${m[0]}`);
    }
  });
}

if (found.length > 0) {
  console.error(`❌ 未記入の欄（{{…}}）が ${found.length} 件残っています（${docs.length - skipped.length} 件の文書を検査${skipped.length ? `・印で外した ${skipped.length} 件は検査せず` : ""}）\n`);
  for (const f of found) console.error(`   ${f}`);
  console.error("\n   → {{…}} を実際の値に書き換えてください");
  console.error(`     日付の欄は今日の日付（${today()}）、このプロジェクトに無いものは「無い」と書きます`);
  process.exit(1);
}

console.log(`✅ 未記入の欄（{{…}}）は残っていませんでした（${docs.length - skipped.length} 件の文書を検査）`);
if (skipped.length > 0) console.log(`   検査から外した文書: ${skipped.length} 件（印 ${OPT_OUT} と .docdd/manifest.json の placeholdersIgnore）`);
