#!/usr/bin/env node
// docdd init.mjs — /docdd:init と /docdd:update-kit が使う「決まった処理」をまとめたスクリプト（依存なし・Node 18 以上）。
// 雛形はこのファイルの位置から ../templates を読む。版はプラグインの .claude-plugin/plugin.json の version（読めなければ FALLBACK_VERSION。値は scripts/check-version-stamps.mjs が plugin.json と揃えさせる）。
// プロジェクトのフォルダ（cwd）で実行する:
//
//   node "${CLAUDE_PLUGIN_ROOT}/scripts/init.mjs" status    [--json]
//   node "${CLAUDE_PLUGIN_ROOT}/scripts/init.mjs" apply     [--json] [--dry-run] [--settings yes|no] [--agents-md new|replace|append|keep]
//                                                           [--mcp auto|next|empty] [--tasks scaffold,test-infra] [--fill-inferred]
//   node "${CLAUDE_PLUGIN_ROOT}/scripts/init.mjs" dates     [--json] [--dry-run] [--date YYYY-MM-DD]
//   node "${CLAUDE_PLUGIN_ROOT}/scripts/init.mjs" precommit [--json]
//   node "${CLAUDE_PLUGIN_ROOT}/scripts/init.mjs" update    [--json] [--dry-run] [--apply <パス,...>] [--keep-customized]
//
// どのサブコマンドも既存ファイルを黙って上書きしない（apply は置くだけ・足すだけ。上書きは update --apply で名指ししたファイルと、
// apply --agents-md replace の AGENTS.md だけ。replace は元を AGENTS.md.bak に残す）。
// 終了コード: 0 = 成功（status と update は調べた結果を返すだけでも 0）／1 = precommit で問題が見つかった／2 = 使い方の誤り・前提が足りない
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATES = path.join(PLUGIN_ROOT, "templates");
const FALLBACK_VERSION = "0.16.0";
const KIT_VERSION = readKitVersion();
const CWD = realpath(process.cwd());

const BEGIN = "<!-- docdd:tables:begin -->";
const END = "<!-- docdd:tables:end -->";
const RULES_BEGIN = /<!-- docdd:rules:begin v([0-9][^ ]*)[^>]*-->/;
const RULES_END = "<!-- docdd:rules:end -->";

/** AGENTS.md の中の「キット共通の約束」の塊（印で囲んだ所）。version は印に書いた版。 */
function rulesBlock(text) {
  const m = RULES_BEGIN.exec(text ?? "");
  if (!m) return null;
  const end = text.indexOf(RULES_END, m.index);
  if (end === -1) return null;
  return { version: m[1], start: m.index, end: end + RULES_END.length, text: text.slice(m.index, end + RULES_END.length) };
}

// v0.13 以前の CLAUDE.md を AGENTS.md へ移すときの、行の言い換え（手付かずの行だけが一致する）
const AGENTS_LINE_CONVERSIONS = [
  [
    "- このファイルには、このプロジェクトだけのこと（構成・コマンド・スキルへの追加指示）を書く。",
    "- このファイルは、Claude Code と Codex のどちらでも毎回読み込まれる。上半分はこのプロジェクトだけのこと（構成・コマンド・スキルへの追加指示）、下半分（「キット共通の約束」）はどのプロジェクトでも同じ約束。",
  ],
  [
    "- キット共通の約束（5原則・変更影響 → 必須の検証・Definition of Done・規約）は `.claude/rules/docdd-kit.md` にあり、毎回自動で読み込まれる。",
    "- 「キット共通の約束」は印（`docdd:rules`）で囲んであり、`/docdd:update-kit` が新しい版にする。直接は直さず、このプロジェクトだけの指示は「スキルへの追加指示」へ書く。",
  ],
  [
    "| `.claude/rules/docdd-kit.md` | キット共通の約束。`/docdd:update-kit` が新しい版にするので、直接は直さない（このプロジェクトだけの指示は下の「スキルへの追加指示」へ） |",
    "| `CLAUDE.md` | Claude Code 用に、このファイル（`AGENTS.md`）を読み込むだけの 1 行。中身はこのファイルに書く |",
  ],
];

/** 無くなった `.claude/rules/docdd-kit.md` への参照を AGENTS.md に言い換える。 */
function renameKitRefs(text) {
  return text.replaceAll("`.claude/rules/docdd-kit.md`", "`AGENTS.md`").replaceAll(".claude/rules/docdd-kit.md", "AGENTS.md");
}

/** docs・tasks の Markdown の中の、無くなったファイルへの参照を直す（移行で書き換えたファイルのパスを返す）。 */
function renameKitRefsInDocs() {
  const touched = [];
  const walk = (dir) => {
    let ents = [];
    try {
      ents = fs.readdirSync(abs(dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of ents) {
      const rel = `${dir}/${ent.name}`;
      if (ent.isDirectory()) walk(rel);
      else if (ent.name.endsWith(".md")) {
        const cur = readText(rel);
        if (cur == null || !cur.includes(".claude/rules/docdd-kit.md")) continue;
        writeFile(rel, renameKitRefs(cur));
        touched.push(rel);
      }
    }
  };
  for (const dir of ["docs", "tasks"]) walk(dir);
  return touched;
}

/**
 * v0.13 以前の CLAUDE.md（＋ .claude/rules/docdd-kit.md）から、AGENTS.md の中身を作る。
 * 利用者が書いた中身は消さない。約束は印で囲んで末尾へ置き、手を入れていなければ新しい版の文面にする。
 */
function toAgentsMd(claudeMd, rulesMd, rulesUntouched = false) {
  let text = (claudeMd ?? "").replace(/\r\n/g, "\n");
  // 手付かずの行は、新しい雛形の言い方に入れ替える（参照先が AGENTS.md の中へ移るため）
  for (const [from, to] of AGENTS_LINE_CONVERSIONS) text = text.replaceAll(from, to);
  // 直した行は、参照だけ言い換える
  text = renameKitRefs(text).replaceAll("`CLAUDE.md`「", "`AGENTS.md`「").replaceAll("CLAUDE.md「", "AGENTS.md「");
  let block = templateRulesBlock();
  if (rulesMd) {
    const cur = rulesMd.replace(/\r\n/g, "\n");
    const stamp = /<!-- docdd-kit v([0-9][^ ]*)/.exec(cur)?.[1] ?? null;
    if (!rulesUntouched) {
      // 手を入れた約束は、そのまま運ぶ（次の update が新しい版への置き換えを聞く）
      const body = cur
        .split("\n")
        .filter((l) => !l.startsWith("<!-- docdd-kit v"))
        .join("\n")
        .replace(/^# .*\n/, "")
        .replace(/^## /gm, "### ")
        .trim();
      block = `<!-- docdd:rules:begin v${stamp ?? "0.13.0"} — ここから下はキットが管理する。直すと /docdd:update-kit が差分を見せて聞く -->\n## キット共通の約束（docdd）\n\n${body}\n${RULES_END}`;
    }
  }
  const base = text.endsWith("\n") ? text : `${text}\n`;
  return `${base}\n${block}\n`;
}

/** 雛形の AGENTS.md から、約束の塊だけを取り出す。 */
function templateRulesBlock() {
  return rulesBlock(tplText("AGENTS.md"))?.text ?? "";
}
/** Codex が AGENTS.md を読む上限は 32 KiB。手前で知らせる（超えると末尾の約束が切れる）。 */
const AGENTS_MD_SOFT_LIMIT = 30 * 1024;
const DATE_TOKEN = "{{YYYY-MM-DD}}";
const MANIFEST = ".docdd/manifest.json";

/** manifest を書き直すときも残す、運営者が足した設定（notifyUpdates: false で更新のお知らせを止める。hook の notify-update.mjs が読む）。 */
function keptManifestSettings(base) {
  const kept = {};
  if (base?.notifyUpdates === false) kept.notifyUpdates = false;
  // 未記入欄の検査から外すパス（{{…}} を別の意味で使う文書。例: AI へ渡すプロンプトの本文）
  if (Array.isArray(base?.placeholdersIgnore) && base.placeholdersIgnore.every((s) => typeof s === "string")) {
    kept.placeholdersIgnore = base.placeholdersIgnore;
  }
  return kept;
}
const EMPTY_MCP = '{\n  "mcpServers": {}\n}\n';

/** キットが管理するファイル（利用者は直さない前提。update で手付かずなら置き換える）。 */
const KIT_OWNED = new Set([
  "CLAUDE.md",
  "scripts/check-doc-dates.mjs",
  "scripts/check-doc-refs.mjs",
  "scripts/check-doc-placeholders.mjs",
  "scripts/audit-check.mjs",
  "scripts/backlog-archive.mjs",
]);
/** 見本（検査の対象外。日付も埋めない）。 */
const SAMPLES = new Set(["docs/requirements/00_template.md", "docs/decisions/0000-template.md"]);

/** AGENTS.md「検証コマンド」表の行（行名は仕様 §3 と同じ）。aliases は前の版の行名（表を読むときだけ使う。書き換えはしない）。 */
const VERIFY_ROWS = [
  { row: "開発サーバー起動", token: "開発サーバー起動" },
  { row: "テスト用 DB", token: "テスト用 DB" },
  { row: "型検査", token: "型検査" },
  { row: "lint", token: "lint" },
  { row: "単体・DBテスト", token: "単体・DBテスト" },
  { row: "ビルド", token: "ビルド" },
  { row: "本番モード起動", token: "本番モード起動" },
  { row: "E2E（実際に動かす）", token: "E2E", aliases: ["E2E（実ブラウザ）"] },
  { row: "全検査（push 前に1回）", token: "全検査" },
  { row: "依存の脆弱性", token: "依存の脆弱性" },
  { row: "実物1周の費用上限", token: "実物1周の費用上限" },
];

/**
 * init が起票する定型タスク。「アプリの土台を作る」はタイトルの完全一致で重複を判定する。
 * 「テスト基盤の導入」は、タイトルがこの語で始まり（「テスト基盤の導入（E2E）」も含む）状態が done・dropped 以外のタスクを
 * 既にある基盤導入タスクとみなす（スキルと同じ判定）。
 */
const TASK_TITLES = { scaffold: "アプリの土台を作る", "test-infra": "テスト基盤の導入" };

/** v0.1.0〜v0.1.4 の雛形の sha256（manifest が無いプロジェクトで「手付かず」を判定する）。 */
const KNOWN_KIT_HASHES = {
  "scripts/check-doc-dates.mjs": {
    "18348e6848cc0c996ec7c8f2381a98bca7a868f3da43a94dfb4aa210b18942fa": "0.1.0",
    "0ba9c1adbd9056a067baef683b4d89df2a3982efde3e6b0775fbd56c67b132e3": "0.1.1〜0.1.4",
  },
  "scripts/check-doc-refs.mjs": {
    "a0f6c466e1c27d31911fdc2cd706b3badba0a38841320189c21c07ecd388d363": "0.1.0",
    "00d3c497d20c7f965b08bbc7c6fd56fd95a28f4e74f34231e39fca6408f7a71d": "0.1.1〜0.1.4",
  },
  "scripts/audit-check.mjs": {
    "cd3e46f6a2b20a8b2360c59fa7db3cf860aeecd93ec7116958a58d5acbfbf636": "0.1.0",
    "eae0fe2199745beaa4cfdac5cbf6e18727102b79389066874bbe4dc1049803fd": "0.1.1〜0.1.4",
  },
  // v0.14.0 で AGENTS.md の中へ移したファイル。手付かずなら、移すときに新しい約束へ入れ替える
  ".claude/rules/docdd-kit.md": {
    "1e7df0d28800355d769f4048bbc7417916d8ad83003fff080b374ed39bbd6493": "0.2.0",
    "875af3b9c111fe9cc06bbe94ca627545d7c51f4235e088e5f65def1a763c24ca": "0.3.0",
    "c44edff0e8003188e7871b937424d7963058a846c5e10c01c4b2c903d3d59745": "0.4.0",
    "fd75861e897203d241115bb1d8af76ca693bcf366239677d6f4339e69b910883": "0.5.0",
    "47678a2f40338eedaf4ced7cbdde3e8c0ba25067bcc6192e30648eaf6fdb78c9": "0.6.0",
    "4207348360425cb3721a1c15aa970924632a10a8804add080d2b977d981982be": "0.7.0",
    "087d7856dcf5366f2cde711298bf63b6dbd609b66b9988c5be134c74afe057a2": "0.8.0",
    "67acf66b39e335efa8c944f941f6e8f36d3fb6de411779295a27ca53fb319124": "0.9.0",
    "a48f2904e1c83382c399da93c384e7c7112693e4781f4c6ad5e106381b904eba": "0.10.0",
    "2afdcaf2ecc92c7a14a83b18ae7bc6bb29bd087480b4412cef9e0f5ce107b353": "0.11.0",
    "18ad74ab61289916df267e933db9b98aa1e5302d01f96ce299fa73662643194a": "0.11.1",
    "76305c7f1f61158d47ccfc9b68ad3f9b067b5f502ef2251e2c53be87e34f7443": "0.11.2",
    "f96f92f4f729a57060cb90b9821bbd5a927db44efec25ee841077961c3fd36b6": "0.12.0",
    "707f13a95259af1f1e2e4c486ff34ca3133d74ff4083e46053794a649d9856f6": "0.12.1",
    "275c32b909a61b439665e33bfde5a5b8822e6a27d02e569f77efa1a980958f9d": "0.13.0",
    "ea955c3db28c59c8cb7dd7c24ff3afd513e7b8e928dd446bdb47bab0e63a9b95": "0.13.1",
    "262c5b8a0766329ae89ffd937c583f472b97c1695ce4aab4ccaa4c1a6dfd3755": "0.13.2",
  },
};
const KNOWN_CLAUDE_MD_HASHES = {
  "d587062485a2c4402aa99df8f2c273e9cc32f9b6fda96038f89b9721abf9c006": "0.1.0",
  "ddd9ae3e21da8ce53ebede44cbcaabe56423c617d5e416c822946c182ec7c889": "0.1.1",
  "7904b9ca70a4ca531a75911a5c4bd31dcb3bb8e5e5a5bdb7a49720ec28082a43": "0.1.2〜0.1.3",
  "01444407c3f7b16d651e52f13f8af64af2bdcd2b4537c0a6d93e632d8ab73214": "0.1.4",
};
/**
 * v0.1.0〜v0.1.4 の雛形のうち利用者のファイルの sha256。一致すれば置いたまま手が入っていないので、
 * 新しい版で置き換えても失うものが無い（update で「手付かず→置換」に分類する）。
 */
const KNOWN_USER_HASHES = {
  "docs/README.md": {
    "2c052e76d42e0058fab6911479bc1434fa527c0ac2928477e0739467dd857d76": "0.1.0",
    "4f506ead4b4bbae60ce3bb7fdc175d01f7f82e23b778eaa11ca5d56522ef31af": "0.1.1〜0.1.4",
  },
  "docs/PRD.md": { "c67bb416d9eaf94b04a9effe77e8276c8ff11e77193cf6a6f739d61b9f8d6f72": "0.1.0〜0.1.4" },
  "docs/requirements/README.md": { "5c00b7bb592ba695eea023bbfa3ca7d315f91cfda96e13017ea67b0a62f49600": "0.1.0〜0.1.4" },
  "docs/decisions/README.md": { "1e021ca5db1266a8bc26f7fcdc97ed5bdd77fc8ef468f88e82deefaf2effe455": "0.1.0〜0.1.4" },
  "docs/decisions/0000-template.md": { "62365329d1d5189b0ca4a5d61ad670e717885ad747944675d1b4e72b8bcb6ce9": "0.1.0〜0.1.4" },
  "docs/operations/development-and-testing.md": { "5698c2ef4a4dfa487103fbe93024c2183ab06711f14ac208a9509577815e9834": "0.1.0〜0.1.4" },
  "tasks/BACKLOG.md": {
    "266bb4795d64ea55eae813ebd634a2f550efd5e258e701a06b6c996b68651208": "0.1.0",
    "2bb87a1d2c550d45882262581ca5f273e89b34433efebdd58c6557d34d86b22f": "0.1.1〜0.1.4",
  },
  "tasks/REFACTOR_PLAN.md": { "ccf27d41e06a2fae9e74b9ae53b9f61002d63910b4a43416e78fea8787cef762": "0.1.0〜0.1.4" },
};
const knownVersion = (rel, hash) => KNOWN_KIT_HASHES[rel]?.[hash] ?? KNOWN_USER_HASHES[rel]?.[hash] ?? null;

/**
 * v0.1 の CLAUDE.md にあって、v0.2 で .claude/rules/docdd-kit.md などへ移った節。
 * hashes は「見出し行から次の ## 見出しの手前まで（末尾の空白を除く）」の sha256。一致すれば利用者は手を入れていない。
 */
const LEGACY_SECTIONS = [
  { prefix: "前提：運営者は個人", movedTo: ".claude/rules/docdd-kit.md", hashes: ["c0a0d6af29e11513b4a1f6207fc8fc6603980759abf98eb9c01bcf9e242ff421"] },
  {
    prefix: "最重要ルール：ドキュメントとコードの同期",
    movedTo: ".claude/rules/docdd-kit.md",
    hashes: ["d809d71661916d491065edfe4a85c755e2ec076a78720661befb1530281e174c", "412dc0bec3078bcdc55a4dc4d0f4346cbb58d63b061893a1756d17f8c12f3eff"],
  },
  {
    prefix: "スキルの地図",
    movedTo: "プラグインの README（/docdd: と打つと一覧が出る）",
    hashes: [
      "53f49f4215be4cbd7ba814118a4f563fb846c536e58605424aa7227a32fa249c",
      "e3d4db7d8703edb47663c4c4949466b4774d26f41327af7d821d3f4d1d4d6a37",
      "f2c1a597dc6f6d4cb4b1f64e44266b4c73e8e1f2a6a8efdfd8a6c13caa2cd903",
    ],
  },
  { prefix: "仕様の読み方", movedTo: ".claude/rules/docdd-kit.md「開発の進め方」", hashes: ["4603065b23819f0690cadf7af14f04d1e05c1f6dcb822775108ac7a3f700362c"] },
  { prefix: "開発の進め方", movedTo: ".claude/rules/docdd-kit.md", hashes: ["22dee7e1023b3cdf032a058c7cceb11ade3e4d2606950fc5774008f7335b6e93"] },
  {
    prefix: "変更影響 → 必須の検証",
    movedTo: ".claude/rules/docdd-kit.md（いつ回すか・落とし穴は docs/operations/development-and-testing.md §2・§5）",
    hashes: [
      "7add94e5c5577c2aec5e5e72c72b85d8228aa27b8ba791ef9e92c12682b2f4b4",
      "61432ed18be87ab404de0bd768f19d882aa48305c2a3fd3fc454e87112a6c21c",
      "0031496fed6f7de1acd5ffafec4dac8480276c8bfad00be33460679d961929f0",
    ],
  },
  { prefix: "Definition of Done", movedTo: ".claude/rules/docdd-kit.md", hashes: ["6a73c7a14c7a8428024f46e7c4d3853f6c1462670695d4ec54b133ba3a4eb508"] },
  { prefix: "規約", movedTo: ".claude/rules/docdd-kit.md", hashes: ["a98f88278343a0289fe5f36dfc2129a37c321aa0b9447d521ad46e0fed4476f6"] },
];

/**
 * v0.1.0〜v0.1.4 の雛形のまま <…>（未記入）が残りうる行と、v0.2 での形（{{…}} は check-doc-placeholders が拾う）。
 * 行が完全に一致するときだけ置き換える（利用者が書き足した行は変えない）。templateRow は、いまの雛形の同じ行（先頭のセル）に置き換える。
 */
const LEGACY_PLACEHOLDER_LINES = {
  "AGENTS.md": [
    ["| `.mcp.json` | Claude Code 向け MCP 設定。初期値は Next.js 向け（shadcn/ui・Next.js DevTools）。Next.js でなければ `/docdd:init` が空にする。<使う道具に合わせて足す> |", { templateRow: "`.mcp.json`" }],
    ["| `.mcp.json` | Claude Code 向け MCP 設定（<使う道具に合わせて直す。既定は shadcn/ui と Next.js DevTools>） |", { templateRow: "`.mcp.json`" }],
  ],
  "docs/PRD.md": [
    ["# PRD：<プロダクト名>", "# PRD：{{プロダクト名}}"],
    ["| 更新日 | <YYYY-MM-DD> |", "| 更新日 | {{YYYY-MM-DD}} |"],
    ["<誰の・どんな困りごとを・どう解決するか>", "{{誰の・どんな困りごとを・どう解決するか}}"],
    ["<主な利用者と、その人が最初にやること>", "{{主な利用者（例: お客さん・店主。ゲームならプレイヤー）と、その人が最初にやること}}"],
    ["| A-1 | <機能名> | <1行> | Must |", "| A-1 | {{機能名}} | {{機能の説明1行}} | Must |"],
    ["- <例: 複数人での共同編集>", "- {{やらないこと（例: 複数人での共同編集）}}"],
    ["| <AI の月間上限> | <数値> | <原価の見積もり> |", "| {{上限の項目（例: AI の月間上限）}} | {{数値}} | {{原価の見積もり}} |"],
    ["| v0.1 | <YYYY-MM-DD> | 初版 |", "| v0.1 | {{YYYY-MM-DD}} | 初版 |"],
  ],
  "docs/operations/development-and-testing.md": [
    ["| 更新日 | <YYYY-MM-DD> |", "| 更新日 | {{YYYY-MM-DD}} |"],
    ["| v0.1 | <YYYY-MM-DD> | 初版 |", "| v0.1 | {{YYYY-MM-DD}} | 初版 |"],
  ],
  "tasks/REFACTOR_PLAN.md": [["## 現況（<YYYY-MM-DD> 時点）", "## 現況（{{YYYY-MM-DD}} 時点）"]],
};

/**
 * スキルの名前が変わった版で、雛形のまま残った行を新しい名前の行へ置き換える（行が完全に一致するときだけ）。
 * templateRow は、いまの雛形の同じ行（先頭のセル）に置き換える。
 */
const RENAMED_LINES = {
  "AGENTS.md": [
    // v0.12.0: tasks-from-prd → tasks-from-docs。v0.13.0: tasks-from-docs を add-task にまとめた
    ["| 起票する | `/docdd:add-task`（要望を 1 件ずつ）／`/docdd:tasks-from-prd`（PRD の機能をまとめて） |", { templateRow: "起票する" }],
    ["| 起票する | `/docdd:add-task`（要望を 1 件ずつ）／`/docdd:tasks-from-docs`（仕様書からまとめて。docs を自分で書き換えたあとも） |", { templateRow: "起票する" }],
  ],
};

/** v0.1 の雛形の未記入（<…>）の文字列。置き換えられずに残ったものを update が報告する（コードブロック・HTML コメントの中は見ない）。 */
const LEGACY_TOKENS = {
  "AGENTS.md": [
    "<プロジェクト名>",
    "<何を作っているか1行>",
    "<使う道具に合わせて足す>",
    "<使う道具に合わせて直す。既定は shadcn/ui と Next.js DevTools>",
    "<フレームワーク名。例: Next.js（App Router）>",
    "<型検査。例: npm run typecheck。無ければ「無い」>",
    "<lint。例: npm run lint>",
    "<単体・DBテスト。例: npm test>",
    "<ビルド。例: npm run build>",
    "<E2E。例: npm run test:e2e>",
    "<上を順に全部回すコマンド。例: npm run check:all>",
    "<上を順に全部回すコマンド。例: npm run release:check>",
    "<staging へ反映するコマンド。例: npm run deploy:staging。無ければ「無い」>",
    "<本番へ反映するコマンド。例: npm run deploy:production。無ければ「無い」（本番ブランチへの取り込みだけで公開されるなら、その旨）>",
    "<https://… 本番の URL。実ブラウザ確認に使う>",
  ],
  "docs/PRD.md": ["<プロダクト名>", "<YYYY-MM-DD>", "<誰の・どんな困りごとを・どう解決するか>", "<主な利用者と、その人が最初にやること>", "<機能名>", "<1行>", "<例: 複数人での共同編集>", "<AI の月間上限>", "<数値>", "<原価の見積もり>"],
  "docs/operations/development-and-testing.md": ["<YYYY-MM-DD>"],
  "tasks/REFACTOR_PLAN.md": [
    "<YYYY-MM-DD>",
    "<型検査> && <lint> && <テスト>",
    "<最後の監査で分かったこと。次に着手すべき領域。まだ監査していなければ「未監査」と書く>",
    "<例: 同じ判定が3ファイルに写経されている → 1つの関数へ集約し、3か所を置き換える>",
    "<論点と暫定案>",
  ],
  "tasks/BACKLOG.md": ["<例: メールアドレスで登録・ログインできる>", "<なぜ必要か・注意点>", "<論点>", "<背景1〜2文>", "<内容と、選んだときのデメリット>"],
};

// ---------------------------------------------------------------- 小さな道具

// Windows では fs.realpathSync（JS 版）が短い名前（RUNNER~1 など）や大文字小文字を直さず、
// git rev-parse --show-toplevel の正式な名前と食い違う。OS に正式な名前を聞く native 版を先に使う
function realpath(p) {
  try {
    return fs.realpathSync.native(p);
  } catch {
    try {
      return fs.realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  }
}

function readKitVersion() {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"), "utf8")).version;
    if (typeof v === "string" && /^\d+\.\d+\.\d+/.test(v)) return v;
  } catch {
    // plugin.json が読めなければ定数を使う
  }
  return FALLBACK_VERSION;
}

const abs = (rel) => path.join(CWD, ...rel.split("/"));
const toPosix = (p) => p.split(path.sep).join("/");
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function isFile(rel) {
  try {
    return fs.statSync(abs(rel)).isFile();
  } catch {
    return false;
  }
}

function readText(rel) {
  try {
    return fs.readFileSync(abs(rel), "utf8");
  } catch {
    return null;
  }
}

/** ファイルの先頭 bytes バイトを文字列で。読めなければ空文字。 */
function readHead(rel, bytes) {
  let fd;
  try {
    fd = fs.openSync(abs(rel), "r");
    const buf = Buffer.alloc(bytes);
    return buf.toString("utf8", 0, fs.readSync(fd, buf, 0, bytes, 0));
  } catch {
    return "";
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function readBuf(rel) {
  try {
    return fs.readFileSync(abs(rel));
  } catch {
    return null;
  }
}

/** 文書の改行。CRLF の行が LF だけの行と同じか多ければ CRLF（書き換えても元の改行を保つため）。 */
function eolOf(text) {
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/\n/g) || []).length - crlf;
  return crlf > 0 && crlf >= lf ? "\r\n" : "\n";
}

/** 改行を eol に揃える。 */
const withEol = (text, eol) => (eol === "\r\n" ? text.replace(/\r?\n/g, "\r\n") : text.replace(/\r\n/g, "\n"));

/** rel にファイルを置けないなら理由を返す（途中のフォルダと同じ名前のファイルがある・同じ名前のフォルダがある）。 */
function pathConflict(rel) {
  const parts = rel.split("/");
  for (let k = 1; k <= parts.length; k += 1) {
    const p = parts.slice(0, k).join("/");
    let st;
    try {
      st = fs.statSync(abs(p));
    } catch {
      return null;
    }
    if (k < parts.length && !st.isDirectory()) return { path: p, message: `${p} がフォルダではなくファイルなので、${rel} を置けません` };
    if (k === parts.length && st.isDirectory()) return { path: rel, message: `${rel} と同じ名前のフォルダがあるので、ファイルを置けません` };
  }
  return null;
}

// Claude Code のサンドボックスなどが書き込みを止めることがある設定ファイル。無くても導入は進められるので、書けなければ記録して先へ進む
const PROTECTED_CONFIG = new Set([".claude/settings.json", ".mcp.json"]);

function writeFile(rel, content) {
  fs.mkdirSync(path.dirname(abs(rel)), { recursive: true });
  fs.writeFileSync(abs(rel), content);
}

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function run(cmd, args, { cwd = CWD, timeout = 15000, env } = {}) {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    timeout,
    env: env ?? process.env,
    windowsHide: true,
    shell: process.platform === "win32" && /^(npm|npx|pnpm|yarn|gh|playwright-cli)$/.test(cmd),
  });
  return { ok: !r.error && r.status === 0, status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error: r.error ?? null };
}

const git = (args, opts) => run("git", ["-c", "core.quotepath=false", ...args], opts);

function listTemplates() {
  const out = [];
  const walk = (dir, prefix) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(path.join(dir, ent.name), rel);
      else if (ent.isFile() && rel !== "package.scripts.json" && ent.name !== ".DS_Store") out.push(rel);
    }
  };
  walk(TEMPLATES, "");
  return out.sort();
}

const tpl = (rel) => fs.readFileSync(path.join(TEMPLATES, ...rel.split("/")));
const tplText = (rel) => tpl(rel).toString("utf8");

function ownerOf(rel) {
  if (KIT_OWNED.has(rel)) return "kit";
  if (SAMPLES.has(rel)) return "sample";
  return "user";
}

function sortKeys(obj) {
  return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));
}

// ---- docdd:scan-markdown begin（templates/scripts/check-doc-*.mjs と同じ中身） ----
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

const PLACEHOLDER = /\{\{[^{}\n]*\}\}/g;

function findPlaceholders(text) {
  const out = [];
  scanMarkdown(text).forEach((segs, i) => {
    for (const s of segs) {
      if (s.kind !== "text") continue;
      for (const m of s.raw.matchAll(PLACEHOLDER)) out.push({ line: i + 1, token: m[0] });
    }
  });
  return out;
}

/** キットが置く Markdown（見本を除く）に残っている {{…}}。overrides は書き込み前の中身。 */
function placeholderReport(templates, overrides = new Map()) {
  const res = [];
  for (const rel of templates) {
    if (!rel.endsWith(".md") || SAMPLES.has(rel)) continue;
    const text = overrides.has(rel) ? String(overrides.get(rel)) : readText(rel);
    if (text == null) continue;
    for (const p of findPlaceholders(text)) res.push({ file: rel, line: p.line, token: p.token });
  }
  return res;
}

// ---------------------------------------------------------------- 引数

const BOOL_FLAGS = new Set(["json", "dry-run", "fill-inferred", "keep-customized", "add-backlog-sections", "help"]);

function parseArgs(argv) {
  const [sub, ...rest] = argv;
  const opts = {};
  const positional = [];
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
    if (eq !== -1) opts[name] = a.slice(eq + 1);
    else if (BOOL_FLAGS.has(name)) opts[name] = true;
    else if (rest[i + 1] !== undefined && !rest[i + 1].startsWith("--")) {
      opts[name] = rest[i + 1];
      i += 1;
    } else opts[name] = true;
  }
  return { sub, opts, positional };
}

class UsageError extends Error {}

function choice(value, allowed, fallback, flag) {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new UsageError(`${flag} は ${allowed.join("／")} のどれかを指定してください（いまの値: ${value}）`);
  }
  return value;
}

function parseList(value, allowed, flag) {
  if (value === undefined || value === true || value === "") return [];
  const items = String(value)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowed) {
    const bad = items.filter((s) => !allowed.includes(s));
    if (bad.length) throw new UsageError(`${flag} に使えるのは ${allowed.join("・")} です（分からない値: ${bad.join("・")}）`);
  }
  return [...new Set(items)];
}

// ---------------------------------------------------------------- プロジェクトを調べる

function gitInfo() {
  const ver = run("git", ["--version"]);
  if (ver.error) {
    return { available: false, version: null, isRepo: false, root: null, atGitRoot: null, userName: null, userEmail: null, commits: 0, branch: null, uncommitted: 0 };
  }
  const top = git(["rev-parse", "--show-toplevel"]);
  const isRepo = top.ok;
  const root = isRepo ? realpath(top.stdout.trim()) : null;
  const name = git(["config", "user.name"]);
  const email = git(["config", "user.email"]);
  const count = isRepo ? git(["rev-list", "--count", "HEAD"]) : null;
  const branch = isRepo ? git(["symbolic-ref", "--short", "-q", "HEAD"]) : null;
  const porcelain = isRepo ? git(["status", "--porcelain", "--untracked-files=normal"]) : null;
  return {
    available: true,
    version: ver.stdout.trim().replace(/^git version\s*/, ""),
    isRepo,
    root,
    atGitRoot: isRepo ? root === CWD : null,
    pathFromRoot: isRepo ? toPosix(path.relative(root, CWD)) : null,
    userName: name.ok ? name.stdout.trim() || null : null,
    userEmail: email.ok ? email.stdout.trim() || null : null,
    commits: count?.ok ? Number(count.stdout.trim()) || 0 : 0,
    branch: branch?.ok ? branch.stdout.trim() || null : null,
    uncommitted: porcelain?.ok ? porcelain.stdout.split("\n").filter(Boolean).length : 0,
  };
}


function readPackageJson() {
  const raw = readText("package.json");
  if (raw == null) return { exists: false, raw: null, data: null, parseError: null };
  try {
    const data = JSON.parse(raw.replace(/^﻿/, ""));
    return { exists: true, raw, data: isPlainObject(data) ? data : null, parseError: isPlainObject(data) ? null : "オブジェクトではない" };
  } catch (e) {
    return { exists: true, raw, data: null, parseError: e.message };
  }
}

const LOCKS = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
  ["npm-shrinkwrap.json", "npm"],
];

function detectPackageManager(pkg, gi) {
  if (!pkg.exists) return { name: null, lockfile: null, yarnBerry: false };
  let found = LOCKS.find(([f]) => isFile(f));
  let lockfile = found ? found[0] : null;
  if (!found && gi.root && !gi.atGitRoot) {
    const rootLock = LOCKS.find(([f]) => fs.existsSync(path.join(gi.root, f)));
    if (rootLock) {
      found = rootLock;
      lockfile = toPosix(path.relative(CWD, path.join(gi.root, rootLock[0])));
    }
  }
  const field = typeof pkg.data?.packageManager === "string" ? /^(npm|pnpm|yarn|bun)@(\d+)/.exec(pkg.data.packageManager) : null;
  const name = found?.[1] ?? field?.[1] ?? "npm";
  const yarnBerry =
    name === "yarn" &&
    Boolean(
      (field && field[1] === "yarn" && Number(field[2]) >= 2) ||
        isFile(".yarnrc.yml") ||
        (gi.root && fs.existsSync(path.join(gi.root, ".yarnrc.yml"))) ||
        // v2 以上の yarn.lock は __metadata: の塊を持つ（v1 は「# yarn lockfile v1」）。.yarnrc.yml も packageManager も無いときの手がかり
        (lockfile && path.posix.basename(lockfile) === "yarn.lock" && /^__metadata:/m.test(readHead(lockfile, 4096)))
    );
  return { name, lockfile, yarnBerry };
}

const STACK_MARKERS = ["package.json", "pyproject.toml", "requirements.txt", "setup.py", "Pipfile", "go.mod", "Gemfile", "Cargo.toml", "composer.json", "deno.json", "deno.jsonc"];

/** プロジェクトの一番上にある、名前が ext で終わるフォルダ（dir: true）かファイル。 */
function topLevelNamed(exts, dir) {
  try {
    return fs
      .readdirSync(CWD, { withFileTypes: true })
      .filter((ent) => (dir ? ent.isDirectory() : ent.isFile()) && exts.some((e) => ent.name.endsWith(e)))
      .map((ent) => ent.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Web 以外のプロジェクト（ゲームエンジン・ネイティブアプリなど）の目印。見つからなければ null。
 * 上から順に見て最初に当てはまったものを返す（Unity は .sln・.csproj も作るので .NET より先に見る）。
 */
function detectNonWeb() {
  if (isFile("ProjectSettings/ProjectVersion.txt")) {
    const m = /^m_EditorVersion:\s*(\S+)/m.exec(readText("ProjectSettings/ProjectVersion.txt") ?? "");
    const editorVersion = m ? m[1] : null;
    return { kind: "unity", framework: editorVersion ? `Unity ${editorVersion}` : "Unity", language: "C#", markers: ["ProjectSettings/ProjectVersion.txt"], unity: { editorVersion } };
  }
  if (isFile("project.godot")) return { kind: "godot", framework: "Godot", markers: ["project.godot"] };
  if (isFile("pubspec.yaml") && /^\s*flutter\s*:/m.test(readText("pubspec.yaml") ?? "")) {
    return { kind: "flutter", framework: "Flutter", language: "Dart", markers: ["pubspec.yaml"] };
  }
  // com.android は、Android Studio の雛形の settings.gradle.kts では正規表現の形（com\\.android.*）で書かれている
  const gradle = ["settings.gradle", "settings.gradle.kts", "build.gradle", "build.gradle.kts"].filter((f) => /com[\\.]+android/.test(readText(f) ?? ""));
  if (gradle.length) return { kind: "android", framework: "Android", markers: gradle };
  const xcode = topLevelNamed([".xcodeproj"], true);
  if (xcode.length || isFile("Package.swift")) {
    return { kind: "apple", framework: xcode.length ? "Xcode" : "Swift Package", markers: [...xcode, ...(isFile("Package.swift") ? ["Package.swift"] : [])] };
  }
  const dotnet = topLevelNamed([".sln", ".csproj"], false);
  if (dotnet.length) return { kind: "dotnet", framework: ".NET", language: "C#", markers: dotnet };
  return null;
}

/**
 * スタックを調べる。kind は web・unity・godot・flutter・android・apple・dotnet・unknown。
 * web は、Web のフレームワーク（package.json・Python・Rails）を見つけたら true、見つけずに Web 以外の目印があれば false、どちらも無ければ null。
 */
function detectStack(pkg, pm) {
  const data = pkg.data ?? {};
  const deps = { ...(isPlainObject(data.dependencies) ? data.dependencies : {}), ...(isPlainObject(data.devDependencies) ? data.devDependencies : {}) };
  const has = (n) => Object.prototype.hasOwnProperty.call(deps, n);
  const markers = STACK_MARKERS.filter(isFile);
  const frameworks = [];
  const languages = [];
  if (pkg.exists) {
    if (has("next")) frameworks.push("Next.js");
    if (has("nuxt")) frameworks.push("Nuxt");
    if (has("@sveltejs/kit")) frameworks.push("SvelteKit");
    if (has("astro")) frameworks.push("Astro");
    if (Object.keys(deps).some((k) => k.startsWith("@remix-run/") || k === "@react-router/dev")) frameworks.push("Remix / React Router");
    if (has("@angular/core")) frameworks.push("Angular");
    if (has("express")) frameworks.push("Express");
    if (has("hono")) frameworks.push("Hono");
    if (has("fastify")) frameworks.push("Fastify");
    if (!frameworks.length && has("vite")) frameworks.push(has("react") ? "Vite + React" : has("vue") ? "Vite + Vue" : "Vite");
    if (!frameworks.length && has("react")) frameworks.push("React");
    languages.push(has("typescript") || isFile("tsconfig.json") ? "TypeScript" : "JavaScript");
  }
  const pyText = ["pyproject.toml", "requirements.txt", "Pipfile", "setup.py"].map(readText).filter(Boolean).join("\n").toLowerCase();
  if (pyText || isFile("setup.py")) {
    languages.push("Python");
    if (/\bdjango\b/.test(pyText)) frameworks.push("Django");
    if (/\bfastapi\b/.test(pyText)) frameworks.push("FastAPI");
    if (/\bflask\b/.test(pyText)) frameworks.push("Flask");
  }
  if (isFile("go.mod")) languages.push("Go");
  if (isFile("Gemfile")) {
    languages.push("Ruby");
    if (/['"]rails['"]/.test(readText("Gemfile") ?? "")) frameworks.push("Ruby on Rails");
  }
  if (isFile("Cargo.toml")) languages.push("Rust");
  if (isFile("composer.json")) languages.push("PHP");
  // ここまでに見つけたフレームワークはどれも Web のもの（Web の画面か HTTP のサーバーを作る）
  const web = frameworks.length > 0;
  const nonWeb = detectNonWeb();
  if (nonWeb) {
    frameworks.push(nonWeb.framework);
    if (nonWeb.language && !languages.includes(nonWeb.language)) languages.push(nonWeb.language);
    for (const m of nonWeb.markers) if (!markers.includes(m)) markers.push(m);
  }
  return {
    markers,
    packageManager: pm.name,
    lockfile: pm.lockfile,
    languages,
    frameworks,
    framework: frameworks[0] ?? null,
    kind: web ? "web" : nonWeb ? nonWeb.kind : "unknown",
    web: web ? true : nonWeb ? false : null,
    unity: nonWeb?.unity ?? null,
    next: has("next"),
    deps: Object.keys(deps).length,
  };
}

const PNPM_BUILTINS = new Set(["add", "audit", "bin", "ci", "config", "create", "dedupe", "deploy", "dlx", "doctor", "env", "exec", "fetch", "import", "init", "install", "licenses", "link", "list", "ls", "outdated", "pack", "patch", "prune", "publish", "rebuild", "remove", "root", "server", "setup", "store", "unlink", "update", "why"]);
const YARN_BUILTINS = new Set(["add", "audit", "bin", "cache", "check", "config", "create", "dlx", "exec", "explain", "generate-lock-entry", "global", "help", "import", "info", "init", "install", "licenses", "link", "list", "login", "logout", "node", "npm", "outdated", "owner", "pack", "plugin", "policies", "publish", "rebuild", "remove", "run", "set", "tag", "team", "unlink", "unplug", "up", "upgrade", "upgrade-interactive", "version", "versions", "why", "workspace", "workspaces"]);

function scriptCmd(pm, name) {
  switch (pm) {
    case "pnpm":
      return PNPM_BUILTINS.has(name) ? `pnpm run ${name}` : `pnpm ${name}`;
    case "yarn":
      return YARN_BUILTINS.has(name) ? `yarn run ${name}` : `yarn ${name}`;
    case "bun":
      return `bun run ${name}`;
    default:
      return name === "test" || name === "start" ? `npm ${name}` : `npm run ${name}`;
  }
}

function execCmd(pm, bin, args) {
  if (pm === "pnpm") return `pnpm exec ${bin} ${args}`;
  if (pm === "yarn") return `yarn ${bin} ${args}`;
  if (pm === "bun") return `bunx ${bin} ${args}`;
  return `npx ${bin} ${args}`;
}

const NPM_DEFAULT_TEST = /no test specified/;

/** JSON にコメントと末尾のカンマを許した形（tsconfig.json など）を読む。読めなければ null。 */
function readJsonc(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  } catch {
    return null;
  }
  // 文字列の外のコメントを消す
  let noComments = "";
  for (let i = 0; i < text.length; ) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      noComments += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 2;
    } else {
      noComments += c;
      i += 1;
    }
  }
  // 文字列の外の、閉じかっこの直前のカンマを消す
  let out = "";
  for (let i = 0; i < noComments.length; ) {
    const c = noComments[i];
    if (c === '"') {
      let j = i + 1;
      while (j < noComments.length && noComments[j] !== '"') j += noComments[j] === "\\" ? 2 : 1;
      out += noComments.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === ",") {
      let j = i + 1;
      while (j < noComments.length && /\s/.test(noComments[j])) j += 1;
      if (noComments[j] === "}" || noComments[j] === "]") {
        i += 1;
        continue;
      }
    }
    out += c;
    i += 1;
  }
  try {
    const data = JSON.parse(out);
    return isPlainObject(data) ? data : null;
  } catch {
    return null;
  }
}

const isFileAbs = (file) => {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
};

/** tsconfig の extends が指すファイル（相対パスか、上のフォルダの node_modules にあるパッケージ）。見つからなければ null。 */
function resolveTsconfigExtends(fromFile, spec) {
  if (typeof spec !== "string" || spec === "") return null;
  const candidates = (base) => [base, `${base}.json`, path.join(base, "tsconfig.json")];
  if (spec.startsWith(".") || path.isAbsolute(spec)) return candidates(path.resolve(path.dirname(fromFile), spec)).find(isFileAbs) ?? null;
  for (let dir = path.dirname(fromFile); ; dir = path.dirname(dir)) {
    const hit = candidates(path.join(dir, "node_modules", ...spec.split("/"))).find(isFileAbs);
    if (hit) return hit;
    if (path.dirname(dir) === dir) return null;
  }
}

/** tsconfig の noEmit・emitDeclarationOnly（extends をたどる）。値は true・false・undefined（指定なし）・"?"（読めない extends があって決まらない）。 */
function tsconfigEmitOptions(file, seen = new Set()) {
  const unknown = { noEmit: "?", emitDeclarationOnly: "?" };
  if (seen.has(file) || seen.size > 16) return unknown;
  const data = readJsonc(file);
  if (!data) return unknown;
  const chain = new Set([...seen, file]);
  const out = { noEmit: undefined, emitDeclarationOnly: undefined };
  const specs = data.extends === undefined ? [] : [data.extends].flat();
  for (const spec of specs) {
    const target = resolveTsconfigExtends(file, spec);
    const base = target ? tsconfigEmitOptions(target, chain) : unknown;
    for (const k of Object.keys(out)) if (base[k] !== undefined) out[k] = base[k];
  }
  const co = isPlainObject(data.compilerOptions) ? data.compilerOptions : {};
  for (const k of Object.keys(out)) if (typeof co[k] === "boolean") out[k] = co[k];
  return out;
}

/** 自分ではファイルを持たず、中身を references の先に任せる tsconfig か（files: [] で include が無い）。 */
const delegatesOnly = (data) => Array.isArray(data.files) && data.files.length === 0 && data.include === undefined;

/**
 * tsc -b（vue-tsc -b）が file から references をたどって JS を書き出すか。
 * true = 書き出す参照先がある／false = どれも書き出さない（noEmit か emitDeclarationOnly）／null = 読めない tsconfig があって決まらない。
 */
function buildEmitsJs(file, depth = 0) {
  if (depth > 8) return null;
  const data = readJsonc(file);
  if (!data) return null;
  let result = false;
  if (!delegatesOnly(data)) {
    const o = tsconfigEmitOptions(file);
    if (o.noEmit !== true && o.emitDeclarationOnly !== true) {
      if (o.noEmit !== "?" && o.emitDeclarationOnly !== "?") return true;
      result = null;
    }
  }
  for (const ref of Array.isArray(data.references) ? data.references : []) {
    if (!isPlainObject(ref) || typeof ref.path !== "string") continue;
    let target = path.resolve(path.dirname(file), ref.path);
    try {
      if (fs.statSync(target).isDirectory()) target = path.join(target, "tsconfig.json");
    } catch {
      result = null;
      continue;
    }
    const r = buildEmitsJs(target, depth + 1);
    if (r === true) return true;
    if (r === null) result = null;
  }
  return result;
}

/** scripts.build の中で、型検査をしながらビルドする形（vue-tsc -b・tsc -b。--build も同じ）。無ければ null。 */
function buildTypecheckBin(build) {
  if (typeof build !== "string") return null;
  for (const bin of ["vue-tsc", "tsc"]) {
    if (new RegExp(`(?:^|[\\s;&|(])${bin}\\s+(?:-b|--build)(?=$|[\\s;&|)])`).test(build)) return bin;
  }
  return null;
}

/** 検証コマンド表の各行を推定する。value は生のコマンド／「無い」／null（推定できない）。cell は表に書く形。 */
function inferVerification(pkg, pm, stack) {
  const rows = new Map(VERIFY_ROWS.map((r) => [r.token, { row: r.row, token: r.token, value: null, cell: null, source: "推定できない（ヒアリングで聞く）" }]));
  const set = (token, value, source, suffix = "") => {
    const r = rows.get(token);
    r.value = value;
    r.cell = value == null ? null : value === "無い" ? "無い" : `\`${value}\`${suffix}`;
    r.source = source;
  };
  if (pkg.exists && pkg.data) {
    const scripts = isPlainObject(pkg.data.scripts) ? pkg.data.scripts : {};
    const deps = { ...(pkg.data.dependencies ?? {}), ...(pkg.data.devDependencies ?? {}) };
    const hasDep = (n) => Object.prototype.hasOwnProperty.call(deps, n);
    const usable = (n) => typeof scripts[n] === "string" && scripts[n].trim() !== "" && !(n === "test" && NPM_DEFAULT_TEST.test(scripts[n]));
    const pick = (names) => names.find(usable);
    const name = pm.name ?? "npm";
    const fromScript = (token, names, label) => {
      const n = pick(names);
      if (n) set(token, scriptCmd(name, n), `package.json の scripts.${n}`);
      else set(token, "無い", `package.json の scripts に ${label} が無い`);
      return n;
    };

    // Vite・SvelteKit・Astro・Nuxt の開発サーバーと preview は、既定で localhost だけで待つ。macOS などでは localhost が ::1 に解決され、
    // http://127.0.0.1 では繋がらない。Next.js は既定で 0.0.0.0 で待つので 127.0.0.1 のまま
    const viteLike = hasDep("vite") || hasDep("@sveltejs/kit");
    const localhostOnly = !hasDep("next") && (hasDep("nuxt") || hasDep("astro") || viteLike);
    const localUrl = (p) => `http://${localhostOnly ? "localhost" : "127.0.0.1"}:${p}`;
    const dev = pick(["dev"]);
    if (dev) {
      const s = scripts[dev];
      const port = (/(?:-p|--port)[\s=]+(\d{2,5})/.exec(s) || /\bPORT=(\d{2,5})/.exec(s) || [])[1];
      const guess = port ?? (hasDep("next") || hasDep("nuxt") ? "3000" : hasDep("astro") ? "4321" : viteLike ? "5173" : null);
      set("開発サーバー起動", scriptCmd(name, dev), `package.json の scripts.${dev}`, guess ? `（${localUrl(guess)} で開く）` : "");
    } else {
      // dev が無い Web のプロジェクト（create-react-app・Express・Vue CLI など）は、serve や start が開発サーバーを兼ねることが多い。
      // ここを「無い」にすると、ui-polish などの Web の門が Web 以外と取り違えて止まるので、推定できなければ未記入のまま聞く。
      const alt = pick(["serve", "start"]);
      if (stack.web === true && alt) set("開発サーバー起動", scriptCmd(name, alt), `package.json の scripts.${alt}（dev が無いので、開発サーバーを兼ねるとみなした）`);
      else if (stack.web === true) rows.get("開発サーバー起動").source = "Web のプロジェクトだが scripts に dev・serve・start が無い（ヒアリングで聞く）";
      else set("開発サーバー起動", "無い", "package.json の scripts に dev が無い");
    }

    const tc = pick(["typecheck", "type-check", "tsc", "types", "check-types", "check:types"]);
    const tsconfig = isFile("tsconfig.json") ? readJsonc(abs("tsconfig.json")) : null;
    // Vite の雛形（react-ts・vue-ts）の形。tsc --noEmit は 1 ファイルも調べずに成功するので使わない
    const solution = tsconfig != null && delegatesOnly(tsconfig) && Array.isArray(tsconfig.references) && tsconfig.references.length > 0;
    if (tc) set("型検査", scriptCmd(name, tc), `package.json の scripts.${tc}`);
    else if (solution && (hasDep("typescript") || hasDep("vue-tsc"))) {
      const bin = buildTypecheckBin(scripts.build);
      const emits = bin ? buildEmitsJs(abs("tsconfig.json")) : undefined;
      const row = rows.get("型検査");
      if (bin && emits === false) set("型検査", execCmd(name, bin, "-b"), `tsconfig.json が references の形で、scripts.build が ${bin} -b を使う（参照先の tsconfig は JS を書き出さない）`);
      else if (!bin) row.source = "tsconfig.json が references の形（files: [] と references）なので tsc --noEmit では何も調べない。scripts.build にも tsc -b・vue-tsc -b が無い（ヒアリングで聞く）";
      else if (emits === true) row.source = `tsconfig.json が references の形だが、参照先の tsconfig に noEmit も emitDeclarationOnly も無く、${bin} -b が JS を書き出す（ヒアリングで聞く）`;
      else row.source = `tsconfig.json が references の形だが、参照先の tsconfig（extends の先）を読めず、${bin} -b が JS を書き出すか分からない（npm install のあとに /docdd:init をもう一度打つか、ヒアリングで聞く）`;
    } else if (hasDep("typescript") && isFile("tsconfig.json")) set("型検査", execCmd(name, "tsc", "--noEmit"), "tsconfig.json と typescript の依存");
    else set("型検査", "無い", "型検査の script も tsconfig.json も無い");

    fromScript("lint", ["lint"], "lint");
    if (!fromScript("単体・DBテスト", ["test", "test:unit", "unit"], "test（npm init の既定の test は数えない）")) {
      // 無い → init が「テスト基盤の導入」を起票する
    }
    const build = fromScript("ビルド", ["build"], "build");
    const start = pick(["start"]);
    // Vite は start を持たず、本番ビルドを手元で動かす preview を持つ
    const preview = !start && hasDep("vite") ? pick(["preview"]) : null;
    const prodRun = start ?? preview;
    if (prodRun) {
      const cmd = build ? `${scriptCmd(name, build)} && ${scriptCmd(name, prodRun)}` : scriptCmd(name, prodRun);
      const why = preview ? "（start が無く、依存に vite があるので、preview を本番モード起動とみなした）" : "";
      // vite preview の既定のポートは 4173
      const previewPort = preview ? ((/(?:^|\s)--port[\s=]+(\d{2,5})/.exec(scripts[preview]) || [])[1] ?? "4173") : null;
      set("本番モード起動", cmd, `package.json の scripts.${build ? `${build} と scripts.` : ""}${prodRun}${why}`, previewPort ? `（${localUrl(previewPort)} で開く）` : "");
    } else set("本番モード起動", "無い", hasDep("vite") ? "package.json の scripts に start も preview も無い" : "package.json の scripts に start が無い");

    const e2e = pick(["test:e2e", "e2e", "playwright", "test:playwright"]);
    const pwConfig = ["playwright.config.ts", "playwright.config.js", "playwright.config.mjs", "playwright.config.cjs"].find(isFile);
    if (e2e) set("E2E", scriptCmd(name, e2e), `package.json の scripts.${e2e}`);
    else if (hasDep("@playwright/test") && pwConfig) set("E2E", execCmd(name, "playwright", "test"), `${pwConfig} と @playwright/test の依存`);
    else set("E2E", "無い", "E2E の script も playwright.config も無い");

    const all = pick(["check:all", "check", "ci"]);
    if (all) set("全検査", scriptCmd(name, all), `package.json の scripts.${all}`);
    else {
      const parts = ["型検査", "lint", "単体・DBテスト", "ビルド", "E2E"].map((t) => rows.get(t).value).filter((v) => v && v !== "無い");
      if (parts.length) set("全検査", parts.join(" && "), "型検査・lint・単体・ビルド・E2E のうち有るものを順につないだ");
      else set("全検査", "無い", "型検査・lint・テスト・ビルドのどれも無い");
    }

    const lock = pm.lockfile ? path.posix.basename(pm.lockfile) : null;
    if (name === "npm" && lock === "package-lock.json") set("依存の脆弱性", "node scripts/audit-check.mjs", "npm と package-lock.json");
    else if (name === "npm" && lock) set("依存の脆弱性", "npm audit --audit-level=high", `npm と ${lock}`);
    // npm 以外も、audit-check と同じく本番の依存だけを high 以上で調べる。据え置きの一覧（scripts/audit-allowlist.json）は audit-check だけが読む
    else if (name === "pnpm") set("依存の脆弱性", "pnpm audit --audit-level=high --prod", "pnpm（本番の依存だけ）");
    else if (name === "yarn" && pm.yarnBerry) set("依存の脆弱性", "yarn npm audit --recursive --severity high --environment production", "yarn（v2 以上。依存の依存まで・本番の依存だけ）");
    else if (name === "yarn") set("依存の脆弱性", "yarn audit --level high --groups dependencies", "yarn（v1。本番の依存だけ）");
    else if (name === "bun") set("依存の脆弱性", "bun audit --audit-level=high --prod", "bun（本番の依存だけ）");
    // lock がまだ無い npm のプロジェクトも audit-check を使う。lock が無ければスクリプトが「npm install を 1 回実行して」と案内して止まるので、非エンジニアにコマンドを聞かずに済む。
    else if (name === "npm") set("依存の脆弱性", "node scripts/audit-check.mjs", "npm（package-lock.json はまだ無い。npm install で作られる）");
    else rows.get("依存の脆弱性").source = "パッケージマネージャを判定できない";
  } else if (stack.languages.includes("Python")) {
    const py = (readText("pyproject.toml") ?? "") + (readText("requirements.txt") ?? "") + (readText("requirements-dev.txt") ?? "");
    const prefix = isFile("uv.lock") ? "uv run " : isFile("poetry.lock") ? "poetry run " : "";
    if (/\[tool\.ruff/.test(py) || isFile("ruff.toml") || isFile(".ruff.toml")) set("lint", `${prefix}ruff check .`, "ruff の設定");
    if (/\[tool\.mypy/.test(py) || isFile("mypy.ini")) set("型検査", `${prefix}mypy .`, "mypy の設定");
    else if (/\[tool\.pyright/.test(py) || isFile("pyrightconfig.json")) set("型検査", `${prefix}pyright`, "pyright の設定");
    if (/\[tool\.pytest/.test(py) || isFile("pytest.ini") || /\bpytest\b/i.test(py)) set("単体・DBテスト", `${prefix}pytest`, "pytest の設定・依存");
    if (/pip-audit/i.test(py)) set("依存の脆弱性", `${prefix}pip-audit`, "pip-audit の依存");
  } else if (stack.languages.includes("Go")) {
    set("単体・DBテスト", "go test ./...", "go.mod");
    set("ビルド", "go build ./...", "go.mod");
    set("lint", "go vet ./...", "go.mod");
  }
  if (stack.web === false) {
    const name = stack.framework ?? stack.kind;
    set("開発サーバー起動", "無い", `Web 以外のプロジェクト（${name}）なので、Web の開発サーバーは無い`);
    set("本番モード起動", "無い", `Web 以外のプロジェクト（${name}）なので、Web の本番モード起動は無い`);
    if (stack.kind === "unity" || stack.kind === "godot") set("依存の脆弱性", "無い", `${name} には依存の脆弱性を調べる標準の検査が無い`);
    if (stack.kind === "unity") {
      const why = "Unity には型検査・lint の標準のコマンドが無い（C# のコンパイルエラーは EditMode テストで出る）";
      set("型検査", "無い", why);
      set("lint", "無い", why);
    }
    for (const token of ["単体・DBテスト", "E2E", "ビルド"]) {
      set(token, null, "推定しない（Web 以外のプロジェクト。plugins/docdd の README『Web 以外のプロジェクトで使う』の例を見て書く）");
    }
  }
  return [...rows.values()];
}

const SKIP_DIRS = ["node_modules", ".git", ".next", "dist", "build", "out", ".venv", "venv", "__pycache__", "vendor", ".turbo", ".cache", "coverage", "target", ".svelte-kit", ".nuxt", ".output", ".playwright-cli", "playwright-report", "test-results", "Library", "Temp", "Logs", "UserSettings", "obj", "Build", "Builds", ".godot", "Pods", "DerivedData", ".gradle"];

function listProjectFiles(gi) {
  if (gi.isRepo) {
    const excludes = SKIP_DIRS.map((d) => `:(exclude,glob)**/${d}/**`);
    const r = git(["ls-files", "-co", "--exclude-standard", "-z", "--", ".", ...excludes], { timeout: 30000 });
    if (r.ok) return r.stdout.split("\0").filter(Boolean).slice(0, 20000);
  }
  const out = [];
  const walk = (dir, prefix) => {
    if (out.length >= 5000) return;
    let ents = [];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of ents) {
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.includes(ent.name)) walk(path.join(dir, ent.name), rel);
      } else if (ent.isFile()) out.push(rel);
      if (out.length >= 5000) return;
    }
  };
  walk(CWD, "");
  return out;
}

const CODE_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|vue|svelte|astro|py|go|rb|php|java|kt|swift|rs|cs|gd|dart|c|cc|cpp|h|hpp|lua|html|css|scss)$/i;
const CONFIG_LIKE = /(^|\/)([^/]+\.config\.[^/]+|\.?eslintrc[^/]*|\.prettierrc[^/]*|[^/]+\.d\.ts)$/i;
const DOC_EXT = /\.(md|markdown|mdx|txt|rst|adoc)$/i;
const NOT_SPEC = /(^|\/)(CHANGELOG|LICENSE|LICENCE|CONTRIBUTING|CODE_OF_CONDUCT|SECURITY|NOTICE|AUTHORS)[^/]*$|(^|\/)requirements[^/]*\.txt$|(^|\/)robots\.txt$|^\.github\/|(^|\/)(AGENTS|CLAUDE)(\.local|\.override)?\.md(\.bak.*)?$|^docs\/_imported\//i;
const SPEC_WORDS = /spec|仕様|要件|prd|requirement|design|設計|memo|メモ|notion|企画|plan|idea/i;
/** エンジンやツールの設定・パッケージ・素材を置くフォルダ（Unity・Godot・iOS・Android）。この下は仕様書の候補にしない。 */
const NOT_SPEC_DIRS = /^(ProjectSettings|Packages|Assets|addons|Pods|android|ios)\//;
/** 既存コードとして数えないフォルダ（Unity の雛形の見本スクリプトと、パッケージの中身）。 */
const NOT_OWN_CODE = /^(Assets\/TutorialInfo|Packages)\//;
/**
 * スタックの種類ごとに、既存コードとして数えないフォルダ。Godot の addons/ はプラグインの中身。
 * Flutter の android/・ios/ などは flutter create が置く各プラットフォームの土台（自分のコードは lib/ に書く）。
 */
const NOT_OWN_CODE_BY_KIND = { godot: /^addons\//, flutter: /^(android|ios|linux|macos|windows|web)\// };

function classifyFiles(files, templates, kind) {
  const dests = new Set(templates);
  const isKitPath = (f) => dests.has(f) || f.startsWith(".docdd/") || f.startsWith(".claude/") || f === "AGENTS.md" || f === "CLAUDE.md" || f.startsWith("AGENTS.md.bak") || f.startsWith("CLAUDE.md.bak");
  const notOwnByKind = NOT_OWN_CODE_BY_KIND[kind];
  const sourceFiles = files.filter((f) => CODE_EXT.test(f) && !isKitPath(f) && !CONFIG_LIKE.test(f) && !NOT_OWN_CODE.test(f) && !notOwnByKind?.test(f));
  // .txt は、ファイル名に仕様らしい語があるときだけ候補にする（例: ProjectSettings/ProjectVersion.txt や sysinfo.txt を出さない）
  const docLike = (f) => DOC_EXT.test(f) && (!/\.txt$/i.test(f) || SPEC_WORDS.test(path.posix.basename(f)));
  const specCandidates = files
    .filter((f) => docLike(f) && !isKitPath(f) && !NOT_SPEC.test(f) && !NOT_SPEC_DIRS.test(f))
    .map((f) => {
      const text = readText(f) ?? "";
      return { path: f, lines: text ? text.split(/\r?\n/).length : 0, text };
    })
    .filter((c) => c.lines >= 3 && !/bootstrapped with|create-next-app|This template provides a minimal setup/i.test(c.text))
    .sort((a, b) => {
      const score = (c) => (SPEC_WORDS.test(c.path) ? 0 : c.path.startsWith("docs/") ? 1 : /readme/i.test(c.path) ? 3 : 2);
      return score(a) - score(b) || a.path.localeCompare(b.path);
    })
    .slice(0, 30)
    .map(({ path: p, lines }) => ({ path: p, lines }));
  return { sourceFiles, specCandidates };
}

/**
 * 約束のファイル（AGENTS.md）の状態。AGENTS.md が無ければ、v0.13 以前の CLAUDE.md を見る（移行の判定に使う）。
 * legacyMain が true なら「中身は CLAUDE.md にある」という意味。
 */
function claudeMdInfo() {
  const legacyMain = !isFile("AGENTS.md") && isFile("CLAUDE.md");
  const main = legacyMain ? "CLAUDE.md" : "AGENTS.md";
  const buf = readBuf(main);
  if (buf == null) return { file: "AGENTS.md", legacyMain: false, exists: false, builtinInit: false, hasMarkers: false, hasVerifyTable: false, hasReflectTable: false, legacyTables: false, docdd: false, lines: 0, bytes: 0, knownTemplate: null };
  const text = buf.toString("utf8");
  const hash = sha256(buf);
  return {
    file: main,
    legacyMain,
    exists: true,
    builtinInit: /This file provides guidance to Claude Code/i.test(text),
    hasMarkers: text.includes(BEGIN) && text.includes(END),
    hasVerifyTable: /^##\s*検証コマンド/m.test(text),
    hasReflectTable: /^##\s*反映コマンド/m.test(text),
    legacyTables: /^##\s*変更影響 → 必須の検証/m.test(text),
    docdd: text.includes("/docdd:"),
    lines: text.split(/\r?\n/).length,
    bytes: buf.length,
    knownTemplate: hash === sha256(tpl(main)) ? KIT_VERSION : KNOWN_CLAUDE_MD_HASHES[hash] ?? null,
  };
}

function readManifest() {
  const text = readText(MANIFEST);
  if (text == null) return { exists: false, data: null, kitVersion: null, parseError: null };
  try {
    const data = JSON.parse(text);
    return { exists: true, data: isPlainObject(data) ? data : null, kitVersion: data?.kitVersion ?? null, parseError: null };
  } catch (e) {
    return { exists: true, data: null, kitVersion: null, parseError: e.message };
  }
}

function settingsDiff() {
  const text = readText(".claude/settings.json");
  if (text == null) return { exists: false };
  let cur;
  try {
    cur = JSON.parse(text);
  } catch (e) {
    return { exists: true, parseError: e.message };
  }
  const t = JSON.parse(tplText(".claude/settings.json"));
  const list = (obj, key) => (Array.isArray(obj?.permissions?.[key]) ? obj.permissions[key] : []);
  const missing = (key) => list(t, key).filter((x) => !list(cur, key).includes(x));
  return {
    exists: true,
    sameAsTemplate: text === tplText(".claude/settings.json"),
    missingAllow: missing("allow"),
    missingAsk: missing("ask"),
    missingDeny: missing("deny"),
    // 雛形は始まりのモードを決めない（Pro・Max・Team の auto モードを上書きしない）。既存の指定は報告だけする
    currentDefaultMode: typeof cur?.permissions?.defaultMode === "string" ? cur.permissions.defaultMode : null,
  };
}

function mcpInfo(stack, mode = "auto") {
  const variant = mode === "next" ? "next" : mode === "empty" ? "empty" : stack.next ? "next" : "empty";
  const text = readText(".mcp.json");
  if (text == null) return { exists: false, recommended: variant, missingServers: [] };
  let cur;
  try {
    cur = JSON.parse(text);
  } catch (e) {
    return { exists: true, recommended: variant, parseError: e.message, missingServers: [] };
  }
  const have = Object.keys(isPlainObject(cur?.mcpServers) ? cur.mcpServers : {});
  const want = variant === "next" ? Object.keys(JSON.parse(tplText(".mcp.json")).mcpServers) : [];
  return { exists: true, recommended: variant, missingServers: want.filter((s) => !have.includes(s)) };
}

/** templates/.gitignore の塊の見出し（完全一致で使う）。「# docdd: 共通」とこの 2 つ以外の見出しの塊は、どのプロジェクトにも使う。 */
const GITIGNORE_WEB_HEADER = "# docdd: Web（Node.js・ビルド出力・Playwright）";
const GITIGNORE_PYTHON_HEADER = "# docdd: Python";

/**
 * templates/.gitignore を「# docdd: 」で始まる見出しごとの塊に分け、stack に合う塊だけを返す。
 * 「# docdd: 共通」は常に。Web の塊は stack.web が false でないとき（Web 以外のプロジェクトには足さない）。Python の塊は Python を検出したとき。
 * lines は比べる行（コメントと空行を除く）、raw は見出しから塊の終わりまでの行（新しく置くときに使う）。
 */
function gitignoreBlocks(stack) {
  const blocks = [];
  for (const line of tplText(".gitignore").split(/\r?\n/)) {
    const l = line.trim();
    if (l.startsWith("# docdd:")) blocks.push({ header: l, lines: [], raw: [l] });
    else if (blocks.length) {
      const b = blocks[blocks.length - 1];
      b.raw.push(line.replace(/\s+$/, ""));
      if (l && !l.startsWith("#")) b.lines.push(l);
    }
  }
  const want = (b) => {
    if (b.header === GITIGNORE_WEB_HEADER) return stack.web !== false;
    if (b.header === GITIGNORE_PYTHON_HEADER) return stack.languages.includes("Python");
    return true;
  };
  return blocks.filter(want).map((b) => {
    const raw = [...b.raw];
    while (raw.length && raw[raw.length - 1] === "") raw.pop();
    return { ...b, raw };
  });
}

function gitignoreTemplateLines(stack) {
  return gitignoreBlocks(stack).flatMap((b) => b.lines);
}

/** .gitignore が無いときに置く中身（stack に合う塊を、雛形の順に空行 1 行で区切る）。 */
function gitignoreTemplateText(stack) {
  return `${gitignoreBlocks(stack)
    .map((b) => b.raw.join("\n"))
    .join("\n\n")}\n`;
}

/** .gitignore の行を比べる形（先頭と末尾の / の違いは同じ行とみなす: node_modules・/node_modules・node_modules/）。 */
const gitignoreKey = (line) => line.trim().replace(/^\//, "").replace(/\/$/, "");

/**
 * 既存の .gitignore に足す行（塊の順・塊の中の順）。塊ごとに、肯定の行（除外する行）を 1 行でも足すなら、その塊の否定行（! で始まる行。例: !.env.example）を
 * 既存にあるかどうかに関係なく、足した行の後ろにもう一度書く（.gitignore は後ろの行が勝つので、足した .env.* が .env.example を除外しないように）。
 */
function gitignoreMissing(text, stack) {
  const have = new Set(
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .map(gitignoreKey),
  );
  const out = [];
  for (const b of gitignoreBlocks(stack)) {
    const negatives = b.lines.filter((l) => l.startsWith("!"));
    const positives = b.lines.filter((l) => !l.startsWith("!") && !have.has(gitignoreKey(l)));
    out.push(...positives, ...(positives.length ? negatives : negatives.filter((l) => !have.has(gitignoreKey(l)))));
  }
  return out;
}

function gitignoreInfo(stack) {
  const text = readText(".gitignore");
  if (text == null) return { exists: false, missingLines: gitignoreTemplateLines(stack) };
  return { exists: true, missingLines: gitignoreMissing(text, stack) };
}

/**
 * package.json の scripts へ足す検査コマンド。audit:check（scripts/audit-check.mjs）は npm と package-lock.json 専用なので、
 * パッケージマネージャが npm で、lock が package-lock.json（モノレポなら一番上のもの）か、まだ lock が無いときだけ足す。
 */
function scriptsToAdd(pm) {
  const scripts = JSON.parse(tplText("package.scripts.json"));
  const skipped = [];
  const lock = pm.lockfile ? path.posix.basename(pm.lockfile) : null;
  if ("audit:check" in scripts && !(pm.name === "npm" && (lock === "package-lock.json" || lock === null))) {
    delete scripts["audit:check"];
    skipped.push({
      name: "audit:check",
      reason: `scripts/audit-check.mjs は npm と package-lock.json 専用です（このプロジェクトは ${pm.name ?? "不明"}${lock ? `・${lock}` : ""}）。依存の脆弱性は AGENTS.md「検証コマンド」表の『依存の脆弱性』行のコマンドを使います。`,
    });
  }
  return { scripts, skipped };
}


const REQUIRED = [
  "AGENTS.md",
  "CLAUDE.md",
  "docs/README.md",
  "docs/PRD.md",
  "docs/operations/development-and-testing.md",
  "tasks/BACKLOG.md",
  "scripts/check-doc-dates.mjs",
  "scripts/check-doc-refs.mjs",
  "scripts/check-doc-placeholders.mjs",
  "scripts/audit-check.mjs",
  MANIFEST,
];
// 導入の痕跡はキット固有の名前だけにする（tasks/BACKLOG.md や scripts/audit-check.mjs は、docdd を入れていないプロジェクトにもありうる）。
const DOCDD_MARKERS = [MANIFEST, "scripts/check-doc-dates.mjs", "scripts/check-doc-refs.mjs", "scripts/check-doc-placeholders.mjs"];

/**
 * v0.1 系の構成か。CLAUDE.md に v0.1 の「変更影響」表があり、表マーカーが無ければ、manifest の有無に関係なく v0.1 系
 * （update --apply を一部だけ実行すると manifest は書かれるが、CLAUDE.md の移行はまだ）。移行後はマーカーがあるので戻らない。
 */
function isLegacy(claude, manifest) {
  if (claude.legacyTables && !claude.hasMarkers) return true;
  if (manifest.exists || isFile(".claude/rules/docdd-kit.md")) return false;
  return isFile("tasks/BACKLOG.md") && isFile("scripts/check-doc-refs.mjs") && !claude.hasMarkers;
}

/**
 * CWD より上（git のルートまで）に docdd のプロジェクトがあれば、git のルートからの相対パスを返す（無ければ null）。
 * 判定は hook（guard-bash.mjs の isDocddProject・notify-update.mjs の findProjectDir）と同じ。
 */
function docddRootAbove(gi) {
  if (!gi.isRepo || !gi.root || gi.atGitRoot) return null;
  let dir = path.dirname(CWD);
  while (dir.length >= gi.root.length) {
    const has = (rel) => { try { return fs.statSync(path.join(dir, rel)).isFile(); } catch { return false; } };
    if (has(MANIFEST)) return toPosix(path.relative(gi.root, dir)) || ".";
    if (has("tasks/BACKLOG.md")) {
      try {
        const agentsOrClaude = ["AGENTS.md", "CLAUDE.md"]
          .map((f) => path.join(dir, f))
          .filter((f) => fs.existsSync(f))
          .map((f) => fs.readFileSync(f, "utf8"));
        if (agentsOrClaude.some((t) => t.includes("/docdd:"))) return toPosix(path.relative(gi.root, dir)) || ".";
      } catch {
        // CLAUDE.md が無い・読めない
      }
    }
    if (dir === gi.root) break;
    dir = path.dirname(dir);
  }
  return null;
}

/** hook と同じ条件: tasks/BACKLOG.md があり、AGENTS.md か CLAUDE.md が /docdd: を含む。 */
function isDocddByBacklog() {
  if (!isFile("tasks/BACKLOG.md")) return false;
  try {
    return ["AGENTS.md", "CLAUDE.md"].some((f) => isFile(f) && fs.readFileSync(abs(f), "utf8").includes("/docdd:"));
  } catch {
    return false;
  }
}

/** projectRoot を人が読める形にする（"." は git のルート）。 */
const rootLabel = (r) => (r === "." ? "git のルート" : `git のルートから ${r}`);

function computeState({ claude, manifest, placeholders, gi }) {
  const missing = REQUIRED.filter((r) => !isFile(r));
  if (claude.exists && !claude.hasVerifyTable) missing.push(`${claude.file} の「検証コマンド」表`);
  const manifestTracked = gi.isRepo && manifest.exists ? git(["ls-files", "--error-unmatch", "--", MANIFEST]).ok : false;
  if (isLegacy(claude, manifest)) return { state: "legacy", missing, manifestTracked };
  if (!DOCDD_MARKERS.some(isFile) && !isDocddByBacklog()) {
    const above = docddRootAbove(gi);
    if (above) return { state: "installed-above", missing, manifestTracked, projectRoot: above };
    return { state: "not-installed", missing, manifestTracked };
  }
  if (missing.length === 0 && placeholders.length === 0 && (manifestTracked || !gi.isRepo)) return { state: "installed", missing, manifestTracked };
  return { state: "partial", missing, manifestTracked };
}

const NON_WEB_NEXT = "Web 以外のプロジェクトです。検証コマンドは一部しか推定できません。README『Web 以外のプロジェクトで使う』を見て埋め、必要なら『スキルへの追加指示』を書いてください（README: https://github.com/no1013kota/docdd-dev-kit/blob/main/plugins/docdd/README.md#web-以外のプロジェクトで使う例-unity）。";

function nextForState(state, s) {
  const nonWeb = s.web === false ? NON_WEB_NEXT : "";
  switch (state) {
    case "not-installed":
      return `未導入です。/docdd:init のヒアリングへ進み、apply で雛形を置きます。${nonWeb}`;
    case "installed-above":
      return `このフォルダより上（${rootLabel(s.projectRoot)}）に docdd が導入済みです。ここには何も置きません。そのフォルダで Claude Code を開き直してください。`;
    case "legacy":
      return "v0.1 系の構成で導入済みです（CLAUDE.md に「変更影響」表があり、.claude/rules/docdd-kit.md が無い）。/docdd:init ではなく /docdd:update-kit で新しい版へ移します。";
    case "installed":
      return "導入済みです。仕様は docs/PRD.md。次は /docdd:add-task <やりたいこと>（PRD に書いた機能をまとめてタスクにするなら、何も書かずに /docdd:add-task）。";
    default: {
      const parts = [];
      if (s.missing.length) parts.push(`足りないファイル ${s.missing.length} 件`);
      if (s.placeholders.length) parts.push(`未記入の欄 ${s.placeholders.length} 件`);
      if (!s.manifestTracked) parts.push("まだコミットしていない");
      return `途中まで導入済みです（${parts.join("・")}）。apply をもう一度実行し（既存は上書きしない）、未記入の欄だけ聞き直してからコミットします。${nonWeb}`;
    }
  }
}

function collectStatus() {
  const templates = listTemplates();
  const gi = gitInfo();
  const pkg = readPackageJson();
  const pm = detectPackageManager(pkg, gi);
  const stack = detectStack(pkg, pm);
  const files = listProjectFiles(gi);
  const { sourceFiles, specCandidates } = classifyFiles(files, templates, stack.kind);
  const claude = claudeMdInfo();
  const manifest = readManifest();
  const placeholders = placeholderReport(templates);
  const st = computeState({ claude, manifest, placeholders, gi });
  const { scripts: scriptsTpl } = scriptsToAdd(pm);
  const curScripts = isPlainObject(pkg.data?.scripts) ? pkg.data.scripts : {};
  const scaffoldPresent = stack.markers.length > 0 || sourceFiles.length > 0;
  return {
    ok: true,
    command: "status",
    kitVersion: KIT_VERSION,
    cwd: CWD,
    state: st.state,
    projectRoot: st.projectRoot ?? null,
    missing: st.missing,
    next: nextForState(st.state, { ...st, placeholders, web: stack.web }),
    git: gi,
    atGitRoot: gi.atGitRoot,
    packageManager: pm.name,
    lockfile: pm.lockfile,
    stack,
    scaffold: { present: scaffoldPresent, markers: stack.markers, sourceFileCount: sourceFiles.length },
    existingCode: sourceFiles.length > 0 && (gi.commits >= 2 || sourceFiles.length > 10),
    inferred: inferVerification(pkg, pm, stack),
    specCandidates,
    placeholders,
    manifest: { exists: manifest.exists, kitVersion: manifest.kitVersion, tracked: st.manifestTracked, parseError: manifest.parseError },
    agentsMd: claude,
    settings: settingsDiff(),
    mcp: mcpInfo(stack),
    gitignore: gitignoreInfo(stack),
    backlog: backlogInfo(),
    packageJson: {
      exists: pkg.exists,
      parseError: pkg.parseError,
      missingScripts: pkg.exists && pkg.data ? Object.keys(scriptsTpl).filter((k) => !(k in curScripts)) : [],
    },
  };
}

// ---------------------------------------------------------------- 書き換えの部品

/** JSON テキストの構造だけを読む（値の位置を返す）。インデントを保ったまま scripts を足すために使う。 */
function jsonScan(text) {
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const ws = () => {
    while (i < text.length && /\s/.test(text[i])) i += 1;
  };
  const str = () => {
    const s = i;
    i += 1;
    while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
    i += 1;
    return JSON.parse(text.slice(s, i));
  };
  const value = () => {
    ws();
    const start = i;
    if (text[i] === "{") return obj();
    if (text[i] === "[") return arr();
    if (text[i] === '"') {
      str();
      return { start, end: i };
    }
    while (i < text.length && !/[\s,}\]]/.test(text[i])) i += 1;
    return { start, end: i };
  };
  const arr = () => {
    const start = i;
    i += 1;
    ws();
    if (text[i] === "]") {
      i += 1;
      return { start, end: i };
    }
    for (;;) {
      value();
      ws();
      if (text[i] === ",") {
        i += 1;
        continue;
      }
      if (text[i] === "]") {
        i += 1;
        break;
      }
      throw new Error("JSON の配列を読めない");
    }
    return { start, end: i };
  };
  const obj = () => {
    const open = i;
    i += 1;
    const members = [];
    ws();
    if (text[i] === "}") {
      i += 1;
      return { start: open, end: i, open, close: i - 1, members };
    }
    for (;;) {
      ws();
      if (text[i] !== '"') throw new Error("JSON のキーを読めない");
      const keyStart = i;
      const key = str();
      const keyEnd = i;
      ws();
      if (text[i] !== ":") throw new Error("JSON の : が無い");
      i += 1;
      ws();
      const v = value();
      members.push({ key, keyStart, keyEnd, valueStart: v.start, valueEnd: v.end, value: v });
      ws();
      if (text[i] === ",") {
        i += 1;
        continue;
      }
      if (text[i] === "}") {
        i += 1;
        break;
      }
      throw new Error("JSON のオブジェクトを読めない");
    }
    return { start: open, end: i, open, close: i - 1, members };
  };
  ws();
  if (text[i] !== "{") throw new Error("JSON の一番外がオブジェクトではない");
  return obj();
}

/** package.json の scripts に additions（[[名前, コマンド]]）を足す。元のインデント・改行・末尾改行を保つ。 */
function addPackageScripts(raw, additions) {
  const expected = JSON.parse(raw.replace(/^﻿/, ""));
  expected.scripts = { ...(isPlainObject(expected.scripts) ? expected.scripts : {}), ...Object.fromEntries(additions) };
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const unit = (/^([ \t]+)\S/m.exec(raw) || [null, "  "])[1];
  const entry = ([k, v], sep) => `${JSON.stringify(k)}${sep}${JSON.stringify(v)}`;
  const lineIndent = (pos) => {
    const ls = raw.lastIndexOf("\n", pos - 1) + 1;
    return /^[ \t]*/.exec(raw.slice(ls))[0];
  };
  const sepOf = (m) => raw.slice(m.keyEnd, m.valueStart);
  let text = null;
  try {
    const top = jsonScan(raw);
    const scripts = top.members.find((m) => m.key === "scripts");
    if (scripts && scripts.value.members) {
      const o = scripts.value;
      if (o.members.length) {
        const first = o.members[0];
        const last = o.members[o.members.length - 1];
        const sep = sepOf(first);
        const multi = raw.slice(o.open, first.keyStart).includes("\n");
        const ins = multi
          ? additions.map((a) => `,${eol}${lineIndent(first.keyStart)}${entry(a, sep)}`).join("")
          : additions.map((a) => `, ${entry(a, sep)}`).join("");
        text = raw.slice(0, last.valueEnd) + ins + raw.slice(last.valueEnd);
      } else {
        const base = lineIndent(scripts.keyStart);
        const body = `{${eol}${additions.map((a) => base + unit + entry(a, ": ")).join(`,${eol}`)}${eol}${base}}`;
        text = raw.slice(0, o.open) + body + raw.slice(o.close + 1);
      }
    } else if (!scripts) {
      if (top.members.length) {
        const first = top.members[0];
        const last = top.members[top.members.length - 1];
        const ind = lineIndent(first.keyStart);
        const sep = sepOf(first);
        const body = `{${eol}${additions.map((a) => ind + unit + entry(a, sep)).join(`,${eol}`)}${eol}${ind}}`;
        text = `${raw.slice(0, last.valueEnd)},${eol}${ind}"scripts"${sep}${body}${raw.slice(last.valueEnd)}`;
      } else {
        const body = `{${eol}${unit}"scripts": {${eol}${additions.map((a) => unit + unit + entry(a, ": ")).join(`,${eol}`)}${eol}${unit}}${eol}}`;
        text = raw.slice(0, top.open) + body + raw.slice(top.close + 1);
      }
    }
    if (text != null && JSON.stringify(JSON.parse(text.replace(/^﻿/, ""))) !== JSON.stringify(expected)) text = null;
  } catch {
    text = null;
  }
  if (text == null) {
    return { text: JSON.stringify(expected, null, unit).replace(/\n/g, eol) + (/\r?\n$/.test(raw) ? eol : ""), reformatted: true };
  }
  return { text, reformatted: false };
}

/**
 * .gitignore に足りない行を、雛形の塊ごとに見出し（「# docdd: 共通」など）の下へ足す。
 * 見出しが既にあればその塊の終わり（次の空行の手前）へ、無ければ末尾に見出しごと足す。
 */
function appendGitignore(existing, missing, stack) {
  const eol = eolOf(existing);
  const lines = existing.split(/\r?\n/);
  const tail = [];
  for (const b of gitignoreBlocks(stack)) {
    const add = missing.filter((l) => b.lines.includes(l));
    if (!add.length) continue;
    const header = lines.findIndex((l) => l.trim() === b.header);
    if (header === -1) {
      tail.push([b.header, ...add]);
      continue;
    }
    let end = header + 1;
    while (end < lines.length && lines[end].trim() !== "") end += 1;
    lines.splice(end, 0, ...add);
  }
  let out = lines.join(eol);
  if (tail.length) {
    if (out.length && !out.endsWith("\n")) out += eol;
    if (out.length && !/(\r?\n){2}$/.test(out)) out += eol;
    out += tail.map((block) => block.join(eol)).join(eol + eol);
  }
  return out.endsWith(eol) ? out : out + eol;
}

function templateTablesBlock() {
  const t = tplText("AGENTS.md");
  const s = t.indexOf(BEGIN);
  const e = t.indexOf(END);
  return `${t.slice(s, e + END.length)}\n`;
}

/** コードブロックの外にある見出し。 */
function headingsOf(lines) {
  const res = [];
  let fence = null;
  lines.forEach((line, i) => {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      return;
    }
    if (f) {
      fence = f[1];
      return;
    }
    const m = /^(#{1,6})\s+(.*?)\s*$/.exec(line);
    if (m) res.push({ level: m[1].length, text: m[2], index: i });
  });
  return res;
}

function headingKey(text) {
  return text
    .replace(/^\d+(\.\d+)*\.?\s*/, "")
    .replace(/[（(][^（）()]*[）)]\s*$/, "")
    .replace(/[\s`]+/g, "")
    .toLowerCase();
}

function sameKey(a, b) {
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const grams = (s) => {
    const g = [];
    for (let i = 0; i < s.length - 1; i += 1) g.push(s.slice(i, i + 2));
    return g;
  };
  const ga = grams(a);
  const gb = grams(b);
  if (!ga.length || !gb.length) return false;
  const pool = [...gb];
  let hit = 0;
  for (const x of ga) {
    const k = pool.indexOf(x);
    if (k !== -1) {
      hit += 1;
      pool.splice(k, 1);
    }
  }
  return (2 * hit) / (ga.length + gb.length) >= 0.5;
}

/** level の見出しの節（次の同じか上の見出し、または表マーカーの手前まで）。 */
function sectionsOf(lines, level) {
  const hs = headingsOf(lines);
  const out = [];
  hs.forEach((h, k) => {
    if (h.level !== level) return;
    let end = lines.length;
    for (let j = k + 1; j < hs.length; j += 1) {
      if (hs[j].level <= level) {
        end = hs[j].index;
        break;
      }
    }
    for (let x = h.index + 1; x < end; x += 1) {
      if (lines[x].startsWith("<!-- docdd:tables:")) {
        end = x;
        break;
      }
    }
    out.push({ ...h, key: headingKey(h.text), start: h.index, end });
  });
  return out;
}

function trimBlank(block) {
  const b = [...block];
  while (b.length && b[b.length - 1].trim() === "") b.pop();
  return b;
}

function splitRow(line) {
  const cells = [];
  let cur = "";
  let tick = false;
  const body = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (c === "\\" && body[i + 1] === "|") {
      cur += "\\|";
      i += 1;
    } else if (c === "`") {
      tick = !tick;
      cur += c;
    } else if (c === "|" && !tick) {
      cells.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

const rowKey = (cell) =>
  cell
    .replace(/`/g, "")
    .replace(/[（(][^（）()]*[）)]\s*$/, "")
    .replace(/\s+/g, "")
    .toLowerCase();

/** 節の中の表の本文行（見出し行と区切り行を除く）。 */
function tableRowsIn(lines, sec) {
  const rows = [];
  let seenHeader = false;
  for (let i = sec.start + 1; i < sec.end; i += 1) {
    const l = lines[i];
    if (!/^\s*\|/.test(l)) {
      if (seenHeader && rows.length && l.trim() === "") break;
      continue;
    }
    if (/^\s*\|\s*:?-{3,}/.test(l)) {
      seenHeader = true;
      continue;
    }
    if (!seenHeader) continue;
    const cells = splitRow(l);
    rows.push({ index: i, cells, key: rowKey(cells[0] ?? "") });
  }
  return rows;
}

const isLegacyUnfilled = (cell) => /^`?<[^>]*>`?$/.test((cell ?? "").trim());

/** ### の見出しから T-番号・タイトル・状態を読む。 */
function tasksOf(lines) {
  return headingsOf(lines)
    .filter((h) => h.level === 3)
    .map((h) => {
      const m = /^T-(\d+)[:：]\s*(.*?)\s*(`[^`]*`)?\s*$/.exec(h.text);
      return m ? { id: Number(m[1]), title: m[2].trim(), state: m[3] ? m[3].replace(/`/g, "").trim() : null, index: h.index } : null;
    })
    .filter(Boolean);
}

/**
 * 定型タスクを BACKLOG の「## タスク」節へ足す。同じタイトルが既にあれば足さない。
 * archived は tasks/archive/BACKLOG-done.md の中身（終わったタスクの置き場）。番号はそこも含めた最大の次にし、
 * 「アプリの土台を作る」がそこにあれば（終わっていても）足さない。
 */
function insertTasks(content, kinds, archived = null) {
  const eol = eolOf(content);
  const lines = content.split(/\r?\n/);
  const hs = headingsOf(lines);
  const tasks = tasksOf(lines);
  const archivedTasks = archived == null ? [] : tasksOf(archived.split(/\r?\n/));
  let max = [...tasks, ...archivedTasks].reduce((a, t) => Math.max(a, t.id), 0);
  const pad = (n) => `T-${String(n).padStart(2, "0")}`;
  const results = [];
  const blocks = [];
  let scaffoldId = null;
  const order = ["scaffold", "test-infra"].filter((k) => kinds.includes(k));
  const existingScaffold = tasks.find((t) => t.title === TASK_TITLES.scaffold) ?? archivedTasks.find((t) => t.title === TASK_TITLES.scaffold);
  if (existingScaffold) scaffoldId = pad(existingScaffold.id);
  for (const kind of order) {
    const title = TASK_TITLES[kind];
    const found =
      kind === "test-infra"
        ? tasks.find((t) => t.title.startsWith(title) && t.state !== "done" && t.state !== "dropped")
        : tasks.find((t) => t.title === title) ?? archivedTasks.find((t) => t.title === title);
    if (found) {
      results.push({ kind, id: pad(found.id), title: found.title, action: "exists" });
      continue;
    }
    max += 1;
    const id = pad(max);
    if (kind === "scaffold") scaffoldId = id;
    blocks.push(...taskBlock(kind, id, scaffoldId), "");
    results.push({ kind, id, title, action: "added" });
  }
  if (!blocks.length) return { content, results };

  const section = hs.find((h) => h.level === 2 && /^タスク\s*$/.test(h.text));
  if (section) {
    let end = lines.length;
    const nextH2 = hs.find((h) => h.level <= 2 && h.index > section.index);
    if (nextH2) end = nextH2.index;
    const firstTask = hs.find((h) => h.level === 3 && h.index > section.index && h.index < end);
    if (firstTask) {
      lines.splice(firstTask.index, 0, ...blocks);
    } else {
      let at = end;
      while (at > section.index + 1 && lines[at - 1].trim() === "") at -= 1;
      lines.splice(at, 0, "", ...blocks);
    }
  } else {
    const decide = hs.find((h) => h.level === 2 && /^要決定/.test(h.text));
    const add = ["## タスク", "", ...blocks];
    if (decide) lines.splice(decide.index, 0, ...add);
    else {
      while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
      lines.push("", ...add);
    }
  }
  let out = lines.join(eol);
  out = out.replace(/(\r?\n){3,}/g, eol + eol);
  if (!out.endsWith(eol)) out += eol;
  return { content: out, results };
}

/** tasks/BACKLOG.md の書式の節（見出しは雛形と同じ）。 */
const BACKLOG_SECTIONS = [
  { heading: "運用ルール", re: /^運用ルール/ },
  { heading: "タスク", re: /^タスク\s*$/ },
  { heading: "要決定・外部準備（ユーザー作業）", re: /^要決定/ },
];

/** tasks/BACKLOG.md に書式の節（運用ルール・タスク・要決定）があるか。 */
function backlogInfo(text = readText("tasks/BACKLOG.md")) {
  if (text == null) return { exists: false, missingSections: [] };
  const h2 = headingsOf(text.split(/\r?\n/)).filter((h) => h.level === 2);
  return { exists: true, missingSections: BACKLOG_SECTIONS.filter((s) => !h2.some((h) => s.re.test(h.text))).map((s) => s.heading) };
}

/**
 * 既存の BACKLOG に無い書式の節を雛形から足す。書いてある内容は変えない。
 * 「## 運用ルール」（書式の見本つき）は最初の ## 見出しの前（無ければ # 見出しの直後）、「## タスク」は運用ルールの直後（既存の中身がタスクの節に入る）、
 * 「## 要決定・外部準備（ユーザー作業）」は末尾。
 */
function addBacklogSections(content) {
  const eol = eolOf(content);
  const missing = backlogInfo(content).missingSections;
  if (!missing.length) return { content, added: [] };
  let lines = content.split(/\r?\n/);
  const tl = tplText("tasks/BACKLOG.md").split(/\r?\n/);
  const rulesBlock = (() => {
    const s = sectionsOf(tl, 2).find((x) => x.text === "運用ルール");
    return s ? trimBlank(tl.slice(s.start, s.end)) : ["## 運用ルール"];
  })();
  const insert = (at, add) => {
    lines = [...lines.slice(0, at), "", ...add, "", ...lines.slice(at)];
    return at + add.length + 2;
  };
  let afterRules = null;
  if (missing.includes("運用ルール")) {
    const hs = headingsOf(lines);
    const firstH2 = hs.find((h) => h.level === 2);
    const h1 = hs.find((h) => h.level === 1);
    afterRules = insert(firstH2 ? firstH2.index : h1 ? h1.index + 1 : 0, rulesBlock);
  }
  if (missing.includes("タスク")) {
    const rules = sectionsOf(lines, 2).find((s) => /^運用ルール/.test(s.text));
    insert(afterRules ?? (rules ? rules.end : lines.length), ["## タスク"]);
  }
  if (missing.includes("要決定・外部準備（ユーザー作業）")) {
    while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
    insert(lines.length, ["## 要決定・外部準備（ユーザー作業）"]);
  }
  let out = lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "");
  if (!out.endsWith("\n")) out += "\n";
  return { content: withEol(out, eol), added: missing };
}

function taskBlock(kind, id, scaffoldId) {
  if (kind === "scaffold") {
    return [
      `### ${id}: ${TASK_TITLES.scaffold} \`todo\``,
      "- 参照: PRD §1・§3.3 / 依存: なし / サイズ: M",
      "- 完了条件:",
      "  - 別のフォルダでアプリの土台（フレームワークのひな形）を作り、中身をこのフォルダへ移して、開発サーバーで最初の画面が開く",
      "  - 移すときにキットのファイル（AGENTS.md・docs/・tasks/・scripts/・.claude/）を上書きしていない（git diff で確かめる）",
      "  - AGENTS.md「検証コマンド」表の『開発サーバー起動』『ビルド』行が埋まる（/docdd:init をもう一度実行すると、分かる行は推定で埋まる）",
      "- メモ: 土台を作る道具（例: create-next-app）は空でないフォルダでは止まるので、別のフォルダで作ってから移す。どのフレームワークにするか決まっていなければ、勝手に決めず「要決定」に案を書いて運営者に聞く。",
    ];
  }
  return [
    `### ${id}: ${TASK_TITLES["test-infra"]} \`todo\``,
    `- 参照: docs/operations/development-and-testing.md §4 / 依存: ${scaffoldId ?? "なし"} / サイズ: S`,
    "- 完了条件:",
    "  - 単体の見本テスト 1 件が緑（docs/operations/development-and-testing.md §4 の最小構成: 設定 1 ファイル＋見本テスト 1 件＋実行コマンド）",
    "  - 画面があるなら、E2E（実際に動かす）の見本テストも 1 件緑",
    "  - AGENTS.md「検証コマンド」表の該当行が埋まる（『単体・DBテスト』。画面があるなら『E2E（実際に動かす）』と『全検査（push 前に1回）』も）",
    "  - DB を使うテストは本番と別の DB に向く（『テスト用 DB』行に従う）",
    "- メモ: テストの道具は §4 のおすすめから選ぶ（技術選定の ADR タスクには分けない。/docdd:dev-loop が着手時に §4 のおすすめでよいかを 1 回確認する）。",
  ];
}

/** AGENTS.md「検証コマンド」表の {{…}} のままのセルを推定値で埋める（埋まっている行は変えない）。 */
function fillVerification(content, inferred, rel) {
  const lines = content.split("\n");
  const hs = headingsOf(lines.map((l) => l.replace(/\r$/, "")));
  const sec = hs.find((h) => h.level === 2 && /^検証コマンド/.test(h.text));
  const filled = [];
  if (!sec) return { content, filled };
  const next = hs.find((h) => h.level <= 2 && h.index > sec.index);
  const end = next ? next.index : lines.length;
  for (let i = sec.index + 1; i < end; i += 1) {
    const cr = lines[i].endsWith("\r") ? "\r" : "";
    const line = lines[i].replace(/\r$/, "");
    if (!/^\|/.test(line)) continue;
    const cells = splitRow(line);
    if (cells.length !== 2) continue;
    const def = VERIFY_ROWS.find((r) => r.row === cells[0] || r.aliases?.includes(cells[0]));
    if (!def || cells[1] !== `{{${def.token}}}`) continue;
    const inf = inferred.find((x) => x.token === def.token);
    if (!inf || inf.cell == null) continue;
    const cell = inf.cell.replace(/\|/g, "\\|");
    // 行名は表に書いてあるまま（前の版の行名でも変えない）
    lines[i] = `| ${cells[0]} | ${cell} |${cr}`;
    filled.push({ row: cells[0], cell, source: inf.source, file: rel, line: i + 1 });
  }
  return { content: lines.join("\n"), filled };
}

// ---------------------------------------------------------------- apply

/**
 * 今回の apply で変えていなくても stage する利用者のファイル（add する前に apply をもう一度実行しても、コミットから漏れないように）。
 * .gitignore は、最後のコミットと中身が違えば入れる（apply が足した .env の除外行や、承知を得て足した例外の行がまだコミットに無い）。
 * package.json は、キットの script が作業中の中身にあって最後のコミットに無いときだけ入れる（依存の追加など、キットと関係ない作業中の変更だけなら入れない）。
 */
function uncommittedKitChanges(pm) {
  const out = [];
  const inHead = (rel) => git(["cat-file", "-e", `HEAD:./${rel}`]).ok;
  if (isFile(".gitignore") && (!inHead(".gitignore") || git(["diff", "--quiet", "HEAD", "--", ".gitignore"]).status === 1)) out.push(".gitignore");
  const pkg = readPackageJson();
  if (pkg.exists && pkg.data && isPlainObject(pkg.data.scripts)) {
    const kit = Object.keys(scriptsToAdd(pm).scripts).filter((k) => k in pkg.data.scripts);
    let headScripts = {};
    const r = kit.length && inHead("package.json") ? git(["show", "HEAD:./package.json"]) : null;
    if (r?.ok) {
      try {
        const data = JSON.parse(r.stdout);
        if (isPlainObject(data?.scripts)) headScripts = data.scripts;
      } catch {
        // 最後のコミットの package.json が読めなければ、script は無いものとみなす
      }
    }
    if (kit.some((k) => !(k in headScripts))) out.push("package.json");
  }
  return out;
}

function cmdApply(opts) {
  const dryRun = opts["dry-run"] === true;
  const settingsMode = choice(opts.settings, ["yes", "no"], "yes", "--settings");
  const claudeMode = choice(opts["agents-md"] ?? opts["claude-md"], ["new", "replace", "append", "keep"], "new", "--agents-md");
  const mcpMode = choice(opts.mcp, ["auto", "next", "empty"], "auto", "--mcp");
  const taskKinds = parseList(opts.tasks, Object.keys(TASK_TITLES), "--tasks");
  const fill = opts["fill-inferred"] === true;
  const addBacklog = opts["add-backlog-sections"] === true;

  const templates = listTemplates();
  const gi = gitInfo();
  const claude = claudeMdInfo();
  const manifest = readManifest();
  if (isLegacy(claude, manifest)) {
    throw new UsageError("v0.1 系の構成で導入済みのプロジェクトです。apply ではなく /docdd:update-kit（init.mjs update）で新しい版へ移してください。");
  }
  if (manifest.exists && manifest.parseError) {
    throw new UsageError(`${MANIFEST} を JSON として読めません（${manifest.parseError}）。中身を確かめてから、もう一度実行してください。`);
  }
  refuseIfInstalledAbove(gi);
  const pkg = readPackageJson();
  const pm = detectPackageManager(pkg, gi);
  const stack = detectStack(pkg, pm);
  const inferred = inferVerification(pkg, pm, stack);

  const out = new Map();
  const created = [];
  const modified = new Map();
  const skipped = [];
  const backups = [];
  const warnings = [];
  const placed = new Set();
  const mod = (rel, change) => modified.set(rel, [...(modified.get(rel) ?? []), change]);
  const report = { agentsMd: null, settings: null, mcp: null, gitignore: null };

  for (const rel of templates) {
    const exists = isFile(rel);
    if (rel === ".gitignore") {
      if (!exists) {
        out.set(rel, gitignoreTemplateText(stack));
        created.push(rel);
        placed.add(rel);
        report.gitignore = { action: "created", addedLines: gitignoreTemplateLines(stack) };
      } else {
        const { missingLines } = gitignoreInfo(stack);
        if (missingLines.length) {
          out.set(rel, appendGitignore(readText(rel), missingLines, stack));
          mod(rel, `足りない行を足した: ${missingLines.join(" ")}`);
          report.gitignore = { action: "appended", addedLines: missingLines };
        } else {
          skipped.push({ path: rel, reason: "既にある（足りない行も無い）" });
          report.gitignore = { action: "unchanged", addedLines: [] };
        }
      }
    } else if (rel === ".mcp.json") {
      const info = mcpInfo(stack, mcpMode);
      if (!exists) {
        out.set(rel, info.recommended === "next" ? tpl(rel) : EMPTY_MCP);
        created.push(rel);
        placed.add(rel);
        report.mcp = { action: "created", variant: info.recommended, missingServers: [] };
      } else {
        skipped.push({ path: rel, reason: "既にある（上書きもマージもしない。差分は mcp.missingServers）" });
        report.mcp = { action: "skipped", variant: info.recommended, missingServers: info.missingServers, parseError: info.parseError };
      }
    } else if (rel === ".claude/settings.json") {
      if (exists) {
        skipped.push({ path: rel, reason: "既にある（上書きもマージもしない。差分は settings.diff）" });
        report.settings = { action: "skipped", diff: settingsDiff() };
      } else if (settingsMode === "no") {
        skipped.push({ path: rel, reason: "--settings no（置く承知が無い）" });
        report.settings = { action: "declined", diff: null };
      } else {
        out.set(rel, tpl(rel));
        created.push(rel);
        placed.add(rel);
        report.settings = { action: "created", diff: null };
      }
    } else if (rel === "AGENTS.md") {
      if (!exists && claude.legacyMain && (claude.hasMarkers || claude.legacyTables)) {
        // v0.13 以前のプロジェクト。中身は CLAUDE.md にある（雛形を置くと二重になる）
        skipped.push({ path: rel, reason: "v0.13 以前の構成（中身は CLAUDE.md にある）。/docdd:update-kit で AGENTS.md へ移す" });
        report.agentsMd = { mode: claudeMode, action: "legacy" };
        warnings.push("このプロジェクトは v0.13 以前の構成です（中身は CLAUDE.md にあります）。`/docdd:update-kit` を打つと AGENTS.md へ移します。");
      } else if (!exists) {
        out.set(rel, tpl(rel));
        created.push(rel);
        placed.add(rel);
        report.agentsMd = { mode: claudeMode, action: "created" };
      } else if (claude.hasMarkers) {
        skipped.push({ path: rel, reason: "既にキットの表（docdd:tables マーカー）がある" });
        report.agentsMd = { mode: claudeMode, action: "unchanged" };
      } else if (claudeMode === "append") {
        const cur = readText(rel);
        const base = cur.endsWith("\n") ? cur : `${cur}\n`;
        out.set(rel, withEol(`${base}\n${templateTablesBlock()}`, eolOf(cur)));
        mod(rel, "末尾に「検証コマンド」「反映コマンド」「スキルへの追加指示」の表（docdd:tables マーカーの間）を足した");
        report.agentsMd = { mode: claudeMode, action: "appended" };
      } else if (claudeMode === "replace") {
        let bak = "AGENTS.md.bak";
        for (let n = 2; isFile(bak); n += 1) bak = `AGENTS.md.bak${n}`;
        backups.push({ from: rel, to: bak });
        out.set(rel, tpl(rel));
        placed.add(rel);
        mod(rel, `キットの AGENTS.md に置き換えた（元は ${bak}）`);
        report.agentsMd = { mode: claudeMode, action: "replaced", backup: bak };
      } else {
        skipped.push({ path: rel, reason: `既にある（--agents-md ${claudeMode}。表は足していない）` });
        report.agentsMd = { mode: claudeMode, action: "kept" };
        warnings.push("AGENTS.md に「検証コマンド」表がありません。スキルはこの表を読むので、--agents-md append で表だけ足すことをすすめます。");
      }
    } else if (rel === "CLAUDE.md") {
      // Claude Code 用に AGENTS.md を読み込む 1 行。中身がまだ CLAUDE.md にあるうち（v0.13 以前）は触らない
      if (claude.legacyMain && (claude.hasMarkers || claude.legacyTables)) {
        skipped.push({ path: rel, reason: "v0.13 以前の構成（中身はこのファイルにある）。/docdd:update-kit で AGENTS.md へ移す" });
      } else if (!exists) {
        out.set(rel, tpl(rel));
        created.push(rel);
        placed.add(rel);
      } else if (readText(rel).includes("@AGENTS.md")) {
        skipped.push({ path: rel, reason: "既に AGENTS.md を読み込んでいる" });
      } else {
        // 利用者の CLAUDE.md は消さない。Claude Code は CLAUDE.md があると AGENTS.md を読まないので、読み込む 1 行だけ足す
        const cur = readText(rel);
        const base = cur.endsWith("\n") ? cur : `${cur}\n`;
        out.set(rel, withEol(`${base}\n${tplText("CLAUDE.md")}`, eolOf(cur)));
        mod(rel, "末尾に `@AGENTS.md`（AGENTS.md を読み込む 1 行）を足した（元の中身はそのまま）");
      }
    } else if (exists) {
      skipped.push({ path: rel, reason: "既にある（上書きしない）" });
    } else {
      out.set(rel, tpl(rel));
      created.push(rel);
      placed.add(rel);
    }
  }

  // 既存の BACKLOG に書式の節が無ければ報告する。--add-backlog-sections なら雛形の節を足す
  let backlog = null;
  if (!out.has("tasks/BACKLOG.md")) {
    const cur = readText("tasks/BACKLOG.md");
    if (cur != null) {
      const info = backlogInfo(cur);
      backlog = { missingSections: info.missingSections, added: [] };
      if (addBacklog && info.missingSections.length) {
        const r = addBacklogSections(cur);
        out.set("tasks/BACKLOG.md", r.content);
        backlog.added = r.added;
        mod("tasks/BACKLOG.md", `書式の節を足した: ${r.added.join("・")}`);
      }
    }
  }

  let tasks = [];
  if (taskKinds.length) {
    const rel = "tasks/BACKLOG.md";
    const cur = out.has(rel) ? String(out.get(rel)) : readText(rel);
    if (cur == null) warnings.push("tasks/BACKLOG.md が無いので、定型タスクを起票できませんでした。");
    else {
      const archivedRel = "tasks/archive/BACKLOG-done.md";
      const archived = out.has(archivedRel) ? String(out.get(archivedRel)) : readText(archivedRel);
      const r = insertTasks(cur, taskKinds, archived);
      tasks = r.results;
      if (r.content !== cur) {
        out.set(rel, r.content);
        if (!created.includes(rel)) mod(rel, `定型タスクを足した: ${r.results.filter((t) => t.action === "added").map((t) => `${t.id} ${t.title}`).join("・")}`);
      }
    }
  }

  // Codex は AGENTS.md を 32 KiB まで読む（超えた分は切り捨て。切れるのは末尾の「キット共通の約束」）
  const agentsBytes = out.has("AGENTS.md") ? Buffer.byteLength(String(out.get("AGENTS.md"))) : claude.file === "AGENTS.md" ? claude.bytes : 0;
  if (agentsBytes > AGENTS_MD_SOFT_LIMIT) {
    warnings.push(
      `AGENTS.md が ${Math.round(agentsBytes / 1024)} KiB です。Codex は 32 KiB までしか読まず、超えた分（末尾の「キット共通の約束」）が切れます。長い説明は docs/ へ移してください。`,
    );
  }

  let filled = [];
  if (fill) {
    const rel = claude.file; // v0.13 以前は CLAUDE.md、いまは AGENTS.md
    const cur = out.has(rel) ? String(out.get(rel)) : readText(rel);
    if (cur != null) {
      const r = fillVerification(cur, inferred, rel);
      filled = r.filled;
      if (r.content !== cur) {
        out.set(rel, r.content);
        if (!created.includes(rel)) mod(rel, `検証コマンド表に推定値を書いた（${r.filled.map((f) => f.row).join("・")}）`);
      }
    }
  }

  const packageJson = { exists: pkg.exists, added: [], alreadyPresent: [], skipped: [], reformatted: false };
  if (pkg.exists && pkg.data) {
    const { scripts: scriptsTpl, skipped: scriptsSkipped } = scriptsToAdd(pm);
    packageJson.skipped = scriptsSkipped;
    if (pkg.data.scripts !== undefined && !isPlainObject(pkg.data.scripts)) {
      warnings.push("package.json の scripts がオブジェクトではないので、検査コマンドを足しませんでした。");
    } else {
      const cur = pkg.data.scripts ?? {};
      const missing = Object.entries(scriptsTpl).filter(([k]) => !(k in cur));
      packageJson.alreadyPresent = Object.keys(scriptsTpl).filter((k) => k in cur);
      if (missing.length) {
        const r = addPackageScripts(pkg.raw, missing);
        out.set("package.json", r.text);
        mod("package.json", `scripts に ${missing.map(([k]) => k).join("・")} を足した`);
        packageJson.added = missing.map(([k]) => k);
        packageJson.reformatted = r.reformatted;
        if (r.reformatted) warnings.push("package.json の書式を保ったまま足せなかったので、整形し直して保存しました（中身は同じ）。");
      }
    }
  } else if (pkg.exists) {
    warnings.push(`package.json を JSON として読めないので、検査コマンドを足しませんでした（${pkg.parseError}）。`);
  }

  // manifest: 置いたファイルの sha256・所有者・版を記録する（既存の記録は残す）
  const base = manifest.data ?? {};
  const manFiles = isPlainObject(base.files) ? { ...base.files } : {};
  for (const rel of placed) manFiles[rel] = { sha256: sha256(out.get(rel)), owner: ownerOf(rel), version: KIT_VERSION };
  // 既にあって中身が雛形と同じなのに記録の無いファイル（前回の apply が途中で止まった場合など）も記録する
  let adopted = 0;
  for (const rel of templates) {
    if (placed.has(rel) || out.has(rel) || manFiles[rel] || !isFile(rel)) continue;
    const buf = readBuf(rel);
    if (buf && sha256(buf) === sha256(tpl(rel))) {
      manFiles[rel] = { sha256: sha256(buf), owner: ownerOf(rel), version: KIT_VERSION };
      adopted += 1;
    }
  }
  const manifestWritten = !manifest.exists || placed.size > 0 || adopted > 0;
  const buildManifestText = () =>
    `${JSON.stringify(
      { kitVersion: base.kitVersion ?? KIT_VERSION, installedAt: base.installedAt ?? today(), updatedAt: today(), ...keptManifestSettings(base), files: sortKeys(manFiles) },
      null,
      2,
    )}\n`;
  let manifestText = manifestWritten ? buildManifestText() : null;

  // 書く前に、置き場所がふさがっていないか（例: tasks という名前のファイルがある）を全部確かめる。1 つでもあれば何も書かない
  const conflicts = [...out.keys(), ...(manifestText ? [MANIFEST] : [])].map(pathConflict).filter(Boolean);
  const written = [];
  const notWritten = [];
  let failed = null;
  if (conflicts.length) failed = { path: conflicts[0].path, message: conflicts.map((c) => c.message).join(" ／ ") };
  else if (!dryRun) {
    let current = null;
    try {
      for (const b of backups) {
        current = b.to;
        fs.copyFileSync(abs(b.from), abs(b.to));
      }
      for (const [rel, content] of out) {
        current = rel;
        try {
          writeFile(rel, content);
        } catch (e) {
          if (PROTECTED_CONFIG.has(rel) && ["EPERM", "EACCES", "EROFS"].includes(e?.code)) {
            notWritten.push({ path: rel, code: e.code, content: String(content) });
            delete manFiles[rel];
            continue;
          }
          throw e;
        }
        written.push(rel);
      }
      if (manifestText) {
        if (notWritten.length) manifestText = buildManifestText();
        current = MANIFEST;
        writeFile(MANIFEST, manifestText);
        written.push(MANIFEST);
      }
    } catch (e) {
      failed = { path: current, message: `${current} を書けませんでした（${e?.code ?? e?.message ?? e}）` };
    }
  }

  const stage = new Set([...created, ...modified.keys(), MANIFEST]);
  for (const rel of Object.keys(manFiles)) if (isFile(rel) || out.has(rel)) stage.add(rel);
  if (gi.isRepo) for (const rel of uncommittedKitChanges(pm)) stage.add(rel);
  if (failed) for (const rel of [...stage]) if (!written.includes(rel)) stage.delete(rel);
  for (const n of notWritten) {
    stage.delete(n.path);
    warnings.push(
      `${n.path} を書けませんでした（${n.code}。Claude Code のサンドボックスなどが設定ファイルへの書き込みを止めています）。残りの雛形は置きました。notWritten の content を Claude の Write で置くか、手で置いてください。`,
    );
  }
  let ignored = [];
  if (gi.isRepo && stage.size) {
    const r = git(["check-ignore", "--", ...stage]);
    ignored = r.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
    if (ignored.length) warnings.push(`.gitignore に除外されていて git add できないファイル: ${ignored.join("・")}（.gitignore の行を見直す）`);
  }
  const toStage = [...stage].filter((p) => !ignored.includes(p)).sort();
  const overrides = new Map([...out].map(([k, v]) => [k, String(v)]));
  const placeholders = placeholderReport(templates, overrides);

  return {
    ok: !failed,
    command: "apply",
    dryRun,
    error: failed
      ? `${failed.message}。置き場所をふさいでいるものを確かめて退けてから、もう一度 apply を実行してください（書けたファイルは上書きしません）。`
      : undefined,
    written,
    failed,
    notWritten,
    conflicts,
    kitVersion: KIT_VERSION,
    options: { settings: settingsMode, agentsMd: claudeMode, mcp: mcpMode, tasks: taskKinds, fillInferred: fill, addBacklogSections: addBacklog },
    created,
    modified: [...modified].map(([p, changes]) => ({ path: p, changes })),
    skipped,
    backups: backups.map((b) => b.to),
    agentsMd: report.agentsMd,
    settings: report.settings,
    mcp: report.mcp,
    gitignore: report.gitignore,
    packageJson,
    backlog,
    tasks,
    filled,
    inferred,
    placeholders,
    manifest: { path: MANIFEST, written: written.includes(MANIFEST), wouldWrite: manifestWritten },
    ignored,
    toStage,
    warnings,
    next: failed
      ? "書けなかったパス（failed・conflicts）を直してから、もう一度 apply を実行します。"
      : dryRun
        ? "--dry-run なので何も書いていません。"
        : "toStage のパスを git add → node scripts/check-doc-refs.mjs → （コミットの承知があれば）dates → dates の toStage を git add → precommit → git commit の順に進めます。",
  };
}

// ---------------------------------------------------------------- dates

function cmdDates(opts) {
  const dryRun = opts["dry-run"] === true;
  const date = opts.date === undefined ? today() : String(opts.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new UsageError(`--date は YYYY-MM-DD の形で指定してください（いまの値: ${date}）`);
  const manifest = readManifest();
  if (!manifest.exists || !manifest.data) {
    throw new UsageError(`${MANIFEST} がありません（または読めません）。先に apply で雛形を置いてください。`);
  }
  // 対象: manifest に載っている文書と、雛形の文書のうちプロジェクトにあるもの（apply が途中で止まって manifest に載らなかった文書も拾う）
  const fromManifest = isPlainObject(manifest.data.files) ? Object.keys(manifest.data.files) : [];
  const files = [...new Set([...fromManifest, ...listTemplates().filter(isFile)])].sort();
  const hasHead = git(["rev-parse", "--verify", "-q", "HEAD"]).ok;
  /** 最後のコミットから中身が変わったか（stage 済み・作業中・まだコミットに無いファイル）。 */
  const changedSinceHead = (rel) => !git(["cat-file", "-e", `HEAD:./${rel}`]).ok || git(["diff", "--quiet", "HEAD", "--", rel]).status === 1;
  const changed = [];
  for (const rel of files) {
    if (SAMPLES.has(rel) || rel.startsWith("docs/_imported/") || !rel.endsWith(".md")) continue;
    const text = readText(rel);
    if (text == null) continue;
    const count = text.split(DATE_TOKEN).length - 1;
    let next = count ? text.split(DATE_TOKEN).join(date) : text;
    // 今回中身を変えた文書は、冒頭の「更新日」も date にする（別の日に未記入の欄を埋めても check-doc-dates が落ちないように）
    let updatedDate = false;
    if (hasHead && changedSinceHead(rel)) {
      const touched = touchUpdatedDate(next, date);
      updatedDate = touched !== next;
      next = touched;
    }
    if (next === text) continue;
    if (!dryRun) writeFile(rel, next);
    changed.push({ file: rel, count, updatedDate });
  }
  return {
    ok: true,
    command: "dates",
    dryRun,
    date,
    changed,
    toStage: changed.map((c) => c.file),
    next: changed.length ? "toStage のパスをもう一度 git add してから precommit → git commit へ進みます。" : "埋める日付はありませんでした。",
  };
}

// ---------------------------------------------------------------- precommit

/** .env の形か。guard-bash.mjs の isEnvPath と同じ規則（ファイル名だけを見る・大文字小文字を区別しない・末尾が .example／.sample／.template なら見本）。 */
function isEnvPath(p) {
  const base = String(p).replace(/[\\/]+$/, "").replace(/^.*[\\/]/, "");
  return /^\.env(?:\..+)?$/i.test(base) && !/\.(?:example|sample|template)$/i.test(base);
}
/** playwright などがログイン状態を保存する形（stage されていたら止める）。 */
/** ログイン状態を保存したファイルか。guard-bash.mjs の isAuthStatePath と同じ規則（直すときは両方直す）。 */
function isAuthStatePath(p) {
  const norm = String(p).replace(/\\/g, "/");
  const base = norm.slice(norm.lastIndexOf("/") + 1);
  if (/\.(?:example|sample|template)\.json$/i.test(base) || /schema/i.test(base)) return false;
  if (/(^|\/)\.playwright-cli\//.test(norm)) return true;
  if (/(^|\/)\.auth\/[^/]+\.json$/i.test(norm)) return true;
  return /(?:auth|storage)[-_]?state[^/]*\.json$/i.test(base);
}
/** 名前だけがログイン状態らしいファイル（i18n の auth.json など、よくある名前なので注意に留める）。 */
const AUTH_LIKE = /(^|[/._-])auth([._-][^/]*)?\.json$/i;

function cmdPrecommit() {
  const gi = gitInfo();
  const problems = [];
  const warnings = [];
  if (!gi.available) {
    problems.push({ code: "no-git", message: "git が見つかりません。git を入れてから、もう一度実行してください。" });
  } else if (!gi.isRepo) {
    problems.push({ code: "not-repo", message: "git のリポジトリの外です。プロジェクトのフォルダで git init してから実行してください。" });
  }
  let staged = [];
  if (gi.isRepo) {
    if (!gi.userName || !gi.userEmail) {
      problems.push({
        code: "no-identity",
        message: `コミットに記録する名前${gi.userName ? "" : "・"}${gi.userEmail ? "" : "メール"}が設定されていません。運営者に聞いて git config user.name "<名前>" と git config user.email "<メール>" でこのリポジトリだけに設定してください。`,
      });
    }
    for (const f of [".env", ".env.local"]) {
      const r = git(["check-ignore", "-q", "--no-index", "--", f]);
      if (r.status !== 0) {
        problems.push({ code: "env-not-ignored", message: `${f} が .gitignore で除外されていません。.gitignore に .env と .env.* の行を足してください（init の apply が足します）。`, path: f });
      }
    }
    const d = git(["diff", "--cached", "--name-only", "-z"]);
    staged = d.stdout.split("\0").filter(Boolean);
    // 秘密の値の判定は、足した・変えたファイルだけを見る（git rm --cached で外した削除を、もう一度指摘しないため。hook と同じ）
    const added = git(["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMRT"]).stdout.split("\0").filter(Boolean);
    const here = (f) => (gi.root ? toPosix(path.relative(CWD, path.join(gi.root, f))) : f); // 案内に書くパス（いまのフォルダから）
    for (const rootPath of added) {
      const f = here(rootPath);
      if (isEnvPath(f)) {
        problems.push({ code: "env-staged", message: `秘密情報のファイル ${f} が stage されています。git rm --cached ${f} で stage から外してください（作業中のファイルは残ります）。`, path: f });
      } else if (isAuthStatePath(f)) {
        problems.push({ code: "auth-state-staged", message: `ログイン状態を保存したファイル ${f} が stage されています。git rm --cached ${f} で外し、.gitignore に足してください。`, path: f });
      } else if (AUTH_LIKE.test(f)) {
        warnings.push({ code: "auth-like-staged", message: `${f} は名前がログイン状態のファイルに似ています。翻訳や設定のファイルならそのままでよい。ログイン状態（Cookie やトークン）なら git rm --cached ${f} で外してください。`, path: f });
      } else if (/^(AGENTS|CLAUDE)\.md\.bak/.test(f)) {
        warnings.push({ code: "backup-staged", message: `${f}（置き換える前の AGENTS.md の控え）が stage されています。コミットしないなら git rm --cached ${f} で外してください。`, path: f });
      }
    }
    if (!staged.length) problems.push({ code: "nothing-staged", message: "stage されたファイルがありません。先にパスを明示して git add してください。" });
  }
  return {
    ok: problems.length === 0,
    command: "precommit",
    identity: { name: gi.userName, email: gi.userEmail },
    staged,
    problems,
    warnings,
    next: problems.length ? "problems を直してから、もう一度 precommit を実行します。" : `この名前とメールで記録します: ${gi.userName} <${gi.userEmail}>`,
  };
}

// ---------------------------------------------------------------- update

function unifiedDiff(a, b, labelA, labelB, ctx = 3) {
  const A = a.split("\n");
  const B = b.split("\n");
  const n = A.length;
  const m = B.length;
  if (n * m > 16e6) return `--- ${labelA}\n+++ ${labelB}\n@@ 差分が大きいので省略（${n} 行 → ${m} 行）@@\n`;
  const W = m + 1;
  const dp = new Uint32Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i * W + j] = A[i] === B[j] ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) ops.push([" ", A[i++], i - 1, j++]);
    else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) ops.push(["-", A[i++], i - 1, j]);
    else ops.push(["+", B[j++], i, j - 1]);
  }
  while (i < n) ops.push(["-", A[i++], i - 1, j]);
  while (j < m) ops.push(["+", B[j++], i, j - 1]);
  const outLines = [`--- ${labelA}`, `+++ ${labelB}`];
  let k = 0;
  while (k < ops.length) {
    while (k < ops.length && ops[k][0] === " ") k += 1;
    if (k >= ops.length) break;
    const start = Math.max(0, k - ctx);
    let last = k;
    let e = k;
    while (e < ops.length) {
      if (ops[e][0] !== " ") last = e;
      else if (e - last > 2 * ctx) break;
      e += 1;
    }
    const end = Math.min(ops.length, last + ctx + 1);
    const slice = ops.slice(start, end);
    const aLen = slice.filter((o) => o[0] !== "+").length;
    const bLen = slice.filter((o) => o[0] !== "-").length;
    const aStart = slice.find((o) => o[0] !== "+")?.[2] ?? slice[0][2];
    const bStart = slice.find((o) => o[0] !== "-")?.[3] ?? slice[0][3];
    outLines.push(`@@ -${aLen ? aStart + 1 : aStart},${aLen} +${bLen ? bStart + 1 : bStart},${bLen} @@`);
    for (const o of slice) outLines.push(o[0] + o[1]);
    k = end;
  }
  return `${outLines.join("\n")}\n`;
}

/** 新しい版の雛形にあって、いまのファイルに無い節（## と ###）。 */
function sectionAdditions(cur, tplStr, { onlyInsideMarkers = false } = {}) {
  const cl = cur.split(/\r?\n/);
  const tl = tplStr.split(/\r?\n/);
  const inside = (lines, idx) => {
    if (!onlyInsideMarkers) return true;
    const b = lines.indexOf(BEGIN);
    const e = lines.indexOf(END);
    return b !== -1 && e !== -1 && idx > b && idx < e;
  };
  const c2 = sectionsOf(cl, 2);
  const t2 = sectionsOf(tl, 2).filter((s) => inside(tl, s.start));
  const c3 = sectionsOf(cl, 3);
  const t3 = sectionsOf(tl, 3).filter((s) => inside(tl, s.start));
  const adds = [];
  for (const t of t2) {
    if (c2.some((c) => sameKey(c.key, t.key))) continue;
    adds.push({ kind: "section", heading: t.text, text: trimBlank(tl.slice(t.start, t.end)).join("\n") });
  }
  for (const t of t3) {
    if (c3.some((c) => sameKey(c.key, t.key))) continue;
    const parent = sectionsOf(tl, 2).filter((p) => p.start < t.start).pop();
    const cparent = parent ? c2.find((c) => sameKey(c.key, parent.key)) : null;
    if (!cparent) continue;
    adds.push({ kind: "subsection", heading: t.text, parent: cparent.text, text: trimBlank(tl.slice(t.start, t.end)).join("\n") });
  }
  return adds;
}

const TABLE_SECTIONS = ["ディレクトリ構成", "検証コマンド", "反映コマンド"];

/** AGENTS.md（v0.13 以前は CLAUDE.md）の表で、新しい版にあって今は無い行と、v0.1 の <…> のままのセル。 */
function rowAdditions(cur, tplStr) {
  const cl = cur.split(/\r?\n/);
  const tl = tplStr.split(/\r?\n/);
  const adds = [];
  for (const name of TABLE_SECTIONS) {
    const ts = sectionsOf(tl, 2).find((s) => s.text.startsWith(name));
    const cs = sectionsOf(cl, 2).find((s) => s.text.startsWith(name));
    if (!ts || !cs) continue;
    const trows = tableRowsIn(tl, ts);
    const crows = tableRowsIn(cl, cs);
    if (!crows.length) continue;
    for (const tr of trows) {
      const cr = crows.find((r) => r.key === tr.key);
      if (!cr) adds.push({ kind: "row", table: name, row: tr.cells[0], line: tl[tr.index] });
      else if (isLegacyUnfilled(cr.cells[1]) && (tr.cells[1] ?? "").includes("{{")) {
        adds.push({ kind: "cell", table: name, row: tr.cells[0], from: cr.cells[1], to: tr.cells[1] });
      }
    }
  }
  return adds;
}

function applyRowAdditions(cur, adds) {
  let lines = cur.split(/\r?\n/);
  for (const a of adds) {
    const cs = sectionsOf(lines, 2).find((s) => s.text.startsWith(a.table));
    if (!cs) continue;
    const rows = tableRowsIn(lines, cs);
    if (a.kind === "cell") {
      const r = rows.find((x) => x.key === rowKey(a.row));
      if (r) lines[r.index] = `| ${r.cells[0]} | ${a.to} |`;
      continue;
    }
    if (!rows.length) continue;
    const appRow = a.table === "ディレクトリ構成" ? rows.find((r) => r.key === "アプリ本体") : null;
    const at = appRow ? appRow.index : rows[rows.length - 1].index + 1;
    lines = [...lines.slice(0, at), a.line, ...lines.slice(at)];
  }
  return lines.join("\n");
}

function applySectionAdditions(cur, adds) {
  let lines = cur.split(/\r?\n/);
  for (const a of adds.filter((x) => x.kind === "subsection")) {
    const parent = sectionsOf(lines, 2).find((s) => s.text === a.parent);
    if (!parent) continue;
    let at = parent.end;
    while (at > parent.start + 1 && lines[at - 1].trim() === "") at -= 1;
    lines = [...lines.slice(0, at), "", ...a.text.split("\n"), ...lines.slice(at)];
  }
  const secs = adds.filter((x) => x.kind === "section");
  if (secs.length) {
    const endMarker = lines.indexOf(END);
    const h2 = sectionsOf(lines, 2);
    const history = endMarker === -1 ? h2.find((s) => s.key.includes("変更履歴")) : null;
    let at = endMarker !== -1 ? endMarker : history ? history.start : lines.length;
    while (at > 0 && lines[at - 1].trim() === "") at -= 1;
    const blocks = secs.map((s) => s.text.split("\n"));
    if (history) {
      const before = h2.filter((s) => s.start < history.start);
      const num = (t) => (/^(\d+)\.\s/.exec(t) || [])[1];
      const prev = before.length ? num(before[before.length - 1].text) : null;
      if (prev && num(history.text) && blocks.every((b) => num(b[0].replace(/^##\s+/, "")))) {
        let n = Number(prev);
        for (const b of blocks) b[0] = b[0].replace(/^(##\s+)\d+\./, `$1${(n += 1)}.`);
        lines[history.start] = lines[history.start].replace(/^(##\s+)\d+\./, `$1${n + 1}.`);
      }
    }
    const insert = [];
    for (const b of blocks) insert.push("", ...b);
    insert.push("");
    lines = [...lines.slice(0, at), ...insert, ...lines.slice(at)];
  }
  return normalizeBlankLines(lines.join("\n"));
}

/** 冒頭の表の「更新日」行が日付なら date（既定は今日）にする（中身を変えた文書が、コミット後に check-doc-dates で「古い」と言われないように）。 */
function touchUpdatedDate(text, date = today()) {
  return text.replace(/^(\|\s*(?:更新日|最終更新日)\s*\|\s*)\d{4}-\d{2}-\d{2}(\s*\|)/m, `$1${date}$2`);
}

function normalizeBlankLines(text) {
  const out = text.replace(/\n{3,}/g, "\n\n");
  return out.endsWith("\n") ? out : `${out}\n`;
}

/**
 * rel の中で、雛形のまま残った古い行を新しい形へ置き換える案。
 * kind は、v0.1 の <…> を {{…}} にするなら placeholder（LEGACY_PLACEHOLDER_LINES）、スキルの名前が変わった行なら rename（RENAMED_LINES）。
 */
function legacyLineConversions(rel, text) {
  // v0.13 以前は同じ中身が CLAUDE.md にあったので、同じ表を使う（置き換え先は AGENTS.md の雛形の行）
  const key = rel === "CLAUDE.md" ? "AGENTS.md" : rel;
  const tables = [
    ["placeholder", LEGACY_PLACEHOLDER_LINES[key]],
    ["rename", RENAMED_LINES[key]],
  ].filter(([, t]) => t);
  if (!tables.length || text == null) return [];
  const res = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const [kind, table] of tables) {
      const hit = table.find(([from]) => line === from);
      if (!hit) continue;
      let to = hit[1];
      if (typeof to !== "string") to = tplText(key).split(/\r?\n/).find((t) => t.startsWith(`| ${to.templateRow} |`)) ?? null;
      if (to != null && to !== line) res.push({ kind, line: i + 1, from: line, to });
      return;
    }
  });
  return res;
}

function applyLineConversions(text, convs) {
  if (!convs.length) return text;
  const lines = text.split(/\r?\n/);
  for (const c of convs) if (lines[c.line - 1] === c.from) lines[c.line - 1] = c.to;
  return lines.join("\n");
}

/** v0.1 の雛形の未記入（<…>）が残っている箇所。 */
function findLegacyPlaceholders() {
  const res = [];
  for (const [key, tokens] of Object.entries(LEGACY_TOKENS)) {
    // v0.13 以前は中身が CLAUDE.md にある
    const rel = key === "AGENTS.md" && !isFile("AGENTS.md") && isFile("CLAUDE.md") ? "CLAUDE.md" : key;
    const text = readText(rel);
    if (text == null) continue;
    scanMarkdown(text).forEach((segs, i) => {
      const raw = segs
        .filter((s) => s.kind === "text" || s.kind === "code")
        .map((s) => s.raw)
        .join("");
      for (const token of tokens) if (raw.includes(token)) res.push({ file: rel, line: i + 1, token });
    });
  }
  return res;
}

/** v0.1 の CLAUDE.md で移す節の一覧（手を入れたかどうか付き）。 */
function legacyRemovals(cur) {
  const lines = cur.split(/\r?\n/);
  const res = [];
  for (const s of sectionsOf(lines, 2)) {
    const def = LEGACY_SECTIONS.find((d) => s.text.startsWith(d.prefix));
    if (!def) continue;
    const text = lines.slice(s.start, s.end).join("\n").replace(/\s+$/, "");
    const customized = !def.hashes.includes(sha256(text));
    res.push({ heading: s.text, startLine: s.start + 1, endLine: s.end, movedTo: def.movedTo, customized, text: customized ? text : undefined });
  }
  return res;
}

/** v0.1 の CLAUDE.md を v0.2 の形へ移した中身を作る。 */
function migrateLegacyClaudeMd(cur, keepCustomized) {
  let lines = cur.split(/\r?\n/);
  const drop = new Set();
  for (const s of sectionsOf(lines, 2)) {
    const def = LEGACY_SECTIONS.find((d) => s.text.startsWith(d.prefix));
    if (!def) continue;
    const text = lines.slice(s.start, s.end).join("\n").replace(/\s+$/, "");
    if (keepCustomized && !def.hashes.includes(sha256(text))) continue;
    for (let i = s.start; i < s.end; i += 1) drop.add(i);
  }
  lines = lines.filter((l, i) => !drop.has(i) && !/^\|\s*スキル\s*\|.*プラグイン `docdd` が提供する/.test(l));
  lines = lines.map((l) => l.replace("<プロジェクト名>", "{{プロジェクト名}}").replace("<何を作っているか1行>", "{{何を作っているか1行}}"));
  lines = applyLineConversions(lines.join("\n"), legacyLineConversions("CLAUDE.md", lines.join("\n"))).split("\n");

  // 表のブロックを雛形から作り、いまの表の記入済みの値を移す
  const block = templateTablesBlock().replace(/\n$/, "").split("\n");
  const cs = sectionsOf(lines, 2);
  const verify = cs.find((s) => s.text.startsWith("検証コマンド"));
  const reflect = cs.find((s) => s.text.startsWith("反映コマンド"));
  for (const [name, sec] of [["検証コマンド", verify], ["反映コマンド", reflect]]) {
    if (!sec) continue;
    const bsec = sectionsOf(block, 2).find((s) => s.text.startsWith(name));
    const crows = tableRowsIn(lines, sec);
    const brows = tableRowsIn(block, bsec);
    for (const br of brows) {
      const cr = crows.find((r) => r.key === br.key);
      if (!cr) continue;
      cr.used = true;
      const tcell = br.cells[1] ?? "";
      const ccell = cr.cells[1] ?? "";
      if (tcell.includes("{{") && ccell && !isLegacyUnfilled(ccell)) block[br.index] = `| ${br.cells[0]} | ${ccell} |`;
    }
    const extras = crows.filter((r) => !r.used).map((r) => lines[r.index]);
    if (extras.length && brows.length) block.splice(brows[brows.length - 1].index + 1, 0, ...extras);
  }
  const ranges = [verify, reflect].filter(Boolean);
  if (ranges.length) {
    const insertAt = Math.min(...ranges.map((r) => r.start));
    const skip = new Set();
    for (const r of ranges) for (let i = r.start; i < r.end; i += 1) skip.add(i);
    const next = [];
    lines.forEach((l, i) => {
      if (i === insertAt) next.push("", ...block, "");
      if (!skip.has(i)) next.push(l);
    });
    lines = next;
  } else {
    while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
    lines.push("", ...block);
  }

  // キット共通の約束の置き場を 1 行で示す
  let text = lines.join("\n");
  if (!text.includes(".claude/rules/docdd-kit.md")) {
    const ls = text.split("\n");
    const h1 = ls.findIndex((l) => /^#\s/.test(l));
    if (h1 !== -1) {
      let j = h1 + 1;
      while (j < ls.length && ls[j].trim() === "") j += 1;
      while (j < ls.length && ls[j].trim() !== "" && !/^#/.test(ls[j])) j += 1;
      ls.splice(j, 0, "", "- キット共通の約束（5原則・変更影響 → 必須の検証・Definition of Done・規約）は `.claude/rules/docdd-kit.md` にあり、毎回自動で読み込まれる。");
      text = ls.join("\n");
    }
  }
  // ディレクトリ構成の表に新しい行を足し、<…> のままのセルを {{…}} にする
  const dirAdds = rowAdditions(text, tplText("AGENTS.md")).filter((a) => a.table === "ディレクトリ構成");
  text = applyRowAdditions(text, dirAdds);
  return normalizeBlankLines(text);
}

function guessInstalledVersion(manifest) {
  if (manifest.kitVersion) return manifest.kitVersion;
  for (const [rel, table] of Object.entries(KNOWN_KIT_HASHES)) {
    const buf = readBuf(rel);
    if (buf && table[sha256(buf)]) return table[sha256(buf)];
  }
  return null;
}

/** 上のフォルダに docdd があるときは、ここへ雛形や manifest を書かない（入れ子の導入を作らない）。 */
function refuseIfInstalledAbove(gi) {
  if (DOCDD_MARKERS.some(isFile) || isDocddByBacklog()) return;
  const above = docddRootAbove(gi);
  if (above) throw new UsageError(`このフォルダより上（${rootLabel(above)}）に docdd が導入済みです。ここには書きません。そのフォルダで Claude Code を開き直してください。`);
}

function planUpdate(opts) {
  const templates = listTemplates();
  const gi = gitInfo();
  const claude = claudeMdInfo();
  const manifest = readManifest();
  const placeholders = placeholderReport(templates);
  const st = computeState({ claude, manifest, placeholders, gi });
  const legacy = st.state === "legacy";
  const manFiles = isPlainObject(manifest.data?.files) ? manifest.data.files : {};
  const pkg = readPackageJson();
  const pm = detectPackageManager(pkg, gi);
  const stack = detectStack(pkg, pm);
  const entries = [];

  for (const rel of templates) {
    const owner = ownerOf(rel);
    const buf = readBuf(rel);
    const t = tpl(rel);
    const e = { path: rel, owner, status: null, action: "none" };
    if (rel === "CLAUDE.md" && buf != null) {
      // 役目は「AGENTS.md を読み込む」だけ。その 1 行があれば、利用者が書き足した中身はそのままにする
      const text = buf.toString("utf8");
      if (text.includes("@AGENTS.md")) e.status = sha256(buf) === sha256(t) ? "current" : "present";
      else
        Object.assign(e, {
          status: "present",
          action: "append",
          additions: [{ kind: "claude-pointer", text: tplText("CLAUDE.md") }],
          note: "Claude Code は CLAUDE.md があると AGENTS.md を読まないので、読み込む 1 行を末尾に足す（元の中身はそのまま）",
        });
    } else if (owner === "kit" || owner === "sample") {
      if (buf == null) Object.assign(e, { status: "missing", action: "add" });
      else if (sha256(buf) === sha256(t)) e.status = "current";
      else if (manFiles[rel]?.sha256 === sha256(buf)) Object.assign(e, { status: "untouched", action: "replace", matchedVersion: manFiles[rel].version ?? manifest.kitVersion });
      else if (knownVersion(rel, sha256(buf))) Object.assign(e, { status: "untouched", action: "replace", matchedVersion: knownVersion(rel, sha256(buf)) });
      else Object.assign(e, { status: "modified", action: owner === "kit" ? "review" : "none", diff: unifiedDiff(buf.toString("utf8"), t.toString("utf8"), `${rel}（いま）`, `${rel}（v${KIT_VERSION}）`) });
    } else if (rel === ".claude/settings.json") {
      Object.assign(e, { status: buf == null ? "missing" : "present", settings: settingsDiff(), note: "許可設定は上書きもマージもしない。足すかは運営者が決める" });
    } else if (rel === ".mcp.json") {
      Object.assign(e, { status: buf == null ? "missing" : "present", mcp: mcpInfo(stack), note: "上書きもマージもしない" });
    } else if (rel === ".gitignore") {
      const gin = gitignoreInfo(stack);
      if (!gin.exists) Object.assign(e, { status: "missing", action: "add", additions: gin.missingLines });
      else if (gin.missingLines.length) Object.assign(e, { status: "present", action: "append", additions: gin.missingLines });
      else e.status = "current";
    } else if (rel === "AGENTS.md") {
      if (buf == null && claude.legacyMain && claude.exists && (claude.hasMarkers || claude.legacyTables)) {
        // v0.13 以前: 中身は CLAUDE.md にある。AGENTS.md へ移す
        const raw = readText("CLAUDE.md");
        // v0.1 系は、先に v0.2 の形へ直してから移す（移った節を消す）
        const legacyV01 = claude.legacyTables && !claude.hasMarkers;
        const from = legacyV01 ? migrateLegacyClaudeMd(raw, opts["keep-customized"] === true) : raw;
        const rulesText = readText(".claude/rules/docdd-kit.md");
        const rulesBuf = readBuf(".claude/rules/docdd-kit.md");
        const rulesUntouched =
          rulesBuf != null &&
          (manFiles[".claude/rules/docdd-kit.md"]?.sha256 === sha256(rulesBuf) || knownVersion(".claude/rules/docdd-kit.md", sha256(rulesBuf)) != null);
        const moved = toAgentsMd(from, rulesText, rulesUntouched);
        e.rulesUntouched = rulesUntouched;
        e.legacyV01 = legacyV01;
        if (legacyV01) e.removals = legacyRemovals(raw);
        Object.assign(e, {
          status: "legacy",
          action: "migrate-to-agents",
          diff: unifiedDiff(raw, moved, "CLAUDE.md（いま）", "AGENTS.md（移したあと）"),
          note: "CLAUDE.md の中身を AGENTS.md へ移し、キット共通の約束（.claude/rules/docdd-kit.md）もこの中へ入れる。CLAUDE.md は AGENTS.md を読み込む 1 行になり、.claude/rules/docdd-kit.md は消える",
        });
      } else if (buf == null) Object.assign(e, { status: "missing", action: "add" });
      else {
        const cur = buf.toString("utf8");
        if (claude.legacyTables && !claude.hasMarkers) {
          const migrated = migrateLegacyClaudeMd(cur, opts["keep-customized"] === true);
          Object.assign(e, {
            status: "legacy",
            action: "migrate",
            removals: legacyRemovals(cur),
            diff: unifiedDiff(cur, migrated, "CLAUDE.md（いま）", "CLAUDE.md（移したあと）"),
          });
        } else {
          const adds = [
            ...legacyLineConversions(rel, cur),
            ...rowAdditions(cur, t.toString("utf8")),
            ...(claude.hasMarkers ? sectionAdditions(cur, t.toString("utf8"), { onlyInsideMarkers: true }) : []),
          ];
          if (!claude.hasMarkers && !claude.hasVerifyTable) adds.push({ kind: "tables", text: templateTablesBlock() });
          const block = rulesBlock(cur);
          if (!block) adds.push({ kind: "rules", text: templateRulesBlock(), note: "「キット共通の約束」を足す" });
          else if (block.version !== KIT_VERSION && block.text !== templateRulesBlock()) {
            adds.push({ kind: "rules", text: templateRulesBlock(), from: block.version, diff: unifiedDiff(block.text, templateRulesBlock(), `キット共通の約束（v${block.version}）`, `キット共通の約束（v${KIT_VERSION}）`) });
          }
          Object.assign(e, { status: adds.length ? "present" : "current", action: adds.length ? "append" : "none", additions: adds });
        }
      }
    } else if (rel.endsWith(".md")) {
      if (buf == null) Object.assign(e, { status: "missing", action: "add" });
      else if (knownVersion(rel, sha256(buf))) {
        Object.assign(e, {
          status: "untouched",
          action: "replace",
          matchedVersion: knownVersion(rel, sha256(buf)),
          diff: unifiedDiff(buf.toString("utf8"), t.toString("utf8"), `${rel}（いま）`, `${rel}（v${KIT_VERSION}）`),
        });
      } else {
        const adds = [...legacyLineConversions(rel, buf.toString("utf8")), ...sectionAdditions(buf.toString("utf8"), t.toString("utf8"))];
        Object.assign(e, { status: adds.length ? "present" : "current", action: adds.length ? "append" : "none", additions: adds });
      }
    } else if (buf == null) Object.assign(e, { status: "missing", action: "add" });
    else e.status = "present";
    entries.push(e);
  }

  if (pkg.exists && pkg.data && (pkg.data.scripts === undefined || isPlainObject(pkg.data.scripts))) {
    const { scripts: scriptsTpl } = scriptsToAdd(pm);
    const cur = pkg.data.scripts ?? {};
    const missing = Object.keys(scriptsTpl).filter((k) => !(k in cur));
    entries.push({ path: "package.json", owner: "user", status: missing.length ? "present" : "current", action: missing.length ? "append" : "none", additions: missing });
  }

  return { templates, gi, claude, manifest, st, legacy, entries, pkg, stack };
}

function applyUpdateEntry(e, opts, pkg, stack) {
  const rel = e.path;
  if (rel === "CLAUDE.md" && e.action === "append") {
    // 利用者が書いた中身は消さず、AGENTS.md を読み込む 1 行だけ足す
    const cur = readText(rel);
    writeFile(rel, withEol(`${cur.endsWith("\n") ? cur : `${cur}\n`}\n${e.additions.find((a) => a.kind === "claude-pointer").text}`, eolOf(cur)));
    return;
  }
  if (e.owner === "kit" || e.owner === "sample") {
    writeFile(rel, tpl(rel));
    return;
  }
  if (rel === ".gitignore") {
    writeFile(rel, e.action === "add" ? gitignoreTemplateText(stack) : appendGitignore(readText(rel), e.additions, stack));
    return;
  }
  if (rel === "package.json") {
    const scriptsTpl = JSON.parse(tplText("package.scripts.json"));
    writeFile(rel, addPackageScripts(pkg.raw, e.additions.map((k) => [k, scriptsTpl[k]])).text);
    return;
  }
  if (e.action === "add" || e.action === "replace") {
    writeFile(rel, tpl(rel));
    return;
  }
  if (rel === "AGENTS.md" && e.action === "migrate-to-agents") {
    const raw = readText("CLAUDE.md");
    const claudeMd = e.legacyV01 === true ? migrateLegacyClaudeMd(raw, opts["keep-customized"] === true) : raw;
    writeFile(rel, withEol(toAgentsMd(claudeMd, readText(".claude/rules/docdd-kit.md"), e.rulesUntouched === true), eolOf(raw)));
    writeFile("CLAUDE.md", tpl("CLAUDE.md"));
    if (isFile(".claude/rules/docdd-kit.md")) fs.rmSync(abs(".claude/rules/docdd-kit.md"));
    e.alsoWrote = renameKitRefsInDocs();
    // 他に何も無ければ、空になった .claude/rules も片づける
    try {
      if (fs.readdirSync(abs(".claude/rules")).length === 0) fs.rmdirSync(abs(".claude/rules"));
    } catch {}
    return;
  }
  const cur = readText(rel);
  const eol = eolOf(cur);
  if ((rel === "AGENTS.md" || rel === "CLAUDE.md") && e.action === "migrate") {
    writeFile(rel, withEol(migrateLegacyClaudeMd(cur, opts["keep-customized"] === true), eol));
    return;
  }
  if (rel === "AGENTS.md") {
    const tables = e.additions.find((a) => a.kind === "tables");
    let text = applyLineConversions(cur, legacyLineConversions(rel, cur));
    if (tables) text = `${text.endsWith("\n") ? text : `${text}\n`}\n${tables.text}`;
    text = applyRowAdditions(text, e.additions.filter((a) => a.kind === "row" || a.kind === "cell"));
    text = applySectionAdditions(text, e.additions.filter((a) => a.kind === "section" || a.kind === "subsection"));
    const rules = e.additions.find((a) => a.kind === "rules");
    if (rules) {
      const block = rulesBlock(text);
      text = block ? `${text.slice(0, block.start)}${rules.text}${text.slice(block.end)}` : `${text.endsWith("\n") ? text : `${text}\n`}\n${rules.text}\n`;
    }
    writeFile(rel, withEol(text, eol));
    return;
  }
  writeFile(rel, withEol(touchUpdatedDate(applySectionAdditions(applyLineConversions(cur, legacyLineConversions(rel, cur)), e.additions)), eol));
}

function cmdUpdate(opts) {
  const dryRun = opts["dry-run"] === true;
  const plan = planUpdate(opts);
  const { entries, st, manifest, legacy, pkg, stack } = plan;
  const requested = parseList(opts.apply);
  const installedVersion = guessInstalledVersion(manifest);
  const applied = [];
  const errors = [];
  if (st.state === "not-installed" && requested.length) {
    throw new UsageError("docdd のファイルが見つかりません。update ではなく /docdd:init で導入してください。");
  }
  if (st.state === "installed-above" && requested.length) {
    throw new UsageError(`このフォルダより上（${rootLabel(st.projectRoot)}）に docdd が導入済みです。ここには書きません。そのフォルダで Claude Code を開き直して /docdd:update-kit を打ってください。`);
  }
  for (const p of requested) {
    const e = entries.find((x) => x.path === p);
    if (!e) errors.push({ path: p, message: "update の対象ではないパスです（status や update の files に出ているパスを指定する）" });
    else if (e.action === "none") errors.push({ path: p, message: `このファイルは ${e.status} なので、することがありません` });
    else {
      if (!dryRun) applyUpdateEntry(e, opts, pkg, stack);
      applied.push({ path: p, action: e.action, ...(e.alsoWrote?.length ? { alsoWrote: e.alsoWrote } : {}) });
    }
  }

  let manifestWritten = false;
  if (applied.length && !dryRun) {
    const base = manifest.data ?? {};
    const files = isPlainObject(base.files) ? { ...base.files } : {};
    for (const rel of plan.templates) {
      const owner = ownerOf(rel);
      const buf = readBuf(rel);
      if (!buf) continue;
      if ((owner === "kit" || owner === "sample") && sha256(buf) === sha256(tpl(rel))) {
        files[rel] = { sha256: sha256(buf), owner, version: KIT_VERSION };
      } else if (applied.some((a) => a.path === rel && a.action === "add")) {
        files[rel] = { sha256: sha256(buf), owner, version: KIT_VERSION };
      }
    }
    // 無くなったファイル（AGENTS.md へ移した .claude/rules/docdd-kit.md など）の記録は消す
    for (const rel of Object.keys(files)) if (!isFile(rel)) delete files[rel];
    // 版を新しくするのは、キットのファイルに「無い」「手付かず（置き換えられる）」が残っておらず、CLAUDE.md の移行も済んだときだけ。
    // それまでは元の版を保つ（一部だけ適用したあとの update でも、残りのファイルと移行を出すため）。
    const kitPending = [...KIT_OWNED].some((rel) => {
      const buf = readBuf(rel);
      if (!buf) return true;
      if (sha256(buf) === sha256(tpl(rel))) return false;
      return entries.find((x) => x.path === rel)?.status === "untouched";
    });
    const now = claudeMdInfo();
    const migratePending = now.exists && now.legacyTables && !now.hasMarkers;
    // 版が分からない（manifest が無かった＝v0.1 系）ときは、途中でも「0.1.0〜0.1.4」と書く（null にすると hook の案内が黙る）
    const kitVersion = kitPending || migratePending ? installedVersion ?? "0.1.0〜0.1.4" : KIT_VERSION;
    writeFile(MANIFEST, `${JSON.stringify({ kitVersion, installedAt: base.installedAt ?? today(), updatedAt: today(), ...keptManifestSettings(base), files: sortKeys(files) }, null, 2)}\n`);
    manifestWritten = true;
  }

  // AGENTS.md への移行が残っているうちは、CLAUDE.md を単独で置き換えない（中身が消えるため。移行が一緒に書き換える）
  if (entries.some((e) => e.path === "AGENTS.md" && e.action === "migrate-to-agents")) {
    const pointer = entries.find((e) => e.path === "CLAUDE.md");
    if (pointer && pointer.action !== "none") Object.assign(pointer, { action: "none", additions: [], note: "AGENTS.md の移行が、このファイルも一緒に書き換える" });
  }
  const actionable = entries.filter((e) => e.action !== "none");
  return {
    ok: errors.length === 0,
    command: "update",
    dryRun,
    kitVersion: KIT_VERSION,
    installedVersion,
    state: st.state,
    projectRoot: st.projectRoot ?? null,
    basis: manifest.exists ? "manifest" : "known-hashes",
    files: entries,
    summary: {
      replace: actionable.filter((e) => e.action === "replace").map((e) => e.path),
      add: actionable.filter((e) => e.action === "add").map((e) => e.path),
      review: actionable.filter((e) => e.action === "review").map((e) => e.path),
      append: actionable.filter((e) => e.action === "append").map((e) => e.path),
      migrate: actionable.filter((e) => e.action === "migrate" || e.action === "migrate-to-agents").map((e) => e.path),
    },
    legacy: legacy
      ? {
          note: "v0.1 系の構成です。CLAUDE.md から移った節を消して表をマーカーで囲み、そのまま AGENTS.md へまとめます（migrate-to-agents）。CLAUDE.md は AGENTS.md を読み込む 1 行になります。",
          removals: entries.find((e) => e.path === "AGENTS.md")?.removals ?? entries.find((e) => e.path === "CLAUDE.md")?.removals ?? [],
        }
      : entries.some((e) => e.action === "migrate-to-agents")
        ? {
            note: "v0.13 以前の構成です。CLAUDE.md の中身と .claude/rules/docdd-kit.md を AGENTS.md へまとめます（migrate-to-agents）。CLAUDE.md は AGENTS.md を読み込む 1 行になり、.claude/rules/docdd-kit.md は消えます。AGENTS.md を適用すると、この 3 つが一度に入れ替わります。",
            removals: [],
          }
        : null,
    applicable: actionable.map((e) => e.path),
    legacyPlaceholders: findLegacyPlaceholders(),
    applied,
    errors,
    manifest: { path: MANIFEST, written: manifestWritten },
    toStage: applied.length && !dryRun ? [...new Set([...applied.flatMap((a) => [a.path, ...(a.alsoWrote ?? [])]), MANIFEST])].sort() : [],
    next:
      st.state === "not-installed"
        ? "docdd のファイルが見つかりません。/docdd:init で導入してください。"
        : applied.length
          ? "toStage のパスを git add し、docs の検査（node scripts/check-doc-dates.mjs && node scripts/check-doc-refs.mjs）を回してからコミットします。"
          : actionable.length
            ? "運営者の承知を得たパスを --apply <パス,...> で渡します（replace は手付かず、review は差分を見せて 1 件ずつ聞く）。"
            : "新しい版で変わったところはありません。",
  };
}

// ---------------------------------------------------------------- 表示

function human(result) {
  const L = [];
  const list = (title, items) => {
    if (!items || !items.length) return;
    L.push(`${title}:`);
    for (const it of items) L.push(`  - ${it}`);
  };
  switch (result.command) {
    case "status": {
      L.push(`docdd v${result.kitVersion} ／ 状態: ${result.state}`);
      L.push(result.next);
      L.push(`git: ${result.git.available ? (result.git.isRepo ? `リポジトリ（コミット ${result.git.commits} 件${result.git.atGitRoot ? "" : "・ここは一番上ではない"}）` : "リポジトリではない") : "見つからない"}`);
      L.push(`名前とメール: ${result.git.userName ?? "未設定"} <${result.git.userEmail ?? "未設定"}>`);
      L.push(
        `スタック: ${result.stack.frameworks.join("・") || "不明"}（${result.stack.languages.join("・") || "言語不明"}／パッケージマネージャ ${result.packageManager ?? "無し"}${result.stack.web === false ? "／Web 以外" : ""}）`,
      );
      L.push(`土台: ${result.scaffold.present ? "あり" : "無い"}`);
      list("検証コマンドの推定", result.inferred.map((r) => `${r.row}: ${r.cell ?? "推定できない"}`));
      list("仕様書らしいファイル", result.specCandidates.map((c) => c.path));
      list("足りないファイル", result.missing);
      list("tasks/BACKLOG.md に無い書式の節", result.backlog.missingSections);
      list("未記入の欄", result.placeholders.map((p) => `${p.file}:${p.line}  ${p.token}`));
      break;
    }
    case "apply":
      if (!result.ok) L.push(`❌ ${result.error}`);
      L.push(`${result.dryRun ? "（--dry-run）" : ""}置いた: ${result.created.length} 件／変えた: ${result.modified.length} 件／飛ばした: ${result.skipped.length} 件`);
      list("置いた", result.created);
      list("変えた", result.modified.map((m) => `${m.path}（${m.changes.join("／")}）`));
      list("飛ばした", result.skipped.map((s) => `${s.path}（${s.reason}）`));
      list("package.json に足さなかった script", result.packageJson.skipped.map((s) => `${s.name}（${s.reason}）`));
      list("推定で埋めた行", result.filled.map((f) => `${f.row}: ${f.cell}`));
      list("tasks/BACKLOG.md に足した書式の節", result.backlog?.added);
      list("tasks/BACKLOG.md に無い書式の節（--add-backlog-sections で足せる）", result.backlog && !result.backlog.added.length ? result.backlog.missingSections : []);
      list("起票した定型タスク", result.tasks.map((t) => `${t.id} ${t.title}（${t.action === "added" ? "追加" : "既にある"}）`));
      list("未記入の欄", result.placeholders.map((p) => `${p.file}:${p.line}  ${p.token}`));
      list("注意", result.warnings);
      list("git add するパス", result.toStage);
      L.push(result.next);
      break;
    case "dates":
      L.push(
        `日付 ${result.date} で埋めた: ${result.changed.map((c) => `${c.file}（${[c.count ? `${c.count} か所` : "", c.updatedDate ? "更新日" : ""].filter(Boolean).join("・")}）`).join("・") || "無し"}`,
      );
      L.push(result.next);
      break;
    case "precommit":
      L.push(result.ok ? "コミットしてよい状態です。" : "コミットの前に直すところがあります。");
      list("問題", result.problems.map((p) => p.message));
      list("注意", result.warnings.map((w) => w.message));
      L.push(result.next);
      break;
    case "update":
      L.push(`docdd v${result.kitVersion} ／ 導入済みの版: ${result.installedVersion ?? "不明"} ／ 状態: ${result.state}（判定: ${result.basis}）`);
      list("手付かず→置き換えてよい", result.summary.replace);
      list("無い→新しく置く", result.summary.add);
      list("変更あり→差分を見て決める", result.summary.review);
      list("新しい節・行を足せる", result.summary.append);
      list("v0.1 の構成から移す", result.summary.migrate);
      list("v0.1 の未記入（<…>）のまま残っている箇所", result.legacyPlaceholders.map((p) => `${p.file}:${p.line}  ${p.token}`));
      list("適用した", result.applied.map((a) => `${a.path}（${a.action}）`));
      list("エラー", result.errors.map((x) => `${x.path}: ${x.message}`));
      L.push(result.next);
      break;
    default:
      L.push(JSON.stringify(result, null, 2));
  }
  return L.join("\n");
}

const USAGE = `使い方: node "\${CLAUDE_PLUGIN_ROOT}/scripts/init.mjs" <status|apply|dates|precommit|update> [--json] [オプション]
  status                       いまの状態を調べる（読み取りのみ）
  apply                        雛形を上書きせずに置く
      --settings yes|no        .claude/settings.json を置くか（既定 yes。既存は上書きしない）
      --agents-md new|replace|append|keep   既存の AGENTS.md の扱い（既定 new＝無ければ置く・あれば触らない）
      --mcp auto|next|empty    .mcp.json の中身（既定 auto＝依存に next があれば Next.js 向け）
      --tasks scaffold,test-infra   BACKLOG に定型タスクを起票する
      --fill-inferred          AGENTS.md「検証コマンド」表の未記入の行を推定値で埋める
      --add-backlog-sections   既存の tasks/BACKLOG.md に無い書式の節（運用ルール・タスク・要決定）を雛形から足す
      --dry-run                書かずに結果だけ返す
  dates [--date YYYY-MM-DD]    manifest に載っている文書の {{YYYY-MM-DD}} を今日にする
  precommit                    コミット前の安全確認（問題があれば終了コード 1）
  update [--apply <パス,...>] [--keep-customized]   新しい版との差分を分類し、名指ししたパスだけ適用する`;

function main() {
  const { sub, opts } = parseArgs(process.argv.slice(2));
  const json = opts.json === true;
  const emit = (result, code = 0) => {
    process.stdout.write(`${json ? JSON.stringify(result, null, 2) : human(result)}\n`);
    process.exitCode = code;
  };
  if (!sub || sub === "help" || opts.help) {
    process.stdout.write(`${USAGE}\n`);
    process.exitCode = sub || opts.help ? 0 : 2;
    return;
  }
  try {
    if (!fs.existsSync(path.join(TEMPLATES, "AGENTS.md"))) {
      throw new UsageError(`雛形が見つかりません（${TEMPLATES}）。/plugin で docdd を入れ直してください。`);
    }
    switch (sub) {
      case "status":
        return emit(collectStatus());
      case "apply": {
        const r = cmdApply(opts);
        return emit(r, r.ok ? 0 : 2);
      }
      case "dates":
        return emit(cmdDates(opts));
      case "precommit": {
        const r = cmdPrecommit();
        return emit(r, r.ok ? 0 : 1);
      }
      case "update": {
        const r = cmdUpdate(opts);
        return emit(r, r.ok ? 0 : 2);
      }
      default:
        throw new UsageError(`分からないサブコマンドです: ${sub}\n${USAGE}`);
    }
  } catch (e) {
    const message = e instanceof UsageError ? e.message : `予期しないエラー: ${e?.stack ?? e}`;
    if (json) process.stdout.write(`${JSON.stringify({ ok: false, command: sub, error: message }, null, 2)}\n`);
    else process.stderr.write(`❌ ${message}\n`);
    process.exitCode = 2;
  }
}

main();
