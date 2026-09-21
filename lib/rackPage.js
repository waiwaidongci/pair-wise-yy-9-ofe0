// 晒架模块 —— 页面层
// 职责：只负责 /racks 页面的渲染与前端交互；不包含业务判定，数据全部来自 /api/rack-room。
export function rackPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>蓝晒晒架占用与曝光补偿</title>
  <style>
    :root { --bg:#eef1f4; --panel:#fff; --ink:#1f2933; --muted:#64717d; --line:#cfd8e0; --accent:#2b5d8a; --warn:#9b4937; --ok:#3e7a4f; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:20px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:24px; } h2 { margin:0 0 12px; font-size:17px; } main { display:grid; grid-template-columns:400px 1fr; gap:20px; padding:20px 28px; align-items:start; }
    form,.panel,.card,.stat { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:15px; }
    label { display:block; margin:9px 0 4px; color:var(--muted); font-size:13px; } input,select { width:100%; border:1px solid var(--line); border-radius:6px; padding:8px; font:inherit; background:#fff; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:8px 12px; font-weight:700; cursor:pointer; margin:4px 4px 0 0; }
    button.secondary { background:#64717d; } button.warn { background:var(--warn); } button.ok { background:var(--ok); } button.mini { padding:5px 9px; font-size:12px; margin:2px 3px 0 0; }
    .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:10px; margin-bottom:14px; } .stat strong { display:block; font-size:23px; }
    .rackgrid { display:grid; grid-template-columns:repeat(auto-fill,minmax(170px,1fr)); gap:11px; margin-bottom:16px; }
    .rack { border:1px solid var(--line); border-radius:8px; padding:12px; } .rack.busy { border-color:var(--warn); background:#fbf2f0; } .rack.free { border-color:var(--ok); background:#f1f7f2; }
    .card { display:grid; gap:7px; margin-bottom:12px; }
    .meta { color:var(--muted); font-size:13px; } .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:2px 9px; font-size:12px; }
    .pill.open { background:#e8f0f8; color:var(--accent); border-color:var(--accent); } .pill.recheck { background:#fdf3e3; color:#8a5a1f; border-color:#c8923f; } .pill.closed { background:#eef0f1; color:var(--muted); }
    .issues { color:var(--warn); font-size:13px; font-weight:700; } .invalid { text-decoration:line-through; color:var(--muted); }
    .history { border-top:1px solid var(--line); padding-top:7px; max-height:96px; overflow:auto; } .inline { display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-top:6px; }
    .inline select { width:auto; flex:1; min-width:120px; }
    a.back { color:var(--accent); text-decoration:none; font-weight:700; }
    @media (max-width:900px){ header{display:block;padding:16px;} main{grid-template-columns:1fr;padding:14px;} }
  </style>
</head>
<body>
  <header>
    <div><h1>蓝晒晒架占用与曝光补偿</h1><div class="meta">每底片唯一 · 同一开放晒程一架一张 · 停用药液/尺寸不符只进待复验</div></div>
    <div><a class="back" href="/">← 回底片整理室</a> &nbsp; <button id="reload" class="secondary">刷新</button></div>
  </header>
  <main>
    <section>
      <form id="createForm">
        <h2>建立晒程</h2>
        <label>底片（按编号唯一）</label><select name="negativeCode" id="negSelect" required></select>
        <label>晒架</label><select name="rackId" id="rackSelect" required></select>
        <label>光照（按底片基准曝光补偿）</label><select name="light" id="lightSelect"></select>
        <label>药液批次</label><select name="chemicalBatch" id="batchSelect"></select>
        <label>玻璃板尺寸</label><input name="plateSize" id="plateInput" required placeholder="如 18x24cm">
        <div class="meta" id="hint" style="margin-top:8px"></div>
        <button style="margin-top:10px">建程</button>
      </form>
      <div class="panel" style="margin-top:14px">
        <h2>药液批次</h2><div id="batches"></div>
      </div>
    </section>
    <section>
      <div class="stats" id="stats"></div>
      <div class="panel"><h2>晒架占用</h2><div class="rackgrid" id="racks"></div></div>
      <div class="panel" style="margin-top:14px"><h2>晒程</h2><div id="sessions"></div></div>
    </section>
  </main>
  <script>
    let overview = null;
    let items = [];
    async function api(path, options) {
      const res = await fetch(path, options && options.body ? { ...options, headers: { 'Content-Type': 'application/json' } } : options);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || ('请求失败 ' + res.status));
      return data;
    }
    function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
    function negByCode(code) { return items.find(i => i.code === code); }

    function renderForms() {
      const neg = document.querySelector('#negSelect');
      neg.innerHTML = '<option value="">选择底片…</option>' + items.map(i => '<option value="' + esc(i.code) + '">' + esc(i.code + ' · ' + (i.plateSize || '') + ' · 基准' + (i.exposure || '?')) + '</option>').join('');
      document.querySelector('#rackSelect').innerHTML = overview.racks.map(r => '<option value="' + esc(r.id) + '">' + esc(r.id + ' ' + r.name + (r.occupied ? '（占用中）' : '')) + '</option>').join('');
      document.querySelector('#lightSelect').innerHTML = Object.entries(overview.lightLevels).map(([k, v]) => '<option value="' + esc(k) + '">' + esc(k + ' — ' + v) + '</option>').join('');
      document.querySelector('#batchSelect').innerHTML = overview.chemicalBatches.map(b => '<option value="' + esc(b.code) + '">' + esc(b.code + (b.active ? '' : '（已停用）')) + '</option>').join('');
      document.querySelector('#batches').innerHTML = overview.chemicalBatches.map(b =>
        '<div class="inline"><span style="flex:1"><b>' + esc(b.code) + '</b> ' + (b.active ? '<span style="color:var(--ok)">启用</span>' : '<span class="warn">停用</span>') + '<div class="meta">' + esc(b.note || '') + '</div></span>' +
        '<button class="mini secondary" data-batch="' + esc(b.code) + '" data-active="' + (b.active ? '0' : '1') + '">' + (b.active ? '停用' : '启用') + '</button></div>').join('');
    }

    function renderRacks() {
      document.querySelector('#racks').innerHTML = overview.racks.map(r =>
        '<div class="rack ' + (r.occupied ? 'busy' : 'free') + '"><b>' + esc(r.id + ' ' + r.name) + '</b><div class="meta">' +
        (r.occupied ? '占用：' + esc(r.negativeCode) + '（' + esc(r.sessionId) + '）' : '空闲') + '</div></div>').join('');
      const open = overview.sessions.filter(s => s.status === '开放中').length;
      const recheck = overview.sessions.filter(s => s.status === '待复验').length;
      const closed = overview.sessions.filter(s => s.status === '已完成').length;
      document.querySelector('#stats').innerHTML = [['晒架总数', overview.racks.length], ['已占用', overview.racks.filter(r => r.occupied).length], ['开放晒程', open], ['待复验', recheck], ['已完成', closed]]
        .map(([k, v]) => '<div class="stat"><span>' + k + '</span><strong>' + v + '</strong></div>').join('');
    }

    function sessionHtml(s) {
      const exp = s.exposure || {};
      const expBlock = exp.adjustedMinutes != null
        ? '<div class="' + (exp.valid ? '' : 'invalid') + '">补偿曝光：' + esc(exp.text) + (exp.valid ? '' : '（已失效）') + '</div>'
        : '<div class="meta">曝光：' + esc(exp.text || '—') + '</div>';
      const issues = (s.issues || []).length ? '<div class="issues">⚠ ' + s.issues.map(esc).join('；') + '</div>' : '';
      const lightOpts = Object.keys(overview.lightLevels).map(l => '<option ' + (l === s.light ? 'selected' : '') + '>' + esc(l) + '</option>').join('');
      const batchOpts = overview.chemicalBatches.map(b => '<option ' + (b.code === s.chemicalBatch ? 'selected' : '') + '>' + esc(b.code) + '</option>').join('');
      const rackOpts = overview.racks.map(r => '<option value="' + esc(r.id) + '" ' + (r.id === s.rackId ? 'selected' : '') + '>' + esc(r.id) + '</option>').join('');
      const history = (s.history || []).slice(-3).reverse().map(h => '<div>' + esc(h.at.slice(0, 16).replace('T', ' ')) + ' ' + esc(h.action) + '：' + esc(h.note) + '</div>').join('');
      let actions = '';
      if (s.status === '待复验') {
        actions = '<button class="ok mini" data-recheck="' + esc(s.id) + '">复验通过则占架</button>';
      }
      if (s.status !== '已完成') {
        actions += '<button class="warn mini" data-close="' + esc(s.id) + '">完成晒程（释放晒架）</button>';
      }
      return '<article class="card"><div><b>' + esc(s.id) + '</b> <span class="pill ' + (s.status === '开放中' ? 'open' : s.status === '待复验' ? 'recheck' : 'closed') + '">' + esc(s.status) + '</span></div>' +
        '<div>底片 ' + esc(s.negativeCode) + ' · 晒架 ' + esc(s.rackId) + '（' + esc(s.rackName) + '） · ' + (s.status === '开放中' ? '占用中' : '未占架') + '</div>' +
        '<div class="meta">登记：光照 ' + esc(s.light) + ' · 药液 ' + esc(s.chemicalBatch) + ' · 玻璃 ' + esc(s.plateSize) + ' · 基准 ' + esc(s.baselineExposure || '—') + '</div>' +
        expBlock + issues +
        (s.status === '已完成' ? '' :
          '<div class="inline"><span class="meta">改参数（退回待复验）</span><select data-light="' + esc(s.id) + '">' + lightOpts + '</select>' +
          '<select data-batchedit="' + esc(s.id) + '">' + batchOpts + '</select><input data-plateedit="' + esc(s.id) + '" value="' + esc(s.plateSize) + '" style="min-width:110px">' +
          '<button class="mini secondary" data-patch="' + esc(s.id) + '">保存</button></div>' +
          '<div class="inline"><span class="meta">换晒架（重查占用）</span><select data-moverack="' + esc(s.id) + '">' + rackOpts + '</select>' +
          '<button class="mini secondary" data-move="' + esc(s.id) + '">换架</button></div>') +
        actions +
        '<div class="history meta">' + (history || '暂无记录') + '</div></article>';
    }

    function renderSessions() {
      document.querySelector('#sessions').innerHTML = overview.sessions.length ? overview.sessions.map(sessionHtml).join('') : '<div class="meta">还没有晒程</div>';
    }

    function render() { renderForms(); renderRacks(); renderSessions(); wire(); }
    async function load() {
      [overview, items] = await Promise.all([api('/api/rack-room'), api('/api/items')]);
      render();
    }
    function wire() {
      document.querySelectorAll('[data-batch]').forEach(btn => btn.onclick = async () => {
        try { await api('/api/chemical-batches/' + encodeURIComponent(btn.dataset.batch), { method: 'PATCH', body: JSON.stringify({ active: btn.dataset.active === '1' }) }); await load(); }
        catch (e) { alert(e.message); }
      });
      document.querySelectorAll('[data-recheck]').forEach(btn => btn.onclick = async () => {
        try { await api('/api/sessions/' + encodeURIComponent(btn.dataset.recheck) + '/recheck', { method: 'POST' }); await load(); } catch (e) { alert(e.message); }
      });
      document.querySelectorAll('[data-close]').forEach(btn => btn.onclick = async () => {
        try { await api('/api/sessions/' + encodeURIComponent(btn.dataset.close) + '/close', { method: 'POST' }); await load(); } catch (e) { alert(e.message); }
      });
      document.querySelectorAll('[data-patch]').forEach(btn => btn.onclick = async () => {
        const id = btn.dataset.patch;
        try {
          await api('/api/sessions/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({
            light: document.querySelector('[data-light="' + id + '"]').value,
            chemicalBatch: document.querySelector('[data-batchedit="' + id + '"]').value,
            plateSize: document.querySelector('[data-plateedit="' + id + '"]').value
          }) });
          await load();
        } catch (e) { alert(e.message); }
      });
      document.querySelectorAll('[data-move]').forEach(btn => btn.onclick = async () => {
        const id = btn.dataset.move;
        try {
          await api('/api/sessions/' + encodeURIComponent(id) + '/rack', { method: 'POST', body: JSON.stringify({ rackId: document.querySelector('[data-moverack="' + id + '"]').value }) });
          await load();
        } catch (e) { alert(e.message); }
      });
    }

    document.querySelector('#negSelect').onchange = () => {
      const n = negByCode(document.querySelector('#negSelect').value);
      if (n) { document.querySelector('#plateInput').value = n.plateSize || '';
        document.querySelector('#hint').textContent = '底片登记：尺寸 ' + (n.plateSize || '?') + ' · 药液 ' + (n.chemicalBatch || '?') + ' · 基准曝光 ' + (n.exposure || '?'); }
    };
    document.querySelector('#createForm').onsubmit = async ev => {
      ev.preventDefault();
      try {
        await api('/api/sessions', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(document.querySelector('#createForm')).entries())) });
        document.querySelector('#createForm').reset(); document.querySelector('#hint').textContent = ''; await load();
      } catch (e) { alert(e.message); }
    };
    document.querySelector('#reload').onclick = load;
    load();
  </script>
</body>
</html>`;
}
