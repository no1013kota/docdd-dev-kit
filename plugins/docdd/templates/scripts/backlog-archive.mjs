// docdd-kit v0.16.0 — scripts/backlog-archive.mjs（キットが管理するファイル。直すと /docdd:update-kit が差分を見せて聞く）
// 終わったタスクと決まった判断を tasks/BACKLOG.md から tasks/archive/BACKLOG-done.md へ移す。
// BACKLOG に残すのは、まだ動いているもの（todo・doing・blocked のタスクと、未決の判断）だけにする。
// 終わったものまで残すと BACKLOG が育ち続け、「BACKLOG を読む」手順が読むだけで作業の場所（コンテキスト）を使い、
// 末尾の未着手のタスクを見落とす。アーカイブは丸ごと読まず、ID や言葉で検索して使う。
//
//   node scripts/backlog-archive.mjs           # 移す（移すものが無ければ何も変えない）
//   node scripts/backlog-archive.mjs --check   # 移さずに、移すものがあるかだけを見る
//
// 移すもの: 見出しの末尾の状態が `done` か `dropped` のタスク（### の見出し）と、
//   「要決定」の節で「- 状態: 決定…」の行がある判断（**D-番号 で始まる段落）。
// 見ない所: コードブロックの中（運用ルールの書式の見本を移さないように）。
// アーカイブは 1 つ深いフォルダにあるので、移す文の相対リンク [文字](./a.md) は 1 段上を指すように直す。
// 終了コード: 0 = 移した・移すものが無い（--check では移すものが無い）／1 = --check で移すものがある／2 = 読めない・書けない
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const BACKLOG = "tasks/BACKLOG.md";
const ARCHIVE = "tasks/archive/BACKLOG-done.md";
const DECISIONS_HEADING = "## 決定済みの要決定・外部準備";
const TASKS_HEADING = "## 完了したタスク";
const ARCHIVE_TEMPLATE = [
  "# BACKLOG のアーカイブ（完了したタスク・決定済みの判断）",
  "",
  "`tasks/BACKLOG.md` から移した記録。**丸ごと読まない**——要るときだけ ID や言葉で検索する（例: `grep -n \"T-12\" tasks/archive/BACKLOG-done.md`）。",
  "書き足すのは `node scripts/backlog-archive.mjs` だけ（手で書き足さない）。",
  "",
  DECISIONS_HEADING,
  "",
  TASKS_HEADING,
  "",
];

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const DECISION_SECTION = /^##\s+要決定/;
const DECISION_START = /^\*\*(?:~~)?D-\d+/;
const TASK_STATE = /`([^`]+)`\s*$/;
const SETTLED = /^\s*[-*]\s*状態\s*[:：]\s*決定/;

/** 行の並びをブロック（前置き・## の節・### のタスク・要決定の判断）に分ける。コードブロックの中では区切らない。 */
export function parseBacklog(lines) {
  const blocks = [];
  let current = { kind: "preamble", lines: [] };
  let section = null;
  let fence = null;
  for (const line of lines) {
    const f = FENCE.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      current.lines.push(line);
      continue;
    }
    if (f) {
      fence = f[1];
      current.lines.push(line);
      continue;
    }
    let kind = null;
    if (/^##\s/.test(line)) kind = "section";
    else if (/^###\s/.test(line)) kind = "task";
    else if (section !== null && DECISION_SECTION.test(section) && DECISION_START.test(line)) kind = "decision";
    if (kind) {
      blocks.push(current);
      if (kind === "section") section = line;
      current = { kind, lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  blocks.push(current);
  return blocks.filter((b) => b.lines.length > 0);
}

/** 移すブロックか。タスクは見出しの末尾の状態、判断は「状態: 決定」の行で決める。 */
export function isArchivable(block) {
  if (block.kind === "task") {
    const state = TASK_STATE.exec(block.lines[0])?.[1].trim();
    return state === "done" || state === "dropped";
  }
  if (block.kind === "decision") return block.lines.some((l) => SETTLED.test(l));
  return false;
}

/** 相対リンクを 1 段上から指すように直す（アーカイブは tasks/archive/ にあり、BACKLOG より 1 段深い）。 */
export function relink(text) {
  return text.replace(/\]\((?!(?:[a-z][a-z0-9+.-]*:|#|\/|<))([^)\s]+)/gi, (_, target) =>
    `](${target.startsWith("./") ? `../${target.slice(2)}` : `../${target}`}`,
  );
}

function trimmed(block) {
  const lines = [...block.lines];
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  return relink(lines.join("\n")).split("\n");
}

/**
 * 移したあとの BACKLOG とアーカイブ（行の配列）を返す。移すものが無ければ moved は空。
 * 判断は「決定済み」の節の末尾（「完了したタスク」の見出しの直前）へ、タスクはアーカイブの末尾へ足す。見出しが無ければ足す。
 */
export function archiveBacklog(backlogLines, archiveLines) {
  const blocks = parseBacklog(backlogLines);
  const moving = blocks.filter(isArchivable);
  const moved = moving.map((b) => ({ kind: b.kind, title: b.lines[0] }));
  if (!moving.length) return { backlog: backlogLines, archive: archiveLines, moved };

  const keep = blocks.filter((b) => !isArchivable(b)).flatMap((b) => b.lines);
  while (keep.length > 1 && keep[keep.length - 1].trim() === "" && keep[keep.length - 2].trim() === "") keep.pop();
  if (keep[keep.length - 1] !== "") keep.push("");

  let out = [...archiveLines];
  while (out.length && out[out.length - 1].trim() === "") out.pop();
  const indexOfHeading = (heading) => out.findIndex((l) => l.trim() === heading);
  if (indexOfHeading(TASKS_HEADING) === -1) out.push("", TASKS_HEADING);
  if (indexOfHeading(DECISIONS_HEADING) === -1) {
    const at = indexOfHeading(TASKS_HEADING);
    out.splice(at, 0, DECISIONS_HEADING, "");
  }
  const decisions = moving.filter((b) => b.kind === "decision").map(trimmed);
  if (decisions.length) {
    let at = indexOfHeading(TASKS_HEADING);
    while (at > 0 && out[at - 1].trim() === "") at -= 1;
    const add = decisions.flatMap((d) => ["", ...d]);
    out.splice(at, 0, ...add, "");
  }
  const tasks = moving.filter((b) => b.kind === "task").map(trimmed);
  while (out.length && out[out.length - 1].trim() === "") out.pop();
  for (const t of tasks) out.push("", ...t);
  out = out.join("\n").replace(/\n{3,}/g, "\n\n").split("\n");
  out.push("");
  return { backlog: keep, archive: out, moved };
}

function readLines(file) {
  const text = readFileSync(file, "utf8");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  return { lines: text.split(/\r?\n/), eol };
}

function main(argv) {
  const check = argv.includes("--check");
  const unknown = argv.filter((a) => a !== "--check");
  if (unknown.length) {
    console.error(`知らない引数です: ${unknown.join(" ")}（使えるのは --check だけ）`);
    return 2;
  }
  if (!existsSync(BACKLOG)) {
    console.error(`${BACKLOG} がありません。プロジェクトのいちばん上のフォルダで実行してください（まだ置いていなければ /docdd:init）。`);
    return 2;
  }
  let backlog;
  let archive;
  try {
    backlog = readLines(BACKLOG);
    archive = existsSync(ARCHIVE) ? readLines(ARCHIVE) : { lines: ARCHIVE_TEMPLATE, eol: backlog.eol };
  } catch (e) {
    console.error(`読めませんでした: ${e.message}`);
    return 2;
  }
  const result = archiveBacklog(backlog.lines, archive.lines);
  const label = (m) => `  ${m.title.replace(/^###\s+/, "").slice(0, 100)}`;
  if (!result.moved.length) {
    console.log("移すものはありません（done・dropped のタスクも、決まった判断も BACKLOG に残っていません）。");
    return 0;
  }
  if (check) {
    console.log(`BACKLOG に終わったものが ${result.moved.length} 件残っています。node scripts/backlog-archive.mjs で移してください:`);
    for (const m of result.moved) console.log(label(m));
    return 1;
  }
  try {
    mkdirSync(path.dirname(ARCHIVE), { recursive: true });
    writeFileSync(ARCHIVE, result.archive.join(archive.eol));
    writeFileSync(BACKLOG, result.backlog.join(backlog.eol));
  } catch (e) {
    console.error(`書けませんでした: ${e.message}`);
    return 2;
  }
  const tasks = result.moved.filter((m) => m.kind === "task").length;
  console.log(`${ARCHIVE} へ移しました（タスク ${tasks} 件・判断 ${result.moved.length - tasks} 件）:`);
  for (const m of result.moved) console.log(label(m));
  console.log(`次: git add ${BACKLOG} ${ARCHIVE}`);
  return 0;
}

// テストから関数だけを読み込むときは実行しない。
const invoked = process.argv[1] && path.resolve(process.argv[1]).endsWith(`${path.sep}backlog-archive.mjs`);
if (invoked) process.exitCode = main(process.argv.slice(2));
