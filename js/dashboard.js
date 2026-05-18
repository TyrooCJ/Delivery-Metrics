/**
 * dashboard.js — CJ CPS Performance Dashboard
 * Reads from Google Sheets via Apps Script
 */

const MONTHS        = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAYS_IN_MONTH = {Jan:31,Feb:28,Mar:31,Apr:30,May:31,Jun:30,Jul:31,Aug:31,Sep:30,Oct:31,Nov:30,Dec:31};
const TRIP_COM_CID  = '4368684';
const TODAY         = new Date();
const CURRENT_MONTH = MONTHS[TODAY.getMonth()];
const CURRENT_MONTH_IDX = TODAY.getMonth();

let advertisers  = [];
let dailyRecs    = [];
let monthlyRecs  = [];
let dataCoverage = {};
let filteredAdvs = [];
let charts       = {};

const el  = id  => document.getElementById(id);
const $$$ = sel => [...document.querySelectorAll(sel)];

// ── BOOT ──────────────────────────────────────────────────────────────
async function init() {
  showLoadingState(true);
  try {
    // Read advertisers from local JSON (static, in repo)
    const advRes = await fetch(`data/advertisers.json?t=${Date.now()}`);
    if (!advRes.ok) throw new Error('Could not load advertisers.json');
    advertisers = await advRes.json();

    // Read actuals from Google Sheets via Apps Script
    const actuals = await DB.getActuals();
    dailyRecs    = actuals.dailyRecords   || [];
    monthlyRecs  = actuals.monthlyRecords || [];
    dataCoverage = actuals.dataCoverage   || {};

    populateFilters();
    bindEvents();
    renderAll();
  } catch(err) {
    el('loadError').textContent = 'Failed to load data: ' + err.message;
    el('loadError').style.display = 'block';
  }
  showLoadingState(false);
}

function showLoadingState(on) {
  el('loadingBar').style.width = on ? '60%' : '100%';
  setTimeout(() => { el('loadingBar').style.opacity = on ? '1' : '0'; }, on ? 0 : 400);
}

// ── FILTERS ───────────────────────────────────────────────────────────
function populateFilters() {
  const geos     = [...new Set(advertisers.map(a => a.geo))].filter(Boolean).sort();
  const programs = [...new Set(advertisers.map(a => a.program))].filter(Boolean).sort();
  const pods     = [...new Set(advertisers.map(a => a.pod))].filter(Boolean).sort();

  populate('monthFilter', MONTHS.map(m => ({ val: m, label: m + (m === CURRENT_MONTH ? ' (current)' : '') })), CURRENT_MONTH);
  populate('geoFilter',     geos.map(g => ({ val: g, label: g })));
  populate('programFilter', programs.map(p => ({ val: p, label: p })));
  populate('podFilter',     pods.map(p => ({ val: p, label: p })));
}

function populate(selectId, opts, selected = '') {
  const sel = el(selectId);
  [...sel.options].filter(o => o.value !== 'all').forEach(o => o.remove());
  opts.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o.val; opt.textContent = o.label;
    if (o.val === selected) opt.selected = true;
    sel.appendChild(opt);
  });
}

function getFilters() {
  return {
    bob:      $$$('.bob-btn').find(b => b.classList.contains('active'))?.dataset.val || 'all',
    month:    el('monthFilter').value,
    geo:      el('geoFilter').value,
    program:  el('programFilter').value,
    status:   el('statusFilter').value,
    serviced: el('servicedFilter').value,
    pod:      el('podFilter').value,
  };
}

function applyFilters(f) {
  return advertisers.filter(a => {
    if (f.bob !== 'all' && a.bookOfBusiness !== f.bob) return false;
    if (f.geo !== 'all' && a.geo !== f.geo) return false;
    if (f.program !== 'all' && a.program !== f.program) return false;
    if (f.status !== 'all' && a.accountStatus !== f.status) return false;
    if (f.serviced !== 'all' && a.servicedAccount !== f.serviced) return false;
    if (f.pod !== 'all' && a.pod !== f.pod) return false;
    return true;
  });
}

function bindEvents() {
  ['monthFilter','geoFilter','programFilter','statusFilter','servicedFilter','podFilter'].forEach(id => {
    el(id).addEventListener('change', renderAll);
  });
  $$$('.bob-btn').forEach(b => b.addEventListener('click', () => {
    $$$('.bob-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    renderAll();
  }));
  el('resetFilters').addEventListener('click', () => {
    $$$('.bob-btn').forEach(b => b.classList.remove('active'));
    el('bobAll').classList.add('active');
    ['geoFilter','programFilter','statusFilter','servicedFilter','podFilter'].forEach(id => el(id).value = 'all');
    el('monthFilter').value = CURRENT_MONTH;
    renderAll();
  });
  $$$('.tbl-tab').forEach(t => t.addEventListener('click', () => {
    $$$('.tbl-tab').forEach(x => x.classList.remove('active'));
    $$$('.tbl-pane').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    el(t.dataset.pane).classList.add('active');
  }));
  $$$('[data-sort]').forEach(th => th.addEventListener('click', () => handleSort(th)));
  el('advSearch').addEventListener('input', () => renderAdvTable(getFilters(), filteredAdvs));
  el('pubSearch').addEventListener('input', () => renderPubTable(getFilters()));
}

// ── PRORATION ─────────────────────────────────────────────────────────
function prorationFactor(month) {
  const mi = MONTHS.indexOf(month);
  if (mi > CURRENT_MONTH_IDX) return 1;
  const days = dataCoverage[month] || (mi === CURRENT_MONTH_IDX ? TODAY.getDate() : DAYS_IN_MONTH[month]);
  return days / (DAYS_IN_MONTH[month] || 30);
}

function coverageDays(month) {
  const mi = MONTHS.indexOf(month);
  return dataCoverage[month] || (mi === CURRENT_MONTH_IDX ? TODAY.getDate() : DAYS_IN_MONTH[month] || 30);
}

// ── ACTUALS LOOKUP ────────────────────────────────────────────────────
function hasActualsForMonth(month) {
  return dailyRecs.some(r => r.month === month) || monthlyRecs.some(r => r.month === month);
}

function getActuals(month, advCIDs = null) {
  if (!hasActualsForMonth(month)) return null;
  const cidSet = advCIDs ? new Set(advCIDs) : null;
  const filter = r => r.month === month && (!cidSet || cidSet.has(r.advCid));
  const all = [...dailyRecs.filter(filter), ...monthlyRecs.filter(filter)];
  if (!all.length) return null;
  return {
    clicks:   all.reduce((s,r) => s+(r.clicks||0), 0),
    netFee:   all.reduce((s,r) => s+(r.netFee||0), 0),
    grossFee: all.reduce((s,r) => s+(r.grossFee||0), 0),
    reversals:all.reduce((s,r) => s+((r.grossFee||0)-(r.netFee||0)), 0),
  };
}

function achvPct(actual, fullTarget, month) {
  if (actual === null || actual === undefined) return null;
  const prorated = fullTarget * prorationFactor(month);
  if (!prorated) return actual > 0 ? Infinity : null;
  return (actual / prorated) * 100;
}

function achvClass(pct) {
  if (pct === null)     return 'achv-na';
  if (pct === Infinity) return 'achv-notgt';
  if (pct >= 100)       return 'achv-green';
  if (pct >= 70)        return 'achv-yellow';
  return 'achv-red';
}

function achvBadge(pct, month) {
  if (pct === null)     return `<span class="achv-chip achv-na">—</span>`;
  if (pct === Infinity) return `<span class="achv-chip achv-notgt" title="No target set">✓</span>`;
  const days = coverageDays(month);
  const total = DAYS_IN_MONTH[month] || 30;
  return `<span class="achv-chip ${achvClass(pct)}" title="Day ${days}/${total} · ${(prorationFactor(month)*100).toFixed(0)}% of month">${pct.toFixed(1)}%</span>`;
}

const fmtM    = v => v == null ? '—' : '$' + (Math.abs(v) >= 1000 ? (v/1000).toFixed(1)+'K' : v.toFixed(0));
const fmtN    = v => v == null ? '—' : v >= 1e6 ? (v/1e6).toFixed(2)+'M' : v >= 1000 ? (v/1000).toFixed(1)+'K' : Math.round(v).toString();
const fmtFull = v => v == null ? '—' : '$' + Number(v).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});

// ── RENDER ALL ────────────────────────────────────────────────────────
function renderAll() {
  const f = getFilters();
  filteredAdvs = applyFilters(f);
  renderKPIs(f, filteredAdvs);
  renderCharts(f, filteredAdvs);
  renderAdvTable(f, filteredAdvs);
  renderPubTable(f);
}

// ── KPIs ──────────────────────────────────────────────────────────────
function renderKPIs(f, advList) {
  const month = f.month;
  const mi    = MONTHS.indexOf(month);
  const isFut = mi > CURRENT_MONTH_IDX;
  const cids  = advList.map(a => a.cid);

  const fullFee   = advList.reduce((s,a) => s+(a.feeTargets?.[month]||0), 0);
  const fullClick = advList.reduce((s,a) => s+(a.clickTargets?.[month]||0), 0);
  const prorFee   = fullFee   * prorationFactor(month);
  const prorClick = fullClick * prorationFactor(month);
  const act       = getActuals(month, cids);
  const days      = coverageDays(month);
  const total     = DAYS_IN_MONTH[month] || 30;
  const covLabel  = act && !isFut ? ` · day ${days}/${total} (${(prorationFactor(month)*100).toFixed(0)}%)` : '';

  const netFee  = act?.netFee ?? null;
  const feePct  = (netFee !== null && prorFee) ? (netFee/prorFee)*100 : null;
  el('kpiFeeVal').textContent = netFee !== null ? fmtM(netFee) : (isFut ? '—' : 'No data');
  el('kpiFeeSub').textContent = isFut ? `Full target: ${fmtM(fullFee)}` : `Prorated: ${fmtM(prorFee)}${covLabel}${feePct !== null ? '  ·  '+feePct.toFixed(1)+'%' : ''}`;
  el('kpiFeeBar').style.width = Math.min(feePct||0, 100) + '%';
  el('kpiFeeBar').className   = 'kpi-bar ' + achvClass(feePct);

  const clicks   = act?.clicks ?? null;
  const clickPct = (clicks !== null && prorClick) ? (clicks/prorClick)*100 : null;
  el('kpiClickVal').textContent = clicks !== null ? fmtN(clicks) : (isFut ? '—' : 'No data');
  el('kpiClickSub').textContent = isFut ? `Full target: ${fmtN(fullClick)}` : `Prorated: ${fmtN(prorClick)}${covLabel}${clickPct !== null ? '  ·  '+clickPct.toFixed(1)+'%' : ''}`;
  el('kpiClickBar').style.width = Math.min(clickPct||0, 100) + '%';
  el('kpiClickBar').className   = 'kpi-bar ' + achvClass(clickPct);

  const rev = act?.reversals ?? null;
  el('kpiRevVal').textContent = rev !== null ? fmtM(rev) : '—';
  el('kpiRevSub').textContent = rev !== null ? `Gross: ${fmtM(act.grossFee)}` : 'Upload gross file';

  const live  = advList.filter(a => a.accountStatus === 'Existing' || a.accountStatus === 'Live').length;
  const churn = advList.filter(a => a.accountStatus === 'Churn').length;
  const nal   = advList.filter(a => a.accountStatus === 'New - NAL').length;
  el('kpiLiveVal').textContent  = live;
  el('kpiChurnVal').textContent = churn;
  el('kpiNalVal').textContent   = nal;
  el('kpiAccSub').textContent   = `${advList.length} total · ${nal} NAL`;
}

// ── CHARTS ────────────────────────────────────────────────────────────
function renderCharts(f, advList) {
  const cids = advList.map(a => a.cid);
  const feeData=[], clickData=[], feeTargData=[], clickTargData=[], revData=[];
  MONTHS.forEach(m => {
    const mi  = MONTHS.indexOf(m);
    const act = getActuals(m, cids);
    const ff  = advList.reduce((s,a)=>s+(a.feeTargets?.[m]||0),0);
    const fc  = advList.reduce((s,a)=>s+(a.clickTargets?.[m]||0),0);
    feeData.push(act?.netFee ?? null);
    clickData.push(act?.clicks ?? null);
    feeTargData.push(mi <= CURRENT_MONTH_IDX ? ff*prorationFactor(m) : ff);
    clickTargData.push(mi <= CURRENT_MONTH_IDX ? fc*prorationFactor(m) : fc);
    revData.push(act?.reversals ?? null);
  });

  renderTrendChart('feeChart', 'Net Fee', feeData, feeTargData, true);
  renderTrendChart('clickChart', 'Clicks', clickData, clickTargData, false);
  renderReversalsChart(revData);
  renderTopAdvChart(f, cids);
  renderTopPubChart(f);
  renderBreakdownChart('progChart', advList, f.month, 'program');
  renderBreakdownChart('geoChart',  advList, f.month, 'geo');
  renderPoDChart(f, advList);
}

function destroyChart(id) { if (charts[id]) { charts[id].destroy(); delete charts[id]; } }

const CD = { // chart defaults
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: { color: 'rgba(31,33,48,1)' }, ticks: { color: '#5a6075', font: { size: 10 } } },
    y: { grid: { color: 'rgba(31,33,48,1)' }, ticks: { color: '#5a6075', font: { size: 10 } } }
  }
};

function renderTrendChart(id, label, actData, targData, isFee) {
  destroyChart(id);
  const ctx   = el(id).getContext('2d');
  const color = isFee ? '#00e5b4' : '#4f7cff';
  charts[id]  = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: MONTHS,
      datasets: [
        {
          data: actData,
          backgroundColor: MONTHS.map((_,i) => {
            if (actData[i] === null) return 'transparent';
            const pct = targData[i] ? actData[i]/targData[i]*100 : 100;
            return pct >= 100 ? 'rgba(0,229,180,0.7)' : pct >= 70 ? 'rgba(245,200,66,0.7)' : 'rgba(255,79,110,0.7)';
          }),
          borderRadius: 2, order: 2,
        },
        { data: targData, type: 'line', borderColor: color, borderWidth: 1.5, borderDash: [4,3], pointRadius: 3, pointBackgroundColor: color, fill: false, tension: 0.3, order: 1 }
      ]
    },
    options: { ...CD, plugins: { ...CD.plugins, tooltip: { callbacks: { label: c => c.raw === null ? 'No data' : isFee ? '$'+Number(c.raw).toLocaleString(undefined,{maximumFractionDigits:0}) : Number(c.raw).toLocaleString() } } }, scales: { ...CD.scales, y: { ...CD.scales.y, ticks: { ...CD.scales.y.ticks, callback: v => isFee ? '$'+fmtN(v) : fmtN(v) } } } }
  });
}

function renderReversalsChart(revData) {
  destroyChart('revChart');
  charts['revChart'] = new Chart(el('revChart').getContext('2d'), {
    type: 'bar',
    data: { labels: MONTHS, datasets: [{ data: revData, backgroundColor: revData.map(v => v === null ? 'transparent' : v < 0 ? 'rgba(255,79,110,0.7)' : 'rgba(0,229,180,0.5)'), borderRadius: 2 }] },
    options: { ...CD, plugins: { ...CD.plugins, tooltip: { callbacks: { label: c => c.raw === null ? 'No data' : '$'+Number(c.raw).toLocaleString(undefined,{maximumFractionDigits:0}) } } }, scales: { ...CD.scales, y: { ...CD.scales.y, ticks: { ...CD.scales.y.ticks, callback: v => '$'+fmtN(v) } } } }
  });
}

function renderTopAdvChart(f, cids) {
  const month = f.month;
  const advMap = {};
  [...dailyRecs, ...monthlyRecs].filter(r => r.month === month && cids.includes(r.advCid)).forEach(r => {
    if (!advMap[r.advCid]) advMap[r.advCid] = 0;
    advMap[r.advCid] += r.netFee || 0;
  });
  const sorted = Object.entries(advMap).sort((a,b)=>b[1]-a[1]).slice(0,10);
  destroyChart('topAdvChart');
  charts['topAdvChart'] = new Chart(el('topAdvChart').getContext('2d'), {
    type: 'bar',
    data: { labels: sorted.map(([cid]) => advertisers.find(a=>a.cid===cid)?.advertiserName.slice(0,16)||cid), datasets: [{ data: sorted.map(([,v])=>v), backgroundColor: 'rgba(0,229,180,0.6)', borderRadius: 2 }] },
    options: { ...CD, indexAxis: 'y', scales: { ...CD.scales, x: { ...CD.scales.x, ticks: { ...CD.scales.x.ticks, callback: v => '$'+fmtN(v) } } } }
  });
}

function renderTopPubChart(f) {
  const month = f.month;
  const pubMap = {};
  [...dailyRecs, ...monthlyRecs].filter(r => r.month === month).forEach(r => {
    if (!pubMap[r.pubCid]) pubMap[r.pubCid] = { name: r.pubName, val: 0 };
    pubMap[r.pubCid].val += r.netFee || 0;
  });
  const sorted = Object.values(pubMap).sort((a,b)=>b.val-a.val).slice(0,10);
  destroyChart('topPubChart');
  charts['topPubChart'] = new Chart(el('topPubChart').getContext('2d'), {
    type: 'bar',
    data: { labels: sorted.map(p=>p.name.slice(0,18)), datasets: [{ data: sorted.map(p=>p.val), backgroundColor: 'rgba(79,124,255,0.6)', borderRadius: 2 }] },
    options: { ...CD, indexAxis: 'y', scales: { ...CD.scales, x: { ...CD.scales.x, ticks: { ...CD.scales.x.ticks, callback: v => '$'+fmtN(v) } } } }
  });
}

function renderBreakdownChart(id, advList, month, field) {
  const groups = [...new Set(advList.map(a=>a[field]))].filter(Boolean);
  const vals   = groups.map(g => getActuals(month, advList.filter(a=>a[field]===g).map(a=>a.cid))?.netFee || 0);
  const colors = ['rgba(0,229,180,0.7)','rgba(79,124,255,0.7)','rgba(245,200,66,0.7)','rgba(255,79,110,0.7)','rgba(107,114,128,0.7)','rgba(200,100,200,0.7)'];
  destroyChart(id);
  charts[id] = new Chart(el(id).getContext('2d'), {
    type: 'doughnut',
    data: { labels: groups, datasets: [{ data: vals, backgroundColor: colors.slice(0, groups.length), borderWidth: 0 }] },
    options: { ...CD, cutout: '65%', plugins: { ...CD.plugins, legend: { display: true, position: 'bottom', labels: { color: '#5a6075', boxWidth: 10, font: { size: 10 } } } } }
  });
}

function renderPoDChart(f, advList) {
  const month = f.month;
  const pods  = [...new Set(advList.map(a=>a.pod))].filter(p=>p&&p!=='Null');
  const data  = pods.map(pod => {
    const cids    = advList.filter(a=>a.pod===pod).map(a=>a.cid);
    const fullFee = advList.filter(a=>a.pod===pod).reduce((s,a)=>s+(a.feeTargets?.[month]||0),0);
    const act     = getActuals(month, cids);
    return { pod, pct: (act?.netFee && fullFee) ? (act.netFee/(fullFee*prorationFactor(month)))*100 : 0 };
  }).sort((a,b)=>b.pct-a.pct);
  destroyChart('podChart');
  charts['podChart'] = new Chart(el('podChart').getContext('2d'), {
    type: 'bar',
    data: { labels: data.map(d=>d.pod.split(' ')[0]), datasets: [{ data: data.map(d=>d.pct), backgroundColor: data.map(d=>d.pct>=100?'rgba(0,229,180,0.7)':d.pct>=70?'rgba(245,200,66,0.7)':'rgba(255,79,110,0.7)'), borderRadius: 2 }] },
    options: { ...CD, scales: { ...CD.scales, y: { ...CD.scales.y, ticks: { ...CD.scales.y.ticks, callback: v=>v+'%' }, max: 150 } } }
  });
}

// ── ADVERTISER TABLE ──────────────────────────────────────────────────
let advSort = { col: 'feeAchv', dir: -1 };

function handleSort(th) {
  const col = th.dataset.sort;
  advSort.dir = advSort.col === col ? advSort.dir * -1 : -1;
  advSort.col = col;
  $$$('[data-sort]').forEach(t => t.classList.remove('sort-asc','sort-desc'));
  th.classList.add(advSort.dir === 1 ? 'sort-asc' : 'sort-desc');
  renderAdvTable(getFilters(), filteredAdvs);
}

function renderAdvTable(f, advList) {
  const month = f.month;
  const q     = el('advSearch').value.toLowerCase();
  let rows    = advList.map(adv => {
    const act       = getActuals(month, [adv.cid]);
    const fullFee   = adv.feeTargets?.[month]  || 0;
    const fullClick = adv.clickTargets?.[month] || 0;
    const prorFee   = fullFee   * prorationFactor(month);
    const prorClick = fullClick * prorationFactor(month);
    const netFee    = act?.netFee    ?? null;
    const clicks    = act?.clicks    ?? null;
    const reversals = act?.reversals ?? null;
    return { ...adv, fullFee, fullClick, prorFee, prorClick, netFee, clicks, reversals,
      feeAchv:   achvPct(netFee, fullFee, month),
      clickAchv: achvPct(clicks, fullClick, month) };
  });
  if (q) rows = rows.filter(r => r.advertiserName.toLowerCase().includes(q) || r.cid.includes(q));
  rows.sort((a,b) => { const va=a[advSort.col]??-Infinity, vb=b[advSort.col]??-Infinity; return (va>vb?1:va<vb?-1:0)*advSort.dir; });
  el('advBody').innerHTML = rows.map(r => `
    <tr>
      <td class="adv-col"><div class="adv-name-tbl">${r.advertiserName}</div></td>
      <td class="mono">${r.cid}</td>
      <td><span class="bob-badge ${r.bookOfBusiness==='New Book'?'bob-new':'bob-ex'}">${r.bookOfBusiness==='New Book'?'New':'Existing'}</span></td>
      <td>${r.program||'—'}</td>
      <td>${r.geo||'—'}</td>
      <td><span class="status-badge status-${(r.accountStatus||'').toLowerCase().replace(/[^a-z]/g,'-')}">${r.accountStatus}</span></td>
      <td>${r.servicedAccount}</td>
      <td class="pod-cell">${r.pod}</td>
      <td class="mono num">${fmtN(r.fullClick)}</td>
      <td class="mono num">${fmtN(Math.round(r.prorClick))}</td>
      <td class="mono num">${r.clicks!==null?fmtN(r.clicks):'—'}</td>
      <td>${achvBadge(r.clickAchv,month)}</td>
      <td class="mono num">${fmtM(r.fullFee)}</td>
      <td class="mono num">${fmtM(r.prorFee)}</td>
      <td class="mono num">${r.netFee!==null?fmtM(r.netFee):'—'}</td>
      <td>${achvBadge(r.feeAchv,month)}</td>
      <td class="mono num ${r.reversals<0?'neg':''}">${r.reversals!==null?fmtM(r.reversals):'—'}</td>
    </tr>`).join('') || '<tr><td colspan="17" class="empty-row">No advertisers match filters</td></tr>';
  el('advCount').textContent = `${rows.length} advertisers`;
}

// ── PUBLISHER TABLE ───────────────────────────────────────────────────
function renderPubTable(f) {
  const month  = f.month;
  const q      = el('pubSearch').value.toLowerCase();
  const pubMap = {};
  [...dailyRecs, ...monthlyRecs].filter(r => r.month === month).forEach(r => {
    if (!pubMap[r.pubCid]) pubMap[r.pubCid] = { pubName:r.pubName, pubCid:r.pubCid, clicks:0, netFee:0, grossFee:0, advSet:new Set() };
    pubMap[r.pubCid].clicks   += r.clicks   || 0;
    pubMap[r.pubCid].netFee   += r.netFee   || 0;
    pubMap[r.pubCid].grossFee += r.grossFee || 0;
    pubMap[r.pubCid].advSet.add(r.advCid);
  });
  let rows = Object.values(pubMap).map(p => ({ ...p, reversals: p.grossFee-p.netFee, advCount: p.advSet.size }));
  if (q) rows = rows.filter(r => r.pubName.toLowerCase().includes(q) || r.pubCid.includes(q));
  rows.sort((a,b) => b.netFee-a.netFee);
  el('pubBody').innerHTML = rows.map(r => `
    <tr>
      <td>${r.pubName}</td>
      <td class="mono">${r.pubCid}</td>
      <td class="mono num">${fmtN(r.clicks)}</td>
      <td class="mono num">${fmtFull(r.netFee)}</td>
      <td class="mono num">${fmtFull(r.grossFee)}</td>
      <td class="mono num ${r.reversals<0?'neg':''}">${fmtFull(r.reversals)}</td>
      <td class="mono num">${r.advCount}</td>
    </tr>`).join('') || '<tr><td colspan="7" class="empty-row">No publisher data for this month</td></tr>';
  el('pubCount').textContent = `${rows.length} publishers`;
}

// ── EXPORT ────────────────────────────────────────────────────────────
el('exportAdvBtn').addEventListener('click', () => {
  const f = getFilters(), month = f.month;
  const rows = filteredAdvs.map(adv => {
    const act = getActuals(month, [adv.cid]);
    return [adv.advertiserName,adv.cid,adv.bookOfBusiness,adv.program,adv.geo,adv.accountStatus,
      adv.servicedAccount,adv.pod,adv.clickTargets?.[month]||0,
      Math.round((adv.clickTargets?.[month]||0)*prorationFactor(month)),
      act?.clicks||'',act?.netFee||'',adv.feeTargets?.[month]||0,act?.reversals||''].join(',');
  });
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(['Advertiser,CID,Book,Program,Geo,Status,Serviced,PoD,ClickTgt,ProrClickTgt,Clicks,NetFee,FeeTgt,Reversals',...rows].join('\n'));
  a.download = `cj-${month}.csv`; a.click();
});

Array.prototype.find = Array.prototype.find || function(fn) { for(let i=0;i<this.length;i++) if(fn(this[i])) return this[i]; };

init();
