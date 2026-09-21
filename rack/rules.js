// 业务规则模块：晒架占用与曝光补偿
// 所有业务判定集中在此处；storage.js 不做判断，view.js 只渲染。
import { nowIso } from "./storage.js";

// ---- 常量 / 字典 ----

// 晒程状态
// open     占用中：晒架被该晒程占用，结论可复晒
// pending  待复验：药液停用或尺寸不匹配，只登记不占晒架
// done     已完成：晒架释放，结论有效
export const SESSION_STATUS = { OPEN: "open", PENDING: "pending", DONE: "done" };
export const STATUS_LABEL = { open: "占用中", pending: "待复验", done: "已完成" };

export const PENDING_REASON_LABEL = {
  batch_inactive: "药液批次已停用",
  batch_unknown: "药液批次不存在",
  size_mismatch: "玻璃板尺寸与晒架不匹配"
};

// 光照条件 -> 相对正午直射光的光强系数与说明
export const LIGHTS = [
  { key: "sun", label: "正午直射阳光", factor: 1.0 },
  { key: "cloud_bright", label: "薄云 / 明亮散射光", factor: 0.75 },
  { key: "cloud", label: "多云", factor: 0.55 },
  { key: "overcast", label: "阴天", factor: 0.35 },
  { key: "indoor", label: "室内补光 UV 灯", factor: 0.25 }
];
export const LIGHT_FACTOR = Object.fromEntries(LIGHTS.map(l => [l.key, l.factor]));
export const DEFAULT_LIGHT = "cloud";

// 可编辑的晒程参数：改这些会让结论失效
export const SESSION_PARAM_KEYS = ["light", "batchCode", "plateSize", "rackCode", "baseExposure"];

export class RuleError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message || code);
    this.status = status;
    this.code = code;
    Object.assign(this, extra);
  }
}

export function newSessionId() {
  return "SS-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
}

// ---- 曝光补偿 ----
// 基准曝光 × 光照补偿 × 药液系数。光越弱、药液感度越低，时间越长。
export function computeExposure(light, batchFactor, baseExposure) {
  const lightFactor = Object.prototype.hasOwnProperty.call(LIGHT_FACTOR, light)
    ? LIGHT_FACTOR[light]
    : null;
  if (lightFactor === null) throw new RuleError(400, "invalid_light", "光照条件不在字典内");
  const base = Number(baseExposure);
  if (!Number.isFinite(base) || base <= 0) throw new RuleError(400, "invalid_base_exposure", "基准曝光必须为正数");
  const bFactor = Number(batchFactor);
  if (!Number.isFinite(bFactor) || bFactor <= 0) throw new RuleError(400, "invalid_batch_factor", "药液系数必须为正数");
  const seconds = Math.round((base * 60 * (1 / lightFactor) * bFactor) / 5) * 5; // 取整到 5 秒
  return {
    baseMinutes: base,
    lightFactor,
    batchFactor: bFactor,
    compensatedSeconds: seconds,
    compensatedText: `${Math.floor(seconds / 60)}分${seconds % 60 ? seconds % 60 + "秒" : ""}`
  };
}

// ---- 查询辅助 ----

export const openSessions = db => (db.sessions || []).filter(s => s.status === SESSION_STATUS.OPEN);
const byCode = (list, code) => list.find(x => x.code === code);
const byId = (list, id) => list.find(x => x.id === id);

export function findNegative(db, code) {
  return byCode(db.items || [], code);
}
export function findRack(db, code) {
  return byCode(db.racks || [], code);
}
export function findBatch(db, code) {
  return byCode(db.batches || [], code);
}
export function findSession(db, id) {
  return byId(db.sessions || [], id);
}

// 同一晒架在一个开放晒程内只接一张
export function rackOccupier(db, rackCode, exceptSessionId = null) {
  return openSessions(db).find(s => s.rackCode === rackCode && s.id !== exceptSessionId) || null;
}
// 每张底片按编号唯一，同一开放晒程内也只允许一张
export function negativeOpenSession(db, negativeCode, exceptSessionId = null) {
  return openSessions(db).find(s => s.negativeCode === negativeCode && s.id !== exceptSessionId) || null;
}

// 待复验原因（按优先级），无原因则可占用
export function pendingReason(db, { rackCode, plateSize, batchCode }) {
  const rack = findRack(db, rackCode);
  if (!rack) throw new RuleError(404, "rack_not_found", "晒架不存在");
  const batch = findBatch(db, batchCode);
  if (!batch) return "batch_unknown";
  if (!batch.active) return "batch_inactive";
  if (plateSize !== rack.plateSize) return "size_mismatch";
  return null;
}

function event(at, type, note) {
  return { at, type, note };
}

// ---- 晒程视图 ----

export function sessionView(db, s) {
  const rack = findRack(db, s.rackCode);
  const batch = findBatch(db, s.batchCode);
  const negative = findNegative(db, s.negativeCode);
  return {
    ...s,
    statusLabel: STATUS_LABEL[s.status],
    pendingReasonLabel: s.pendingReason ? PENDING_REASON_LABEL[s.pendingReason] : null,
    rackLabel: rack ? rack.code : s.rackCode,
    rackPlateSize: rack ? rack.plateSize : null,
    batchActive: batch ? batch.active : false,
    negativeExists: Boolean(negative)
  };
}

export function board(db) {
  return {
    baseExposure: db.rackSettings.baseExposure,
    lights: LIGHTS,
    batches: db.batches,
    racks: db.racks.map(r => ({
      ...r,
      occupiedBy: (() => {
        const o = rackOccupier(db, r.code);
        return o ? { id: o.id, negativeCode: o.negativeCode, compensatedText: o.exposure ? o.exposure.compensatedText : "待复验补算" } : null;
      })()
    })),
    sessions: db.sessions.map(s => sessionView(db, s))
  };
}

// ---- 建程 ----
// 返回 { status, session }；冲突抛 RuleError(409) 且由调用方保证不落库。
export function openSession(db, input = {}) {
  const negativeCode = String(input.negativeCode || "").trim();
  const rackCode = String(input.rackCode || "").trim();
  const light = String(input.light || DEFAULT_LIGHT);
  const batchCode = String(input.batchCode || "").trim();
  const plateSize = String(input.plateSize || "").trim();
  const baseExposure = input.baseExposure !== undefined ? input.baseExposure : db.rackSettings.baseExposure;
  const note = String(input.note || "").trim();

  if (!negativeCode) throw new RuleError(400, "missing_negative", "缺少底片编号");
  if (!rackCode) throw new RuleError(400, "missing_rack", "缺少晒架");
  if (!batchCode) throw new RuleError(400, "missing_batch", "缺少药液批次");
  if (!plateSize) throw new RuleError(400, "missing_plate_size", "缺少玻璃板尺寸");
  if (!findNegative(db, negativeCode)) throw new RuleError(404, "negative_not_found", "底片编号未登记");

  // 唯一性冲突优先判定：重复并发建程在进入任何写入前返回 409。
  const rackHolder = rackOccupier(db, rackCode);
  if (rackHolder) {
    throw new RuleError(409, "rack_occupied", "该晒架在一个开放晒程内只接一张", {
      holderId: rackHolder.id, holderNegative: rackHolder.negativeCode
    });
  }
  const negHolder = negativeOpenSession(db, negativeCode);
  if (negHolder) {
    throw new RuleError(409, "negative_in_open_session", "该底片已在一个开放晒程内", {
      holderId: negHolder.id
    });
  }

  const rack = findRack(db, rackCode); // 存在性由 pendingReason 校验，这里提前给出明确 404
  if (!rack) throw new RuleError(404, "rack_not_found", "晒架不存在");
  const batch = findBatch(db, batchCode); // 批次可能尚不存在：按待复验登记

  const reason = pendingReason(db, { rackCode, plateSize, batchCode });
  // 未知批次没有感度系数，补偿曝光留待复验通过后补算。
  const exposure = batch ? computeExposure(light, batch.factor, baseExposure) : null;
  const at = nowIso();
  const session = {
    id: newSessionId(),
    negativeCode,
    rackCode,
    plateSize,
    light,
    batchCode,
    baseExposure: Number(baseExposure),
    exposure,
    status: reason ? SESSION_STATUS.PENDING : SESSION_STATUS.OPEN,
    pendingReason: reason,
    revision: 1,
    conclusion: null,
    note,
    createdAt: at,
    updatedAt: at,
    events: [
      event(at, "created", reason
        ? `建程登记，${PENDING_REASON_LABEL[reason]}，进入待复验（不占晒架）`
        : `建程占用晒架，按基准 ${baseExposure} 分钟补偿为 ${exposure.compensatedText}`)
    ]
  };
  db.sessions.unshift(session);
  return session;
}

// ---- 复验：待复验 -> 占用中 ----
export function reverifySession(db, id) {
  const s = findSession(db, id);
  if (!s) throw new RuleError(404, "session_not_found", "晒程不存在");
  if (s.status === SESSION_STATUS.DONE) throw new RuleError(400, "session_done", "已完成的晒程不能复验");
  if (s.status === SESSION_STATUS.OPEN) throw new RuleError(400, "session_open", "晒程已占用，无需复验");

  // 重新查占用——换晒架/期间被占用都要重查
  const holder = rackOccupier(db, s.rackCode, s.id);
  if (holder) {
    throw new RuleError(409, "rack_occupied", "晒架现已被占用，需换晒架", {
      holderId: holder.id, holderNegative: holder.negativeCode
    });
  }
  const reason = pendingReason(db, { rackCode: s.rackCode, plateSize: s.plateSize, batchCode: s.batchCode });
  if (reason) {
    s.pendingReason = reason;
    s.updatedAt = nowIso();
    s.events.push(event(s.updatedAt, "reverify_failed", `复验未通过：${PENDING_REASON_LABEL[reason]}`));
    throw new RuleError(409, "still_pending", `复验未通过：${PENDING_REASON_LABEL[reason]}`, { reason });
  }
  const batch = findBatch(db, s.batchCode);
  s.status = SESSION_STATUS.OPEN;
  s.pendingReason = null;
  s.exposure = computeExposure(s.light, batch.factor, s.baseExposure);
  s.updatedAt = nowIso();
  s.events.push(event(s.updatedAt, "reverified", `复验通过，占用晒架，补偿曝光 ${s.exposure.compensatedText}`));
  return s;
}

// ---- 完成晒程：释放晒架，登记结论 ----
export function completeSession(db, id, input = {}) {
  const s = findSession(db, id);
  if (!s) throw new RuleError(404, "session_not_found", "晒程不存在");
  if (s.status === SESSION_STATUS.DONE) throw new RuleError(400, "session_done", "晒程已完成");
  if (s.status === SESSION_STATUS.PENDING) throw new RuleError(400, "session_pending", "待复验晒程不能完成");
  const result = String(input.result || "合格").trim();
  const actualSeconds = input.actualSeconds !== undefined && input.actualSeconds !== ""
    ? Math.max(0, Math.round(Number(input.actualSeconds))) : s.exposure.compensatedSeconds;
  const note = String(input.note || "").trim();
  s.status = SESSION_STATUS.DONE;
  s.conclusion = {
    result,
    actualSeconds,
    actualText: `${Math.floor(actualSeconds / 60)}分${actualSeconds % 60 ? actualSeconds % 60 + "秒" : ""}`,
    at: nowIso(),
    note,
    valid: true,
    invalidatedBy: null
  };
  s.updatedAt = nowIso();
  s.events.push(event(s.updatedAt, "completed", `晒程完成，结论：${result}`));
  return s;
}

// ---- 改参数：结论失效并退回待复验；换晒架重查占用 ----
export function updateSession(db, id, patch = {}) {
  const s = findSession(db, id);
  if (!s) throw new RuleError(404, "session_not_found", "晒程不存在");
  if (s.status === SESSION_STATUS.DONE) throw new RuleError(400, "session_done", "已完成的晒程请新建晒程");

  const changes = {};
  for (const key of SESSION_PARAM_KEYS) {
    if (patch[key] !== undefined) {
      const value = key === "baseExposure" ? Number(patch[key]) : String(patch[key]).trim();
      if (key === "baseExposure" && (!Number.isFinite(value) || value <= 0)) {
        throw new RuleError(400, "invalid_base_exposure", "基准曝光必须为正数");
      }
      if (key !== "baseExposure" && !value) throw new RuleError(400, "empty_param", `${key} 不能为空`);
      changes[key] = value;
    }
  }
  if (patch.note !== undefined) s.note = String(patch.note).trim();
  if (Object.keys(changes).length === 0) return s;

  if (changes.light && !Object.prototype.hasOwnProperty.call(LIGHT_FACTOR, changes.light)) {
    throw new RuleError(400, "invalid_light", "光照条件不在字典内");
  }
  if (changes.batchCode && !findBatch(db, changes.batchCode)) {
    throw new RuleError(404, "batch_not_found", "药液批次不存在");
  }
  const nextRackCode = changes.rackCode || s.rackCode;
  if (!findRack(db, nextRackCode)) throw new RuleError(404, "rack_not_found", "晒架不存在");

  // 换晒架必须重查占用（排除自身）。
  if (changes.rackCode && changes.rackCode !== s.rackCode) {
    const holder = rackOccupier(db, nextRackCode, s.id);
    if (holder) {
      throw new RuleError(409, "rack_occupied", "目标晒架已被占用", {
        holderId: holder.id, holderNegative: holder.negativeCode
      });
    }
  }

  Object.assign(s, changes);

  // 改基准曝光/光照/药液会改变补偿值；未知批次时留待复验补算。
  const batch = findBatch(db, s.batchCode);
  s.exposure = batch ? computeExposure(s.light, batch.factor, s.baseExposure) : null;
  s.revision += 1;

  // 参数变化后结论/占用状态一律不再可信：退回待复验并重新判定。
  // open 时旧晒架随状态退回而立即释放；pending 时本就未占用。
  const reason = pendingReason(db, { rackCode: s.rackCode, plateSize: s.plateSize, batchCode: s.batchCode });
  s.status = SESSION_STATUS.PENDING;
  s.pendingReason = reason;
  s.conclusion = null;
  s.updatedAt = nowIso();
  const labels = {
    light: "光照", batchCode: "药液批次", plateSize: "玻璃板尺寸",
    rackCode: "晒架", baseExposure: "基准曝光"
  };
  const desc = Object.keys(changes).map(k => `${labels[k]}→${changes[k]}`).join("，");
  s.events.push(event(s.updatedAt, "params_changed", `参数修改（${desc}），结论失效，退回待复验${reason ? "：" + PENDING_REASON_LABEL[reason] : "，等待复验"}`));
  return s;
}

// ---- 删除 / 取消晒程：释放晒架 ----
export function deleteSession(db, id) {
  const idx = db.sessions.findIndex(x => x.id === id);
  if (idx === -1) throw new RuleError(404, "session_not_found", "晒程不存在");
  const [removed] = db.sessions.splice(idx, 1);
  return removed; // open 删除即释放占用；pending 本不占用
}

// ---- 晒架管理 ----
export function addRack(db, input = {}) {
  const code = String(input.code || "").trim();
  const plateSize = String(input.plateSize || "").trim();
  if (!code) throw new RuleError(400, "missing_rack_code", "缺少晒架编号");
  if (!plateSize) throw new RuleError(400, "missing_plate_size", "缺少玻璃板尺寸");
  if (findRack(db, code)) throw new RuleError(409, "rack_exists", "晒架编号已存在");
  const rack = {
    id: "rack-" + Buffer.from(code).toString("hex").slice(0, 10) + "-" + Math.random().toString(36).slice(2, 5),
    code,
    plateSize,
    note: String(input.note || "").trim()
  };
  db.racks.push(rack);
  return rack;
}

export function deleteRack(db, code) {
  const rack = findRack(db, code);
  if (!rack) throw new RuleError(404, "rack_not_found", "晒架不存在");
  // 只要有晒程（占用中或待复验）引用就不允许删除
  const ref = (db.sessions || []).find(s => s.rackCode === code && s.status !== SESSION_STATUS.DONE);
  if (ref) throw new RuleError(409, "rack_in_use", "该晒架有未结束晒程，不能删除", { sessionId: ref.id });
  db.racks = db.racks.filter(r => r.code !== code);
  return rack;
}

// ---- 药液批次管理 ----
export function addBatch(db, input = {}) {
  const code = String(input.code || "").trim();
  const factor = Number(input.factor);
  if (!code) throw new RuleError(400, "missing_batch_code", "缺少药液批次号");
  if (!Number.isFinite(factor) || factor <= 0) throw new RuleError(400, "invalid_batch_factor", "药液系数必须为正数");
  if (findBatch(db, code)) throw new RuleError(409, "batch_exists", "药液批次已存在");
  const batch = {
    code,
    factor,
    active: input.active !== false,
    note: String(input.note || "").trim(),
    deactivatedAt: null
  };
  db.batches.push(batch);
  return batch;
}

export function deactivateBatch(db, code) {
  const batch = findBatch(db, code);
  if (!batch) throw new RuleError(404, "batch_not_found", "药液批次不存在");
  batch.active = false;
  batch.deactivatedAt = nowIso();
  return batch;
}

// ---- 全局基准曝光 ----
export function updateSettings(db, patch = {}) {
  if (patch.baseExposure !== undefined) {
    const base = Number(patch.baseExposure);
    if (!Number.isFinite(base) || base <= 0) throw new RuleError(400, "invalid_base_exposure", "基准曝光必须为正数");
    db.rackSettings.baseExposure = base;
  }
  return db.rackSettings;
}

// ---- 底片登记（保留旧页面；每张底片按编号唯一）----
export function addNegative(db, input = {}) {
  const code = String(input.code || "").trim();
  if (!code) throw new RuleError(400, "code_required", "底片编号必填");
  if (findNegative(db, code)) throw new RuleError(409, "negative_exists", "底片编号已存在");
  const item = {
    id: "CN-" + Date.now(),
    ...input,
    code,
    logs: [{ at: nowIso(), step: "建档", note: "创建底片" }]
  };
  db.items.unshift(item);
  return item;
}
