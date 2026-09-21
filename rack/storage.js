// 存储模块：蓝晒晒架占用与曝光补偿
// 职责：JSON 文件持久化、现有数据兼容迁移、串行写入队列（保证并发建程的原子性）。
// 不包含任何业务规则；业务规则全部放在 rules.js。
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";

export const DEFAULT_DB_PATH = new URL("../data/cyanotype-negative-room.json", import.meta.url).pathname;

const DEFAULTS = {
  items: [],
  racks: [],
  batches: [],
  sessions: [],
  rackSettings: { baseExposure: 8 }
};

// 晒程的初始配置数据：仅在集合缺失时写入，绝不覆盖已有内容。
const SEED_RACKS = [
  { id: "rack-a1", code: "晒架A-01", plateSize: "18x24cm", note: "南向窗位" },
  { id: "rack-a2", code: "晒架A-02", plateSize: "24x30cm", note: "北向窗位" },
  { id: "rack-a3", code: "晒架A-03", plateSize: "18x24cm", note: "备用" }
];
const SEED_BATCHES = [
  { code: "B-0620", factor: 1.0, active: true, note: "在用批次" },
  { code: "B-0518", factor: 1.1, active: true, note: "高感批次" },
  { code: "B-0310", factor: 0.9, active: false, note: "已停用", deactivatedAt: null }
];

export function nowIso() {
  return new Date().toISOString();
}

export class Storage {
  constructor(dbPath = process.env.RACK_DB_PATH || DEFAULT_DB_PATH) {
    this.dbPath = dbPath;
    this.queue = Promise.resolve();
  }

  async read() {
    return this.#load();
  }

  // 所有变更都走串行队列：上一条变更落盘后才处理下一条，
  // 因此并发建程中的占用判定与写入对其他请求不可见地交错。
  async mutate(fn) {
    const run = this.queue.then(async () => {
      const db = await this.#load();
      const result = await fn(db);
      await this.#write(db);
      return result;
    });
    // 让单个任务的失败不中断后续任务。
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  async #load() {
    if (!existsSync(this.dbPath)) {
      await mkdir(dirname(this.dbPath), { recursive: true });
      const seeded = { ...DEFAULTS, racks: SEED_RACKS, batches: SEED_BATCHES };
      await this.#write(seeded);
      return seeded;
    }
    const db = JSON.parse(await readFile(this.dbPath, "utf8"));
    let changed = false;
    for (const key of Object.keys(DEFAULTS)) {
      if (db[key] === undefined) {
        db[key] = key === "racks" ? SEED_RACKS : key === "batches" ? SEED_BATCHES : structuredClone(DEFAULTS[key]);
        changed = true;
      }
    }
    if (changed) await this.#write(db);
    return db;
  }

  async #write(db) {
    const tmp = this.dbPath + ".tmp";
    await writeFile(tmp, JSON.stringify(db, null, 2));
    await rename(tmp, this.dbPath); // 原子替换，刷新/崩溃不会读到半截文件
  }
}
