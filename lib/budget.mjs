// Persistent preflight authorization. Reservations are charged even if upstream fails.
// No prices, prompts, API keys, raw IPs, or reply text are stored in the ledger.
import { DatabaseSync } from "node:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KINDS = ["llm", "hot", "search", "knowledge", "zhida"];
const contexts = new AsyncLocalStorage();
const number = (value, fallback) => value === undefined || value === "" ? fallback : /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) ? Number(value) : 0;
const dayOf = now => new Date(now + 8 * 3600e3).toISOString().slice(0, 10);
export function budgetMessage(code) {
  if (code === "BUDGET_CONCURRENT" || code === "BUDGET_RATE") return "实时服务正在忙碌，本次使用经典模式，不影响继续游戏。";
  if (code === "BUDGET_PLAYER" || code === "BUDGET_IP") return "本轮体验的实时增强名额已用完，仍可使用经典模式继续探索。";
  if (code === "BUDGET_DISABLED") return "实时 API 预算尚未开放，当前使用经典模式与已有参考资料。";
  if (code === "BUDGET_CONFIG") return "本项实时增强预算尚未开放，当前使用经典模式；资料以各卡片来源为准。";
  if (String(code).startsWith("BUDGET_")) return "实时增强暂不可用，本次使用经典模式；剧情、真相与结局仍可完整体验。";
  return "AI 生成暂不可用，本次使用规则文本，不影响继续游戏。";
}
const denial = code => Object.assign(new Error(budgetMessage(code)), { code, status: 429 });
export function currentBudgetContext() { return contexts.getStore() || {}; }
export function runBudgetContext(context, fn) { return contexts.run(context, fn); }

export function createBudget({ env = process.env, dbPath = env.API_BUDGET_DB || path.join(ROOT, "data", "budget", "ledger.sqlite"), now = Date.now } = {}) {
  let db, failed = false, closed = false;
  const enabled = env.API_LIVE_ENABLED === "true";
  const policies = Object.fromEntries(KINDS.map(kind => {
    const prefix = "API_" + kind.toUpperCase();
    return [kind, { daily: number(env[prefix + "_DAILY_CALLS"], 0), total: number(env[prefix + "_TOTAL_CALLS"], 0),
      player: number(env[prefix + "_PLAYER_DAILY_CALLS"], kind === "llm" || kind === "zhida" ? 6 : kind === "search" ? 3 : 10),
      ip: number(env[prefix + "_IP_DAILY_CALLS"], kind === "llm" || kind === "zhida" ? 60 : 100) }];
  }));
  const dailyUnits = number(env.API_LLM_DAILY_UNITS, 0), totalUnits = number(env.API_LLM_TOTAL_UNITS, 0);
  const maxConcurrent = Math.min(number(env.API_MAX_CONCURRENT, 3), 20);
  const playerPerMinute = number(env.API_PLAYER_PER_MINUTE, 6), ipPerMinute = number(env.API_IP_PER_MINUTE, 30);
  function database() {
    if (failed || closed) throw denial("BUDGET_STORAGE");
    if (db) return db;
    try {
      if (dbPath !== ":memory:") mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
      db = new DatabaseSync(dbPath);
      db.exec(`PRAGMA busy_timeout=2000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS spend (id TEXT PRIMARY KEY, kind TEXT NOT NULL, day TEXT NOT NULL, player TEXT NOT NULL, ip TEXT NOT NULL, units INTEGER NOT NULL, at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS spend_kind_day ON spend(kind, day);
        CREATE INDEX IF NOT EXISTS spend_player_day ON spend(player, day, kind);
        CREATE INDEX IF NOT EXISTS spend_ip_day ON spend(ip, day, kind);
        CREATE INDEX IF NOT EXISTS spend_at ON spend(at);
        CREATE TABLE IF NOT EXISTS leases (id TEXT PRIMARY KEY, player TEXT NOT NULL, kind TEXT NOT NULL, expires INTEGER NOT NULL);`);
      db.prepare("INSERT OR IGNORE INTO meta(key,value) VALUES ('identity_key',?)").run(randomBytes(32).toString("hex"));
      return db;
    } catch { failed = true; throw denial("BUDGET_STORAGE"); }
  }
  function hash(value) {
    const secret = database().prepare("SELECT value FROM meta WHERE key='identity_key'").get().value;
    return createHmac("sha256", secret).update(value).digest("hex");
  }
  function actor(req, res) {
    if (!enabled) return {};
    // Do not trust arbitrary X-Forwarded-For: only a specifically configured direct proxy may provide it.
    let ip = req.socket?.remoteAddress || "unknown";
    const trusted = String(env.API_TRUSTED_PROXY_IPS || "").split(",").map(x => x.trim()).filter(Boolean);
    if (trusted.includes(ip)) {
      const forwarded = String(req.headers["x-forwarded-for"] || "").split(",").at(-1)?.trim();
      if (isIP(forwarded || "")) ip = forwarded;
    }
    const cookieName = "echo_player";
    const value = String(req.headers.cookie || "").split(";").map(x => x.trim()).find(x => x.startsWith(cookieName + "="))?.slice(cookieName.length + 1);
    let id;
    try {
      if (value && /^[a-f0-9]{32}\.[a-f0-9]{64}$/.test(value)) {
        const [candidate, signature] = value.split(".");
        if (timingSafeEqual(Buffer.from(signature), Buffer.from(hash("cookie:" + candidate)))) id = candidate;
      }
      if (!id) {
        id = randomBytes(16).toString("hex");
        const secure = req.socket?.encrypted || env.API_SECURE_COOKIE === "true";
        res.setHeader("Set-Cookie", `${cookieName}=${id}.${hash("cookie:" + id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure ? "; Secure" : ""}`);
      }
      return { player: hash("player:" + id), ip: hash("ip:" + ip) };
    } catch { return { unavailable: true }; }
  }
  function reserve(kind, { units = 0, actor: suppliedActor } = {}) {
    if (!enabled) throw denial("BUDGET_DISABLED");
    const policy = policies[kind];
    if (!policy?.daily || !policy.total || !policy.player || !policy.ip || !maxConcurrent || !playerPerMinute || !ipPerMinute
      || (kind === "llm" && (!dailyUnits || !totalUnits))) throw denial("BUDGET_CONFIG");
    if (!Number.isSafeInteger(units) || units < 0 || (kind === "llm" && units <= 0)) throw denial("BUDGET_INPUT");
    const context = suppliedActor || currentBudgetContext();
    if (context.unavailable) throw denial("BUDGET_STORAGE");
    const player = context.player || "server", ip = context.ip || "server";
    const time = now(), day = dayOf(time), id = randomUUID(), conn = database();
    let transaction = false;
    try {
      conn.exec("BEGIN IMMEDIATE"); transaction = true;
      conn.prepare("DELETE FROM leases WHERE expires <= ?").run(time);
      const sum = conn.prepare("SELECT count(*) AS calls, coalesce(sum(units),0) AS units FROM spend WHERE kind=?").get(kind);
      const today = conn.prepare("SELECT count(*) AS calls, coalesce(sum(units),0) AS units FROM spend WHERE kind=? AND day=?").get(kind, day);
      if (sum.calls >= policy.total || today.calls >= policy.daily) throw denial("BUDGET_EXHAUSTED");
      if (kind === "llm" && (sum.units + units > totalUnits || today.units + units > dailyUnits)) throw denial("BUDGET_UNITS");
      if (conn.prepare("SELECT count(*) AS n FROM spend WHERE kind=? AND day=? AND player=?").get(kind, day, player).n >= policy.player) throw denial("BUDGET_PLAYER");
      if (conn.prepare("SELECT count(*) AS n FROM spend WHERE kind=? AND day=? AND ip=?").get(kind, day, ip).n >= policy.ip) throw denial("BUDGET_IP");
      if (conn.prepare("SELECT count(*) AS n FROM spend WHERE at>? AND player=?").get(time - 60000, player).n >= playerPerMinute
        || conn.prepare("SELECT count(*) AS n FROM spend WHERE at>? AND ip=?").get(time - 60000, ip).n >= ipPerMinute) throw denial("BUDGET_RATE");
      if (conn.prepare("SELECT count(*) AS n FROM leases").get().n >= maxConcurrent
        || conn.prepare("SELECT count(*) AS n FROM leases WHERE player=? AND kind=?").get(player, kind).n >= 1) throw denial("BUDGET_CONCURRENT");
      conn.prepare("INSERT INTO spend VALUES (?,?,?,?,?,?,?)").run(id, kind, day, player, ip, units, time);
      // Crash leases expire after 10 minutes; charges never expire/refund. HTTP requests have shorter timeouts.
      conn.prepare("INSERT INTO leases VALUES (?,?,?,?)").run(id, player, kind, time + 10 * 60e3);
      conn.exec("COMMIT"); transaction = false;
    } catch (error) {
      if (transaction) try { conn.exec("ROLLBACK"); } catch { failed = true; }
      if (error.code?.startsWith("BUDGET_")) throw error;
      failed = true; throw denial("BUDGET_STORAGE");
    }
    let released = false;
    return { release() {
      if (released) return; released = true;
      try { database().prepare("DELETE FROM leases WHERE id=?").run(id); }
      catch { failed = true; } // Never refund a sent request; storage errors fail closed on the next call.
    } };
  }
  function snapshot() {
    const conn = database(), day = dayOf(now());
    return { enabled, date: day, timezone: "Asia/Shanghai", accounting: "reserved-not-billed", limits: policies,
      units: { daily: dailyUnits, total: totalUnits }, usage: conn.prepare("SELECT kind,count(*) AS totalCalls,sum(units) AS totalUnits,sum(CASE WHEN day=? THEN 1 ELSE 0 END) AS dailyCalls,sum(CASE WHEN day=? THEN units ELSE 0 END) AS dailyUnits FROM spend GROUP BY kind").all(day, day),
      active: conn.prepare("SELECT count(*) AS n FROM leases WHERE expires>?").get(now()).n };
  }
  function status() {
    if (!enabled) return { mode: "classic", reason: "BUDGET_DISABLED", message: budgetMessage("BUDGET_DISABLED") };
    try {
      const report = snapshot(), policy = policies.llm, used = report.usage.find(x => x.kind === "llm");
      const reason = !policy.daily || !policy.total || !dailyUnits || !totalUnits ? "BUDGET_CONFIG"
        : used && (used.dailyCalls >= policy.daily || used.totalCalls >= policy.total || used.dailyUnits >= dailyUnits || used.totalUnits >= totalUnits) ? "BUDGET_EXHAUSTED" : null;
      return { mode: reason ? "classic" : "available", reason, message: reason ? budgetMessage(reason) : "实时增强按预算开放；实际输出以本次来源标签为准。" };
    } catch { return { mode: "classic", reason: "BUDGET_STORAGE", message: budgetMessage("BUDGET_STORAGE") }; }
  }
  return { reserve, actor, status, snapshot, close() { closed = true; if (db) { db.close(); db = null; } } };
}
export const budget = createBudget();
