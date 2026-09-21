// HTTP 路由层：保持纤薄。
// 旧底片整理室接口（/api/...）与页面（/）行为不变；
// 新晒架占用与曝光补偿模块挂在 /rack 与 /rack/api/...，规则见 rack/rules.js。
import http from "node:http";
import { Storage, nowIso } from "./rack/storage.js";
import * as rules from "./rack/rules.js";
import { rackPage, roomPage } from "./rack/view.js";

const storage = new Storage();
const port = Number(process.env.PORT || 3040);

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const err = new Error("invalid_json");
    err.status = 400;
    throw err;
  }
}
function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}
function html(res, text) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(text);
}
const statLabels = ["待曝光","冲洗中","待入盒","已交付"];
function computeStats(items) {
  const stats = Object.fromEntries(statLabels.map(label => [label, 0]));
  for (const item of items) if (stats[item.status] !== undefined) stats[item.status] += 1;
  return stats;
}
function summarize(item) {
  const logCount = (item.logs || []).length + (item.tasks || []).reduce((n, t) => n + (t.logs || []).length, 0);
  return { ...item, logCount };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  try {
    // ---------- 页面 ----------
    if (req.method === "GET" && p === "/") return html(res, roomPage());
    if (req.method === "GET" && p === "/rack") return html(res, rackPage());

    // ---------- 旧：底片整理室 API（保持原样）----------
    if (req.method === "GET" && p === "/api/items") {
      const db = await storage.read();
      return send(res, 200, db.items.map(summarize));
    }
    if (req.method === "POST" && p === "/api/items") {
      const input = await readBody(req);
      const item = await storage.mutate(db => rules.addNegative(db, input));
      return send(res, 201, item);
    }
    let m = p.match(/^\/api\/items\/([^/]+)$/);
    if (m && req.method === "PATCH") {
      const input = await readBody(req);
      const item = await storage.mutate(db => {
        const it = db.items.find(x => x.id === m[1] || x.code === m[1]);
        if (!it) throw Object.assign(new Error("item_not_found"), { status: 404 });
        Object.assign(it, input);
        it.logs ||= [];
        it.logs.push({ at: nowIso(), step: "状态", note: "更新为" + it.status });
        return it;
      });
      return send(res, 200, item);
    }
    m = p.match(/^\/api\/items\/([^/]+)\/logs$/);
    if (m && req.method === "POST") {
      const input = await readBody(req);
      const item = await storage.mutate(db => {
        const it = db.items.find(x => x.id === m[1] || x.code === m[1]);
        if (!it) throw Object.assign(new Error("item_not_found"), { status: 404 });
        it.logs ||= [];
        it.logs.push({ at: nowIso(), step: input.step || "记录", note: input.note || "" });
        return it;
      });
      return send(res, 201, item);
    }
    m = p.match(/^\/api\/items\/([^/]+)\/action$/);
    if (m && req.method === "POST") {
      const input = await readBody(req);
      const item = await storage.mutate(db => {
        const it = db.items.find(x => x.id === m[1] || x.code === m[1]);
        if (!it) throw Object.assign(new Error("item_not_found"), { status: 404 });
        it.logs ||= [];
        it.steps ||= [];
        it.steps.push({ at: nowIso(), ...input });
        if (input.defect) it.defect = input.defect;
        if (input.step === "冲洗") it.status = "冲洗中";
        else if (input.step === "入盒") it.status = "待入盒";
        else if (input.step === "交付") it.status = "已交付";
        else it.status = "待曝光";
        it.logs.push({ at: nowIso(), step: input.step || "工艺", note: input.note || input.developStatus || "步骤记录" });
        return it;
      });
      return send(res, 201, item);
    }
    if (req.method === "GET" && p === "/api/stats") {
      const db = await storage.read();
      return send(res, 200, computeStats(db.items));
    }

    // ---------- 新：晒架占用与曝光补偿 API ----------
    if (req.method === "GET" && p === "/rack/api/board") {
      const db = await storage.read();
      const b = rules.board(db);
      b.negatives = db.items.map(n => ({ code: n.code, plateSize: n.plateSize, status: n.status }));
      return send(res, 200, b);
    }
    if (req.method === "POST" && p === "/rack/api/sessions") {
      const input = await readBody(req);
      const session = await storage.mutate(db => rules.openSession(db, input));
      return send(res, 201, rules.sessionView(await storage.read(), session));
    }
    m = p.match(/^\/rack\/api\/sessions\/([^/]+)\/reverify$/);
    if (m && req.method === "POST") {
      const session = await storage.mutate(db => rules.reverifySession(db, m[1]));
      return send(res, 200, rules.sessionView(await storage.read(), session));
    }
    m = p.match(/^\/rack\/api\/sessions\/([^/]+)\/complete$/);
    if (m && req.method === "POST") {
      const input = await readBody(req);
      const session = await storage.mutate(db => rules.completeSession(db, m[1], input));
      return send(res, 200, rules.sessionView(await storage.read(), session));
    }
    m = p.match(/^\/rack\/api\/sessions\/([^/]+)$/);
    if (m && req.method === "PATCH") {
      const input = await readBody(req);
      const session = await storage.mutate(db => rules.updateSession(db, m[1], input));
      return send(res, 200, rules.sessionView(await storage.read(), session));
    }
    if (m && req.method === "DELETE") {
      const removed = await storage.mutate(db => rules.deleteSession(db, m[1]));
      return send(res, 200, { ok: true, removed: removed.id });
    }
    if (req.method === "POST" && p === "/rack/api/racks") {
      const input = await readBody(req);
      const rack = await storage.mutate(db => rules.addRack(db, input));
      return send(res, 201, rack);
    }
    m = p.match(/^\/rack\/api\/racks\/(.+)$/);
    if (m && req.method === "DELETE") {
      await storage.mutate(db => rules.deleteRack(db, decodeURIComponent(m[1])));
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && p === "/rack/api/batches") {
      const input = await readBody(req);
      const batch = await storage.mutate(db => rules.addBatch(db, input));
      return send(res, 201, batch);
    }
    m = p.match(/^\/rack\/api\/batches\/([^/]+)\/deactivate$/);
    if (m && req.method === "POST") {
      const batch = await storage.mutate(db => rules.deactivateBatch(db, decodeURIComponent(m[1])));
      return send(res, 200, batch);
    }
    if (req.method === "PATCH" && p === "/rack/api/settings") {
      const input = await readBody(req);
      const settings = await storage.mutate(db => rules.updateSettings(db, input));
      return send(res, 200, settings);
    }

    return send(res, 404, { error: "not_found" });
  } catch (error) {
    const status = error.status || (error instanceof rules.RuleError ? error.status : 500);
    const payload = { error: error.message || "server_error" };
    if (error instanceof rules.RuleError) {
      if (error.code) payload.code = error.code;
      if (error.holderId) payload.holderId = error.holderId;
      if (error.holderNegative) payload.holderNegative = error.holderNegative;
      if (error.reason) payload.reason = error.reason;
    }
    return send(res, status, payload);
  }
});

server.listen(port, () => console.log(`古法蓝晒整理室 listening on http://localhost:${port}  (晒架模块 /rack)`));
