#!/usr/bin/env node
// docdd-kit v0.16.0 — scripts/audit-check.mjs（キットが管理するファイル。直すと /docdd:update-kit が差分を見せて聞く）
//
// 依存ライブラリの脆弱性ゲート（npm と package-lock.json を使うプロジェクト向け）。
//
//   node scripts/audit-check.mjs
//
// 判定は **本番依存（--omit=dev）** の脆弱性を 1 件ずつ（GHSA-… の ID の単位で）見て行う:
//   - critical は必ず失敗（据え置きの一覧に関わらず）
//   - high は、据え置きの一覧にそのパッケージとその ID が無ければ失敗
//     （一覧にあるパッケージでも、ids に無い脆弱性が出たら失敗）
//   - moderate / low は報告のみ
// 依存の脆弱性が伝わって high に見えるだけの親（qs の脆弱性で express が high になる、など）は、親としては数えない。
// 脆弱性を持つパッケージの側で判定するので、npm audit の経路と直接問い合わせる経路で同じ結果になる。
// devDependencies だけに存在する脆弱性は利用者へ配布されないため、件数の報告に留める。
//
// 終了コード: 0 = 問題なし／1 = 直すものがある（一覧に無い high、critical、据え置きの期限切れ）／
//             2 = 判定できない（package-lock.json が無い・古い形式、据え置きの一覧の書き方の誤り、通信できない など）
//
// npm audit が監査レポートを返さないときは、bulk advisory endpoint へ直接問い合わせる
// （npm が Content-Encoding 無しの gzip 応答を解釈できずに失敗することがあるため）。
// 監査結果を取得できなければ **必ず exit 2 で止める**（「0件」と誤認して素通りさせない）。
import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ALLOWLIST_FILE = path.join(SCRIPT_DIR, "audit-allowlist.json");
const ALLOWLIST_NAME = path.relative(process.cwd(), ALLOWLIST_FILE) || "audit-allowlist.json";
const BULK_ENDPOINT = "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk";
const SEVERITY_ORDER = ["info", "low", "moderate", "high", "critical"];

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/*
  **package-lock.json を探す。** まず scripts/ の 1 つ上（ふつうのプロジェクト）。
  無ければ git の一番上のフォルダ（npm workspaces では lock がそこに 1 つだけできる）。
*/
function findLockFile() {
  const beside = path.join(SCRIPT_DIR, "..", "package-lock.json");
  if (existsSync(beside)) return beside;
  const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: SCRIPT_DIR, encoding: "utf8" });
  if (!top.error && top.status === 0) {
    const atRoot = path.join(top.stdout.trim(), "package-lock.json");
    if (existsSync(atRoot)) return atRoot;
  }
  return null;
}

/*
  **package-lock.json が無ければ、監査の前に止める。**
  `npm audit` も下のフォールバックも lock を読むので、無いと 2 段の失敗文だけが出て次の一手が読めない。
*/
const LOCK_FILE = findLockFile();
if (!LOCK_FILE) {
  console.error("audit-check: package-lock.json がありません（scripts/ の 1 つ上と、git の一番上のフォルダを探しました）。`npm install` を1回実行して作ってください");
  console.error("  （npm workspaces で複数のパッケージを 1 つのリポジトリに置いている場合は、一番上のフォルダで `npm audit` を回してください）");
  console.error("  （pnpm / yarn のプロジェクトではこの検査は使えません。AGENTS.md「検証コマンド」表の『依存の脆弱性』行を、そのツールの監査コマンドに書き換えてください）");
  process.exit(2);
}
const LOCK_DIR = path.dirname(LOCK_FILE);
const LOCK_NAME = path.relative(process.cwd(), LOCK_FILE) || "package-lock.json";
if (path.resolve(LOCK_DIR) !== path.resolve(SCRIPT_DIR, "..")) {
  console.log(`audit-check: scripts/ の 1 つ上に package-lock.json が無いため、git の一番上の ${LOCK_NAME} で監査します`);
}

/*
  **古い形式（lockfileVersion 1）は作り直してもらう。** v1 には `packages` が無く、
  npm audit が使えないときの直接問い合わせで依存を 1 件も読めず「0 件」に見えてしまう。
*/
let lock;
try {
  lock = JSON.parse(readFileSync(LOCK_FILE, "utf8"));
} catch (err) {
  console.error(`audit-check: ${LOCK_NAME} を読めません（${err.message}）。\`npm install\` で作り直してください`);
  process.exit(2);
}
if (!(Number(lock?.lockfileVersion) >= 2) || lock.packages === null || typeof lock.packages !== "object") {
  console.error(
    `audit-check: ${LOCK_NAME} が古い形式です（lockfileVersion ${lock?.lockfileVersion ?? "なし"}）。npm 7 以上で \`npm install\` を実行して作り直してください`,
  );
  process.exit(2);
}

/**
 * 既知の high のうち、すぐには上げられないもの（据え置き）。critical には適用しない。
 *
 * 一覧は隣の `audit-allowlist.json`。形は次の 1 つだけで、**ids・why・until のどれが欠けても受け付けない**:
 *   { "<パッケージ名>": { "ids": ["GHSA-xxxx-xxxx-xxxx"], "why": "<なぜ今直さないか>", "until": "YYYY-MM-DD" } }
 * ids は据え置く脆弱性の ID（GitHub が脆弱性ごとに振る番号。検査が落ちたときの出力に出る）。
 * 同じパッケージに ids に無い high が出たら、据え置き中でも失敗にする。期限を過ぎたら exit 1 で知らせる。
 * ファイルが無ければ「何も許さない」（最も厳しい側に倒す）。
 *
 * 据え置きを外すときは、依存を上げる（必要なら package.json の overrides で nested の版も寄せる）
 * → ビルドが通ることを確かめる → 一覧から消す、の順にする。
 */
const ALLOWLIST_SHAPE = '{ "<パッケージ名>": { "ids": ["GHSA-xxxx-xxxx-xxxx"], "why": "<なぜ今直さないか>", "until": "YYYY-MM-DD" } }';
const GHSA_ID = /^GHSA(?:-[0-9a-z]{4}){3}$/i;
const GHSA_IN_URL = /GHSA(?:-[0-9a-z]{4}){3}/i;

/** GHSA の ID を「GHSA-小文字」にそろえる（GitHub の URL と同じ綴り）。 */
function normalizeId(id) {
  return `GHSA${id.slice(4).toLowerCase()}`;
}

function isDate(value) {
  if (typeof value !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function loadAllowlist() {
  if (!existsSync(ALLOWLIST_FILE)) return new Map();
  let raw;
  try {
    raw = JSON.parse(readFileSync(ALLOWLIST_FILE, "utf8"));
  } catch (err) {
    console.error(`audit-check: ${ALLOWLIST_NAME} を読めません（${err.message}）。${ALLOWLIST_SHAPE} の形の JSON にしてください`);
    process.exit(2);
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    console.error(`audit-check: ${ALLOWLIST_NAME} は ${ALLOWLIST_SHAPE} の形にしてください（据え置きが無ければ {}）`);
    process.exit(2);
  }
  const list = new Map();
  const problems = [];
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === "string") {
      problems.push(`"${name}" は古い書き方です（値が文字列）。据え置く脆弱性の ID（ids）と期限（until）を足して、下の形に書き直してください`);
      continue;
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      problems.push(`"${name}" の値は { "ids": [...], "why": "...", "until": "YYYY-MM-DD" } の形にしてください`);
      continue;
    }
    const { ids, why, until } = value;
    const before = problems.length;
    if (!Array.isArray(ids) || ids.length === 0) {
      problems.push(`"${name}" に据え置く脆弱性の ID（ids）を 1 件以上書いてください`);
    } else {
      const bad = ids.filter((id) => typeof id !== "string" || !GHSA_ID.test(id.trim()));
      if (bad.length > 0) {
        problems.push(`"${name}" の ids は GHSA-xxxx-xxxx-xxxx の形で書いてください（いまの値: ${bad.map((b) => JSON.stringify(b)).join(", ")}）`);
      }
    }
    if (typeof why !== "string" || why.trim() === "") {
      problems.push(`"${name}" に「なぜ今直さないか」（why）を書いてください`);
    }
    if (until === undefined) {
      problems.push(`"${name}" に期限（until）を YYYY-MM-DD で書いてください（その日を過ぎると、見直すようこの検査が知らせます）`);
    } else if (!isDate(until)) {
      problems.push(`"${name}" の until は YYYY-MM-DD の日付で書いてください（いまの値: ${JSON.stringify(until)}）`);
    }
    if (problems.length === before) {
      list.set(name, { ids: new Set(ids.map((id) => normalizeId(id.trim()))), why: why.trim(), until });
    }
  }
  if (problems.length > 0) {
    console.error(`audit-check: ${ALLOWLIST_NAME} の書き方を直してください（${problems.length} 件）:`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error(`  形: ${ALLOWLIST_SHAPE}`);
    console.error("  （ids は据え置く脆弱性の ID です。この検査が落ちたときの出力に、足す形がそのまま出ます。1 つのパッケージで複数を据え置くときは ids に並べます）");
    process.exit(2);
  }
  return list;
}
const HIGH_ALLOWLIST = loadAllowlist();

/*
  **据え置きの期限切れは、監査の前に止める。** 期限を決めた据え置きは、その日までに上げる約束。
  脆弱性がまだあるかどうかに関わらず、上げるか・理由を書いて期限を延ばすかを決めてもらう。
*/
const TODAY = today();
const expired = [...HIGH_ALLOWLIST].filter(([, e]) => e.until < TODAY);
if (expired.length > 0) {
  console.error(`audit-check FAILED — 据え置き期限切れ（${ALLOWLIST_NAME} の until を過ぎています。今日は ${TODAY}）:`);
  for (const [name, e] of expired) console.error(`  - ${name} ${[...e.ids].join(", ")}（期限 ${e.until}。理由: ${e.why}）`);
  console.error("依存を上げて一覧から消すか、まだ上げられないなら why に延ばす理由を書き足し、until を新しい日付にしてください。");
  process.exit(1);
}

function runAudit(extraArgs = "") {
  try {
    // vuln があると npm audit は非0終了するが JSON は stdout に出る。
    return execSync(`npm audit --json ${extraArgs}`.trim(), {
      cwd: LOCK_DIR,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch (err) {
    const out = err.stdout ? err.stdout.toString() : "";
    if (out) return out;
    throw err;
  }
}

function parseAudit(extraArgs) {
  try {
    return JSON.parse(runAudit(extraArgs));
  } catch {
    return null;
  }
}

/**
 * registry がエラーを返すと npm は `{ "message": ..., "error": {...} }` を stdout へ出す。
 * これも valid JSON なので、監査レポートの体裁を確認しないと「脆弱性0件」に見えてしまう。
 */
function looksLikeReport(audit) {
  const counts = audit?.metadata?.vulnerabilities;
  return (
    audit?.auditReportVersion !== undefined &&
    counts !== null &&
    typeof counts === "object" &&
    typeof counts.total === "number" &&
    audit.vulnerabilities !== null &&
    typeof audit.vulnerabilities === "object"
  );
}

/** 脆弱性 1 件（パッケージ名・GHSA の ID・深刻度・題名・URL）。GHSA が無いときは npm の番号で持つ。 */
function advisory(pkg, number, { url, title, severity }) {
  const ghsa = typeof url === "string" ? GHSA_IN_URL.exec(url) : null;
  return {
    pkg,
    id: ghsa ? normalizeId(ghsa[0]) : `npm の番号 ${number}`,
    hasGhsa: Boolean(ghsa),
    severity,
    title: typeof title === "string" ? title : "",
    url: typeof url === "string" ? url : "",
  };
}

/** 同じパッケージと ID の組は 1 件にまとめ、パッケージ名・深刻度（重い順）・ID の順に並べる。 */
function uniqueSorted(list) {
  const byKey = new Map(list.map((a) => [`${a.pkg}\0${a.id}`, a]));
  return [...byKey.values()].sort(
    (x, y) =>
      (x.pkg < y.pkg ? -1 : x.pkg > y.pkg ? 1 : 0) ||
      SEVERITY_ORDER.indexOf(y.severity) - SEVERITY_ORDER.indexOf(x.severity) ||
      (x.id < y.id ? -1 : x.id > y.id ? 1 : 0),
  );
}

/**
 * npm audit のレポートから脆弱性を 1 件ずつ取り出す。
 * via の要素がオブジェクトならそのパッケージ自身の脆弱性。文字列は「別のパッケージの脆弱性が伝わった」印で、
 * 元のパッケージの側に同じものが載っているので数えない（伝わっただけの親を落とさない）。
 */
function advisoriesFromNpm(report) {
  const found = [];
  for (const [name, info] of Object.entries(report.vulnerabilities ?? {})) {
    for (const via of Array.isArray(info?.via) ? info.via : []) {
      if (via === null || typeof via !== "object") continue;
      found.push(advisory(typeof via.name === "string" ? via.name : name, via.source, via));
    }
  }
  return uniqueSorted(found);
}

/** package-lock.json のインストール済みパッケージを {name: [version]} にする。 */
function lockedPackages({ productionOnly }) {
  const byName = new Map();
  for (const [pkgPath, info] of Object.entries(lock.packages)) {
    if (!pkgPath.includes("node_modules/") || !info.version) continue;
    if (productionOnly && (info.dev || info.devOptional)) continue;
    const name = pkgPath.slice(pkgPath.lastIndexOf("node_modules/") + "node_modules/".length);
    const versions = byName.get(name) ?? new Set();
    versions.add(info.version);
    byName.set(name, versions);
  }
  return Object.fromEntries([...byName].map(([n, v]) => [n, [...v]]));
}

/**
 * `npm audit` が使えないときのフォールバック。応答は {パッケージ名: [脆弱性]} で、
 * 依存元への伝播は含まない（npm の経路でも伝播は数えないので、判定は同じになる）。
 */
async function advisoriesViaBulkEndpoint() {
  const packages = lockedPackages({ productionOnly: true });
  const names = Object.keys(packages);
  const found = [];
  const BATCH = 250;
  for (let i = 0; i < names.length; i += BATCH) {
    const body = {};
    for (const n of names.slice(i, i + BATCH)) body[n] = packages[n];
    const res = await fetch(BULK_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`bulk endpoint が ${res.status} を返しました`);
    const raw = Buffer.from(await res.arrayBuffer());
    // この endpoint は Content-Encoding を付けずに gzip 本文を返すことがある。
    const text =
      raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
    if (!text.trim()) continue;
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("bulk endpoint の応答が {パッケージ名: [脆弱性]} の形ではありません");
    }
    for (const [pkg, list] of Object.entries(parsed)) {
      if (!Array.isArray(list)) throw new Error(`bulk endpoint の応答で ${pkg} の値が配列ではありません`);
      for (const a of list) found.push(advisory(pkg, a?.id, a ?? {}));
    }
  }
  return uniqueSorted(found);
}

function countBySeverity(list) {
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  for (const a of list) if (a.severity in counts) counts[a.severity] += 1;
  return counts;
}

const formatCounts = (c) => `critical=${c.critical} high=${c.high} moderate=${c.moderate} low=${c.low}`;

// --- 本番依存の監査（判定対象） ---
let prodAdvisories;
let via = "";
const prod = parseAudit("--omit=dev");
if (looksLikeReport(prod)) {
  prodAdvisories = advisoriesFromNpm(prod);
} else {
  console.warn(
    `audit-check: npm audit が監査レポートを返しませんでした（${
      prod?.message ?? "npm が無いか、応答に metadata.vulnerabilities がありません"
    }）。bulk advisory endpoint へ直接問い合わせます。`,
  );
  if (typeof fetch !== "function") {
    console.error(`audit-check: 直接の問い合わせには Node.js 18 以上が必要です（いまの版: ${process.version}）。Node.js を上げてからもう一度実行してください`);
    process.exit(2);
  }
  try {
    prodAdvisories = await advisoriesViaBulkEndpoint();
    via = "（bulk endpoint 直接問い合わせ）";
  } catch (err) {
    const code = err?.cause?.code ? ` / ${err.cause.code}` : "";
    console.error(`audit-check: 監査結果を取得できませんでした（${err?.message ?? err}${code}）`);
    console.error("  → ネットワーク接続と registry.npmjs.org への到達（proxy の設定）を確認して、もう一度実行してください");
    process.exit(2);
  }
}

console.log(`audit${via} 本番依存の脆弱性: ${formatCounts(countBySeverity(prodAdvisories))}（件数は脆弱性の数。伝わっただけの親は数えない）`);

// dev だけの脆弱性は配布されないため、参考として件数だけ出す（取得できたときのみ）。
const all = parseAudit("");
if (looksLikeReport(all)) {
  console.log(`（参考）dev込み: ${formatCounts(countBySeverity(advisoriesFromNpm(all)))}`);
}

const blocking = [];
const deferred = [];
for (const a of prodAdvisories) {
  const entry = HIGH_ALLOWLIST.get(a.pkg);
  const listed = Boolean(entry?.ids.has(a.id));
  if (a.severity === "critical") {
    blocking.push({ a, note: listed ? "critical は据え置けません" : "" });
  } else if (a.severity === "high") {
    if (listed) deferred.push(a);
    else blocking.push({ a, note: entry ? "据え置きの一覧に無い脆弱性" : "" });
  }
}

if (blocking.length > 0) {
  console.error("audit-check FAILED — 直すものがあります（本番依存の high・critical）:");
  for (const { a, note } of blocking) {
    const extra = [a.severity, note, a.hasGhsa ? "" : "GHSA の ID が無いため据え置けません"].filter(Boolean).join("。");
    console.error(`  - ${a.pkg} ${a.id}（${extra}）${a.title}`);
    if (a.url) console.error(`      ${a.url}`);
  }
  console.error("依存を上げて直してください（npm なら package.json の overrides で、入れ子の依存の版も寄せられることがあります）。");
  const hasCritical = blocking.some(({ a }) => a.severity === "critical");
  const deferrable = blocking.filter(({ a }) => a.severity === "high" && a.hasGhsa).map(({ a }) => a);
  if (deferrable.length > 0) {
    const idsByPkg = new Map();
    for (const a of deferrable) {
      const ids = idsByPkg.get(a.pkg) ?? new Set(HIGH_ALLOWLIST.get(a.pkg)?.ids ?? []);
      ids.add(a.id);
      idsByPkg.set(a.pkg, ids);
    }
    console.error(`すぐに上げられない high だけは、要決定で合意のうえ ${ALLOWLIST_NAME} に次の形で足せます${hasCritical ? "（critical は据え置けません）" : ""}:`);
    const lines = [...idsByPkg].map(
      ([pkg, ids]) =>
        `  ${JSON.stringify(pkg)}: { "ids": [${[...ids].map((id) => JSON.stringify(id)).join(", ")}], "why": "<なぜ今直さないか>", "until": "YYYY-MM-DD" }`,
    );
    console.error(`{\n${lines.join(",\n")}\n}`);
    if (deferrable.some((a) => HIGH_ALLOWLIST.has(a.pkg))) {
      console.error("（一覧にすでにあるパッケージは、ids に新しい ID を足し、why をその脆弱性の分まで書き直してください）");
    }
  } else if (hasCritical) {
    console.error("critical は据え置けません。");
  }
  if (blocking.some(({ a }) => a.severity === "high" && !a.hasGhsa)) {
    console.error("GHSA の ID が無い high は一覧に書けないため、依存を上げて直すしかありません。");
  }
  process.exit(1);
}

console.log("audit-check OK");
for (const a of deferred) {
  const e = HIGH_ALLOWLIST.get(a.pkg);
  console.log(`  据え置き中: ${a.pkg} ${a.id}（${a.severity}。期限 ${e.until}。理由: ${e.why}）`);
}
const seen = new Set(prodAdvisories.filter((a) => a.severity === "high").map((a) => `${a.pkg}\0${a.id}`));
for (const [name, e] of HIGH_ALLOWLIST) {
  const gone = [...e.ids].filter((id) => !seen.has(`${name}\0${id}`));
  if (gone.length > 0) {
    console.log(`  一覧にあるが、いまは本番依存の high として出ていない: ${name} ${gone.join(", ")}（依存を上げて直っていれば、一覧から消せます）`);
  }
}
