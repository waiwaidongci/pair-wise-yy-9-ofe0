// 端到端规则验证：启动临时数据目录的服务，覆盖全部业务规则。
import { spawn } from "node:child_process";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = await mkdtemp(join(tmpdir(), "rack-test-"));
const dbFile = join(dir, "test-db.json");
// 以真实的旧数据（仅 items）作为初始库，启动后由存储层迁移补齐 racks/batches。
const legacyData = await readFile(new URL("../data/cyanotype-negative-room.json", import.meta.url), "utf8");
await writeFile(dbFile, legacyData);
const srv = spawn(process.execPath, [new URL("../server.js", import.meta.url).pathname], {
  env: { ...process.env, PORT: "3999", RACK_DB_PATH: dbFile }
});
const logs = [];
srv.stdout.on("data", d => logs.push(d.toString()));
srv.stderr.on("data", d => logs.push(d.toString()));

const BASE = "http://127.0.0.1:3999";
let pass = 0, fail = 0;
function ok(name, cond, extra = "") {
  if (cond) { pass++; console.log("  ✓", name); }
  else { fail++; console.log("  ✗ FAIL:", name, extra); }
}
async function j(path, opts = {}) {
  const res = await fetch(BASE + path, opts.body ? { ...opts, headers: { "Content-Type": "application/json" } } : opts);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(600);

try {
  // 0. 现有数据/页面保留
  const items = await j("/api/items");
  ok("现有底片数据保留", items.status === 200 && items.data.some(i => i.code === "CN-001"));
  const home = await fetch(BASE + "/").then(r => r.text());
  ok("旧页面保留且含入口", home.includes("古法蓝晒底片整理室") && home.includes("/rack"));
  const page = await fetch(BASE + "/rack").then(r => r.text());
  ok("晒架页面可访问", page.includes("蓝晒晒架占用与曝光补偿"));

  // 1. 底片编号唯一（旧接口也约束）
  const dup = await j("/api/items", { method: "POST", body: JSON.stringify({ code: "CN-001", plateSize: "18x24cm" }) });
  ok("重复底片编号返回409", dup.status === 409 && dup.data.code === "negative_exists", JSON.stringify(dup.data));
  const n2 = await j("/api/items", { method: "POST", body: JSON.stringify({ code: "CN-002", plateSize: "24x30cm", chemicalBatch: "B-0620", status: "待曝光" }) });
  const n3 = await j("/api/items", { method: "POST", body: JSON.stringify({ code: "CN-003", plateSize: "18x24cm", chemicalBatch: "B-0620", status: "待曝光" }) });
  ok("可登记新底片", n2.status === 201 && n3.status === 201);

  // 2. 正常建程：占用晒架 + 补偿曝光（多云 0.55，B-0620 1.0，基准8分）
  // 480 / 0.55 = 872.7 -> 取整5秒 = 875秒 = 14分35秒
  const s1 = await j("/rack/api/sessions", { method: "POST", body: JSON.stringify({ negativeCode: "CN-001", rackCode: "晒架A-01", plateSize: "18x24cm", light: "cloud", batchCode: "B-0620" }) });
  ok("正常建程201且占用中", s1.status === 201 && s1.data.status === "open", JSON.stringify(s1.data));
  ok("补偿曝光=14分35秒(875s)", s1.data.exposure.compensatedSeconds === 875, String(s1.data.exposure.compensatedSeconds));

  // 3. 并发重复建程：同晒架与同底片都必须 409 且只落库一张
  const conf = await Promise.all([
    j("/rack/api/sessions", { method: "POST", body: JSON.stringify({ negativeCode: "CN-002", rackCode: "晒架A-01", plateSize: "24x30cm", light: "sun", batchCode: "B-0620" }) }),
    j("/rack/api/sessions", { method: "POST", body: JSON.stringify({ negativeCode: "CN-003", rackCode: "晒架A-01", plateSize: "18x24cm", light: "sun", batchCode: "B-0620" }) }),
    j("/rack/api/sessions", { method: "POST", body: JSON.stringify({ negativeCode: "CN-001", rackCode: "晒架A-02", plateSize: "18x24cm", light: "sun", batchCode: "B-0620" }) })
  ]);
  ok("并发同晒架重复建程全部409", conf[0].status === 409 && conf[1].status === 409, JSON.stringify(conf.map(c => c.status)));
  ok("并发同底片(另一架)也409", conf[2].status === 409 && conf[2].data.code === "negative_in_open_session", JSON.stringify(conf[2].data));
  const board1 = await j("/rack/api/board");
  ok("冲突请求未额外落库(仍只1张)", board1.data.sessions.length === 1, String(board1.data.sessions.length));
  const rackA01 = board1.data.racks.find(r => r.code === "晒架A-01");
  ok("占用板反映晒架A-01被CN-001占用", rackA01.occupiedBy && rackA01.occupiedBy.negativeCode === "CN-001");

  // 4. 药液停用 -> 待复验，不占晒架
  const s2 = await j("/rack/api/sessions", { method: "POST", body: JSON.stringify({ negativeCode: "CN-002", rackCode: "晒架A-02", plateSize: "24x30cm", light: "cloud", batchCode: "B-0310" }) });
  ok("停用药液建程为待复验", s2.status === 201 && s2.data.status === "pending" && s2.data.pendingReason === "batch_inactive", JSON.stringify(s2.data));
  const board2 = await j("/rack/api/board");
  ok("待复验不占晒架(A-02空闲)", !board2.data.racks.find(r => r.code === "晒架A-02").occupiedBy);
  // 未占用，另一底片可正常占用 A-02
  const s3 = await j("/rack/api/sessions", { method: "POST", body: JSON.stringify({ negativeCode: "CN-003", rackCode: "晒架A-02", plateSize: "24x30cm", light: "cloud", batchCode: "B-0620" }) });
  ok("待复验不占架，他片可占用A-02", s3.status === 201 && s3.data.status === "open");

  // 5. 尺寸不匹配 -> 待复验
  const n4 = (await j("/api/items", { method: "POST", body: JSON.stringify({ code: "CN-004", plateSize: "18x24cm", status: "待曝光" }) })).data;
  const s4 = await j("/rack/api/sessions", { method: "POST", body: JSON.stringify({ negativeCode: "CN-004", rackCode: "晒架A-03", plateSize: "24x30cm", light: "sun", batchCode: "B-0620" }) });
  ok("尺寸不匹配进入待复验", s4.status === 201 && s4.data.status === "pending" && s4.data.pendingReason === "size_mismatch", JSON.stringify(s4.data));
  const board3 = await j("/rack/api/board");
  ok("尺寸不匹配不占晒架(A-03空闲)", !board3.data.racks.find(r => r.code === "晒架A-03").occupiedBy);

  // 待复验直接完成应被拒绝
  const badComplete = await j(`/rack/api/sessions/${s2.data.id}/complete`, { method: "POST", body: JSON.stringify({ result: "合格" }) });
  ok("待复验不能完成(400)", badComplete.status === 400);

  // 6. 复验失败 -> 仍待复验（409，不占架）。此时 A-02 已被 s3 占用，应按占用重查报 409。
  const rvFail = await j(`/rack/api/sessions/${s2.data.id}/reverify`, { method: "POST" });
  ok("复验时晒架被占返回409", rvFail.status === 409 && rvFail.data.code === "rack_occupied", JSON.stringify(rvFail.data));
  // 换到空闲晒架 A-03（待复验换架不占架），但药液仍停用 -> still_pending
  await j(`/rack/api/sessions/${s2.data.id}`, { method: "PATCH", body: JSON.stringify({ rackCode: "晒架A-03", plateSize: "18x24cm" }) });
  const rvFail2 = await j(`/rack/api/sessions/${s2.data.id}/reverify`, { method: "POST" });
  ok("空闲架但药液停用复验仍409(待复验)", rvFail2.status === 409 && rvFail2.data.code === "still_pending", JSON.stringify(rvFail2.data));
  // s2 换回 A-02 保持待复验，避免占用随后 s4 要复验的 A-03
  await j(`/rack/api/sessions/${s2.data.id}`, { method: "PATCH", body: JSON.stringify({ rackCode: "晒架A-02", plateSize: "24x30cm" }) });
  // 改尺寸后复验通过 -> 占用 A-03
  const fixed = await j(`/rack/api/sessions/${s4.data.id}`, { method: "PATCH", body: JSON.stringify({ plateSize: "18x24cm" }) });
  ok("改参数后退回待复验", fixed.data.status === "pending" && fixed.data.revision === 2);
  const rvOk = await j(`/rack/api/sessions/${s4.data.id}/reverify`, { method: "POST" });
  ok("复验通过转为占用中", rvOk.status === 200 && rvOk.data.status === "open");

  // 7. 晒程后改参数 -> 完成结论失效并退回待复验
  const done = await j(`/rack/api/sessions/${s1.data.id}/complete`, { method: "POST", body: JSON.stringify({ result: "合格", actualSeconds: 870 }) });
  ok("完成晒程登记结论并释放架", done.data.status === "done" && done.data.conclusion.valid);
  const board4 = await j("/rack/api/board");
  ok("完成后A-01释放空闲", !board4.data.racks.find(r => r.code === "晒架A-01").occupiedBy);
  // 完成的晒程不允许再改参数
  const editDone = await j(`/rack/api/sessions/${s1.data.id}`, { method: "PATCH", body: JSON.stringify({ light: "sun" }) });
  ok("已完成晒程不可改参数(400)", editDone.status === 400);

  // 对占用中的 s3 改光照 -> 结论流程：释放 A-02 并退回待复验（光照仍是有效药液/尺寸 -> pending reason null）
  const upd = await j(`/rack/api/sessions/${s3.data.id}`, { method: "PATCH", body: JSON.stringify({ light: "sun" }) });
  ok("占用中改参数退回待复验", upd.data.status === "pending" && upd.data.revision === 2, JSON.stringify(upd.data));
  const board5 = await j("/rack/api/board");
  ok("改参数后A-02释放重查占用", !board5.data.racks.find(r => r.code === "晒架A-02").occupiedBy);

  // 8. 换晒架重查占用：现在让 CN-004 占 A-03；s3 改到 A-03 应 409
  const swapBusy = await j(`/rack/api/sessions/${s3.data.id}`, { method: "PATCH", body: JSON.stringify({ rackCode: "晒架A-03", plateSize: "18x24cm" }) });
  ok("换到被占晒架返回409", swapBusy.status === 409 && swapBusy.data.code === "rack_occupied", JSON.stringify(swapBusy.data));
  // 换到空闲且尺寸匹配的 A-01（18x24）后仍是待复验
  const swapOk = await j(`/rack/api/sessions/${s3.data.id}`, { method: "PATCH", body: JSON.stringify({ rackCode: "晒架A-01", plateSize: "18x24cm" }) });
  ok("换到空闲匹配晒架后待复验", swapOk.status === 200 && swapOk.data.rackCode === "晒架A-01");
  const rv3 = await j(`/rack/api/sessions/${s3.data.id}/reverify`, { method: "POST" });
  ok("复验后占用A-01", rv3.data.status === "open" && rv3.data.rackCode === "晒架A-01");

  // 9. 删除占用中晒程释放架
  const del = await j(`/rack/api/sessions/${s4.data.id}`, { method: "DELETE" });
  ok("删除晒程200", del.status === 200);
  const board6 = await j("/rack/api/board");
  ok("删除后A-03释放", !board6.data.racks.find(r => r.code === "晒架A-03").occupiedBy);

  // 10. 晒架删除保护
  const rackDel = await j("/rack/api/racks/" + encodeURIComponent("晒架A-01"), { method: "DELETE" });
  ok("有开放晒程的晒架不能删(409)", rackDel.status === 409);

  // 11. 不存在底片/晒架
  const noNeg = await j("/rack/api/sessions", { method: "POST", body: JSON.stringify({ negativeCode: "CN-999", rackCode: "晒架A-03", plateSize: "18x24cm", light: "sun", batchCode: "B-0620" }) });
  ok("未登记底片404", noNeg.status === 404);

  // 12. 未知药液 -> 待复验（batch_unknown）
  const s5 = await j("/rack/api/sessions", { method: "POST", body: JSON.stringify({ negativeCode: "CN-004", rackCode: "晒架A-03", plateSize: "18x24cm", light: "sun", batchCode: "B-9999" }) });
  ok("未知药液进待复验", s5.data.status === "pending" && s5.data.pendingReason === "batch_unknown");

  // 13. 刷新一致：重新读取磁盘文件，事件与状态持久
  const onDisk = JSON.parse(await readFile(dbFile, "utf8"));
  ok("数据落盘且含sessions/racks/batches", Array.isArray(onDisk.sessions) && onDisk.racks.length >= 3 && onDisk.batches.length >= 3);
  ok("原items未被破坏", onDisk.items.some(i => i.code === "CN-001" && i.status === "待入盒"));
  const persisted = onDisk.sessions.find(x => x.id === s3.data.id);
  ok("晒程revision/事件持久化", persisted.revision >= 2 && persisted.events.length >= 3, String(persisted && persisted.events.length));

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  if (fail) { console.log(logs.join("\n")); process.exitCode = 1; }
} catch (e) {
  console.error("测试异常：", e);
  console.log(logs.join("\n"));
  process.exitCode = 1;
} finally {
  srv.kill("SIGTERM");
  await rm(dir, { recursive: true, force: true });
}
