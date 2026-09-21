// 页面模块：HTML 渲染。
// rackPage  新建的晒架占用与曝光补偿页面（本模块）
// roomPage  现有底片整理室页面（原样保留，仅加返回入口）

export function rackPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>蓝晒晒架占用与曝光补偿</title>
  <style>
    :root { --bg:#eef1f3; --panel:#fff; --ink:#1d2429; --muted:#5d6b74; --line:#cfd8de; --accent:#2f5d7c; --warn:#9b4937; --ok:#3f7a4f; --pend:#b07d22; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:20px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:24px; } h2 { margin:0 0 12px; font-size:17px; } h3 { margin:0; font-size:16px; }
    main { padding:20px 28px; display:grid; grid-template-columns:360px 1fr; gap:18px; align-items:start; }
    form,.panel,.card,.stat { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:14px; }
    label { display:block; margin:9px 0 4px; color:var(--muted); font-size:13px; }
    input,select,textarea { width:100%; border:1px solid var(--line); border-radius:6px; padding:8px; font:inherit; background:#fff; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:8px 12px; font-weight:700; cursor:pointer; }
    button.secondary { background:#667783; } button.danger { background:var(--warn); } button.mini { padding:5px 9px; font-size:12px; }
    .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(110px,1fr)); gap:10px; margin-bottom:14px; }
    .stat strong { display:block; font-size:22px; } .stat span { color:var(--muted); font-size:13px; }
    .racks { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:10px; margin-bottom:16px; }
    .rack { border:1px solid var(--line); border-radius:8px; padding:11px; background:#fbfcfd; }
    .rack.busy { border-color:var(--accent); background:#f2f7fa; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:12px; }
    .card { display:grid; gap:7px; }
    .meta { color:var(--muted); font-size:13px; }
    .pill { display:inline-block; border-radius:999px; padding:3px 9px; font-size:12px; border:1px solid var(--line); }
    .pill.open { background:#e7f0f6; color:var(--accent); border-color:var(--accent); }
    .pill.pending { background:#fbf3e2; color:var(--pend); border-color:var(--pend); }
    .pill.done { background:#eaf4ec; color:var(--ok); border-color:var(--ok); }
    .warn { color:var(--warn); font-weight:700; } .ok { color:var(--ok); font-weight:700; }
    .row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
    .toolbar { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:12px; } .toolbar select,.toolbar input { width:auto; min-width:150px; }
    .logs { border-top:1px solid var(--line); padding-top:7px; max-height:96px; overflow:auto; }
    #banner { margin:0 28px 0; } #banner .err { background:#fbeae7; border:1px solid var(--warn); color:var(--warn); padding:9px 12px; border-radius:6px; margin-top:12px; font-size:14px; }
    nav a { color:var(--accent); text-decoration:none; font-size:14px; }
    .comp { font-size:15px; font-weight:700; color:var(--accent); }
    details { border-top:1px dashed var(--line); padding-top:7px; } summary { cursor:pointer; color:var(--muted); font-size:13px; }
    .inline { display:grid; gap:6px; margin-top:6px; }
    @media (max-width:900px){ header{display:block;padding:16px;} main{grid-template-columns:1fr;padding:14px;} #banner{margin:0 14px;} }
  </style>
</head>
<body>
  <header>
    <div><h1>蓝晒晒架占用与曝光补偿</h1><div class="meta">编号唯一 · 一开放晒程一架一片 · 建程按基准补偿 · 改参退回待复验</div></div>
    <nav><a href="/">← 返回底片整理室</a> &nbsp; <button id="reload" class="secondary mini">刷新</button></nav>
  </header>
  <div id="banner"></div>
  <main>
    <section>
      <form id="createForm" class="panel">
        <h2>建晒程</h2>
        <label>底片编号（唯一）</label><select name="negativeCode" id="negativeSelect" required></select>
        <label>晒架</label><select name="rackCode" id="rackSelect" required></select>
        <label>玻璃板尺寸</label><input name="plateSize" id="plateSizeInput" required placeholder="如 18x24cm">
        <label>光照条件</label><select name="light" id="lightSelect"></select>
        <label>药液批次</label><select name="batchCode" id="batchSelect"></select>
        <label>基准曝光（分钟，留空用全局）</label><input name="baseExposure" type="number" min="0.5" step="0.5" placeholder="全局基准">
        <label>备注</label><input name="note">
        <div class="meta" id="compPreview" style="margin-top:8px"></div>
        <div style="margin-top:10px"><button>登记建程</button></div>
      </form>
      <form id="settingForm" class="panel" style="margin-top:12px">
        <h2>全局基准曝光</h2>
        <div class="row"><input name="baseExposure" id="baseExposureInput" type="number" min="0.5" step="0.5" style="width:110px"> 分钟 <button class="secondary mini">更新</button></div>
        <div class="meta" style="margin-top:6px">仅影响之后新建的晒程；已有晒程已记录各自基准。</div>
      </form>
      <form id="rackForm" class="panel" style="margin-top:12px">
        <h2>新增晒架</h2>
        <div class="row"><input name="code" placeholder="晒架编号" required><input name="plateSize" placeholder="适配尺寸" required></div>
        <label>备注</label><input name="note"><div style="margin-top:8px"><button class="secondary mini">添加晒架</button></div>
      </form>
      <form id="batchForm" class="panel" style="margin-top:12px">
        <h2>新增药液批次</h2>
        <div class="row"><input name="code" placeholder="批次号 如 B-0701" required><input name="factor" type="number" step="0.05" min="0.1" value="1" style="width:100px" required></div>
        <div class="meta">感度系数：值越大所需曝光越长。</div>
        <div style="margin-top:8px"><button class="secondary mini">添加批次</button></div>
      </form>
    </section>
    <section>
      <div class="stats" id="stats"></div>
      <div class="panel" style="margin-bottom:14px">
        <h2>晒架占用板</h2>
        <div class="racks" id="racks"></div>
      </div>
      <div class="panel">
        <h2>晒程</h2>
        <div class="toolbar">
          <select id="statusFilter"><option value="">全部状态</option><option value="open">占用中</option><option value="pending">待复验</option><option value="done">已完成</option></select>
          <input id="search" placeholder="搜索底片 / 晒架 / 批次">
        </div>
        <div class="grid" id="cards"></div>
      </div>
    </section>
  </main>
  <script>
    let board = null;
    const $ = s => document.querySelector(s);
    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    async function api(path, options) {
      const res = await fetch(path, options && options.body ? { ...options, headers:{'Content-Type':'application/json'} } : options);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { const e = new Error(data.error || '请求失败'); e.data = data; throw e; }
      return data;
    }
    function flash(err) {
      const d = err && err.data ? err.data : {};
      const detail = d.holderNegative ? '（已被底片 ' + esc(d.holderNegative) + ' 占用）' : '';
      $('#banner').innerHTML = '<div class="err">' + esc(err.message || err) + detail + '</div>';
      clearTimeout(flash._t); flash._t = setTimeout(() => $('#banner').innerHTML = '', 5000);
    }
    function lightFactor(key) { const l = (board.lights||[]).find(x => x.key === key); return l ? l.factor : 1; }
    function batchFactor(code) { const b = (board.batches||[]).find(x => x.code === code); return b ? b.factor : 1; }
    function fmt(sec) { const m = Math.floor(sec/60), s = sec%60; return m + '分' + (s ? s+'秒' : ''); }

    function renderSelectors() {
      $('#negativeSelect').innerHTML = (board.negatives||[]).map(n => '<option value="'+esc(n.code)+'">'+esc(n.code)+' · '+esc(n.plateSize||'')+'</option>').join('');
      $('#rackSelect').innerHTML = board.racks.map(r => '<option value="'+esc(r.code)+'" data-size="'+esc(r.plateSize)+'">'+esc(r.code)+' ('+esc(r.plateSize)+')'+(r.occupiedBy?' · 占用':'')+'</option>').join('');
      $('#lightSelect').innerHTML = board.lights.map(l => '<option value="'+l.key+'"'+(l.key==='cloud'?' selected':'')+'>'+esc(l.label)+' ×'+l.factor+'</option>').join('');
      $('#batchSelect').innerHTML = board.batches.map(b => '<option value="'+esc(b.code)+'">'+esc(b.code)+' ×'+b.factor+(b.active?'':' [停用]')+'</option>').join('');
      $('#baseExposureInput').value = board.baseExposure;
      syncPlate(); previewComp();
    }
    function syncPlate() {
      const opt = $('#rackSelect').selectedOptions[0];
      if (opt) $('#plateSizeInput').value = opt.dataset.size || '';
    }
    function previewComp() {
      const base = Number($('#createForm').baseExposure.value || board.baseExposure);
      const sec = Math.round(base*60*(1/lightFactor($('#lightSelect').value))*batchFactor($('#batchSelect').value)/5)*5;
      $('#compPreview').innerHTML = '预计补偿曝光：<span class="comp">'+esc(fmt(sec))+'</span>（基准 '+base+' 分钟）';
    }

    function renderStats() {
      const s = board.sessions;
      const busy = board.racks.filter(r => r.occupiedBy).length;
      const stats = [['占用晒架', busy], ['空闲晒架', board.racks.length-busy], ['占用中晒程', s.filter(x=>x.status==='open').length], ['待复验', s.filter(x=>x.status==='pending').length], ['已完成', s.filter(x=>x.status==='done').length]];
      $('#stats').innerHTML = stats.map(([k,v]) => '<div class="stat"><span>'+k+'</span><strong>'+v+'</strong></div>').join('');
    }
    function renderRacks() {
      $('#racks').innerHTML = board.racks.map(r => '<div class="rack '+(r.occupiedBy?'busy':'')+'">'
        + '<h3>'+esc(r.code)+'</h3><div class="meta">适配 '+esc(r.plateSize)+(r.note?' · '+esc(r.note):'')+'</div>'
        + (r.occupiedBy
            ? '<div class="meta" style="margin-top:6px">占用：<b>'+esc(r.occupiedBy.negativeCode)+'</b><br>'+esc(r.occupiedBy.compensatedText)+'</div><button class="danger mini" data-delrack="'+esc(r.code)+'" style="margin-top:6px">删除晒架</button>'
            : '<div class="ok" style="margin-top:6px">空闲</div><button class="danger mini" data-delrack="'+esc(r.code)+'" style="margin-top:6px">删除晒架</button>')
        + '</div>').join('');
      document.querySelectorAll('[data-delrack]').forEach(b => b.onclick = async () => {
        if (!confirm('删除晒架 '+b.dataset.delrack+'？')) return;
        try { await api('/rack/api/racks/'+encodeURIComponent(b.dataset.delrack), { method:'DELETE' }); await load(); } catch(e){ flash(e); }
      });
    }
    function cardHtml(s) {
      const logs = (s.events||[]).slice(-4).map(l => '<div>'+esc(l.note)+'</div>').join('');
      let actions = '';
      if (s.status === 'pending') {
        actions = '<div class="row"><button class="mini" data-reverify="'+s.id+'">复验占用</button><button class="danger mini" data-del="'+s.id+'">取消晒程</button></div>';
      } else if (s.status === 'open') {
        actions = '<div class="row"><button class="mini" data-complete="'+s.id+'">完成并登记结论</button><button class="danger mini" data-del="'+s.id+'">取消晒程</button></div>';
      } else {
        actions = '<div class="row"><button class="danger mini" data-del="'+s.id+'">删除记录</button></div>';
      }
      const concl = s.conclusion
        ? '<div>结论：<b>'+esc(s.conclusion.result)+'</b> · 实照 '+esc(s.conclusion.actualText)+(s.conclusion.valid?'':' <span class="warn">已失效</span>')+'</div>'
        : '';
      return '<article class="card">'
        + '<div class="row" style="justify-content:space-between"><h3>'+esc(s.negativeCode)+'</h3><span class="pill '+s.status+'">'+esc(s.statusLabel)+'</span></div>'
        + '<div class="meta">晒架 '+esc(s.rackLabel)+' · 尺寸 '+esc(s.plateSize)+'</div>'
        + '<div class="meta">光照 '+esc(s.light)+' · 药液 '+esc(s.batchCode)+(s.batchActive?'':' <span class="warn">[停用]</span>')+' · rev'+s.revision+'</div>'
        + '<div>基准 '+s.baseExposure+' 分钟 → '+(s.exposure ? '<span class="comp">'+esc(s.exposure.compensatedText)+'</span>' : '<span class="warn">待复验补算曝光</span>')+'</div>'
        + (s.pendingReasonLabel ? '<div class="warn">待复验：'+esc(s.pendingReasonLabel)+'（不占晒架）</div>' : '')
        + concl
        + (s.note ? '<div class="meta">备注：'+esc(s.note)+'</div>' : '')
        + actions
        + editHtml(s)
        + '<div class="logs meta">'+(logs||'暂无事件')+'</div>'
        + '</article>';
    }
    function editHtml(s) {
      if (s.status === 'done') return '';
      return '<details><summary>修改参数（结论失效 / 换架重查占用）</summary><div class="inline">'
        + '<label>换晒架</label><select data-e="rackCode">'+board.racks.map(r=>'<option value="'+esc(r.code)+'"'+(r.code===s.rackCode?' selected':'')+'>'+esc(r.code)+'</option>').join('')+'</select>'
        + '<label>玻璃板尺寸</label><input data-e="plateSize" value="'+esc(s.plateSize)+'">'
        + '<label>光照</label><select data-e="light">'+board.lights.map(l=>'<option value="'+l.key+'"'+(l.key===s.light?' selected':'')+'>'+esc(l.label)+'</option>').join('')+'</select>'
        + '<label>药液批次</label><select data-e="batchCode">'+board.batches.map(b=>'<option value="'+esc(b.code)+'"'+(b.code===s.batchCode?' selected':'')+'>'+esc(b.code)+(b.active?'':' [停用]')+'</option>').join('')+'</select>'
        + '<label>基准曝光（分钟）</label><input data-e="baseExposure" type="number" step="0.5" min="0.5" value="'+s.baseExposure+'">'
        + '<button class="secondary mini" data-save="'+s.id+'">保存修改（退回待复验）</button>'
        + '</div></details>';
    }
    function renderCards() {
      const status = $('#statusFilter').value, q = $('#search').value.trim();
      const list = board.sessions.filter(s => (!status || s.status===status) && (!q || JSON.stringify(s).includes(q)));
      $('#cards').innerHTML = list.map(cardHtml).join('');
      bindCardEvents();
    }
    function bindCardEvents() {
      document.querySelectorAll('[data-reverify]').forEach(b => b.onclick = async () => {
        try { await api('/rack/api/sessions/'+b.dataset.reverify+'/reverify', { method:'POST' }); await load(); } catch(e){ flash(e); }
      });
      document.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
        if (!confirm('确定删除该晒程？占用将释放。')) return;
        try { await api('/rack/api/sessions/'+b.dataset.del, { method:'DELETE' }); await load(); } catch(e){ flash(e); }
      });
      document.querySelectorAll('[data-complete]').forEach(b => b.onclick = async () => {
        const result = prompt('晒成结论（合格 / 偏浅 / 过曝）', '合格'); if (result === null) return;
        const actual = prompt('实际曝光秒数（留空用补偿值）', ''); if (actual === null) return;
        try { await api('/rack/api/sessions/'+b.dataset.complete+'/complete', { method:'POST', body: JSON.stringify({ result, actualSeconds: actual }) }); await load(); } catch(e){ flash(e); }
      });
      document.querySelectorAll('[data-save]').forEach(b => b.onclick = async () => {
        const card = b.closest('.card');
        const patch = {};
        card.querySelectorAll('[data-e]').forEach(el => {
          const k = el.dataset.e;
          if (k === 'baseExposure') patch[k] = Number(el.value); else patch[k] = el.value;
        });
        if (!confirm('修改后结论失效并退回待复验，确定？')) return;
        try { await api('/rack/api/sessions/'+b.dataset.save, { method:'PATCH', body: JSON.stringify(patch) }); await load(); } catch(e){ flash(e); }
      });
    }
    async function load() {
      board = await api('/rack/api/board');
      renderSelectors(); renderStats(); renderRacks(); renderCards();
    }
    $('#createForm').onchange = () => { syncPlate(); previewComp(); };
    $('#createForm').onsubmit = async e => {
      e.preventDefault();
      try { await api('/rack/api/sessions', { method:'POST', body: JSON.stringify(Object.fromEntries(new FormData($('#createForm')).entries())) }); $('#createForm').reset(); await load(); }
      catch(err){ flash(err); }
    };
    $('#settingForm').onsubmit = async e => {
      e.preventDefault();
      try { await api('/rack/api/settings', { method:'PATCH', body: JSON.stringify({ baseExposure: $('#baseExposureInput').value }) }); await load(); } catch(err){ flash(err); }
    };
    $('#rackForm').onsubmit = async e => {
      e.preventDefault();
      try { await api('/rack/api/racks', { method:'POST', body: JSON.stringify(Object.fromEntries(new FormData($('#rackForm')).entries())) }); $('#rackForm').reset(); await load(); } catch(err){ flash(err); }
    };
    $('#batchForm').onsubmit = async e => {
      e.preventDefault();
      try { await api('/rack/api/batches', { method:'POST', body: JSON.stringify(Object.fromEntries(new FormData($('#batchForm')).entries())) }); $('#batchForm').reset(); await load(); } catch(err){ flash(err); }
    };
    $('#statusFilter').onchange = renderCards; $('#search').oninput = renderCards; $('#reload').onclick = load;
    load();
  </script>
</body>
</html>`;
}

// 现有底片整理室页面：从原 server.js 原样搬迁，仅在 header 增加模块入口。
export function roomPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>古法蓝晒底片整理室</title>
  <style>
    :root { --bg:#f1f3ef; --panel:#fff; --ink:#20241f; --muted:#687066; --line:#d4ddd0; --accent:#526f43; --warn:#9b4937; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:26px; } h2 { margin:0 0 12px; font-size:18px; } main { display:grid; grid-template-columns:380px 1fr; gap:22px; padding:22px 28px; }
    form,.panel,.card,.stat { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; } input,select,textarea { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; background:#fff; } textarea { min-height:68px; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:10px 13px; font-weight:700; cursor:pointer; } button.secondary { background:#69736a; }
    .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:10px; margin-bottom:14px; } .stat strong { display:block; font-size:24px; }
    .toolbar { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px; } .toolbar select,.toolbar input { width:auto; min-width:160px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:12px; } .card { display:grid; gap:8px; }
    .meta { color:var(--muted); font-size:13px; } .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; }
    .logs { border-top:1px solid var(--line); padding-top:8px; max-height:90px; overflow:auto; } .warn { color:var(--warn); font-weight:700; }
    nav a { color:var(--accent); text-decoration:none; font-size:14px; font-weight:700; }
    @media (max-width:900px){ header{display:block;padding:18px 16px;} main{grid-template-columns:1fr;padding:16px;} }
  </style>
</head>
<body>
  <header><div><h1>古法蓝晒底片整理室</h1><div class="meta">底片任务、工艺步骤、缺陷和入盒交付</div></div><div style="display:flex;gap:14px;align-items:center"><nav><a href="/rack">晒架占用与曝光补偿 →</a></nav><button id="reload" class="secondary">刷新</button></div></header>
  <main>
    <section>
      <form id="createForm"><h2>新增底片</h2><div id="fields"></div><label>初始状态</label><select name="status">${stages().map(s => '<option>'+s+'</option>').join('')}</select><button>保存底片</button></form>
      <form id="actionForm" style="margin-top:14px"><h2>记录工艺步骤</h2><label>选择底片</label><select name="id" id="itemSelect"></select><div id="extraFields"></div><button>提交记录</button></form>
    </section>
    <section>
      <div class="stats" id="stats"></div>
      <div class="toolbar"><select id="statusFilter"><option value="">全部状态</option>${stages().map(s => '<option>'+s+'</option>').join('')}</select><input id="search" placeholder="搜索编号或关键词"></div>
      <div class="panel"><h2>创建蓝晒任务后，按涂布、晾干、曝光、冲洗、复晒、入盒记录每一步历史。</h2><div class="grid" id="cards"></div></div>
    </section>
  </main>
  <script>
    const fields = [["code","底片编号","text"],["plateSize","玻璃板尺寸","text"],["chemicalBatch","药液批次","text"],["exposure","曝光时间","text"],["waterSource","冲洗水源","text"],["box","存放盒位","text"]];
    const stages = ${JSON.stringify(stages())};
    const extraFields = [["step","步骤"],["developStatus","显影状态"],["defect","缺陷类型"],["repair","修补记录"],["note","备注"]];
    const createForm = document.querySelector('#createForm');
    const actionForm = document.querySelector('#actionForm');
    const cards = document.querySelector('#cards');
    const statsEl = document.querySelector('#stats');
    const itemSelect = document.querySelector('#itemSelect');
    let items = [];
    async function api(path, options) {
      const res = await fetch(path, options && options.body ? { ...options, headers:{ 'Content-Type':'application/json' } } : options);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '请求失败');
      return data;
    }
    function renderForms() {
      document.querySelector('#fields').innerHTML = fields.map(([key,label,type]) => '<label>'+label+'</label><input name="'+key+'" type="'+type+'" '+(key==='code'?'required':'')+'>').join('');
      document.querySelector('#extraFields').innerHTML = extraFields.map(([key,label]) => '<label>'+label+'</label><input name="'+key+'">').join('');
    }
    function render() {
      itemSelect.innerHTML = items.map(item => '<option value="'+(item.id || item.code)+'">'+(item.code || item.id)+' · '+(item.name || item.shipType || item.source || item.plateSize || '')+'</option>').join('');
      const stats = Object.fromEntries(stages.map(s => [s, items.filter(i => i.status === s).length]));
      statsEl.innerHTML = Object.entries(stats).map(([k,v]) => '<div class="stat"><span>'+k+'</span><strong>'+v+'</strong></div>').join('');
      const status = document.querySelector('#statusFilter').value;
      const q = document.querySelector('#search').value.trim();
      const visible = items.filter(item => (!status || item.status === status) && (!q || JSON.stringify(item).includes(q)));
      cards.innerHTML = visible.map(item => cardHtml(item)).join('');
      document.querySelectorAll('[data-status]').forEach(sel => sel.onchange = async () => { await api('/api/items/'+sel.dataset.status, { method:'PATCH', body: JSON.stringify({ status: sel.value }) }); await load(); });
      document.querySelectorAll('[data-note]').forEach(btn => btn.onclick = async () => { const id = btn.dataset.note; const note = prompt('记录备注'); if (note) { await api('/api/items/'+id+'/logs', { method:'POST', body: JSON.stringify({ step:'备注', note }) }); await load(); } });
    }
    function cardHtml(item) {
      const main = fields.slice(0,4).map(([key,label]) => '<div><b>'+label+'</b> '+(item[key] ?? '')+'</div>').join('');
      const tasks = (item.tasks || []).map(t => '<div class="meta">任务 '+t.position+' · '+t.status+' · '+t.tension+'</div>').join('');
      const logs = (item.logs || []).slice(-4).map(l => '<div>'+l.step+'：'+l.note+'</div>').join('');
      return '<article class="card"><h3>'+(item.code || item.id)+'</h3><span class="pill">'+item.status+'</span>'+main+tasks+'<label>状态</label><select data-status="'+(item.id || item.code)+'">'+stages.map(s => '<option '+(s===item.status?'selected':'')+'>'+s+'</option>').join('')+'</select><button class="secondary" data-note="'+(item.id || item.code)+'">追加备注</button><div class="logs meta">'+(logs || '暂无记录')+'</div></article>';
    }
    async function load() { items = await api('/api/items'); render(); }
    createForm.onsubmit = async event => { event.preventDefault(); await api('/api/items', { method:'POST', body: JSON.stringify(Object.fromEntries(new FormData(createForm).entries())) }); createForm.reset(); await load(); };
    actionForm.onsubmit = async event => { event.preventDefault(); await api('/api/items/'+itemSelect.value+'/action', { method:'POST', body: JSON.stringify(Object.fromEntries(new FormData(actionForm).entries())) }); actionForm.reset(); await load(); };
    document.querySelector('#statusFilter').onchange = render; document.querySelector('#search').oninput = render; document.querySelector('#reload').onclick = load;
    renderForms(); load();
  </script>
</body>
</html>`;
}

// 旧页面脚本里用到的常量，通过函数注入以保持单文件模块整洁。
function stages() {
  return ["待曝光","冲洗中","待入盒","已交付"];
}
