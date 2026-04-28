/* MADA Tracker – client-side only. No data leaves the browser. */
(() => {
  'use strict';

  // ====================== Tabs ======================
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });

  // ====================== Helpers ======================
  const $ = (sel, el=document) => el.querySelector(sel);
  const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));

  function toNumber(v){
    if (v === null || v === undefined || v === '' || v === '--') return 0;
    if (typeof v === 'number') return v;
    const s = String(v).replace(/[$,%\s]/g,'').replace(/,/g,'');
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }
  function fmtNum(n){ return Number(n||0).toLocaleString('en-US'); }
  function fmtMoney(n){ return '$' + Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2, maximumFractionDigits:2}); }
  function fmtPct(n){
    const v = Number(n||0);
    if (v > 0 && v < 1) return (v*100).toFixed(2)+'%';  // decimal
    return v.toFixed(2)+'%';
  }
  function escapeHtml(s){
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function colorFor(name){
    let h = 0; for (const c of String(name||'')) h = (h*31 + c.charCodeAt(0)) % 360;
    return `hsl(${h} 65% 45%)`;
  }
  function initials(n){
    const s = String(n||'').replace(/^@/,'').trim();
    return (s[0] || '?').toUpperCase();
  }
  function cleanHandle(s){
    return String(s||'').trim().toLowerCase().replace(/^@/,'').replace(/\s+/g,'');
  }
  function csvEscape(v){
    const s = String(v ?? '');
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
    return s;
  }
  function downloadCSV(rows, filename){
    const csv = rows.map(r => r.map(csvEscape).join(',')).join('\n');
    const blob = new Blob(['\ufeff'+csv], {type:'text/csv;charset=utf-8'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href), 500);
  }

  // ====================== Dropzone wiring ======================
  function wireDropzone(zoneId, inputId, onFile, {multiple=false} = {}){
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(inputId);
    zone.addEventListener('click', e => {
      if (e.target.tagName === 'BUTTON') return;
      input.click();
    });
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('drag');
      if (e.dataTransfer.files?.length) {
        if (multiple) for (const f of e.dataTransfer.files) onFile(f);
        else onFile(e.dataTransfer.files[0]);
      }
    });
    input.addEventListener('change', () => {
      if (!input.files?.length) return;
      if (multiple) for (const f of input.files) onFile(f);
      else onFile(input.files[0]);
      input.value = '';
    });
  }

  function showToast(msg){
    const old = document.querySelector('.toast'); if (old) old.remove();
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 1900);
  }
  // "browse" inner buttons
  document.addEventListener('click', e => {
    if (e.target.matches('.link[data-for]')) {
      e.stopPropagation();
      document.getElementById(e.target.dataset.for).click();
    }
  });

  // ====================== Daily Performance ======================
  // dailyFiles: [{ id, fileName, dateLabel, dateKey, rows: [...] }]
  let dailyFiles = [];
  let dailySort = {key: 'vv', dir: -1};

  function readXlsx(file){
    return file.arrayBuffer().then(buf => XLSX.read(buf, {type:'array'}));
  }

  // Best-effort date label from filename + the workbook header.
  function deriveDateLabel(filename, headerLabel){
    if (headerLabel) {
      // Single date: "2026-04-20 ~ 2026-04-20" -> "2026-04-20"
      const m = headerLabel.match(/(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})/);
      if (m) return (m[1] === m[2]) ? m[1] : (m[1] + ' → ' + m[2]);
      const m2 = headerLabel.match(/\d{4}-\d{2}-\d{2}/);
      if (m2) return m2[0];
    }
    // Try filename: e.g. Video-Performance-List_20260422... or 2026-04-22
    const m1 = filename.match(/(\d{4})[-_]?(\d{2})[-_]?(\d{2})/);
    if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`;
    return filename;
  }

  function dateKeyOf(label){
    const m = String(label||'').match(/(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}${m[2]}${m[3]}` : String(label||'');
  }

  async function handleDailyFile(file){
    try {
      const wb = await readXlsx(file);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});

      let headerIdx = aoa.findIndex(r => r.some(c => String(c).toLowerCase().includes('creator name')));
      if (headerIdx < 0) headerIdx = 0;
      const headers = aoa[headerIdx].map(h => String(h).trim());
      const colOf = (needle) => headers.findIndex(h => h.toLowerCase().includes(needle));

      const idx = {
        creator: colOf('creator name'),
        creatorId: colOf('creator id'),
        video: colOf('video info'),
        videoId: colOf('video id'),
        time: colOf('time'),
        product: colOf('products'),
        vv: colOf('vv'),
        likes: colOf('likes'),
        comments: colOf('comments'),
        shares: colOf('shares'),
        vlclicks: headers.findIndex(h => /v-to-l clicks/i.test(h)),
        pclicks: headers.findIndex(h => /product clicks/i.test(h)),
        orders: colOf('orders'),
        gmv: headers.findIndex(h => /gross merchandise/i.test(h)) >= 0
             ? headers.findIndex(h => /gross merchandise/i.test(h))
             : headers.findIndex(h => /video.*gmv|gmv.*video|shoppable.*gmv/i.test(h)),
        ctr: headers.findIndex(h => /click-through rate/i.test(h))
      };
      const parsePct = (v) => {
        if (v === null || v === undefined || v === '' || v === '--') return 0;
        if (typeof v === 'number') return v > 1 ? v : v * 100;
        const s = String(v).trim();
        const hasPct = s.endsWith('%');
        const n = parseFloat(s.replace(/[%,\s]/g,''));
        if (isNaN(n)) return 0;
        return hasPct ? n : (n > 1 ? n : n * 100);
      };

      let headerLabel = '';
      const a1 = String(aoa[0]?.[0] || '');
      const m = a1.match(/Date Range\]?\s*:\s*(.+)/i);
      if (m) headerLabel = m[1].trim();
      const dateLabel = deriveDateLabel(file.name, headerLabel);

      const rows = [];
      for (let i = headerIdx+1; i < aoa.length; i++){
        const r = aoa[i];
        if (!r || r.every(c => c === '' || c == null)) continue;
        const creator = String(r[idx.creator] ?? '').trim();
        if (!creator) continue;
        const videoId = String(r[idx.videoId] ?? '').trim();
        const handle = cleanHandle(creator);
        const link = videoId ? `https://www.tiktok.com/@${handle}/video/${videoId}` : '';
        rows.push({
          creator, creatorId: r[idx.creatorId],
          video: String(r[idx.video] ?? ''),
          videoId, link,
          time: r[idx.time],
          product: r[idx.product],
          vv: toNumber(r[idx.vv]),
          likes: toNumber(r[idx.likes]),
          comments: toNumber(r[idx.comments]),
          shares: toNumber(r[idx.shares]),
          vlclicks: toNumber(r[idx.vlclicks]),
          pclicks: toNumber(r[idx.pclicks]),
          orders: toNumber(r[idx.orders]),
          gmv: toNumber(r[idx.gmv]),
          ctrNum: parsePct(r[idx.ctr]),
          ctr: r[idx.ctr],
          date: dateLabel
        });
      }

      const id = 'f' + Date.now() + Math.random().toString(36).slice(2,6);
      // De-dup: replace existing entry with same date label
      const existing = dailyFiles.findIndex(f => f.dateLabel === dateLabel);
      const entry = { id, fileName: file.name, dateLabel, dateKey: dateKeyOf(dateLabel), rows };
      if (existing >= 0) {
        dailyFiles[existing] = entry;
        showToast(`Replaced data for ${dateLabel}`);
      } else {
        dailyFiles.push(entry);
        showToast(`Added ${dateLabel} · ${rows.length} videos`);
      }
      $('#dz-daily').classList.add('filled');
      $('#dz-daily .dz-title').textContent = `${dailyFiles.length} file${dailyFiles.length>1?'s':''} loaded · drop more to add`;
      renderDaily();
    } catch (err) {
      console.error(err);
      showToast('Failed to read "' + file.name + '"');
    }
  }

  function removeDailyFile(id){
    dailyFiles = dailyFiles.filter(f => f.id !== id);
    if (dailyFiles.length === 0){
      $('#dz-daily').classList.remove('filled');
      $('#dz-daily .dz-title').textContent = 'Drop one or several Video-Performance-List files';
      $('#daily-result').hidden = true;
      $('#daily-loaded').hidden = true;
      return;
    }
    $('#dz-daily .dz-title').textContent = `${dailyFiles.length} file${dailyFiles.length>1?'s':''} loaded · drop more to add`;
    renderDaily();
  }

  function aggregateByDate(){
    const map = new Map();
    dailyFiles.forEach(f => {
      const key = f.dateLabel;
      if (!map.has(key)) {
        map.set(key, { dateLabel: key, dateKey: f.dateKey, vv:0, pclicks:0, gmv:0, ctrSum:0, count:0, fileIds: [] });
      }
      const a = map.get(key);
      a.fileIds.push(f.id);
      f.rows.forEach(r => {
        a.vv += r.vv;
        a.pclicks += r.pclicks;
        a.gmv += r.gmv;
        a.ctrSum += r.ctrNum;
        a.count += 1;
      });
    });
    const arr = Array.from(map.values());
    arr.sort((a,b) => String(a.dateKey).localeCompare(String(b.dateKey)));
    return arr;
  }

  function renderDaily(){
    if (dailyFiles.length === 0){ $('#daily-result').hidden = true; $('#daily-loaded').hidden = true; return; }
    $('#daily-result').hidden = false;

    // Loaded files chips
    const chipsEl = $('#daily-loaded');
    chipsEl.hidden = false;
    chipsEl.innerHTML = dailyFiles
      .slice()
      .sort((a,b) => String(a.dateKey).localeCompare(String(b.dateKey)))
      .map(f => `<span class="file-chip" title="${escapeHtml(f.fileName)}">
        <span class="file-date">${escapeHtml(f.dateLabel)}</span>
        <span class="muted">· ${f.rows.length} videos</span>
        <button class="file-x" data-rm="${f.id}" title="Remove">×</button>
      </span>`).join('');
    chipsEl.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => removeDailyFile(b.dataset.rm)));

    // === Summary by date ===
    const agg = aggregateByDate();
    const sumBody = $('#daily-summary tbody');
    sumBody.innerHTML = agg.map(a => {
      const ctor = a.count ? (a.ctrSum / a.count) : 0;
      return `<tr data-date="${escapeHtml(a.dateLabel)}">
        <td><b>${escapeHtml(a.dateLabel)}</b></td>
        <td class="num">${fmtNum(a.vv)}</td>
        <td class="num">${fmtNum(a.pclicks)}</td>
        <td class="num">${ctor.toFixed(2)}%</td>
        <td class="num">${fmtMoney(a.gmv)}</td>
        <td class="num">${a.count}</td>
        <td class="num"><button class="row-x" data-rm-date="${escapeHtml(a.dateLabel)}" title="Remove this date">×</button></td>
      </tr>`;
    }).join('');
    sumBody.querySelectorAll('[data-rm-date]').forEach(b => b.addEventListener('click', () => {
      const lab = b.dataset.rmDate;
      dailyFiles.filter(f => f.dateLabel === lab).forEach(f => removeDailyFile(f.id));
    }));

    // Totals row
    const totV = agg.reduce((s,a)=>s+a.vv,0);
    const totPC = agg.reduce((s,a)=>s+a.pclicks,0);
    const totG = agg.reduce((s,a)=>s+a.gmv,0);
    const totVids = agg.reduce((s,a)=>s+a.count,0);
    const allCtor = totVids ? agg.reduce((s,a)=>s+a.ctrSum,0)/totVids : 0;
    $('#daily-summary tfoot').innerHTML = `<tr>
      <td>Total · ${agg.length} day${agg.length>1?'s':''}</td>
      <td class="num">${fmtNum(totV)}</td>
      <td class="num">${fmtNum(totPC)}</td>
      <td class="num">${allCtor.toFixed(2)}%</td>
      <td class="num">${fmtMoney(totG)}</td>
      <td class="num">${totVids}</td>
      <td></td>
    </tr>`;

    // Top stats
    $('#daily-files-count').textContent = `${dailyFiles.length} file${dailyFiles.length>1?'s':''} · ${agg.length} day${agg.length>1?'s':''}`;
    $('#tot-vv').textContent = fmtNum(totV);
    $('#tot-clicks').textContent = fmtNum(totPC);
    $('#avg-ctr').textContent = allCtor.toFixed(2)+'%';
    $('#tot-gmv').textContent = fmtMoney(totG);

    // === Per-video table ===
    const allRows = [];
    dailyFiles.forEach(f => f.rows.forEach(r => allRows.push(r)));
    $('#per-video-count').textContent = `(${allRows.length} videos)`;

    // Date filter dropdown
    const dateFilter = $('#daily-date-filter');
    const currentVal = dateFilter.value;
    const dateOpts = ['<option value="">All dates</option>'].concat(
      agg.map(a => `<option value="${escapeHtml(a.dateLabel)}"${a.dateLabel===currentVal?' selected':''}>${escapeHtml(a.dateLabel)}</option>`)
    );
    dateFilter.innerHTML = dateOpts.join('');

    const q = $('#daily-search').value.trim().toLowerCase();
    const dfVal = dateFilter.value;
    let data = allRows.slice();
    if (dfVal) data = data.filter(r => r.date === dfVal);
    if (q){
      data = data.filter(r =>
        r.creator.toLowerCase().includes(q) ||
        String(r.video).toLowerCase().includes(q) ||
        String(r.product).toLowerCase().includes(q)
      );
    }
    data.sort((a,b) => {
      const k = dailySort.key, d = dailySort.dir;
      const av = a[k], bv = b[k];
      if (typeof av === 'number' && typeof bv === 'number') return (av-bv)*d;
      return String(av||'').localeCompare(String(bv||''))*d;
    });

    const tb = $('#daily-table tbody');
    tb.innerHTML = data.map(r => {
      const ctr = r.ctrNum.toFixed(2) + '%';
      return `<tr>
        <td>${escapeHtml(r.date||'')}</td>
        <td><div class="creator-cell"><div class="avatar" style="background:${colorFor(r.creator)}">${escapeHtml(initials(r.creator))}</div>@${escapeHtml(r.creator)}</div></td>
        <td class="wrap" title="${escapeHtml(r.video)}">${escapeHtml(String(r.video).slice(0,140))}${String(r.video).length>140?'…':''}</td>
        <td>${escapeHtml(String(r.time||''))}</td>
        <td class="num">${fmtNum(r.vv)}</td>
        <td class="num">${fmtNum(r.likes)}</td>
        <td class="num">${fmtNum(r.pclicks)}</td>
        <td class="num">${ctr}</td>
        <td class="num">${fmtNum(r.orders)}</td>
        <td class="num">${fmtMoney(r.gmv)}</td>
        <td>${r.link ? `<a class="link-cell" href="${r.link}" target="_blank" rel="noopener">Open</a>` : ''}</td>
      </tr>`;
    }).join('');
  }

  $$('#daily-table thead th').forEach(th => {
    th.addEventListener('click', () => {
      const k = th.dataset.key; if (!k) return;
      if (dailySort.key === k) dailySort.dir *= -1; else { dailySort.key = k; dailySort.dir = -1; }
      renderDaily();
    });
  });
  $('#daily-search').addEventListener('input', renderDaily);
  $('#daily-date-filter').addEventListener('change', renderDaily);
  $('#btn-daily').addEventListener('click', e => { e.stopPropagation(); $('#file-daily').click(); });

  $('#daily-clear').addEventListener('click', () => {
    dailyFiles = [];
    $('#dz-daily').classList.remove('filled');
    $('#dz-daily .dz-title').textContent = 'Drop one or several Video-Performance-List files';
    $('#daily-result').hidden = true;
    $('#daily-loaded').hidden = true;
    showToast('Cleared');
  });

  function summaryAsRows(){
    const agg = aggregateByDate();
    const head = ['Date','Views','Product Clicks','CTOR','GMV'];
    const body = agg.map(a => {
      const ctor = a.count ? (a.ctrSum/a.count) : 0;
      return [a.dateLabel, a.vv, a.pclicks, ctor.toFixed(2)+'%', a.gmv.toFixed(2)];
    });
    return [head, ...body];
  }

  $('#daily-export').addEventListener('click', () => {
    downloadCSV(summaryAsRows(), 'daily-summary.csv');
  });

  $('#daily-copy').addEventListener('click', async () => {
    const rows = summaryAsRows();
    // Tab-separated for direct paste into Google Sheets / Excel
    const tsv = rows.map(r => r.join('\t')).join('\n');
    try {
      await navigator.clipboard.writeText(tsv);
      showToast('Copied — paste into your sheet');
    } catch (e) {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = tsv; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
      showToast('Copied');
    }
  });

  wireDropzone('dz-daily','file-daily', handleDailyFile, {multiple:true});

  // ====================== Affiliate Status ======================
  let vlistRows = [];
  let nicknames = [];
  let affResult = [];
  let affFilter = 'all';

  async function handleVlistFile(file){
    $('#dz-vlist').classList.add('filled');
    $('#dz-vlist .dz-title').textContent = file.name;
    const wb = await readXlsx(file);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
    let headerIdx = aoa.findIndex(r => r.some(c => /creator username/i.test(String(c))));
    if (headerIdx < 0) headerIdx = 0;
    const headers = aoa[headerIdx].map(h => String(h).trim());
    const ci = {
      name: headers.findIndex(h => /video name/i.test(h)),
      link: headers.findIndex(h => /video link/i.test(h)),
      date: headers.findIndex(h => /video post date/i.test(h)),
      user: headers.findIndex(h => /creator username/i.test(h)),
      gmv: headers.findIndex(h => /^gmv$/i.test(h) || /\bgmv\b/i.test(h)),
    };
    vlistRows = [];
    for (let i=headerIdx+1; i<aoa.length; i++){
      const r = aoa[i];
      if (!r || r.every(c => c === '' || c == null)) continue;
      const user = cleanHandle(r[ci.user]);
      if (!user) continue;
      vlistRows.push({
        name: String(r[ci.name] ?? ''),
        link: String(r[ci.link] ?? ''),
        date: r[ci.date],
        user
      });
    }
    checkReady();
  }

  async function handleNicksFile(file){
    $('#dz-nicks').classList.add('filled');
    $('#dz-nicks .dz-title').textContent = file.name;
    const text = await file.text();
    nicknames = parseNicknames(text);
    $('#nicks-sub').textContent = `${nicknames.length} nicknames loaded`;
    checkReady();
  }

  function parseNicknames(text){
    // Accept lines with optional numbering "   1\tname" or plain names.
    const out = [];
    text.split(/\r?\n/).forEach(line => {
      const raw = line.trim();
      if (!raw) return;
      // remove leading numbering like "1\t", "1.", "1)"
      const m = raw.match(/^\s*\d+[\.\)\t\s-]+(.+)$/);
      const val = m ? m[1] : raw;
      const h = cleanHandle(val);
      if (h) out.push(h);
    });
    return out;
  }

  function checkReady(){
    $('#run-affiliate').disabled = !(vlistRows.length && nicknames.length);
  }

  function runAffiliate(){
    // Group videos by creator
    const byUser = new Map();
    vlistRows.forEach(v => {
      if (!byUser.has(v.user)) byUser.set(v.user, []);
      byUser.get(v.user).push(v);
    });

    // Preserve order + keep duplicates in nickname list (user explicitly mentioned duplicates)
    affResult = nicknames.map((nick, i) => {
      const videos = (byUser.get(nick) || []).slice().sort((a,b) => String(a.date).localeCompare(String(b.date)));
      return {
        idx: i+1,
        nick,
        status: videos.length ? 'posted' : 'missing',
        videos
      };
    });

    renderAffiliate();
    $('#aff-result').hidden = false;
  }

  function fmtDate(d){
    if (!d) return '';
    if (d instanceof Date) return d.toISOString().slice(0,10);
    const s = String(d);
    // Excel serial?
    if (/^\d+(\.\d+)?$/.test(s)) {
      const serial = parseFloat(s);
      const ms = (serial - 25569) * 86400 * 1000;
      return new Date(ms).toISOString().slice(0,10);
    }
    return s;
  }

  function renderAffiliate(){
    const q = $('#aff-search').value.trim().toLowerCase();
    let data = affResult.slice();
    if (affFilter === 'posted') data = data.filter(r => r.status === 'posted');
    if (affFilter === 'missing') data = data.filter(r => r.status === 'missing');
    if (q) data = data.filter(r => r.nick.toLowerCase().includes(q));

    const posted = affResult.filter(r => r.status === 'posted').length;
    const missing = affResult.filter(r => r.status === 'missing').length;
    const totalVideos = affResult.reduce((s,r)=>s+r.videos.length,0);
    $('#aff-posted').textContent = `✓ Posted: ${posted}`;
    $('#aff-missing').textContent = `✗ Not Posted: ${missing}`;
    $('#aff-total-videos').textContent = `${totalVideos} videos matched`;

    const tb = $('#aff-table tbody');
    const html = [];
    data.forEach(r => {
      if (r.videos.length === 0){
        html.push(`<tr>
          <td>${r.idx}</td>
          <td><div class="creator-cell"><div class="avatar" style="background:${colorFor(r.nick)}">${escapeHtml(initials(r.nick))}</div>@${escapeHtml(r.nick)}</div></td>
          <td><span class="status-pill missing">Not Posted</span></td>
          <td>—</td><td>—</td>
          <td class="num">0</td>
        </tr>`);
      } else {
        r.videos.forEach((v, j) => {
          const isFirst = j === 0;
          html.push(`<tr class="${isFirst?'first-of-group':'dup'}">
            <td>${isFirst ? r.idx : ''}</td>
            <td>${isFirst
              ? `<div class="creator-cell"><div class="avatar" style="background:${colorFor(r.nick)}">${escapeHtml(initials(r.nick))}</div>@${escapeHtml(r.nick)}</div>`
              : `<span class="muted">↳ duplicate #${j+1}</span>`}</td>
            <td>${isFirst ? `<span class="status-pill posted">Posted</span>` : ''}</td>
            <td>${escapeHtml(fmtDate(v.date))}</td>
            <td><a class="link-cell" href="${escapeHtml(v.link)}" target="_blank" rel="noopener">${escapeHtml(v.link)}</a></td>
            <td class="num">${isFirst ? r.videos.length : ''}</td>
          </tr>`);
        });
      }
    });
    tb.innerHTML = html.join('') || `<tr><td colspan="6" style="padding:24px;text-align:center;color:var(--muted)">No matches</td></tr>`;
  }

  $('#run-affiliate').addEventListener('click', runAffiliate);
  $('#clear-affiliate').addEventListener('click', () => {
    vlistRows = []; nicknames = []; affResult = [];
    $('#dz-vlist').classList.remove('filled');
    $('#dz-nicks').classList.remove('filled');
    $('#dz-vlist .dz-title').textContent = 'Video_List.xlsx';
    $('#dz-nicks .dz-title').textContent = 'Nicknames.txt';
    $('#nicks-sub').innerHTML = 'or <button class="link" data-for="file-nicks">browse</button>';
    $('#file-vlist').value = ''; $('#file-nicks').value = '';
    $('#aff-result').hidden = true;
    $('#run-affiliate').disabled = true;
  });
  $('#aff-search').addEventListener('input', renderAffiliate);
  $$('.toggle').forEach(b => b.addEventListener('click', () => {
    $$('.toggle').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    affFilter = b.dataset.filter;
    renderAffiliate();
  }));
  $('#aff-export').addEventListener('click', () => {
    const head = ['#','Creator','Status','Posted Date','Video Link'];
    const rows = [];
    affResult.forEach(r => {
      if (r.videos.length === 0){
        rows.push([r.idx, '@'+r.nick, 'Not Posted', '', '']);
      } else {
        r.videos.forEach((v,j) => {
          rows.push([j===0?r.idx:'', '@'+r.nick, j===0?'Posted':'Duplicate', fmtDate(v.date), v.link]);
        });
      }
    });
    downloadCSV([head, ...rows], 'affiliate-status.csv');
  });

  wireDropzone('dz-vlist','file-vlist', handleVlistFile);
  wireDropzone('dz-nicks','file-nicks', handleNicksFile);
})();
