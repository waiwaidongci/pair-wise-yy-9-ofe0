// 晒架模块 —— 存储层
// 职责：晒架 / 药液批次 / 晒程数据的持久化，以及所有写操作的串行化。
// 不包含任何业务判定；业务规则见 rackRules.js。
// 数据独立成文件，原有底片数据 data/cyanotype-negative-room.json 不受影响。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "..", "data", "cyanotype-rack-room.json");

const seed = {
  "racks": [
    { "id": "R-01", "name": "1号晒架" },
    { "id": "R-02", "name": "2号晒架" },
    { "id": "R-03", "name": "3号晒架" },
    { "id": "R-04", "name": "4号晒架" }
  ],
  "chemicalBatches": [
    { "code": "B-0620", "active": true, "note": "本季新配，药力正常" },
    { "code": "B-0702", "active": true, "note": "备用批次" },
    { "code": "B-0518", "active": false, "note": "药力衰减，已停用" }
  ],
  "sessions": []
};

export async function loadRackDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
  }
  return JSON.parse(await readFile(dbPath, "utf8"));
}

export async function saveRackDb(db) {
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}

// 单进程写互斥：同一时刻只允许一个建程/改参事务读改写文件，
// 否则两个并发请求会都读到“晒架空闲”从而重复落库。
let chain = Promise.resolve();
export function withLock(task) {
  const run = chain.then(() => task());
  chain = run.then(() => {}, () => {});
  return run;
}

export function newSessionId() {
  return "SE-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
}
