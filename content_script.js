// 負責：在政大論著系統頁面上，把 JSON 資料填入表單欄位

// ── 工具函式 ─────────────────────────────────────────────

// 第二層填入時設為 true，抑制 change/input 事件
// JSF 的 f:ajax 收到 change 事件後會從伺服器空白狀態重新 render，導致剛填入的值全部消失
let _fillQuiet = false;

// optional = true 表示此欄允許為空，不標橘色
function setText(name, value, optional = false) {
  const el = document.querySelector(`[name="${name}"]`);
  if (!el) return;
  if (value === undefined || value === null || value === '') {
    if (!optional) highlightManual(el);
    return;
  }
  el.value = value;
  if (!_fillQuiet) {
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  highlight(el);
}

function setSelect(name, value, optional = false) {
  const el = document.querySelector(`select[name="${name}"]`);
  if (!el) return;
  if (!value && value !== 0) {
    if (!optional) highlightManual(el);
    return;
  }
  el.value = value;
  if (!_fillQuiet) el.dispatchEvent(new Event('change', { bubbles: true }));
  highlight(el);
}

function setRadio(name, value, optional = false) {
  if (value === undefined || value === null) {
    if (!optional) highlightManualByName(name);
    return;
  }
  const el = document.querySelector(
    `input[type="radio"][name="${name}"][value="${value}"]`
  );
  if (!el) return;
  el.checked = true;
  if (!_fillQuiet) el.dispatchEvent(new Event('change', { bubbles: true }));
  // highlight the label/parent so the selection is visually marked
  const label = el.closest('label') || el.parentElement;
  if (label) highlight(label);
  highlight(el);
}

function setCheckboxes(name, values) {
  if (!Array.isArray(values) || values.length === 0) return;
  document.querySelectorAll(`input[type="checkbox"][name="${name}"]`)
    .forEach(el => { el.checked = values.includes(el.value); });
}

function highlight(el) {
  el.style.backgroundColor = '#fffbcc';
  el.style.outline = '2px solid #f0c000';
  el.dataset.aiHighlighted = 'true';
}

function highlightManual(el) {
  if (!el) return;
  el.style.backgroundColor = '#fff0dc';
  el.style.outline = '2px dashed #e07000';
  el.dataset.aiHighlighted = 'true';
}

function highlightManualByName(name) {
  highlightManual(document.querySelector(`[name="${name}"]`));
}



// ── 判斷目前是否為第二層頁面 ─────────────────────────────
// 第一層沒有 authlist；第二層一定有 authlist[0].sta_chi（第一位作者輸入欄）。
// 此欄名稱已在 findAddAuthorButton() 裡確認可被 querySelector 找到。
function isSecondLayerPage() {
  return !!document.querySelector('[name="authlist[0].sta_chi"]');
}


// ── 第一層欄位 ───────────────────────────────────────────
function fillFirstLayer(data) {
  _fillQuiet = false; // 第一層需要 change 事件（publ_tpe 等 UI 連動）
  setText  ('title1',       data.title1);
  setText  ('publ_dt',      data.publ_dt,        true);
  setSelect('field_cod',    data.field_cod);
  setSelect('publ_tpe',     data.publ_tpe);
  setText  ('publ_txt',     data.publ_txt,       true);
  setSelect('lang_cod',     data.lang_cod,       true);
  setSelect('promote',      data.promote);
  setRadio ('chk_tag',      data.chk_tag,        true);
  setRadio ('sch_publ_tpe', data.sch_publ_tpe,   true);
  setText  ('sch_publ_rem', data.sch_publ_rem,   true);
  setRadio ('lib_flg',      data.lib_flg,        true);
  setText  ('doi',          data.doi,          true);
  interceptSubmit();
}


// ── 第二層欄位（各類別共用部分）─────────────────────────
function fillSecondLayerCommon(data) {
  _fillQuiet = true; // 防止 JSF AJAX 重新 render（抑制 change/input 事件）
  setRadio ('chk_odr',      data.chk_odr);
  setText  ('auth_cnt',     data.auth_cnt);
  setRadio ('trsnat',       data.trsnat);
  setSelect('promote',      data.promote);
  setRadio ('chk_tag',      data.chk_tag);
  setRadio ('sch_publ_tpe', data.sch_publ_tpe);
  setRadio ('lib_flg',      data.lib_flg);

  setText('kw1', data.kw1 || '');
  ['kw2', 'kw3', 'kw4', 'kw5'].forEach(kw => setText(kw, data[kw] || '', true));

  fillAuthors(data.authors || []);
  setText ('sch_publ_rem', data.sch_publ_rem, true);
  setRadio('upld_tpe',     data.upld_tpe || '0');
  if (data._oa_url) showOaBanner(data._oa_url);
}

function showOaBanner(url) {
  if (document.getElementById('nccu-oa-banner')) return;
  const anchor = document.querySelector('[name="upld_tpe"]')?.closest('tr, div, td') || document.body;
  const banner = document.createElement('div');
  banner.id = 'nccu-oa-banner';
  banner.style.cssText = [
    'background:#fff8dc', 'border:2px solid #f0a500', 'border-radius:6px',
    'padding:8px 12px', 'margin:8px 0', 'font-size:13px', 'color:#5a3e00',
    'display:flex', 'align-items:center', 'gap:10px'
  ].join(';');
  banner.innerHTML =
    '<span>📄 此論著有開放取用全文，可手動上傳：</span>' +
    `<a href="${url}" target="_blank" rel="noopener"` +
    ' style="color:#0055cc;word-break:break-all;">' + url + '</a>';
  anchor.insertAdjacentElement('afterend', banner);
}

function findAddAuthorButton() {
  // Priority 1: known ID
  const byId = document.getElementById('addAuthorBlock');
  if (byId) return byId;
  // Priority 2: text match on any clickable element
  for (const el of document.querySelectorAll('input[type="button"], button, a')) {
    const txt = (el.value || el.textContent || '').trim();
    if (['新增作家', '新增作者', '[增加作者]', '增加作者'].includes(txt)) return el;
  }
  // Priority 3: proximity to authlist[0] — non-delete, non-submit button
  const firstField = document.querySelector('[name="authlist[0].sta_chi"]');
  if (firstField) {
    let el = firstField.parentElement;
    for (let d = 0; d < 6 && el; d++, el = el.parentElement) {
      const btn = el.querySelector(
        'input[type="button"]:not([value="刪除"]):not([value="delete"]), button:not([type="submit"])'
      );
      if (btn) return btn;
    }
  }
  return null;
}

async function fillAuthors(authors) {
  if (!authors.length) return;
  const fillRow = (i, a) => {
    setText (`authlist[${i}].sta_chi`,    a.sta_chi    || '', true);
    setText (`authlist[${i}].sta_ut_nam`, a.sta_ut_nam || '', true);
    setRadio(`authlist[${i}].ca_sts`,     a.ca_sts     || '0');
  };
  fillRow(0, authors[0]);

  for (let i = 1; i < authors.length; i++) {
    let tries = 0;
    while (!document.querySelector(`[name="authlist[${i}].sta_chi"]`) && tries < 8) {
      const btn = findAddAuthorButton();
      if (!btn) break;
      btn.click();
      await new Promise(r => setTimeout(r, 1000));
      tries++;
    }
    const exists = !!document.querySelector(`[name="authlist[${i}].sta_chi"]`);
    if (exists) fillRow(i, authors[i]);
  }
}

// ── 第二層欄位（期刊論文 03）────────────────────────────
function fillSecondLayerJournal(data) {
  fillSecondLayerCommon(data);
  setRadio     ('acc_flg',     data.acc_flg,          true);
  setText      ('jnl_nam',     data.jnl_nam);
  setText      ('vol',         data.vol,               true);
  setText      ('no',          data.no,                true);
  setText      ('pp',          data.pp);
  setCheckboxes('citelist',    data.citelist);
  setText      ('citetpe_rem', data.citetpe_rem,       true);
  setRadio     ('nat_tpe',     data.nat_tpe,           true);
  setSelect    ('nat_cod',     data.nat_cod,           true);
  setRadio     ('pertpe_cod',  data.pertpe_cod,        true);
  setRadio     ('publ_type',   data.publ_type,         true);
  setText      ('url_addr',    data.url_addr,          true);
  setText      ('doi',         data.doi,               true);
}

// ── 第二層欄位（專書 01 / 專書篇章 02 共用核心）─────────
function fillSecondLayerBookBase(data) {
  fillSecondLayerCommon(data);
  setRadio ('publ_type',    data.publ_type,  true);
  setText  ('publ_rem',     data.publ_rem,   true);
  setRadio ('bktpe_cod',    data.bktpe_cod,  true);
  setRadio ('bkcat_tpe',    data.bkcat_tpe,  true);
  setText  ('bkcat_rem',    data.bkcat_rem,  true);
  setText  ('isbn_num',     data.isbn_num,   true);
  setText  ('publ_nam',     data.publ_nam);
  setText  ('publ_pls',     data.publ_pls);
  setText  ('doi',          data.doi,        true);
}

// ── 第二層欄位（專書 01）────────────────────────────────
function fillSecondLayerBook(data) {
  fillSecondLayerBookBase(data);
  setText  ('set_title',    data.set_title,  true);
}

// ── 第二層欄位（專書篇章 02）────────────────────────────
function fillSecondLayerBookChapter(data) {
  fillSecondLayerBookBase(data);
  setText  ('set_title',    data.set_title);
  setText  ('page_num',     data.page_num);
}

// ── 第二層欄位（會議論文 04）────────────────────────────
function fillSecondLayerConference(data) {
  fillSecondLayerCommon(data);
  setText  ('conf_nam',     data.conf_nam);
  setText  ('conf_dt',      data.conf_dt);
  setText  ('conf_pls',     data.conf_pls,   true);
  setSelect('nat_cod',      data.nat_cod,    true);
  setText  ('cty_nam',      data.cty_nam,    true);
  setText  ('conf_host',    data.conf_host);
  setRadio ('intl_conf',    data.intl_conf,  true);
  setSelect('proceeding',   data.proceeding);
  setText  ('thesis_chi',   data.thesis_chi, true);
  setText  ('pp',           data.pp,         true);
  setCheckboxes('citelist', data.citelist);
  setText  ('citetpe_rem',  data.citetpe_rem, true);
  setText  ('isbn_num',     data.isbn_num,   true);
  setText  ('doi',          data.doi,        true);
}

// ── 第二層欄位（研究報告 05）────────────────────────────
function fillSecondLayerReport(data) {
  fillSecondLayerCommon(data);
  setText  ('prj_nam',  data.prj_nam);
  setText  ('repo_num', data.repo_num);
  setText  ('period',   data.period);
  setText  ('funds_by', data.funds_by);
  setRadio ('lead_tpe', data.lead_tpe,  true);
  setText  ('budget',   data.budget,    true);
  setText  ('doi',      data.doi,      true);
}

// ── 第二層欄位（展演 06）────────────────────────────────
function fillSecondLayerPerformance(data) {
  fillSecondLayerCommon(data);
  setText  ('conf_nam',  data.conf_nam);
  setText  ('conf_dt',   data.conf_dt);
  setSelect('nat_cod',   data.nat_cod,   true);
  setText  ('cty_nam',   data.cty_nam,   true);
  setText  ('conf_pls',  data.conf_pls,  true);
  setText  ('conf_host', data.conf_host);
  setText  ('adm_nam',   data.adm_nam,   true);
  setText  ('mbr_cnt',   data.mbr_cnt,   true);
  setText  ('doi',       data.doi,       true);
}

// ── 第二層欄位（學術資料庫 08）──────────────────────────
function fillSecondLayerDatabase(data) {
  fillSecondLayerCommon(data);
  setText ('cont_info', data.cont_info, true);
  setRadio('ann_flg',   data.ann_flg,   true);
  setText ('db_url',    data.db_url);
  setText ('doi',       data.doi,       true);
}

// ── 第二層欄位（個案 09）────────────────────────────────
function fillSecondLayerCase(data) {
  fillSecondLayerCommon(data);
  setText('publ_ut',  data.publ_ut);
  setText('case_num', data.case_num);
  setText('doi',      data.doi,      true);
}

// ── 第二層欄位（其他 10）────────────────────────────────
function fillSecondLayerOther(data) {
  fillSecondLayerCommon(data);
  setSelect('ramtyp_cod', data.ramtyp_cod);
  setText  ('publ_ut',    data.publ_ut);
  setText  ('ram_memo',   data.ram_memo,  true);
  setText  ('doi',        data.doi,       true);
}

// ── 第二層欄位（學術交流 12）────────────────────────────
function fillSecondLayerAcademicExchange(data) {
  fillSecondLayerCommon(data);
  setRadio ('conf_tpe',  data.conf_tpe,  true);
  setText  ('conf_nam',  data.conf_nam);
  setText  ('conf_dt',   data.conf_dt);
  setSelect('nat_cod',   data.nat_cod,   true);
  setText  ('cty_nam',   data.cty_nam,   true);
  setText  ('conf_pls',  data.conf_pls,  true);
  setText  ('conf_host', data.conf_host);
  setText  ('doi',       data.doi,       true);
}

// ── 第二層欄位（依 publ_tpe 分派）───────────────────────
function fillSecondLayer(data) {
  const type = data.publ_tpe || '03';
  if      (type === '01') fillSecondLayerBook(data);
  else if (type === '02') fillSecondLayerBookChapter(data);
  else if (type === '03') fillSecondLayerJournal(data);
  else if (type === '04') fillSecondLayerConference(data);
  else if (type === '05') fillSecondLayerReport(data);
  else if (type === '06') fillSecondLayerPerformance(data);
  else if (type === '08') fillSecondLayerDatabase(data);
  else if (type === '09') fillSecondLayerCase(data);
  else if (type === '10') fillSecondLayerOther(data);
  else if (type === '12') fillSecondLayerAcademicExchange(data);
  interceptSubmit();
}


// ── 攔截送出按鈕 ─────────────────────────────────────────
function interceptSubmit() {
  const submitBtn = document.querySelector(
    'input[type="submit"], button[type="submit"]'
  );
  if (!submitBtn || submitBtn.dataset.intercepted) return;
  submitBtn.dataset.intercepted = 'true';

  function handleClick(e) {
    e.preventDefault();
    e.stopPropagation();
    const confirmed = window.confirm(
      '⚠️ 論著助手已自動填入資料。\n\n' +
      '🟡 黃色欄位：AI 已填入，請確認正確性\n' +
      '🟠 橘色虛線欄位：需人工填寫（卷期頁、資料庫）\n\n' +
      '確認無誤後按「確定」送出，按「取消」繼續填寫。'
    );
    if (confirmed) {
      // 先移除 listener，避免第二次 click 又觸發攔截
      submitBtn.removeEventListener('click', handleClick, true);
      submitBtn.dataset.intercepted = '';
      submitBtn.click();
    }
  }

  submitBtn.addEventListener('click', handleClick, true);
}


// ── 清除黃色標示 ─────────────────────────────────────────
function clearHighlight() {
  document.querySelectorAll('[data-ai-highlighted="true"]').forEach(el => {
    el.style.backgroundColor = '';
    el.style.outline = '';
    el.dataset.aiHighlighted = '';
  });
  const submitBtn = document.querySelector('input[type="submit"], button[type="submit"]');
  if (submitBtn) submitBtn.dataset.intercepted = '';
}


// ── 接收 popup 廣播（第一層即時填入）────────────────────
window.addEventListener('nccu_fillForm', (e) => {
  try { fillFirstLayer(e.detail); }
  catch { }
});

// 手動觸發（popup 的「填入表單」按鈕）：填入當前頁面所有可用欄位
window.addEventListener('nccu_reFill', (e) => {
  try {
    fillFirstLayer(e.detail);
    if (isSecondLayerPage()) fillSecondLayer(e.detail);
  } catch { }
});

window.addEventListener('nccu_clearHighlight', () => {
  clearHighlight();
  chrome.storage.local.remove(['pendingFillData', 'filledPhase']);
});


// ── 第二層自動填入（支援全頁跳轉、iframe 跳轉、AJAX 換頁）─
let _autoFillDone = false;

async function tryAutoFillSecondLayer() {
  if (_autoFillDone) return;
  const onSecond = isSecondLayerPage();
  if (!onSecond) return;

  const { pendingFillData, filledPhase } =
    await chrome.storage.local.get(['pendingFillData', 'filledPhase']);
  if (!pendingFillData || filledPhase !== 1) return;

  _autoFillDone = true;
  try {
    fillSecondLayer(pendingFillData);
    await chrome.storage.local.set({ filledPhase: 2 });
    chrome.runtime.sendMessage({ action: 'secondLayerFilled' }).catch(() => {});
  } catch (err) {
    _autoFillDone = false;
  }
}

// 1. 頁面載入即執行（全頁跳轉 / iframe 重新載入）
(async () => {
  await tryAutoFillSecondLayer();
})();

// 2. 監看 DOM 變化（AJAX / SPA 換頁：第二層欄位動態插入）
const _mo = new MutationObserver(() => tryAutoFillSecondLayer());
_mo.observe(document.documentElement, { childList: true, subtree: true });

// 3. 監看 storage（fillPhase 在本頁面已開啟後才被設為 1 的情況）
chrome.storage.onChanged.addListener((changes) => {
  if (changes.filledPhase?.newValue === 1) {
    _autoFillDone = false;
    tryAutoFillSecondLayer();
  }
});
