// 晒架模块 —— 业务规则层
// 职责：底片唯一性、晒架占用、光照曝光补偿、药液/尺寸复验、参数失效状态机。
// 纯函数：数据由调用方传入，不直接读写文件；并发串行化由存储层 withLock 保证。

export const SessionStatus = Object.freeze({
  OPEN: "开放中",        // 已占晒架，曝光结论有效
  RECHECK: "待复验",     // 建程复验未过，或晒程后参数被改动 —— 不占晒架
  CLOSED: "已完成"       // 晒程结束，晒架已释放
});

// 光照补偿档位：倍数作用于基准曝光，再给出该档位的操作说明
export const lightLevels = Object.freeze({
  "烈日": { factor: 0.85, note: "紫外强，按基准缩短" },
  "薄云": { factor: 1.0, note: "标准光照，按基准" },
  "厚云": { factor: 1.25, note: "紫外偏弱，需延时" },
  "阴天": { factor: 1.4, note: "紫外很弱，显著延时" }
});

export class RuleError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

const LIGHT_KEYS = Object.keys(lightLevels);

// —— 曝光补偿 ——

// 底片基准曝光登记为“8分钟”这类文本；取其中数字（单位默认分钟）
export function parseBaselineMinutes(text) {
  if (typeof text !== "string") return null;
  const m = text.match(/\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

export function calcExposure(baselineText, light) {
  const level = lightLevels[light];
  if (!level) throw new RuleError(400, "invalid_light", "光照档位必须是：" + LIGHT_KEYS.join("、"));
  const base = parseBaselineMinutes(baselineText);
  if (base == null) throw new RuleError(400, "missing_baseline", "底片缺少可解析的基准曝光时间");
  const adjusted = Math.round(base * level.factor * 10) / 10;
  return {
    baselineMinutes: base,
    light,
    factor: level.factor,
    adjustedMinutes: adjusted,
    text: `${adjusted}分钟（基准${base}分钟 × ${level.factor}，${level.note}）`
  };
}

// —— 查询 ——

export function findNegative(items, code) {
  return items.find(x => x.code === code) || null;
}

// 占用的定义：开放晒程（未完成、非待复验）在该晒架上。
// 已完成晒程释放晒架；待复验晒程本就不占晒架。
export function findOpenSessionOnRack(db, rackId, exceptSessionId = null) {
  return db.sessions.find(s =>
    s.rackId === rackId && s.status === SessionStatus.OPEN && s.id !== exceptSessionId
  ) || null;
}

export function findSessionByNegative(db, code, exceptSessionId = null) {
  return db.sessions.find(s => s.negativeCode === code && s.id !== exceptSessionId) || null;
}

// 同一底片一个开放晒程内只接一张：已有开放晒程即冲突
export function findOpenSessionByNegative(db, code, exceptSessionId = null) {
  return db.sessions.find(s =>
    s.negativeCode === code && s.status === SessionStatus.OPEN && s.id !== exceptSessionId
  ) || null;
}

export function findRack(db, rackId) {
  return db.racks.find(r => r.id === rackId) || null;
}

export function findBatch(db, code) {
  return db.chemicalBatches.find(b => b.code === code) || null;
}

// 建程/复验三道关：药液停用、尺寸不匹配、基准曝光缺失。
// 有关卡问题就只进待复验，不占晒架。药液停用判定依赖批次表，见 evaluateWithBatches。
export function evaluate(input, negative) {
  const issues = [];
  if (negative.chemicalBatch && input.chemicalBatch !== negative.chemicalBatch) {
    issues.push(`药液批次与底片登记不符（底片登记 ${negative.chemicalBatch}）`);
  }
  if (negative.plateSize && input.plateSize !== negative.plateSize) {
    issues.push(`玻璃板尺寸与底片不匹配（底片为 ${negative.plateSize}）`);
  }
  if (parseBaselineMinutes(negative.exposure) == null) {
    issues.push("底片缺少可解析的基准曝光时间");
  }
  return issues;
}

function evaluateWithBatches(db, input, negative) {
  const issues = evaluate(input, negative);
  const batch = findBatch(db, input.chemicalBatch);
  if (!batch) {
    issues.unshift(`药液批次 ${input.chemicalBatch} 未登记`);
  } else if (!batch.active) {
    issues.unshift(`药液批次 ${input.chemicalBatch} 已停用`);
  }
  return issues;
}

// —— 建程 ——

// 输入：{ negativeCode, rackId, light, chemicalBatch, plateSize }
// 事务在存储层 withLock 内执行。冲突抛 RuleError(409)，由路由转成 409 且不落库。
export function createSession(db, items, input, now = new Date().toISOString()) {
  const negativeCode = String(input.negativeCode || "").trim();
  const rackId = String(input.rackId || "").trim();
  const chemicalBatch = String(input.chemicalBatch || "").trim();
  const plateSize = String(input.plateSize || "").trim();
  if (!negativeCode || !rackId || !chemicalBatch || !plateSize || !input.light) {
    throw new RuleError(400, "missing_fields", "必须登记底片编号、晒架、光照、药液批次和玻璃板尺寸");
  }
  const negative = findNegative(items, negativeCode);
  if (!negative) throw new RuleError(404, "negative_not_found", "底片不存在：" + negativeCode);
  if (!findRack(db, rackId)) throw new RuleError(400, "rack_not_found", "晒架不存在：" + rackId);
  if (!lightLevels[input.light]) {
    throw new RuleError(400, "invalid_light", "光照档位必须是：" + LIGHT_KEYS.join("、"));
  }

  // 同一底片一个开放晒程内只接一张
  const negBusy = findOpenSessionByNegative(db, negativeCode);
  if (negBusy) throw new RuleError(409, "negative_already_open", `底片 ${negativeCode} 已在开放晒程 ${negBusy.id} 中`);

  const issues = evaluateWithBatches(db, { chemicalBatch, plateSize, light: input.light }, negative);

  // 药液停用或尺寸不匹配：只进待复验，不占晒架（也不检查占用）
  if (issues.length) {
    return buildSession(db, { negativeCode, rackId, chemicalBatch, plateSize, light: input.light, negative }, issues, now);
  }

  // 同一晒架在一个开放晒程内只接一张 —— 409 且不落库
  const occupant = findOpenSessionOnRack(db, rackId);
  if (occupant) throw new RuleError(409, "rack_occupied", `晒架 ${rackId} 已被底片 ${occupant.negativeCode} 的开放晒程占用`);

  return buildSession(db, { negativeCode, rackId, chemicalBatch, plateSize, light: input.light, negative }, [], now);
}

function buildSession(db, p, issues, now) {
  const exposure = issues.some(i => i.includes("基准曝光"))
    ? { valid: false, text: "缺少基准曝光，无法补偿" }
    : { ...calcExposure(p.negative.exposure, p.light), valid: false };

  const session = {
    id: null, // 由路由用 newSessionId 填入
    negativeCode: p.negativeCode,
    rackId: p.rackId,
    light: p.light,
    chemicalBatch: p.chemicalBatch,
    plateSize: p.plateSize,
    baselineExposure: p.negative.exposure,
    status: issues.length ? SessionStatus.RECHECK : SessionStatus.OPEN,
    issues,
    exposure: issues.length ? { ...exposure, valid: false } : { ...exposure, valid: true },
    createdAt: now,
    updatedAt: now,
    closedAt: null,
    history: [{
      at: now,
      action: issues.length ? "建程待复验" : "建程开放",
      note: issues.length ? "未占晒架：" + issues.join("；") : `占用晒架 ${p.rackId}，${exposure.text}`
    }]
  };
  return session;
}

// —— 晒程后改参数 ——
// 任何关键参数（光照/药液/尺寸）改动都让曝光结论失效，退回待复验并释放晒架。

export function patchSessionParams(db, items, sessionId, patch, now = new Date().toISOString()) {
  const s = db.sessions.find(x => x.id === sessionId);
  if (!s) throw new RuleError(404, "session_not_found", "晒程不存在");
  if (s.status === SessionStatus.CLOSED) throw new RuleError(400, "session_closed", "晒程已完成，不可改参数");

  const negative = findNegative(items, s.negativeCode);
  const next = {
    light: patch.light ?? s.light,
    chemicalBatch: (patch.chemicalBatch ?? s.chemicalBatch).trim(),
    plateSize: (patch.plateSize ?? s.plateSize).trim()
  };
  if (!lightLevels[next.light]) throw new RuleError(400, "invalid_light", "光照档位必须是：" + LIGHT_KEYS.join("、"));

  const changed = next.light !== s.light || next.chemicalBatch !== s.chemicalBatch || next.plateSize !== s.plateSize;
  s.light = next.light;
  s.chemicalBatch = next.chemicalBatch;
  s.plateSize = next.plateSize;
  s.updatedAt = now;

  if (changed) {
    s.status = SessionStatus.RECHECK;
    s.issues = evaluateWithBatches(db, next, negative);
    s.exposure = { ...calcExposure(negative.exposure, next.light), valid: false };
    s.history.push({
      at: now,
      action: "参数修改",
      note: "结论失效，退回待复验" + (s.issues.length ? "；" + s.issues.join("；") : "")
    });
  }
  return s;
}

// 换晒架：先重查目标晒架占用；成功后同样退回待复验（本晒程结论失效）。
export function moveSessionRack(db, sessionId, newRackId, now = new Date().toISOString()) {
  const s = db.sessions.find(x => x.id === sessionId);
  if (!s) throw new RuleError(404, "session_not_found", "晒程不存在");
  if (s.status === SessionStatus.CLOSED) throw new RuleError(400, "session_closed", "晒程已完成，不可换晒架");
  newRackId = String(newRackId || "").trim();
  if (!findRack(db, newRackId)) throw new RuleError(400, "rack_not_found", "晒架不存在：" + newRackId);
  if (newRackId === s.rackId) throw new RuleError(400, "same_rack", "与当前晒架相同");

  // 重查占用：被占则 409，不改动任何数据
  const occupant = findOpenSessionOnRack(db, newRackId, s.id);
  if (occupant) throw new RuleError(409, "rack_occupied", `晒架 ${newRackId} 已被底片 ${occupant.negativeCode} 占用`);

  const old = s.rackId;
  s.rackId = newRackId;
  s.status = SessionStatus.RECHECK;
  s.updatedAt = now;
  s.exposure = { ...s.exposure, valid: false };
  s.history.push({ at: now, action: "换晒架", note: `${old} → ${newRackId}，重查占用后退回待复验` });
  return s;
}

// 待复验晒程重新查验：三关通过则重新占架、结论恢复有效；晒架被占则 409。
export function recheckSession(db, items, sessionId, now = new Date().toISOString()) {
  const s = db.sessions.find(x => x.id === sessionId);
  if (!s) throw new RuleError(404, "session_not_found", "晒程不存在");
  if (s.status !== SessionStatus.RECHECK) throw new RuleError(400, "not_recheck", "只有待复验晒程可以复验");
  const negative = findNegative(items, s.negativeCode);

  const issues = evaluateWithBatches(db,
    { chemicalBatch: s.chemicalBatch, plateSize: s.plateSize, light: s.light }, negative);
  if (issues.length) {
    s.issues = issues;
    s.updatedAt = now;
    s.history.push({ at: now, action: "复验", note: "仍未通过：" + issues.join("；") });
    return s;
  }

  const occupant = findOpenSessionOnRack(db, s.rackId, s.id);
  if (occupant) throw new RuleError(409, "rack_occupied", `晒架 ${s.rackId} 已被底片 ${occupant.negativeCode} 占用`);

  s.issues = [];
  s.status = SessionStatus.OPEN;
  s.exposure = { ...calcExposure(negative.exposure, s.light), valid: true };
  s.updatedAt = now;
  s.history.push({ at: now, action: "复验通过", note: `重新占用晒架 ${s.rackId}，${s.exposure.text}` });
  return s;
}

// 完成晒程：释放晒架
export function closeSession(db, sessionId, now = new Date().toISOString()) {
  const s = db.sessions.find(x => x.id === sessionId);
  if (!s) throw new RuleError(404, "session_not_found", "晒程不存在");
  if (s.status === SessionStatus.CLOSED) throw new RuleError(400, "session_closed", "晒程已完成");
  s.status = SessionStatus.CLOSED;
  s.exposure = { ...s.exposure, valid: false };
  s.closedAt = now;
  s.updatedAt = now;
  s.history.push({ at: now, action: "完成", note: `晒程结束，释放晒架 ${s.rackId}` });
  return s;
}

// —— 总览（给页面）——

export function rackOverview(db, items) {
  const racks = db.racks.map(r => {
    const s = findOpenSessionOnRack(db, r.id);
    return {
      ...r,
      occupied: Boolean(s),
      sessionId: s ? s.id : null,
      negativeCode: s ? s.negativeCode : null
    };
  });
  const sessions = [...db.sessions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const rackByName = id => db.racks.find(r => r.id === id)?.name || "";
  return {
    racks,
    chemicalBatches: db.chemicalBatches,
    sessions: sessions.map(s => decorate(s, items, rackByName)),
    lightLevels: Object.fromEntries(Object.entries(lightLevels).map(([k, v]) => [k, v.note]))
  };
}

function decorate(s, items, rackByName) {
  const negative = findNegative(items, s.negativeCode);
  return {
    ...s,
    rackName: rackByName(s.rackId),
    negativeLabel: negative ? `${negative.code} · ${negative.plateSize || ""}` : s.negativeCode
  };
}

// 供原底片建档复用：底片编号唯一
export function assertNegativeCodeUnique(items, code, exceptCode = null) {
  const dup = items.find(x => x.code === code && x.code !== exceptCode);
  if (dup) throw new RuleError(409, "negative_code_exists", "底片编号已存在：" + code);
}
