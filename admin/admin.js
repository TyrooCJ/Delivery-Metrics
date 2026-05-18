/**
 * admin.js — CJ CPS Admin Panel
 * Writes to Google Sheets via Apps Script (no API key, no auth)
 */

const ADMIN_PASSWORD = 'cjcps2026';
const MONTH_ORDER    = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAYS_IN_MONTH  = {Jan:31,Feb:28,Mar:31,Apr:30,May:31,Jun:30,Jul:31,Aug:31,Sep:30,Oct:31,Nov:30,Dec:31};
const GEO_OPTIONS    = ['IN','SEA','CJ BD','KR','VN','APAC, Others'];
const PROGRAM_OPTIONS= ['FPM','SS','GC','NA','Agency'];
const POD_OPTIONS    = ['Tanya Jain','Mukund Toshniwal','Praneeth Bajaj','Shreya Grover','Pooja Chouhan','Katie Vo','Null'];
const TRIP_COM_CID   = '4368684';
const TRIP_COM_SHARE = 0.165;
const BLOCKED_CIDS = new Set([
  // ── China (CN) accounts — ignored on every upload ──
  '1097361', // CyberLink
  '2683708', // LightInTheBox
  '3194603', // Wondershare
  '3387283', // GeekBuying
  '3773223', // Shein AMF
  '4295086', // PandaHall
  '4498040', // Banggood CJ Affiliate Pro
  '4699387', // Fairyseason
  '4723933', // PatPat
  '4777179', // Zaful
  '4839834', // Modlily.com
  '4854093', // Bellelily
  '5149517', // Eufy
  '5197358', // Tenorshare/PassFab
  '5306197', // PureVPN
  '5313197', // ITEAD
  '5594555', // Modelones.com
  '5599987', // Vivaia INT
  '5683510', // VideoProc
  '5815804', // EcoFlow
  '5824323', // UNice
  '5966681', // Vevor
  '6005268', // Cupshe US
  '6045815', // Hohem
  '6050938', // Vevor FR
  '6053590', // Nadula Hair
  '6067712', // Beauty Forever
  '6081048', // Glamermaid
  '6100283', // Roborock
  '6109855', // iWALK
  '6116651', // Klaiyi Hair
  '6123342', // EcoFlow EU
  '6163733', // myChway Beauty Tools
  '6164489', // EaseUS
  '6175965', // EcoFlow CA
  '6175973', // EcoFlow UK
  '6191107', // Bluetti Global
  '6216442', // Bluu
  '6229571', // Julia Hair
  '6242886', // VIVIDSTORM
  '6305416', // Halara
  '6316298', // Phrozen
  '6325655', // Luvme Hair
  '6326546', // Ulike
  '6342639', // Vantrue
  '6385512', // Fanka INT
  '6387385', // BloomChic
  '6404897', // Aiper
  '6424481', // Lifesight
  '6582116', // Funny Fuzzy
  '6584182', // HONGKONG DYU TECHNOLOGY
  '6685106', // Renogy
  '7087880', // Temu APAC
  '7182748', // Aiper AU
  '7185601', // Sunber Hair
  '7207881', // Urban Revivo
  '7385563', // Popilush US
  '7423961', // Fanttik
  '7443634', // Jackery
  '7461882', // Dreame US
  '7493867', // Vevor AU/CA/UK/MX
  '7504299', // Safeshell
  '7529241', // Aomei
  '7568188', // TCL homesecurity
  '7582444', // Bc Babycare
  '7603322', // Imobie
  '7633156', // Meross
  '7636568', // Coofandy
  '7641760', // Baseus US Amazon
  '7641772', // Baseus EU and UK Amazon
  '7686542', // KSP Performance
  '7696208', // Lexar
  '7696308', // Panda Office Limited
  '7696220', // Pexar - Amazon
  '7711902', // AliExpress - Global
  '7804601', // GearUP
  '7824417', // Mowrator
  '7839428', // Amotopart
  '7845357', // LILYSILK
  '7863754', // FITUEYES
  '7883485', // Honey Play Box
  '7892263', // kaerworld
  '5610532', // ZeBrand
  // ── IHG accounts ──
  '4386835', // InterContinental Hotels Group
  '4390377', // IHG Greater China
]);

let netParsed   = null;
let grossParsed = null;
let mergedRows  = null;
let newAdvCIDs  = [];
let currentActuals = null;
let currentAdvs    = null;

const el  = id  => document.getElementById(id);
const $$$ = sel => [...document.querySelectorAll(sel)];

// ── TOAST ─────────────────────────────────────────────────────────────
function showToast(msg, isErr=false) {
  const t = el('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isErr?' err':'');
  clearTimeout(t._tid);
  t._tid = setTimeout(() => t.classList.remove('show'), 4000);
}

function log(msg, type='info') {
  const line = document.createElement('div');
  line.className = `log-line ${type}`;
  line.textContent = msg;
  el('uploadLog').appendChild(line);
  el('uploadLog').scrollTop = el('uploadLog').scrollHeight;
}

function clearLog() { el('uploadLog').innerHTML = ''; }

// ── LOGIN ─────────────────────────────────────────────────────────────
el('passwordInput').addEventListener('keydown', e => { if(e.key==='Enter') handleLogin(); });

function handleLogin() {
  if (el('passwordInput').value !== ADMIN_PASSWORD) {
    el('loginError').textContent = 'Incorrect password.'; return;
  }
  el('loginSection').style.display = 'none';
  el('mainSection').style.display  = 'block';
  loadDBStatus();
}

// ── TABS ──────────────────────────────────────────────────────────────
$$$('.tab-btn').forEach(btn => btn.addEventListener('click', () => {
  $$$('.tab-btn').forEach(b => b.classList.remove('active'));
  $$$('.tab-pane').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  el(btn.dataset.tab).classList.add('active');
  if (btn.dataset.tab === 'targetsTab') loadTargetsTab();
}));

// ── CID HELPERS ───────────────────────────────────────────────────────
function normalizeCID(raw) {
  return String(raw).replace(/[\uFEFF\u200B\u00A0\s]/g,'').replace(/[^\d]/g,'');
}
function isValidCID(raw) {
  const n = normalizeCID(raw);
  return n.length >= 4 && /^\d+$/.test(n);
}

// ── DATE PARSE ────────────────────────────────────────────────────────
function parseDateCol(s) {
  const m = String(s).trim().match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (!m) return null;
  const mon3 = m[2].slice(0,3);
  const mon  = mon3.charAt(0).toUpperCase() + mon3.slice(1,3).toLowerCase();
  return MONTH_ORDER.includes(mon) ? { month: mon, day: parseInt(m[1],10) } : null;
}

function getDailyMonths() {
  const now  = new Date();
  const cur  = now.getMonth();
  const prev = cur === 0 ? 11 : cur - 1;
  return new Set([MONTH_ORDER[cur], MONTH_ORDER[prev]]);
}

// ── DROP ZONES ────────────────────────────────────────────────────────
['netZone','grossZone'].forEach(zoneId => {
  const zone = el(zoneId);
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFileDrop(zoneId, file);
  });
  zone.addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type='file'; inp.accept='.csv,.txt,.tsv';
    inp.onchange = () => { if(inp.files[0]) handleFileDrop(zoneId, inp.files[0]); };
    inp.click();
  });
});

function handleFileDrop(zoneId, file) {
  const isNet = zoneId === 'netZone';
  const zone  = el(zoneId);
  zone.querySelector('.zone-name').textContent = file.name;
  zone.classList.add('has-file');
  if (isNet) netParsed = null; else grossParsed = null;
  parseFile(file, isNet);
}

async function parseFile(file, isNet) {
  try {
    const matrix = await readCrosstab(file);
    const parsed = extractFromMatrix(matrix);
    if (isNet) netParsed = parsed; else grossParsed = parsed;
    const advCount = Object.keys(parsed).length;
    log(`✓ ${isNet?'Net':'Gross'} file parsed — ${advCount} advertisers`, 'success');
    if (netParsed) { el('previewBtn').disabled=false; el('previewBtn').textContent='Preview & Commit'; }
  } catch(err) {
    log(`✗ Parse error (${isNet?'Net':'Gross'}): ${err.message}`, 'error');
  }
}

function readCrosstab(file) {
  return new Promise((resolve, reject) => {
    const tryParse = text => {
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      resolve(text.split(/\r?\n/).map(l => l.split('\t')));
    };
    const r = new FileReader();
    r.onload  = e => tryParse(e.target.result);
    r.onerror = () => { const r2=new FileReader(); r2.onload=e=>tryParse(e.target.result); r2.onerror=reject; r2.readAsText(file,'UTF-8'); };
    r.readAsText(file, 'UTF-16LE');
  });
}

/**
 * Extract from CJ crosstab.
 * Returns: { advCid: { pubCid: { pubName, advName, dates: { 'Mon|DD': { clicks, netFee } } } } }
 */
function extractFromMatrix(matrix) {
  let headerIdx = -1;
  for (let i=0; i<Math.min(5,matrix.length); i++) {
    if (matrix[i].some(c => String(c||'').includes('Dimension 1'))) { headerIdx=i; break; }
  }
  if (headerIdx < 0) throw new Error('Header row not found');

  const colDateMap = {};
  matrix[headerIdx].forEach((h,j) => {
    if (j < 3) return;
    const p = parseDateCol(String(h||'').trim());
    if (p) colDateMap[j] = p;
  });
  if (!Object.keys(colDateMap).length) throw new Error('No date columns found');

  const result = {};
  let curAdvCid=null, curAdvName=null;

  for (let i=headerIdx+1; i<matrix.length; i++) {
    const cols   = matrix[i];
    const dim1   = String(cols[0]||'').trim();
    const dim2   = String(cols[1]||'').trim();
    const metric = String(cols[2]||'').trim().toLowerCase();

    if (dim1 && dim1 !== 'nan') {
      const parts  = dim1.split('|');
      const rawCid = parts[0].trim();
      if (isValidCID(rawCid)) {
        curAdvCid  = normalizeCID(rawCid);
        curAdvName = (parts[1]||rawCid).trim();
        if (BLOCKED_CIDS.has(curAdvCid)) { curAdvCid=null; curAdvName=null; }
      } else { curAdvCid=null; curAdvName=null; }
    }

    if (!curAdvCid || !dim2 || dim2==='nan' || !metric) continue;

    const pubParts = dim2.split('|');
    if (!isValidCID(pubParts[0].trim())) continue;
    const pubCid  = normalizeCID(pubParts[0].trim());
    const pubName = (pubParts[1]||pubParts[0]).trim();

    const isClicks = metric.includes('click');
    const isFee    = metric.includes('fee');
    if (!isClicks && !isFee) continue;

    if (!result[curAdvCid]) result[curAdvCid] = {};
    if (!result[curAdvCid][pubCid]) result[curAdvCid][pubCid] = { pubName, advName:curAdvName, dates:{} };

    for (const [jStr, dateInfo] of Object.entries(colDateMap)) {
      const raw = String(cols[parseInt(jStr)]||'').trim();
      if (!raw || raw==='NaN'||raw==='nan'||raw==='-') continue;
      const val = parseFloat(raw.replace(/,/g,''));
      if (isNaN(val)) continue;
      const key = `${dateInfo.month}|${dateInfo.day}`;
      if (!result[curAdvCid][pubCid].dates[key]) result[curAdvCid][pubCid].dates[key] = {clicks:0,netFee:0};
      if (isClicks) result[curAdvCid][pubCid].dates[key].clicks  += val;
      if (isFee)    result[curAdvCid][pubCid].dates[key].netFee  += val;
    }
  }
  return result;
}

// ── PREVIEW ───────────────────────────────────────────────────────────
el('previewBtn').addEventListener('click', async () => {
  el('previewBtn').disabled=true; el('previewBtn').textContent='Loading…';
  clearLog();
  try {
    log('📡 Fetching current database…');
    currentActuals = await DB.getActuals();
    log(`✓ DB loaded — ${(currentActuals.dailyRecords||[]).length} daily + ${(currentActuals.monthlyRecords||[]).length} monthly records`);

    // Merge net+gross
    const combined = mergeParsed(netParsed, grossParsed);

    // Detect coverage
    const coverage = {};
    for (const pubs of Object.values(combined)) {
      for (const pubData of Object.values(pubs)) {
        for (const key of Object.keys(pubData.dates)) {
          const [mon, dayStr] = key.split('|');
          const day = parseInt(dayStr);
          if (!coverage[mon] || day > coverage[mon]) coverage[mon] = day;
        }
      }
    }
    log(`✓ Coverage: ${Object.entries(coverage).map(([m,d])=>`${m}:${d}`).join(', ')}`);

    // Check new advertisers
    const knownCIDs = new Set((await DB.getAdvertisers()).map(a => normalizeCID(String(a.cid))));
    newAdvCIDs = [];
    for (const [advCid, pubs] of Object.entries(combined)) {
      if (!knownCIDs.has(advCid)) {
        newAdvCIDs.push({ cid: advCid, advertiserName: Object.values(pubs)[0]?.advName || `CID ${advCid}` });
      }
    }
    if (newAdvCIDs.length > 0) {
      log(`⚠ ${newAdvCIDs.length} new advertiser(s) — fill details below`, 'warn');
      renderNewAdvModal(newAdvCIDs);
    }

    // Build rows
    const dailyMonths = getDailyMonths();
    mergedRows = buildFlatRows(combined, dailyMonths);
    window._parsedCoverage = coverage;

    log(`✓ ${mergedRows.daily.length} daily + ${mergedRows.monthly.length} monthly rows ready`);
    renderPreview(mergedRows, coverage);
    if (!newAdvCIDs.length) el('commitBtn').style.display='inline-flex';
  } catch(err) {
    log(`✗ ${err.message}`, 'error');
  } finally {
    el('previewBtn').disabled=false; el('previewBtn').textContent='Preview & Commit';
  }
});

function mergeParsed(net, gross) {
  const combined = {};
  const sources  = [{parsed:net,type:'net'},{parsed:gross,type:'gross'}];
  for (const {parsed, type} of sources) {
    if (!parsed) continue;
    for (const [advCid, pubs] of Object.entries(parsed)) {
      if (!combined[advCid]) combined[advCid] = {};
      for (const [pubCid, pubData] of Object.entries(pubs)) {
        if (!combined[advCid][pubCid]) combined[advCid][pubCid] = {pubName:pubData.pubName, advName:pubData.advName, dates:{}};
        for (const [key, vals] of Object.entries(pubData.dates)) {
          if (!combined[advCid][pubCid].dates[key]) combined[advCid][pubCid].dates[key] = {clicks:0,netFee:0,grossFee:0};
          const d = combined[advCid][pubCid].dates[key];
          if (type==='net')   { d.clicks+=vals.clicks||0; d.netFee+=vals.netFee||0; }
          if (type==='gross') { d.grossFee+=vals.netFee||0; } // gross file: netFee field = grossFee
        }
      }
    }
  }
  // Apply Trip.com share
  if (combined[TRIP_COM_CID]) {
    for (const pubData of Object.values(combined[TRIP_COM_CID])) {
      for (const d of Object.values(pubData.dates)) {
        d.netFee   *= TRIP_COM_SHARE;
        d.grossFee *= TRIP_COM_SHARE;
      }
    }
  }
  return combined;
}

function buildFlatRows(combined, dailyMonths) {
  const daily=[], monthly=[];
  for (const [advCid, pubs] of Object.entries(combined)) {
    for (const [pubCid, pubData] of Object.entries(pubs)) {
      const monthMap = {};
      for (const [key, vals] of Object.entries(pubData.dates)) {
        const [mon, dayStr] = key.split('|');
        const day = parseInt(dayStr);
        if (dailyMonths.has(mon)) {
          daily.push({ advCid, pubCid, pubName:pubData.pubName, month:mon, day,
            clicks:Math.round(vals.clicks||0),
            netFee:Math.round((vals.netFee||0)*100)/100,
            grossFee:Math.round((vals.grossFee||0)*100)/100 });
        } else {
          if (!monthMap[mon]) monthMap[mon]={clicks:0,netFee:0,grossFee:0};
          monthMap[mon].clicks   += vals.clicks   ||0;
          monthMap[mon].netFee   += vals.netFee   ||0;
          monthMap[mon].grossFee += vals.grossFee ||0;
        }
      }
      for (const [mon, t] of Object.entries(monthMap)) {
        monthly.push({ advCid, pubCid, pubName:pubData.pubName, month:mon,
          clicks:Math.round(t.clicks),
          netFee:Math.round(t.netFee*100)/100,
          grossFee:Math.round(t.grossFee*100)/100 });
      }
    }
  }
  return {daily, monthly};
}

function renderPreview(rows, coverage) {
  const months = new Set([...rows.daily.map(r=>r.month),...rows.monthly.map(r=>r.month)]);
  const advs   = new Set([...rows.daily.map(r=>r.advCid),...rows.monthly.map(r=>r.advCid)]);
  el('previewSummary').innerHTML = `
    <div class="preview-stat"><span class="ps-val">${advs.size}</span><span class="ps-label">Advertisers</span></div>
    <div class="preview-stat"><span class="ps-val">${[...months].join(', ')}</span><span class="ps-label">Months</span></div>
    <div class="preview-stat"><span class="ps-val">${rows.daily.length}</span><span class="ps-label">Daily rows</span></div>
    <div class="preview-stat"><span class="ps-val">${rows.monthly.length}</span><span class="ps-label">Monthly rows</span></div>
  `;
  el('previewSection').style.display='block';
}

// ── NEW ADV MODAL ─────────────────────────────────────────────────────
function renderNewAdvModal(advs) {
  el('newAdvList').innerHTML = advs.map(adv => `
    <div class="new-adv-row" data-cid="${adv.cid}">
      <div class="new-adv-name">${adv.advertiserName} <span class="new-adv-cid">${adv.cid}</span></div>
      <div class="new-adv-fields">
        <div class="field-group"><label>Program *</label><select class="sel-program"><option value="">— Select —</option>${PROGRAM_OPTIONS.map(o=>`<option>${o}</option>`).join('')}</select></div>
        <div class="field-group"><label>Geo *</label><select class="sel-geo"><option value="">— Select —</option>${GEO_OPTIONS.map(o=>`<option>${o}</option>`).join('')}</select></div>
        <div class="field-group"><label>PoD *</label><select class="sel-pod"><option value="">— Select —</option>${POD_OPTIONS.map(o=>`<option>${o}</option>`).join('')}</select></div>
        <div class="field-group"><label>Serviced</label><select class="sel-serviced"><option value="Yes">Yes</option><option value="No">No</option></select></div>
      </div>
    </div>`).join('');
  el('newAdvModal').style.display='flex';
}

el('saveNewAdvBtn').addEventListener('click', async () => {
  const rows = $$$('.new-adv-row');
  const newRecs = [];
  for (const row of rows) {
    const cid=row.dataset.cid, program=row.querySelector('.sel-program').value,
          geo=row.querySelector('.sel-geo').value, pod=row.querySelector('.sel-pod').value,
          serviced=row.querySelector('.sel-serviced').value;
    if (!program||!geo||!pod) { showToast('Fill all required fields',true); return; }
    const advName = newAdvCIDs.find(a=>a.cid===cid)?.advertiserName||`CID ${cid}`;
    newRecs.push({ cid, advertiserName:advName, bookOfBusiness:'New Book', program, geo,
      accountStatus:'New - NAL', servicedAccount:serviced, pod, tripComFeeShare:false,
      clickTargets:Object.fromEntries(MONTH_ORDER.map(m=>[m,0])),
      feeTargets:Object.fromEntries(MONTH_ORDER.map(m=>[m,0])) });
  }
  try {
    el('saveNewAdvBtn').textContent='Saving…';
    const existing = await DB.getAdvertisers();
    await DB.saveAdvertisers([...existing, ...newRecs]);
    showToast(`✓ ${newRecs.length} new advertiser(s) saved`);
    el('newAdvModal').style.display='none';
    el('commitBtn').style.display='inline-flex';
    newAdvCIDs=[];
  } catch(err) {
    showToast('Error: '+err.message, true);
  } finally { el('saveNewAdvBtn').textContent='Save & Continue'; }
});

// ── COMMIT ────────────────────────────────────────────────────────────
el('commitBtn').addEventListener('click', async () => {
  el('commitBtn').disabled=true; el('commitBtn').textContent='Committing…';
  try {
    const coverage    = window._parsedCoverage||{};
    const dailyMonths = getDailyMonths();
    const newData     = mergeActuals(currentActuals, mergedRows, coverage, dailyMonths);
    await DB.saveActuals(newData);
    log(`✓ Committed — ${mergedRows.daily.length+mergedRows.monthly.length} records`, 'success');
    showToast('✓ Data committed to Google Sheets');
    resetUploadState();
    loadDBStatus();
  } catch(err) {
    log(`✗ ${err.message}`, 'error');
    showToast('Commit failed: '+err.message, true);
  } finally { el('commitBtn').disabled=false; el('commitBtn').textContent='✓ Commit to Database'; }
});

function mergeActuals(existing, newRows, newCoverage, dailyMonths) {
  let daily   = [...(existing.dailyRecords  ||[])];
  let monthly = [...(existing.monthlyRecords||[])];
  const coverage = {...(existing.dataCoverage||{})};

  // Promote old daily records that are no longer in dailyMonths
  const toPromote = daily.filter(r => !dailyMonths.has(r.month));
  if (toPromote.length) {
    const promoMap = {};
    for (const r of toPromote) {
      const k=`${r.advCid}|${r.pubCid}|${r.month}`;
      if (!promoMap[k]) promoMap[k]={advCid:r.advCid,pubCid:r.pubCid,pubName:r.pubName,month:r.month,clicks:0,netFee:0,grossFee:0};
      promoMap[k].clicks+=r.clicks; promoMap[k].netFee+=r.netFee; promoMap[k].grossFee+=r.grossFee;
    }
    for (const p of Object.values(promoMap)) {
      const idx=monthly.findIndex(m=>m.advCid===p.advCid&&m.pubCid===p.pubCid&&m.month===p.month);
      if (idx>=0) monthly[idx]=p; else monthly.push(p);
    }
    daily=daily.filter(r=>dailyMonths.has(r.month));
  }

  // Replace existing records for uploaded months
  const newDailyKeys  =new Set(newRows.daily.map(r=>`${r.advCid}|${r.pubCid}|${r.month}`));
  const newDailyMonths=new Set(newRows.daily.map(r=>r.month));
  daily=daily.filter(r=>!newDailyMonths.has(r.month)||!newDailyKeys.has(`${r.advCid}|${r.pubCid}|${r.month}`));
  daily.push(...newRows.daily);

  const newMonthlyKeys=new Set(newRows.monthly.map(r=>`${r.advCid}|${r.pubCid}|${r.month}`));
  monthly=monthly.filter(r=>!newMonthlyKeys.has(`${r.advCid}|${r.pubCid}|${r.month}`));
  monthly.push(...newRows.monthly);

  for (const [m,d] of Object.entries(newCoverage)) coverage[m]=Math.max(coverage[m]||0,d);

  return { lastUpdated:new Date().toISOString().slice(0,10), dataCoverage:coverage, dailyRecords:daily, monthlyRecords:monthly };
}

function resetUploadState() {
  netParsed=null; grossParsed=null; mergedRows=null; newAdvCIDs=[];
  ['netZone','grossZone'].forEach(id=>{ el(id).querySelector('.zone-name').textContent=id==='netZone'?'Drop Net Fee file here':'Drop Gross Fee file here'; el(id).classList.remove('has-file'); });
  el('previewSection').style.display='none';
  el('previewBtn').disabled=true; el('previewBtn').textContent='Preview & Commit';
  el('commitBtn').style.display='none';
}

// ── DB STATUS ─────────────────────────────────────────────────────────
async function loadDBStatus() {
  el('dbStatus').textContent='Loading…';
  try {
    const data    = await DB.getActuals();
    const daily   = data.dailyRecords  ||[];
    const monthly = data.monthlyRecords||[];
    const coverage= data.dataCoverage  ||{};
    const allMonths=[...new Set([...daily.map(r=>r.month),...monthly.map(r=>r.month)])].sort((a,b)=>MONTH_ORDER.indexOf(a)-MONTH_ORDER.indexOf(b));
    const advCount=new Set([...daily.map(r=>r.advCid),...monthly.map(r=>r.advCid)]).size;
    const covStr=Object.entries(coverage).map(([m,d])=>`${m}: day ${d}/${DAYS_IN_MONTH[m]||30}`).join(' · ')||'No data yet';
    el('dbStatus').innerHTML=`
      <div class="stat-grid">
        <div class="stat-box"><div class="sv">${data.lastUpdated||'—'}</div><div class="sl">Last Upload</div></div>
        <div class="stat-box"><div class="sv">${advCount}</div><div class="sl">Advertisers w/ data</div></div>
        <div class="stat-box"><div class="sv">${allMonths.join(', ')||'—'}</div><div class="sl">Months in DB</div></div>
        <div class="stat-box"><div class="sv">${daily.length.toLocaleString()}</div><div class="sl">Daily records</div></div>
        <div class="stat-box"><div class="sv">${monthly.length.toLocaleString()}</div><div class="sl">Monthly records</div></div>
      </div>
      <div class="cov-line">📅 ${covStr}</div>`;
  } catch(err) { el('dbStatus').textContent='Could not load: '+err.message; }
}

el('refreshStatusBtn').addEventListener('click', loadDBStatus);
el('clearActualsBtn').addEventListener('click', async () => {
  if (!confirm('Clear ALL actuals? Cannot be undone.')) return;
  try { await DB.clearActuals(); showToast('All actuals cleared'); loadDBStatus(); }
  catch(err) { showToast('Error: '+err.message, true); }
});

// ── TARGETS TAB ───────────────────────────────────────────────────────
async function loadTargetsTab() {
  el('targetsBody').innerHTML='<tr><td colspan="26" style="text-align:center;padding:24px;color:var(--muted)">Loading…</td></tr>';
  try {
    currentAdvs = await DB.getAdvertisers();
    renderTargetsTable(currentAdvs);
  } catch(err) {
    el('targetsBody').innerHTML=`<tr><td colspan="26" style="color:var(--red);padding:16px">${err.message}</td></tr>`;
  }
}

function renderTargetsTable(data) {
  el('targetsBody').innerHTML = data.map((adv,idx) => `
    <tr data-idx="${idx}">
      <td class="sticky-col adv-name-cell"><div class="adv-name">${adv.advertiserName}</div><div class="adv-cid">${adv.cid}</div></td>
      <td><span class="pod-tag">${adv.pod}</span></td>
      ${MONTH_ORDER.map(m=>`
        <td><input type="number" class="tgt-input click-tgt" data-cid="${adv.cid}" data-month="${m}" data-type="click" value="${Math.round(adv.clickTargets?.[m]||0)}" min="0"></td>
        <td><input type="number" class="tgt-input fee-tgt"   data-cid="${adv.cid}" data-month="${m}" data-type="fee"   value="${Math.round((adv.feeTargets?.[m]||0)*100)/100}" min="0" step="0.01"></td>
      `).join('')}
    </tr>`).join('');
}

el('saveTargetsBtn').addEventListener('click', async () => {
  if (!currentAdvs) return;
  el('saveTargetsBtn').disabled=true; el('saveTargetsBtn').textContent='Saving…';
  try {
    $$$('.tgt-input').forEach(inp => {
      const {cid,month,type}=inp.dataset;
      const adv=currentAdvs.find(a=>String(a.cid)===cid);
      if (!adv) return;
      const val=parseFloat(inp.value)||0;
      if (type==='click') { if(!adv.clickTargets) adv.clickTargets={}; adv.clickTargets[month]=val; }
      else                { if(!adv.feeTargets)   adv.feeTargets={};   adv.feeTargets[month]=val;   }
    });
    await DB.saveAdvertisers(currentAdvs);
    showToast('✓ Targets saved');
    currentAdvs = await DB.getAdvertisers();
  } catch(err) { showToast('Save failed: '+err.message, true); }
  finally { el('saveTargetsBtn').disabled=false; el('saveTargetsBtn').textContent='💾 Save Targets'; }
});

el('targetsSearch').addEventListener('input', e => {
  const q=e.target.value.toLowerCase();
  $$$('#targetsBody tr').forEach(row => {
    const name=row.querySelector('.adv-name')?.textContent.toLowerCase()||'';
    const cid =row.querySelector('.adv-cid')?.textContent||'';
    row.style.display=(name.includes(q)||cid.includes(q))?'':'none';
  });
});
