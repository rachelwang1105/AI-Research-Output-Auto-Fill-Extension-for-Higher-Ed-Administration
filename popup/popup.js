// 負責：外掛彈出視窗的所有互動邏輯

// ── 取得頁面上所有會用到的元素 ──────────────────────────
const pageStatus     = document.getElementById('pageStatus');
const pageStatusText = document.getElementById('pageStatusText');
const step1          = document.getElementById('step1');
const step2          = document.getElementById('step2');
const step3          = document.getElementById('step3');
const step4          = document.getElementById('step4');
const sectionInput   = document.getElementById('sectionInput');
const sectionConfirm = document.getElementById('sectionConfirm');
const sectionLoading = document.getElementById('sectionLoading');
const sectionError   = document.getElementById('sectionError');
const sectionPreview = document.getElementById('sectionPreview');
const confirmBox     = document.getElementById('confirmBox');
const btnConfirm     = document.getElementById('btnConfirm');
const btnConfirmCancel = document.getElementById('btnConfirmCancel');
const doiInput          = document.getElementById('doiInput');
const textInput         = document.getElementById('textInput');
const tabDoi            = document.getElementById('tabDoi');
const tabText           = document.getElementById('tabText');
const modeDoiContainer  = document.getElementById('modeDoiContainer');
const modeTextContainer = document.getElementById('modeTextContainer');
const btnProcess        = document.getElementById('btnProcess');

let inputMode = 'doi'; // 'doi' | 'text'
let pendingFormattedText = null; // CrossRef 整理後的文字，確認後送 AI
let pendingPageMetaDoi   = null; // DSpace REST API 回傳的 DOI（如有），加入佇列時用
let pendingTabId = null;
const loadingText    = document.getElementById('loadingText');
const errorMsg       = document.getElementById('errorMsg');
const btnRetry       = document.getElementById('btnRetry');
const previewBox     = document.getElementById('previewBox');
const btnFill        = document.getElementById('btnFill');
const btnCancel      = document.getElementById('btnCancel');
const btnNewDoi      = document.getElementById('btnNewDoi');
const apiKeyInput      = { value: '' };  // API key 已內建，不顯示於 UI
const btnSaveKey       = document.getElementById('btnSaveKey');
const btnAutoDetect    = document.getElementById('btnAutoDetect');
const empInput         = document.getElementById('empInput');
const btnLookupOrcid   = document.getElementById('btnLookupOrcid');
const empStatus        = document.getElementById('empStatus');
const orcidInput       = document.getElementById('orcidInput');
const btnSaveOrcid     = document.getElementById('btnSaveOrcid');
const orcidStatus      = document.getElementById('orcidStatus');
const btnCheckOrcid    = document.getElementById('btnCheckOrcid');
const tabQueue          = document.getElementById('tabQueue');
const modeQueueContainer = document.getElementById('modeQueueContainer');
const queueTabBadge     = document.getElementById('queueTabBadge');
const newWorksList      = document.getElementById('newWorksList');
const queuePagination   = document.getElementById('queuePagination');
const btnQueuePrev      = document.getElementById('btnQueuePrev');
const btnQueueNext      = document.getElementById('btnQueueNext');
const queuePageInfo     = document.getElementById('queuePageInfo');
const sectionPendingQueue = document.getElementById('sectionPendingQueue');
const pendingQueueList  = document.getElementById('pendingQueueList');
const worksActions      = document.getElementById('worksActions');
const btnSelectAll      = document.getElementById('btnSelectAll');
const btnImportSelected = document.getElementById('btnImportSelected');
const btnStartQueue     = document.getElementById('btnStartQueue');
const btnNextQueue      = document.getElementById('btnNextQueue');
const fileImport        = document.getElementById('fileImport');
const btnImportFile     = document.getElementById('btnImportFile');
const pageMetaAction    = document.getElementById('pageMetaAction');
const btnAddPageMeta    = document.getElementById('btnAddPageMeta');

const PAGE_SIZE = 5;
let queueNewPage = 0;


// ── 外掛開啟時，執行初始化 ───────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  checkCurrentPage();
  loadApiKey();
  checkPendingData();
  loadOrcidSettings();
  checkNewOrcidWorks();
  renderPendingQueue();
  restoreSavedInput();
});

// ── 輸入欄位自動儲存 ─────────────────────────────────────
function saveInputState() {
  chrome.storage.local.set({
    savedInput: {
      mode: inputMode,
      doi:  doiInput.value  || '',
      text: textInput.value || ''
    }
  });
}

async function restoreSavedInput() {
  const { savedInput } = await chrome.storage.local.get('savedInput');
  if (!savedInput) return;
  if (savedInput.doi)  doiInput.value  = savedInput.doi;
  if (savedInput.text) textInput.value = savedInput.text;
  if (savedInput.mode === 'text') {
    tabText.click();
  }
}

doiInput.addEventListener('input', saveInputState);
textInput.addEventListener('input', saveInputState);


// ── 讀取暫存資料，還原 UI 狀態 ──────────────────────────
async function checkPendingData() {
  const { pendingFillData, filledPhase, pendingConfirm } =
    await chrome.storage.local.get(['pendingFillData', 'filledPhase', 'pendingConfirm']);

  // filledPhase === 1：第一頁已填，等待第二頁自動填入（content script 還需要資料）→ 不清除
  // filledPhase === 2 或無 phase：已完成或廢棄 → 清除
  if (pendingFillData) {
    if (filledPhase !== 1) {
      await chrome.storage.local.remove(['pendingFillData', 'filledPhase']);
    }
    return;
  }

  // pendingConfirm：popup 在使用者按「確認」前被關掉 → 還原確認畫面（有效 recovery）
  if (pendingConfirm) {
    pendingFormattedText = pendingConfirm.formattedText;
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    pendingTabId = tabs[0]?.id || null;
    setStep(1, 'done');
    showConfirm(pendingConfirm.meta);
    return;
  }
}


// ── Tab 切換 ──────────────────────────────────────────────
function setActiveTab(activeTab) {
  [tabDoi, tabText, tabQueue].forEach(t => t.classList.remove('active'));
  activeTab.classList.add('active');
}

tabDoi.addEventListener('click', () => {
  inputMode = 'doi';
  setActiveTab(tabDoi);
  show(modeDoiContainer);
  hide(modeTextContainer);
  hide(modeQueueContainer);
  show(btnProcess);
});

tabText.addEventListener('click', () => {
  inputMode = 'text';
  setActiveTab(tabText);
  hide(modeDoiContainer);
  show(modeTextContainer);
  hide(modeQueueContainer);
  show(btnProcess);
  textInput.focus();
});

tabQueue.addEventListener('click', async () => {
  inputMode = 'queue';
  setActiveTab(tabQueue);
  hide(modeDoiContainer);
  hide(modeTextContainer);
  show(modeQueueContainer);
  hide(btnProcess);
  await checkNewOrcidWorks();
});


// ── 1. 偵測目前頁面：論著系統 or 一般學術頁面 ──────────
function checkCurrentPage() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const url = tabs[0]?.url || '';
    const isNccuPage = url.includes('webapp1.nccu.edu.tw') ||
                       url.includes('webapp.nccu.edu.tw');
    btnProcess.disabled = false; // 任何頁面都可操作

    if (isNccuPage) {
      pageStatus.className = 'page-status ok';
      pageStatusText.textContent = '已偵測到論著系統，可以開始填入';
    } else {
      // 嘗試從當前頁面抓 DOI
      detectDoiFromPage(tabs[0].id);
    }
  });
}

// 掃描當前分頁的 meta tag、JSON-LD、URL，找 DOI
function detectDoiFromPage(tabId) {
  chrome.scripting.executeScript(
    {
      target: { tabId, allFrames: false },
      func: () => {
        // ── Airiti 華藝線上圖書館 ──────────────────────────────
        if (location.hostname === 'www.airitilibrary.com' && location.pathname.startsWith('/Article/Detail')) {
          const h2sAll = [...document.querySelectorAll('h2')].filter(el => el.offsetParent !== null);
          // 若任一可見 h2 含 cookie/本網站 等 cookie 橫幅字樣，改由背景擷取
          const COOKIE_RE = /cookie|本網站|隱私|privacy/i;
          if (h2sAll.some(el => COOKIE_RE.test(el.textContent))) return { type: 'fetch_url', url: location.href };
          const h2s   = h2sAll;
          const title = h2s[0]?.textContent?.trim() || '';
          if (!title) return { type: 'fetch_url', url: location.href };
          if (title) {
            // 英文標題：第一個 h3（在「摘要」之前）
            const h3s  = [...document.querySelectorAll('h3')].map(h => h.textContent.trim());
            const engTitle = h3s.find(t => /[a-zA-Z]{4}/.test(t) && !/cookie|本網站/i.test(t) && t !== '摘要' && t !== '關鍵字' && t !== '並列關鍵字' && t !== '參考文獻') || '';

            // Airiti 所有可見的 a[href="javascript:;"] 依內容分類
            const jsTexts = [...document.querySelectorAll('a[href="javascript:;"]')]
              .filter(el => el.offsetParent !== null)
              .map(a => a.textContent.trim()).filter(Boolean);
            // 作者：無換行、無《》、不含 IP/http、長度合理
            const authors = jsTexts.filter(t =>
              !t.includes('\n') && !t.includes('《') &&
              !t.startsWith('http') && !t.includes('IP:') && t.length < 60
            );
            // 期刊資訊：含《》的那一項
            const jnlText = jsTexts.find(t => t.includes('《')) || '';
            const jnl    = jnlText.match(/《(.+?)》/)?.[1] || '';
            const vol    = jnlText.match(/(\d+)卷/)?.[1] || '';
            const iss    = jnlText.match(/(\d+)期/)?.[1] || '';
            const yearM  = jnlText.match(/\((\d{4})\/(\d+)\)/);
            const year   = yearM?.[1] || '';
            const month  = yearM?.[2]?.padStart(2, '0') || '';
            const pages  = jnlText.match(/Pp\.\s*(.+)/)?.[1]?.trim() || '';
            // DOI：文字含 doi.org/10. 的那一項（href 是 javascript:; 所以從文字抓）
            const doiText = jsTexts.find(t => /doi\.org\/10\./i.test(t)) || '';
            const doi    = doiText.match(/10\.\d{4,}\/\S+/)?.[0]
                        || [...document.querySelectorAll('a[href*="doi.org/10."]')]
                             .map(a => a.href.match(/10\.\d{4,}\/\S+/)?.[0]).find(Boolean) || '';

            // 摘要 & 關鍵字：h3 後的兄弟節點文字
            const getAfterH3 = (label) => {
              const h = [...document.querySelectorAll('h3')].find(h => h.textContent.trim() === label);
              if (!h) return '';
              let el = h.nextElementSibling;
              const parts = [];
              while (el && !['H2','H3','H4'].includes(el.tagName)) {
                const t = el.textContent.trim();
                if (t) parts.push(t);
                el = el.nextElementSibling;
              }
              return parts.join(' ');
            };
            const abstract = getAfterH3('摘要');
            const kwZh = getAfterH3('關鍵字').split(/[；;]/).map(k => k.trim()).filter(Boolean);
            const kwEn = getAfterH3('並列關鍵字').split(/[；;]/).map(k => k.trim()).filter(Boolean);
            const keywords = kwZh.length ? kwZh : kwEn;

            const lines = ['Title: ' + (engTitle || title)];
            if (engTitle && title !== engTitle) lines.push('Title (zh): ' + title);
            if (authors.length)  lines.push('Authors: ' + authors.join('; '));
            if (jnl)             lines.push('Journal/Source: ' + jnl);
            if (year)            lines.push('Date: ' + year + (month ? '-' + month : ''));
            if (vol)             lines.push('Volume: ' + vol);
            if (iss)             lines.push('Issue: ' + iss);
            if (pages)           lines.push('Pages: ' + pages);
            lines.push('Language: zh_TW');
            if (keywords.length) lines.push('Keywords: ' + keywords.join('; '));
            if (abstract)        lines.push('Abstract: ' + abstract.slice(0, 2000));
            if (doi)             lines.push('DOI: ' + doi);
            lines.push('URL: ' + location.href);
            return { type: 'metadata', value: lines.join('\n'), title: engTitle || title };
          }
        }
        // ── 政大圖書館論文典藏 (thesis.lib.nccu.edu.tw) ─────────────
        // 頁面是 Django 伺服器端渲染，書目資料以 <th>欄名：</th><td>值</td> 表格呈現
        if (location.hostname === 'thesis.lib.nccu.edu.tw'
            && location.pathname.startsWith('/thesis/detail/')) {
          // 建立 th文字 → td 元素的對照表
          const _thMap = {};
          document.querySelectorAll('table tr').forEach(tr => {
            const th = tr.querySelector('th');
            const td = tr.querySelector('td');
            if (th && td) {
              const key = th.textContent.trim().replace(/[：:]$/, '');
              _thMap[key] = td;
            }
          });
          // 將 td innerHTML 依 <br> 拆分成多段文字（標題/作者/系所有雙語行）
          const _tdParts = key => {
            if (!_thMap[key]) return [];
            return _thMap[key].innerHTML
              .split(/<br\s*\/?>/i)
              .map(s => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
              .filter(Boolean);
          };
          // 取 td 內所有 <a> 連結文字（關鍵詞用）
          const _tdLinks = (...keys) => {
            for (const k of keys) {
              if (!_thMap[k]) continue;
              const ls = [..._thMap[k].querySelectorAll('a')]
                .map(a => a.textContent.trim()).filter(Boolean);
              if (ls.length) return ls;
            }
            return [];
          };
          // 論文名稱：td 內有中文行與英文行，以 <br> 分隔
          const _titleParts = _tdParts('論文名稱');
          const _zhT  = _titleParts.find(t => /[一-鿿]/.test(t)) || '';
          const _enT  = _titleParts.find(t => !/[一-鿿]/.test(t) && /[A-Za-z]{4}/.test(t)) || '';
          const _title = _enT || _zhT;
          if (_title) {
            // 研究生：取 CJK 行（蕭百傑），排除英文拼音行
            const _authorParts = _tdParts('研究生');
            const _author = _authorParts.find(t => /[一-鿿]/.test(t)) || _authorParts[0] || '';
            // 系所：「商學院 - 資訊管理學系」→ 擷取末段中文系所名
            const _deptParts = _tdParts('系所名稱');
            const _deptRaw   = _deptParts.find(t => /[一-鿿]/.test(t)) || _deptParts[0] || '';
            const _deptM     = _deptRaw.match(/[一-鿿]+(學系|研究所|學院|學程|研究中心)/);
            const _dept      = _deptM ? _deptM[0]
              : (_deptRaw.includes(' - ') ? _deptRaw.split(' - ').pop().trim() : _deptRaw.split(/\s/)[0]);
            const _year   = _thMap['論文出版年']?.textContent?.trim() || '';
            const _degree = _thMap['學位類別']?.textContent?.trim() || '';
            const _type   = /博士/.test(_degree) ? 'dissertation' : 'thesis';
            // 摘要：#parents_2 分頁內容
            const _absEl    = document.getElementById('parents_2');
            const _abstract = (_absEl?.textContent?.trim() || '').replace(/\s+/g, ' ').slice(0, 2000);
            // 關鍵詞：取 <a> 連結文字
            const _kwZh = _tdLinks('中文關鍵詞');
            const _kwEn = _tdLinks('外文關鍵詞');
            const _kws  = (_kwZh.length ? _kwZh : _kwEn);
            const _lines = [`Title: ${_title}`];
            if (_zhT && _zhT !== _title) _lines.push(`Title (zh): ${_zhT}`);
            if (_author)     _lines.push(`Authors: ${_author}`);
            if (_year)       _lines.push(`Year: ${_year}`);
            _lines.push(`Type: ${_type}`);
            if (_dept)       _lines.push(`Department: ${_dept}`);
            if (_kws.length) _lines.push(`Keywords: ${_kws.join('; ')}`);
            if (_abstract)   _lines.push(`Abstract: ${_abstract}`);
            _lines.push(`URL: ${location.href}`);
            return { type: 'metadata', value: _lines.join('\n'), title: _title };
          }
        }

        // 1. meta tag：DOI（Highwire、bepress、DC、PRISM）
        for (const name of ['citation_doi','bepress_citation_doi','DC.identifier','dc.identifier','prism.doi']) {
          const m = (document.querySelector(`meta[name="${name}"]`)?.content || '').match(/10\.\d{4,}\/\S+/);
          if (m) return { type: 'doi', value: m[0].replace(/[.,;)>\]]+$/, '') };
        }
        // 2. JSON-LD ScholarlyArticle
        for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
          try {
            for (const item of [].concat(JSON.parse(s.textContent))) {
              for (const v of [].concat(item.identifier, item.sameAs).filter(Boolean)) {
                const str = typeof v === 'string' ? v : (v.value || '');
                const m   = str.match(/10\.\d{4,}\/\S+/);
                if (m) return { type: 'doi', value: m[0].replace(/[.,;)>\]]+$/, '') };
              }
            }
          } catch {}
        }
        // 3. doi.org 連結
        for (const a of document.querySelectorAll('a[href*="doi.org/10."]')) {
          const m = a.href.match(/10\.\d{4,}\/[^\s"'<>]+/);
          if (m) return { type: 'doi', value: m[0].replace(/[.,;)>\]]+$/, '') };
        }
        // 4. URL 本身是否含 DOI
        const doiInUrl = location.href.match(/10\.\d{4,}\/[^\s&?#"'<>]+/);
        if (doiInUrl) return { type: 'doi', value: doiInUrl[0].replace(/[.,;)>\]]+$/, '') };

        // 5. PubMed meta tag 或 URL
        const pmidMeta = document.querySelector('meta[name="citation_pmid"]')?.content;
        if (pmidMeta) return { type: 'pmid', value: pmidMeta.trim() };
        const pmidUrl = location.href.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/i);
        if (pmidUrl) return { type: 'pmid', value: pmidUrl[1] };

        // 6. arXiv meta tag 或 URL
        const arxivMeta = document.querySelector('meta[name="citation_arxiv_id"]')?.content;
        if (arxivMeta) return { type: 'arxiv', value: arxivMeta.trim() };
        const arxivUrl = location.href.match(/arxiv\.org\/abs\/([^\s?#/]+)/i);
        if (arxivUrl) return { type: 'arxiv', value: arxivUrl[1] };

        // 7. 無識別碼：從 Highwire / Dublin Core / Open Graph / JSON-LD 擷取書目 metadata
        const getMeta  = n => document.querySelector(`meta[name="${n}"]`)?.content?.trim() || '';
        const getMetas = n => [...document.querySelectorAll(`meta[name="${n}"]`)].map(m => m.content?.trim()).filter(Boolean);
        // AH DOM 補抓：以 regex 搜尋 metadataFieldLabel 文字，取對應的 metadataFieldValue
        const _getAhField = (labelRe) => {
          let cur = null;
          for (const el of document.querySelectorAll(
              '.metadataFieldLabel,.metadataFieldLabel1,.metadataFieldValue')) {
            const isLbl = el.classList.contains('metadataFieldLabel')
                       || el.classList.contains('metadataFieldLabel1');
            if (isLbl) cur = el.textContent.trim();
            else if (cur && labelRe.test(cur)) return el.textContent.trim();
          }
          return '';
        };
        const getOg    = p => document.querySelector(`meta[property="${p}"]`)?.content?.trim() || '';

        // Highwire Press citation 標籤（Google Scholar 規範，學術出版商廣泛使用）
        const hwTitle   = getMeta('citation_title');
        const hwAuthors = getMetas('citation_author');
        const hwDate    = getMeta('citation_publication_date') || getMeta('citation_date');
        const hwJnl     = getMeta('citation_journal_title');
        const hwConf    = getMeta('citation_conference_title');
        const hwVol     = getMeta('citation_volume');
        const hwIss     = getMeta('citation_issue');
        const hwSP      = getMeta('citation_firstpage');
        const hwEP      = getMeta('citation_lastpage');
        const hwISBN    = getMeta('citation_isbn');
        const hwPub     = getMeta('citation_publisher');
        const hwLang    = getMeta('citation_language');
        const hwKws     = getMetas('citation_keywords');
        const hwAbs     = getMeta('citation_abstract');

        // Dublin Core（含 DSpace 限定詞格式：DC.contributor.author / DC.date.issued 等）
        const dcTitle    = getMeta('DC.title')           || getMeta('dc.title');
        const dcCreators = [
          ...getMetas('DC.creator'),        ...getMetas('dc.creator'),
          ...getMetas('DC.contributor.author'), ...getMetas('dc.contributor.author'),
        ];
        // DSpace DOM fallback：從 metadata 表格「作者:」列的 <a> 連結直接取作者名
        // （比 citation_author 可靠，AH 常把多個作者串成一個 meta tag）
        const _dsDomAuthors = (() => {
          let cur = null;
          for (const el of document.querySelectorAll(
              '.metadataFieldLabel,.metadataFieldLabel1,.metadataFieldValue')) {
            if (el.classList.contains('metadataFieldLabel') ||
                el.classList.contains('metadataFieldLabel1')) {
              cur = el.textContent.trim().replace(/:?\s*$/, '');
            } else if (['作者','Authors','Author'].includes(cur) &&
                       el.classList.contains('metadataFieldValue')) {
              const links = [...el.querySelectorAll('a')].map(a => a.textContent.trim()).filter(Boolean);
              return links.length ? links : [];
            }
          }
          return [];
        })();
        const dcDate     = getMeta('DC.date')             || getMeta('dc.date')
                        || getMeta('DC.date.issued')      || getMeta('dc.date.issued')
                        || getMeta('DC.date.created')     || getMeta('dc.date.created');
        // 摘要：AH/DSpace 用 DCTERMS.abstract；部分 repo 用 DC.description.abstract；最後才退到 DC.description
        // AH 頁面的 DCTERMS.abstract 存的是平台介紹樣板而非論著摘要，偵測到就過濾並改抓 DOM
        const _rawDesc   = getMeta('DCTERMS.abstract')         || getMeta('dcterms.abstract')
                        || getMeta('DC.description.abstract') || getMeta('dc.description.abstract')
                        || getMeta('DC.description')          || getMeta('dc.description');
        const _isAhBoilerplate = v => /NCCU\s+Academic\s+Hub|academic\s+output\s+collection|政大學術集成/i.test(v);
        const dcDesc     = (_isAhBoilerplate(_rawDesc) ? '' : _rawDesc)
                        || (() => { const d = _getAhField(/摘要|[Aa]bstract/); return _isAhBoilerplate(d) ? '' : d; })();
        // 來源：只取非 URL 的值（論文記錄的 DC.relation 常存 URL，不能當期刊名）
        const dcSourceRaw = getMeta('DC.source')          || getMeta('dc.source')
                        || getMeta('DC.relation.ispartof')|| getMeta('dc.relation.ispartof')
                        || getMeta('DC.relation')         || getMeta('dc.relation')
                        || _getAhField(/dc\.relation|關聯/i);
        const dcSource   = dcSourceRaw && /^https?:\/\//.test(dcSourceRaw) ? '' : (dcSourceRaw || '');
        const dcType     = getMeta('DC.type')             || getMeta('dc.type')
                        || (() => {
                             // DSpace CRIS DOM fallback：meta tag 無 dc.type 時從頁面抓
                             let cur = null;
                             for (const el of document.querySelectorAll(
                                 '.metadataFieldLabel,.metadataFieldLabel1,.metadataFieldValue')) {
                               const isLbl = el.classList.contains('metadataFieldLabel')
                                          || el.classList.contains('metadataFieldLabel1');
                               if (isLbl) { cur = el.textContent.trim().replace(/:$/, ''); }
                               else if ((cur === '資料類型' || cur === 'Type')
                                     && el.classList.contains('metadataFieldValue'))
                                 return el.textContent.trim();
                             }
                             return [...document.querySelectorAll('h3')]
                               .map(h => h.textContent.trim())
                               .find(t => t.startsWith('學術產出-'))
                               ?.replace('學術產出-', '') || '';
                           })();
        const dcPub      = getMeta('DC.publisher')        || getMeta('dc.publisher');
        const dcLang     = getMeta('DC.language')         || getMeta('dc.language')
                        || getMeta('DC.language.iso')     || getMeta('dc.language.iso');
        const dcSubj     = getMetas('DC.subject').concat(getMetas('dc.subject'));
        const dcISBN     = getMeta('DC.identifier.isbn')  || getMeta('dc.identifier.isbn');
        // 系所：優先取 .department 限定詞；若無，從 DC.description 多值中找含「系/所/院/組」且長度 < 30 的值
        // （AH 論文記錄：DC.description 依序存「學位/大學/系所/學號」，系所通常在第三個）
        const _dcDescs   = getMetas('DC.description').concat(getMetas('dc.description'));
        const dcDept     = getMeta('DC.contributor.department') || getMeta('dc.contributor.department')
                        || getMeta('DC.description.department') || getMeta('dc.description.department')
                        || _dcDescs.find(v => /[系所院組]/.test(v) && v.length < 30)
                        || _getAhField(/^dc\.contributor(?!\.(author|creator|editor|department))/i) || '';

        // Open Graph
        const ogTitle  = getOg('og:title');
        const ogDesc   = getOg('og:description');
        const ogUrl    = getOg('og:url') || location.href;

        // Schema.org JSON-LD（只取 ScholarlyArticle / Book，避免一般文章誤觸發）
        let ldTitle = '', ldAuthors = [], ldYear = '', ldDateRaw = '', ldJnl = '', ldDesc = '', ldPub = '', ldISBN = '';
        let ldIsAcademic = false;
        for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
          try {
            for (const item of [].concat(JSON.parse(s.textContent))) {
              const t = item['@type'] || '';
              if (['ScholarlyArticle', 'Book'].includes(t)) ldIsAcademic = true;
              if (!['ScholarlyArticle','Article','Book'].includes(t)) continue;
              ldTitle   = ldTitle   || item.name        || item.headline || '';
              ldDesc    = ldDesc    || item.description  || item.abstract || '';
              ldDateRaw = ldDateRaw || item.datePublished || item.dateCreated || '';
              ldYear    = ldYear    || ldDateRaw.match(/\d{4}/)?.[0] || '';
              ldJnl     = ldJnl    || item.isPartOf?.name || '';
              ldPub     = ldPub    || item.publisher?.name || '';
              ldISBN    = ldISBN   || item.isbn || '';
              if (!ldAuthors.length && item.author)
                ldAuthors = [].concat(item.author).map(a => a.name || '').filter(Boolean);
            }
          } catch {}
        }

        // 學術頁面門檻：至少符合以下其一才觸發，避免一般網頁誤判
        // 1. Highwire citation_title（學術出版商專用）
        // 2. Dublin Core title + 作者或來源（機構庫）
        // 3. JSON-LD ScholarlyArticle 或 Book
        // 4. DSpace handle URL + DC.title（機構典藏通用格式）
        const isHandleUrl  = /\/handle\/[\d.]+\/\d+/.test(location.pathname);
        const hasDSpaceDOM = !!document.querySelector('.metadataFieldLabel1');
        const isAcademic  = !!hwTitle
          || (!!dcTitle && (dcCreators.length > 0 || !!dcSource))
          || ldIsAcademic
          || (isHandleUrl && !!dcTitle);

        // DSpace Angular SPA / CRIS 頁面：meta tag 為空，先刮 DOM（metadataFieldLabel/Value 結構）
        if ((isHandleUrl || hasDSpaceDOM) && !isAcademic) {
          const domResult = (() => {
            let curLabel = null;
            const fields = {};
            // ah.lib.nccu.edu.tw 用 metadataFieldLabel1（有數字）
            document.querySelectorAll('.metadataFieldLabel, .metadataFieldLabel1, .metadataFieldValue').forEach(el => {
              if (el.classList.contains('metadataFieldLabel') || el.classList.contains('metadataFieldLabel1')) {
                curLabel = el.textContent.trim().replace(/:$/, '').trim();
                if (!fields[curLabel]) fields[curLabel] = [];
              } else if (curLabel !== null) {
                const v = el.textContent.trim();
                if (v) fields[curLabel].push(v);
              }
            });
            // h3「學術產出-會議論文」等可作類型補充
            const h3TypeHint = [...document.querySelectorAll('h3')]
              .map(h => h.textContent.trim())
              .find(t => t.startsWith('學術產出-'))
              ?.replace('學術產出-', '') || '';
            const gv  = (...ks) => ks.map(k => fields[k]?.[0] || '').find(Boolean) || '';
            const gvs = (...ks) => ks.flatMap(k => fields[k] || []);
            const title = gv('題名', 'Title');
            if (!title) return null;
            // 逐一抓取作者欄位的 <a> 連結（<br> 不計入 textContent，不能靠換行分割）
            const _authorLinks = (() => {
              let cur = null;
              for (const el of document.querySelectorAll(
                  '.metadataFieldLabel,.metadataFieldLabel1,.metadataFieldValue')) {
                const isLbl = el.classList.contains('metadataFieldLabel')
                           || el.classList.contains('metadataFieldLabel1');
                if (isLbl) cur = el.textContent.trim().replace(/:$/, '').trim();
                else if (['作者','Author','Authors'].includes(cur)
                      && el.classList.contains('metadataFieldValue')) {
                  const links = [...el.querySelectorAll('a')]
                    .map(a => a.textContent.trim()).filter(Boolean);
                  return links.length ? links : null;
                }
              }
              return null;
            })();
            const authors = _authorLinks || gvs('作者', 'Author', 'Authors');
            const dateRaw   = gv('日期', 'Date');
            const year      = dateRaw.match(/\d{4}/)?.[0] || '';
            const abstractRaw = gv('摘要', 'Abstract');
            const abstract  = _isAhBoilerplate(abstractRaw) ? '' : abstractRaw;
            const source    = gv('關聯', 'Relation', 'Source')
                           || _getAhField(/dc\.relation|關聯/i);
            const dept      = _getAhField(/^dc\.contributor(?!\.(author|creator|editor|department))/i);
            const type      = gv('資料類型', 'Type') || h3TypeHint;
            const lang      = gv('語言', 'Language');
            const publisher = gv('出版者', 'Publisher');
            const kwsRaw  = gvs('關鍵詞', 'Keywords');
            const TYPE_PAT_DOM = /^(book.?chapter|book\/chapter|bookpart|article|journal.?article|conference.?paper|thesis|dissertation|report|publications?)$/i;
            const keywords = kwsRaw.filter(k => !TYPE_PAT_DOM.test(k.trim()));
            const isbn      = gv('ISBN');
            const ids       = gvs('識別碼', 'Identifier');
            const doi       = ids.find(v => /^10\.\d/.test(v))
                           || ids.find(v => v.includes('doi.org/'))?.match(/10\.\d{4,}\/\S+/)?.[0]
                           || '';
            // 來源：若是純 URL 則略去（論文記錄的「關聯」欄位常存學位論文系統連結）
            const sourceClean = source && /^https?:\/\//.test(source) ? '' : source;
            const lines = [`Title: ${title}`];
            if (authors.length)  lines.push(`Authors: ${authors.join('; ')}`);
            if (dateRaw)         lines.push(`Date: ${dateRaw}`);
            else if (year)       lines.push(`Year: ${year}`);
            if (type)            lines.push(`Type: ${type}`);
            if (sourceClean)     lines.push(`${/multimedia/i.test(type) ? 'Event' : 'Journal/Source'}: ${sourceClean}`);
            if (isbn)            lines.push(`ISBN: ${isbn}`);
            if (publisher)       lines.push(`Publisher: ${publisher}`);
            if (dept)            lines.push(`Department: ${dept}`);
            if (lang)            lines.push(`Language: ${lang}`);
            if (keywords.length) lines.push(`Keywords: ${keywords.join('; ')}`);
            if (abstract)        lines.push(`Abstract: ${abstract.slice(0, 2000)}`);
            if (doi)             lines.push(`DOI: ${doi}`);
            lines.push(`URL: ${location.href}`);
            // 多位作者時，將 DOM 直接取得的作者清單嵌入文字
            if (authors.length > 1) {
              const _paj = JSON.stringify(authors.map(n => {
                if (/[一-鿿]/.test(n) || !n.includes(',')) return { sta_chi: n };
                const c = n.indexOf(',');
                return { sta_chi: `${n.slice(c + 1).trim()} ${n.slice(0, c).trim()}`.trim() };
              }));
              lines.push(`_pre_authors_json: ${_paj}`);
              const _dept = gv('系所', '系所單位', 'Department');
              if (_dept) lines.push(`_pre_dept: ${_dept}`);
            }
            return { type: 'metadata', value: lines.join('\n'), title };
          })();
          if (domResult) return domResult;
          // DOM 也無法取得 → 交由 background 試 REST API / OAI-PMH
          const handle = location.pathname.match(/\/handle\/([\d.]+\/\d+)/)?.[1];
          if (handle) return { type: 'dspace_handle', handle, origin: location.origin };
        }

        if (!isAcademic) return null;

        // 優先順序：Highwire > DC > JSON-LD > OG > page title
        const finalTitle    = hwTitle   || dcTitle   || ldTitle   || ogTitle  || document.title || '';
        // 優先順序（作者）：DSpace DOM > Highwire citation_author > DC.creator > JSON-LD
        // AH 的 citation_author 有已知問題，會把多位作者串成「衛如祈Visita, Luksi」
        // 因此優先使用 DOM 的作者連結
        const _splitCJKLat = ns => ns.flatMap(n => {
          if (/[一-鿿]/.test(n) && /[A-Za-z]/.test(n)) {
            const parts = n.split(/(?<=[一-鿿])(?=[A-Za-z])/);
            return parts.length > 1 ? parts.map(p => p.trim()).filter(Boolean) : [n];
          }
          return [n];
        });
        const _hwSplit   = _splitCJKLat(hwAuthors);
        const _hwOnlyCJK = _hwSplit.length > 0 && _hwSplit.every(n => /[一-鿿]/.test(n));
        const _dcLat     = dcCreators.filter(n => !/[一-鿿]/.test(n));
        const rawAuthors  = _dsDomAuthors.length ? _dsDomAuthors
          : _hwSplit.length
            ? (_hwOnlyCJK && _dcLat.length ? [..._hwSplit, ..._dcLat] : _hwSplit)
            : (dcCreators.length ? _splitCJKLat(dcCreators) : ldAuthors);
        // 去重 1：移除精確重複（DSpace 論文記錄常對同一作者存中英各兩筆）
        const _seenA = new Set();
        const _uniqA = rawAuthors.filter(n => { const k = n.toLowerCase(); return !_seenA.has(k) && _seenA.add(k); });
        // 去重 2：「名 姓」拉丁自然順序若已存在「姓, 名」形式則移除（保留 Last,First 形式）
        const _lastFirstSet = new Set(_uniqA.filter(n => n.includes(',')).map(n => n.toLowerCase()));
        const finalAuthors = _uniqA.filter(n => {
          if (/[一-鿿]/.test(n) || n.includes(',')) return true;
          const p = n.trim().split(/\s+/);
          return p.length < 2 || !_lastFirstSet.has((p.slice(1).join(' ') + ', ' + p[0]).toLowerCase());
        });
        // DOM 日期補充：JSON-LD 常只有年份，DSpace DOM 有完整 yyyy-mm
        const domDateRaw = (() => {
          let cur = null;
          for (const el of document.querySelectorAll(
            '.metadataFieldLabel,.metadataFieldLabel1,.metadataFieldValue')) {
            const isLbl = el.classList.contains('metadataFieldLabel')
                       || el.classList.contains('metadataFieldLabel1');
            if (isLbl) cur = el.textContent.trim().replace(/:$/, '');
            else if ((cur === '日期' || cur === 'Date')
                  && el.classList.contains('metadataFieldValue'))
              return el.textContent.trim();
          }
          return '';
        })();
        const finalDateRaw  = hwDate || dcDate
          || (domDateRaw.length > 4 ? domDateRaw : '')  // DOM 有月份時優先
          || ldDateRaw || domDateRaw || '';
        const finalYear     = finalDateRaw.match(/\d{4}/)?.[0] || '';
        const finalJnl      = hwJnl || hwConf || dcSource || ldJnl || '';
        // AH 頁面的 meta tag（citation_abstract / DCTERMS.abstract / og:description）全是平台樣板
        // 只信任 DOM 表格的摘要欄位；其他來源保留給非 AH 頁面
        const isAhPage = /ah\.lib\.nccu\.edu\.tw/i.test(location.hostname);
        const finalAbstract = isAhPage
          ? (() => { const d = _getAhField(/摘要|[Aa]bstract/); return _isAhBoilerplate(d) ? '' : (d || ''); })()
          : ([hwAbs, dcDesc, ldDesc, ogDesc].find(v => v && !_isAhBoilerplate(v)) || '');
        const finalPub      = hwPub  || dcPub  || ldPub  || '';
        // DSpace 頁面的 dc.language.iso meta tag 常填錯（預設 zh_TW）
        // 改抓 DOM 可見的語言欄位；沒顯示語言就不傳，讓 AI 從 title 判斷
        const domLang = hasDSpaceDOM ? (() => {
          let cur = null;
          for (const el of document.querySelectorAll(
            '.metadataFieldLabel,.metadataFieldLabel1,.metadataFieldValue')) {
            const isLbl = el.classList.contains('metadataFieldLabel')
                       || el.classList.contains('metadataFieldLabel1');
            if (isLbl) cur = el.textContent.trim().replace(/:$/, '');
            else if ((cur === '語言' || cur === 'Language')
                  && el.classList.contains('metadataFieldValue'))
              return el.textContent.trim();
          }
          return '';
        })() : '';
        const finalLang     = hwLang || (hasDSpaceDOM ? domLang : dcLang) || '';
        const finalISBN     = hwISBN || ldISBN || dcISBN || '';

        // 過濾 dc.type 值混入 dc.subject 的情況
        // DSpace 有時把所有關鍵字塞進單一 citation_keywords（分號隔開），需先展開再過濾
        const TYPE_PAT = /^(book.?chapter|book\/chapter|bookpart|article|journal.?article|conference.?paper|thesis|dissertation|report|publications?)$/i;
        const _rawKwFlat = hwKws.length === 1 && hwKws[0].includes(';')
          ? hwKws[0].split(/\s*;\s*/).filter(Boolean) : hwKws;
        const rawKws   = _rawKwFlat.length ? _rawKwFlat : dcSubj;
        const finalKws = rawKws.filter(k => !TYPE_PAT.test(k.trim()));

        // 專書篇章：拆解 dc.relation 混合字串為 Book / Pages / Publisher
        const isBookChapter = dcType && /book.?chapter|book\/chapter|bookpart/i.test(dcType);
        let bookTitle = '', bookPages = '', bookPub = finalPub;
        if (isBookChapter && finalJnl) {
          const pageM = finalJnl.match(/,?\s*pp\.\s*(\d+)[–\-](\d+)/);
          if (pageM) {
            bookPages = `${pageM[1]}-${pageM[2]}`;
            const wo = finalJnl.replace(/,?\s*pp\.\s*\d+[–\-]\d+/, '').trim();
            const parts = wo.split(/,\s*/);
            bookTitle = parts.length >= 2 ? parts.slice(0, -1).join(', ') : wo;
            if (!bookPub && parts.length >= 2) bookPub = parts[parts.length - 1].trim();
          } else {
            bookTitle = finalJnl;
          }
        }

        if (!finalTitle) return null;

        const lines = [`Title: ${finalTitle}`];
        if (finalAuthors.length) lines.push(`Authors: ${finalAuthors.join('; ')}`);
        if (finalDateRaw)        lines.push(`Date: ${finalDateRaw}`);
        else if (finalYear)      lines.push(`Year: ${finalYear}`);
        if (dcType)              lines.push(`Type: ${dcType}`);
        if (isBookChapter) {
          if (bookTitle)         lines.push(`Book: ${bookTitle}`);
          if (bookPages)         lines.push(`Pages: ${bookPages}`);
        } else {
          // 過濾純 URL（論文記錄的 DC.relation 常是學位論文系統連結，不適合當來源名稱）
          if (finalJnl && !/^https?:\/\//.test(finalJnl)) {
            const isMultimedia = dcType && /multimedia/i.test(dcType);
            lines.push(isMultimedia ? `Event: ${finalJnl}` : `Journal/Source: ${finalJnl}`);
          }
          if (hwVol)             lines.push(`Volume: ${hwVol}`);
          if (hwIss)             lines.push(`Issue: ${hwIss}`);
          if (hwSP && hwEP)      lines.push(`Pages: ${hwSP}-${hwEP}`);
        }
        if (finalISBN)           lines.push(`ISBN: ${finalISBN}`);
        if (bookPub)             lines.push(`Publisher: ${bookPub}`);
        if (dcDept)              lines.push(`Department: ${dcDept}`);
        if (finalLang)           lines.push(`Language: ${finalLang}`);
        if (finalKws.length)     lines.push(`Keywords: ${finalKws.join('; ')}`);
        if (finalAbstract)       lines.push(`Abstract: ${finalAbstract}`);
        lines.push(`URL: ${ogUrl}`);

        // 多位作者時，將 DOM 解析結果嵌入 _pre_authors_json
        // background.js 送 AI 前先移除，AI 回傳後覆蓋作者欄位
        if (finalAuthors.length > 1) {
          const _preAuthsJson = JSON.stringify(finalAuthors.map(n => {
            if (/[一-鿿]/.test(n) || !n.includes(',')) return { sta_chi: n };
            const comma = n.indexOf(',');
            return { sta_chi: `${n.slice(comma + 1).trim()} ${n.slice(0, comma).trim()}`.trim() };
          }));
          lines.push(`_pre_authors_json: ${_preAuthsJson}`);
          if (dcDept) lines.push(`_pre_dept: ${dcDept}`);
        }

        return { type: 'metadata', value: lines.join('\n'), title: finalTitle };
      }
    },
    (results) => {
      if (chrome.runtime.lastError) {
        pageStatus.className = 'page-status warn';
        pageStatusText.textContent = '請輸入 DOI / PMID / arXiv / ISBN，或前往論著系統頁面';
        return;
      }
      const detected = results?.[0]?.result;
      if (!detected) {
        pageStatus.className = 'page-status warn';
        pageStatusText.textContent = '請輸入 DOI / PMID / arXiv / ISBN，或前往論著系統頁面';
        return;
      }
      // 無識別碼但有書目 metadata → 顯示專屬加入按鈕
      if (detected.type === 'metadata') {
        textInput.value = detected.value;
        pendingPageMetaDoi = null;
        pageStatus.className = 'page-status ok';
        const preview = detected.title.length > 28 ? detected.title.slice(0, 28) + '…' : detected.title;
        pageStatusText.textContent = `已從頁面擷取：「${preview}」`;
        show(pageMetaAction);
        return;
      }
      // Cookie 橫幅遮蔽（Airiti 等）：退回 service worker 直接 fetch 頁面 HTML
      if (detected.type === 'fetch_url') {
        pageStatus.className = 'page-status warn';
        pageStatusText.textContent = '頁面由 Cookie 橫幅遮蔽，改由背景擷取…';
        chrome.runtime.sendMessage({ action: 'fetchMetaFromUrl', url: detected.url }, (res) => {
          if (chrome.runtime.lastError || !res?.success || !res?.title || /cookie/i.test(res.title)) {
            pageStatus.className = 'page-status warn';
            pageStatusText.textContent = '請先在頁面接受 Cookie 同意後再試';
            return;
          }
          textInput.value = res.formattedText;
          pendingPageMetaDoi = res.doi || null;
          pageStatus.className = 'page-status ok';
          const preview = res.title.length > 28 ? res.title.slice(0, 28) + '…' : res.title;
          pageStatusText.textContent = `已從頁面擷取：「${preview}」`;
          show(pageMetaAction);
        });
        return;
      }
      // DSpace 7 (Angular SPA)：meta tag 為空，改查 REST API
      if (detected.type === 'dspace_handle') {
        pageStatus.className = 'page-status warn';
        pageStatusText.textContent = '正在查詢機構典藏資料…';
        chrome.runtime.sendMessage(
          { action: 'fetchDSpaceHandle', handle: detected.handle, origin: detected.origin },
          (response) => {
            if (chrome.runtime.lastError || !response?.data) {
              pageStatus.className = 'page-status warn';
              pageStatusText.textContent = response?.error || '無法取得機構典藏資料（可能需要校園網路）';
              return;
            }
            const d = response.data;
            textInput.value  = d.formattedText;
            pendingPageMetaDoi = d.doi || null;
            pageStatus.className = 'page-status ok';
            const preview = d.title.length > 28 ? d.title.slice(0, 28) + '…' : d.title;
            pageStatusText.textContent = `已從機構典藏擷取：「${preview}」`;
            show(pageMetaAction);
          }
        );
        return;
      }
      const labelMap   = { doi: 'DOI', pmid: 'PubMed PMID', arxiv: 'arXiv ID' };
      const displayMap = { doi: detected.value, pmid: `PMID:${detected.value}`, arxiv: detected.value };
      doiInput.value = displayMap[detected.type];
      pageStatus.className = 'page-status ok';
      pageStatusText.textContent = `已從頁面偵測到 ${labelMap[detected.type]}；處理後前往論著系統，外掛將自動填入`;
    }
  );
}


// ── 2 & 3. API Key 已內建，略過 UI 讀寫 ──────────────────
function loadApiKey() {}


// ── 識別碼類型偵測 ───────────────────────────────────────
function detectInputType(raw) {
  const s = raw.trim();
  const arXivUrl = s.match(/arxiv\.org\/abs\/([^\s?#/]+)/i);
  if (arXivUrl) return { type: 'arxiv', id: arXivUrl[1] };
  if (/^(arxiv:)?(\d{4}\.\d{4,5}(v\d+)?|[a-z\-]+\/\d{7})$/i.test(s))
    return { type: 'arxiv', id: s.replace(/^arxiv:/i, '') };
  const pmidUrl = s.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/i);
  if (pmidUrl) return { type: 'pmid', id: pmidUrl[1] };
  const pmidPrefix = s.match(/^pmid:?\s*(\d{5,9})$/i);
  if (pmidPrefix) return { type: 'pmid', id: pmidPrefix[1] };
  if (/^\d{5,9}$/.test(s)) return { type: 'pmid', id: s };
  // ISBN-10（9 digits + digit/X）or ISBN-13（978/979 + 10 digits）
  const isbnClean = s.replace(/[-\s]/g, '');
  if (/^\d{9}[\dX]$/i.test(isbnClean)) return { type: 'isbn', id: isbnClean.toUpperCase() };
  if (/^97[89]\d{10}$/.test(isbnClean)) return { type: 'isbn', id: isbnClean };
  return { type: 'doi', id: s };
}


// ── RIS / BibTeX / ENW 書目匯入 ─────────────────────────

btnImportFile.addEventListener('click', () => fileImport.click());

// 頁面書目一鍵處理（metadata 偵測後出現）
btnAddPageMeta.addEventListener('click', async () => {
  const text = textInput.value.trim();
  if (!text) return;

  const preview    = text.replace(/^Title: /m, '').split('\n')[0].substring(0, 50);
  const doi        = pendingPageMetaDoi;
  const year       = text.match(/^Year: (.+)$/m)?.[1]?.trim()    || '';
  const journal    = text.match(/^Journal: (.+)$/m)?.[1]?.trim() || '';
  const hasAbstract = /^Abstract: /m.test(text);

  pendingPageMetaDoi = null;
  textInput.value = '';
  hide(pageMetaAction);

  const entry = {
    identifierType:  'page',
    identifierValue: doi || '',
    title:           preview,
    journal,
    year,
    hasAbstract,
    authorCount:     0,
    formattedText:   text,
    needsDoi:        !!doi,
  };

  const { orcidQueue = [] } = await chrome.storage.local.get('orcidQueue');
  await chrome.storage.local.set({ orcidQueue: [...orcidQueue, entry] });

  tabQueue.click();
  await renderPendingQueue();
});

fileImport.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  fileImport.value = '';

  const content = await file.text();
  const format  = detectBibFormat(content);

  if (!format) {
    alert('無法識別格式。請使用 RIS (.ris)、BibTeX (.bib) 或 EndNote (.enw) 格式的檔案');
    return;
  }

  let entries, toText;
  if      (format === 'ris') { entries = parseRIS(content);     toText = risEntryToText; }
  else if (format === 'bib') { entries = parseBibTeX(content);  toText = bibtexEntryToText; }
  else if (format === 'enw') { entries = parseENW(content);     toText = enwEntryToText; }

  if (!entries?.length) {
    alert('未找到有效的書目資料，請確認檔案格式是否正確');
    return;
  }

  const newItems = entries.map(entry => {
    const text        = toText(entry);
    const title       = text.match(/^Title: (.+)$/m)?.[1] || '未知標題';
    const year        = text.match(/^Year: (.+)$/m)?.[1]  || '';
    const journal     = text.match(/^(?:Journal|Book\/Conference): (.+)$/m)?.[1] || '';
    const doi         = text.match(/^DOI: (.+)$/m)?.[1]   || '';
    const authorLine  = text.match(/^Authors: (.+)$/m)?.[1] || '';
    const authorCount = authorLine ? authorLine.split(';').filter(s => s.trim()).length : 0;
    const hasAbstract = /^Abstract: /m.test(text);
    const preview     = title.length > 45 ? title.slice(0, 45) + '…' : title;
    return {
      identifierType:  format,
      identifierValue: doi,
      title:           preview,
      journal,
      year,
      hasAbstract,
      authorCount,
      formattedText:   text,
      needsDoi:        !!doi,
    };
  });

  const { orcidQueue = [] } = await chrome.storage.local.get('orcidQueue');
  await chrome.storage.local.set({ orcidQueue: [...orcidQueue, ...newItems] });
  await renderPendingQueue();

  btnImportFile.textContent = `✓ 已匯入 ${newItems.length} 篇`;
  setTimeout(() => { btnImportFile.textContent = '匯入 RIS / BibTeX / ENW 檔案'; }, 2500);
});


// 格式自動偵測（依內容特徵判斷）
function detectBibFormat(content) {
  if (/^@\w+\s*\{/m.test(content)) return 'bib';
  if (/^%0\s/m.test(content))        return 'enw';
  if (/^TY\s+-/m.test(content))      return 'ris';
  return null;
}


// ── RIS 解析 ─────────────────────────────────────────────
function parseRIS(content) {
  const entries = [];
  const blocks  = content.split(/^ER\s*-.*$/m);
  for (const block of blocks) {
    const fields = {};
    for (const line of block.split('\n')) {
      const m = line.match(/^([A-Z][A-Z0-9])\s+-\s+(.*)/);
      if (!m || !m[2].trim()) continue;
      (fields[m[1]] = fields[m[1]] || []).push(m[2].trim());
    }
    if (Object.keys(fields).length > 1) entries.push(fields);
  }
  return entries;
}

function risEntryToText(f) {
  const get  = (...tags) => tags.flatMap(t => f[t] || [])[0] || '';
  const getA = (...tags) => tags.flatMap(t => f[t] || []).join('; ');
  const title     = get('TI', 'T1', 'CT');
  const authors   = getA('AU', 'A1', 'A2');
  const year      = (get('PY', 'Y1') || '').split('/')[0];
  const typeCode  = get('TY');
  const journal   = get('JO', 'JF', 'J2');
  const booktitle = get('T2', 'BT');
  const volume    = get('VL');
  const issue     = get('IS');
  const sp = get('SP'), ep = get('EP');
  const pages     = sp && ep ? `${sp}-${ep}` : sp;
  const rawDoi    = get('DO', 'M3');
  const abstract  = get('AB', 'N2');
  const keywords  = getA('KW');
  const publisher = get('PB');
  const place     = get('CY', 'PP');
  const isbn      = get('SN');
  const confDate  = get('Y2');
  const confPlace = get('C1');
  const rawUrl    = get('UR', 'L1', 'L2');
  const doiFromUrl = !rawDoi && rawUrl ? (rawUrl.match(/10\.\d{4,}\/\S+/)?.[0] || '') : '';
  const doi       = rawDoi || doiFromUrl;
  const articleUrl = rawUrl && !doiFromUrl ? rawUrl : '';
  const typeMap   = {
    JOUR:'Journal Article', JFULL:'Journal Article',
    CONF:'Conference Paper', CPAPER:'Conference Paper',
    BOOK:'Book', CHAP:'Book Section', RPRT:'Report', THES:'Thesis',
  };
  const lines = [];
  if (title)                               lines.push(`Title: ${title}`);
  if (authors)                             lines.push(`Authors: ${authors}`);
  if (year)                                lines.push(`Year: ${year}`);
  if (typeCode)                            lines.push(`Type: ${typeMap[typeCode] || typeCode}`);
  if (journal)                             lines.push(`Journal: ${journal}`);
  if (booktitle && booktitle !== journal)  lines.push(`Book/Conference: ${booktitle}`);
  if (volume)                              lines.push(`Volume: ${volume}`);
  if (issue)                               lines.push(`Issue: ${issue}`);
  if (pages)                               lines.push(`Pages: ${pages}`);
  if (doi)                                 lines.push(`DOI: ${doi}`);
  if (publisher)                           lines.push(`Publisher: ${publisher}`);
  if (place)                               lines.push(`Place: ${place}`);
  if (isbn)                                lines.push(`ISBN: ${isbn}`);
  if (confDate)                            lines.push(`Conference Date: ${confDate}`);
  if (confPlace)                           lines.push(`Conference Place: ${confPlace}`);
  if (keywords)                            lines.push(`Keywords: ${keywords}`);
  if (abstract)                            lines.push(`Abstract: ${abstract}`);
  if (articleUrl)                          lines.push(`URL: ${articleUrl}`);
  return lines.join('\n');
}


// ── BibTeX 解析 ──────────────────────────────────────────
function parseBibTeX(content) {
  const entries = [];
  const re = /@(\w+)\s*\{/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const type = m[1].toLowerCase();
    if (['string', 'comment', 'preamble'].includes(type)) continue;
    let depth = 1, j = m.index + m[0].length;
    while (j < content.length && depth > 0) {
      if      (content[j] === '{') depth++;
      else if (content[j] === '}') depth--;
      j++;
    }
    re.lastIndex = j;
    const body   = content.slice(m.index + m[0].length, j - 1);
    const fields = { _type: type };
    const ci     = body.indexOf(',');
    if (ci === -1) continue;
    const fRe = /(\w+)\s*=\s*(?:\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}|"([^"]*)"|([\w\d]+))/g;
    let fm;
    while ((fm = fRe.exec(body.slice(ci + 1))) !== null) {
      fields[fm[1].toLowerCase()] = (fm[2] ?? fm[3] ?? fm[4] ?? '').trim();
    }
    entries.push(fields);
  }
  return entries;
}

function bibtexEntryToText(f) {
  const clean    = s => (s || '').replace(/[{}]/g, '').trim();
  const title    = clean(f.title);
  const authors  = clean(f.author || f.editor).replace(/ and /gi, '; ');
  const year     = clean(f.year);
  const type     = f._type || '';
  const journal  = clean(f.journal);
  const booktitle= clean(f.booktitle);
  const volume   = clean(f.volume);
  const number   = clean(f.number);
  const pages    = clean(f.pages).replace(/--/g, '-');
  const rawDoi   = clean(f.doi);
  const abstract = clean(f.abstract);
  const keywords = clean(f.keywords);
  const publisher= clean(f.publisher);
  const place    = clean(f.address);
  const isbn     = clean(f.isbn);
  const rawUrl   = clean(f.url || f.URL || '');
  // 從 URL 欄位萃取 DOI（doi 欄位優先，URL 作備援）
  const doiFromUrl = !rawDoi && rawUrl ? (rawUrl.match(/10\.\d{4,}\/\S+/)?.[0] || '') : '';
  const doi      = rawDoi || doiFromUrl;
  // URL 是文章連結但不含 DOI 時保留（可能有期刊資訊）
  const articleUrl = rawUrl && !doiFromUrl ? rawUrl : '';
  const typeMap  = {
    article:'Journal Article', inproceedings:'Conference Paper',
    conference:'Conference Paper', book:'Book', incollection:'Book Section',
    techreport:'Technical Report', phdthesis:'PhD Thesis',
    mastersthesis:"Master's Thesis", misc:'Miscellaneous', unpublished:'Unpublished',
  };
  const lines = [];
  if (title)                               lines.push(`Title: ${title}`);
  if (authors)                             lines.push(`Authors: ${authors}`);
  if (year)                                lines.push(`Year: ${year}`);
  if (type)                                lines.push(`Type: ${typeMap[type] || type}`);
  if (journal)                             lines.push(`Journal: ${journal}`);
  if (booktitle && booktitle !== journal)  lines.push(`Book/Conference: ${booktitle}`);
  if (volume)                              lines.push(`Volume: ${volume}`);
  if (number)                              lines.push(`Issue: ${number}`);
  if (pages)                               lines.push(`Pages: ${pages}`);
  if (doi)                                 lines.push(`DOI: ${doi}`);
  if (publisher)                           lines.push(`Publisher: ${publisher}`);
  if (place)                               lines.push(`Place: ${place}`);
  if (isbn)                                lines.push(`ISBN: ${isbn}`);
  if (keywords)                            lines.push(`Keywords: ${keywords}`);
  if (abstract)                            lines.push(`Abstract: ${abstract}`);
  if (articleUrl)                          lines.push(`URL: ${articleUrl}`);
  return lines.join('\n');
}


// ── ENW（EndNote Export）解析 ────────────────────────────
function parseENW(content) {
  const entries = [];
  const blocks  = content.split(/(?=^%0 )/m).filter(b => b.trim());
  for (const block of blocks) {
    const fields = {};
    for (const line of block.split('\n')) {
      const m = line.match(/^%([A-Z0-9@!<>?~])[ \t]+(.*)/);
      if (!m || !m[2].trim()) continue;
      (fields[m[1]] = fields[m[1]] || []).push(m[2].trim());
    }
    if (Object.keys(fields).length > 0) entries.push(fields);
  }
  return entries;
}

function enwEntryToText(f) {
  const get  = tag => (f[tag] || [])[0] || '';
  const getA = tag => (f[tag] || []).join('; ');
  const title    = get('T');
  const authors  = getA('A');
  const year     = (get('D') || '').match(/\d{4}/)?.[0] || '';
  const type     = get('0');
  const journal  = get('J');
  const booktitle= get('B');
  const volume   = get('V');
  const issue    = get('N');
  const pages    = get('P');
  const rawDoi   = get('R');
  const abstract = get('X');
  const keywords = getA('K');
  const publisher= get('I');
  const place    = get('C');
  const isbn     = get('@');
  const rawUrl   = get('U') || get('L');
  const doiFromUrl = !rawDoi && rawUrl ? (rawUrl.match(/10\.\d{4,}\/\S+/)?.[0] || '') : '';
  const doi      = rawDoi || doiFromUrl;
  const articleUrl = rawUrl && !doiFromUrl ? rawUrl : '';
  const lines = [];
  if (title)                               lines.push(`Title: ${title}`);
  if (authors)                             lines.push(`Authors: ${authors}`);
  if (year)                                lines.push(`Year: ${year}`);
  if (type)                                lines.push(`Type: ${type}`);
  if (journal)                             lines.push(`Journal: ${journal}`);
  if (booktitle && booktitle !== journal)  lines.push(`Book/Conference: ${booktitle}`);
  if (volume)                              lines.push(`Volume: ${volume}`);
  if (issue)                               lines.push(`Issue: ${issue}`);
  if (pages)                               lines.push(`Pages: ${pages}`);
  if (doi)                                 lines.push(`DOI: ${doi}`);
  if (publisher)                           lines.push(`Publisher: ${publisher}`);
  if (place)                               lines.push(`Place: ${place}`);
  if (isbn)                                lines.push(`ISBN: ${isbn}`);
  if (keywords)                            lines.push(`Keywords: ${keywords}`);
  if (abstract)                            lines.push(`Abstract: ${abstract}`);
  if (articleUrl)                          lines.push(`URL: ${articleUrl}`);
  return lines.join('\n');
}


// ── 4. 加入佇列 ──────────────────────────────────────────
btnProcess.addEventListener('click', async () => {

  // 純文字模式：直接進確認畫面（文字本身即書目資料）
  if (inputMode === 'text') {
    const text = textInput.value.trim();
    if (!text) { alert('請貼上書目資料'); return; }
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    pendingTabId = tabs[0]?.id || null;
    pendingFormattedText = text;
    textInput.value = '';
    chrome.storage.local.remove('savedInput');
    const preview = text.replace(/\s+/g, ' ').substring(0, 50) + (text.length > 50 ? '…' : '');
    setStep(1, 'done');
    showConfirm({ title: preview, hasAbstract: /\bAbstract\s*:/i.test(text), authorCount: 0 });
    return;
  }

  // DOI / PMID / arXiv / ISBN 模式：查詢 CrossRef 後存入佇列（含 formattedText）
  // 之後按「開始處理第一篇」可直接跳 AI 清洗，不需重查
  const raw = doiInput.value.trim();
  if (!raw) { alert('請輸入 DOI、PMID 或 arXiv ID'); return; }
  const detected = detectInputType(raw);

  btnProcess.textContent = '查詢中…';
  btnProcess.disabled = true;

  const handleAdd = (response) => {
    const err = chrome.runtime.lastError;
    btnProcess.textContent = '加入佇列';
    btnProcess.disabled = false;
    if (err || !response?.success) {
      alert('查詢失敗：' + (response?.error || err?.message || '未知錯誤'));
      return;
    }
    (async () => {
      const meta = response.data;
      const { orcidQueue = [] } = await chrome.storage.local.get('orcidQueue');
      await chrome.storage.local.set({
        orcidQueue: [...orcidQueue, {
          identifierType:  detected.type,
          identifierValue: detected.id || raw,
          title:       meta.title || raw,
          journal:     meta.journal || '',
          year:        meta.year || '',
          hasAbstract: meta.hasAbstract,
          authorCount: meta.authorCount,
          formattedText: meta.formattedText,
        }]
      });
      doiInput.value = '';
      chrome.storage.local.remove('savedInput');
      await renderPendingQueue();
      btnProcess.textContent = '✓ 已加入佇列';
      setTimeout(() => { btnProcess.textContent = '加入佇列'; }, 2000);
    })();
  };

  if (detected.type === 'pmid') {
    chrome.runtime.sendMessage({ action: 'fetchPubMed', pmid: detected.id }, handleAdd);
  } else if (detected.type === 'arxiv') {
    chrome.runtime.sendMessage({ action: 'fetchArxiv', arxivId: detected.id }, handleAdd);
  } else if (detected.type === 'isbn') {
    chrome.runtime.sendMessage({ action: 'fetchISBN', isbn: detected.id }, handleAdd);
  } else {
    chrome.runtime.sendMessage({ action: 'fetchMetadata', doi: raw }, handleAdd);
  }
});


// ── 確認後，呼叫 OpenAI 並填入 ───────────────────────────
btnConfirm.addEventListener('click', async () => {
  if (!pendingFormattedText) return;
  chrome.storage.local.remove('pendingConfirm');
  setStep(2, 'active');
  showLoading('AI 欄位對應中…');

  chrome.runtime.sendMessage(
    { action: 'processWithAI', formattedText: pendingFormattedText },
    async (response) => {
      if (!response.success) {
        showError(response.error);
        setStep(2, 'error');
        return;
      }
      await dispatchFill(response.data, pendingTabId);
    }
  );
});

btnConfirmCancel.addEventListener('click', async () => {
  pendingFormattedText = null;
  chrome.storage.local.remove('pendingConfirm');
  resetSteps();
  hide(sectionConfirm);
  show(sectionInput);
  await renderPendingQueue();
});


// 儲存並廣播填入事件（DOI 模式與純文字模式共用）
async function dispatchFill(data, tabId) {
  setStep(1, 'done');
  setStep(2, 'done');
  setStep(3, 'active');
  showLoading('正在填入表單…');
  const dbg = document.getElementById('debugOutput');
  if (dbg) {
    dbg.textContent = JSON.stringify(data, null, 2);
    document.getElementById('debugSection').style.display = '';
  }

  chrome.storage.local.remove(['savedInput', 'pendingConfirm']);
  await chrome.storage.local.set({ pendingFillData: data, filledPhase: 1 });

  chrome.scripting.executeScript(
    {
      target: { tabId, allFrames: true },
      func: (d) => {
        window.dispatchEvent(new CustomEvent('nccu_fillForm', { detail: d }));
      },
      args: [data]
    },
    () => {
      if (chrome.runtime.lastError) {
        showError('表單填入失敗：' + chrome.runtime.lastError.message);
        setStep(3, 'error');
        return;
      }
      setStep(3, 'done');
      setStep(4, 'active');
      showPreview(data);
      updateQueueButton();
    }
  );
}


// ── 5. 重新輸入 ──────────────────────────────────────────
btnRetry.addEventListener('click', async () => {
  resetSteps();
  show(sectionInput);
  hide(sectionError);
  await renderPendingQueue();
});


// ── 6. 手動觸發填入（頁面已開著時使用）──────────────────
btnFill.addEventListener('click', async () => {
  const { pendingFillData } = await chrome.storage.local.get('pendingFillData');
  if (!pendingFillData) return;

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs[0].id;

  chrome.scripting.executeScript(
    {
      target: { tabId, allFrames: true },
      func: (data) => {
        window.dispatchEvent(new CustomEvent('nccu_reFill', { detail: data }));
      },
      args: [pendingFillData]
    },
    () => {
      if (chrome.runtime.lastError) return;
      chrome.storage.local.set({ filledPhase: 2 });
      setStep(3, 'done');
      setStep(4, 'active');
      updateQueueButton();
    }
  );
});


// ── 7. 取消並清除填入內容 ────────────────────────────────
btnCancel.addEventListener('click', async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs[0].id;

  // 同樣廣播到所有 iframe
  chrome.scripting.executeScript(
    {
      target: { tabId: tabId, allFrames: true },
      func: () => {
        window.dispatchEvent(new CustomEvent('nccu_clearHighlight'));
      }
    },
    () => {
      resetSteps();
      show(sectionInput);
      hide(sectionPreview);
      renderPendingQueue();
    }
  );
});


// ── 8. 換一篇（清除暫存，回到輸入，不清除表單）──────────
btnNewDoi.addEventListener('click', async () => {
  await chrome.storage.local.remove(['pendingFillData', 'filledPhase']);
  doiInput.value = '';
  resetSteps();
  hide(sectionPreview);
  show(sectionInput);
  await renderPendingQueue();
});


// ── 工具函式 ─────────────────────────────────────────────

function setStep(num, status) {
  const el = document.getElementById(`step${num}`);
  if (!el) return;
  el.className = `step ${status}`;
  const dot = el.querySelector('.step-dot');
  if (status === 'done')       dot.textContent = '✓';
  else if (status === 'error') dot.textContent = '✕';
  else                         dot.textContent = num;
}

function resetSteps() {
  [1, 2, 3, 4].forEach(n => setStep(n, ''));
  hide(btnNextQueue);
}

function showLoading(text) {
  hide(sectionInput);
  hide(sectionConfirm);
  hide(sectionError);
  hide(sectionPreview);
  show(sectionLoading);
  loadingText.textContent = text;
}

function showError(msg) {
  hide(sectionLoading);
  hide(sectionPreview);
  show(sectionError);
  errorMsg.textContent = msg;
}


// ── ORCID 設定 ────────────────────────────────────────────

async function loadOrcidSettings() {
  const { orcidId, orcidLastCheck, orcidKnown = [], savedEmpId } =
    await chrome.storage.local.get(['orcidId', 'orcidLastCheck', 'orcidKnown', 'savedEmpId']);
  if (orcidId) {
    orcidInput.value = orcidId;
    const lastCheck = orcidLastCheck
      ? new Date(orcidLastCheck).toLocaleDateString('zh-TW')
      : '尚未檢查';
    orcidStatus.textContent = `追蹤中・${orcidKnown.length} 篇著作・上次檢查：${lastCheck}`;
  }
  if (savedEmpId) {
    empInput.value = savedEmpId;
  }
}

async function tryDetectEmpId() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!/webapp\d*\.nccu\.edu\.tw/.test(tab?.url ?? '')) return;

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: () => {
        const el = document.querySelector('#IdLb');
        if (el?.textContent?.trim().match(/^\d{4,7}$/)) return el.textContent.trim();
        return null;
      }
    });

    const empId = results?.find(r => r.result)?.result;
    if (empId) {
      empInput.value = empId;
      empStatus.textContent = `已從政大系統偵測到員工編號 ${empId}`;
      lookupOrcidByEmpId(empId, true);
    }
  } catch {
    // 無存取權限或其他錯誤，靜默略過
  }
}

async function lookupOrcidByEmpId(empId, autoDetected = false) {
  if (!empId || !/^\d{4,7}$/.test(empId)) {
    empStatus.textContent = '請輸入正確的員工編號（4–7 位數字）';
    empStatus.style.color = '#c62828';
    return;
  }
  empStatus.textContent = '查詢中…';
  empStatus.style.color = '';
  chrome.runtime.sendMessage({ action: 'lookupOrcidByEmpId', empId }, async (res) => {
    const toStore = { savedEmpId: empId };
    if (res?.scholarId) toStore.scholarId = res.scholarId;
    if (res?.orcid) {
      orcidInput.value = res.orcid;
      empStatus.textContent = autoDetected
        ? `偵測到員工編號 ${empId}，已自動填入 ORCID，請點「儲存」確認`
        : `找到對應 ORCID，已填入欄位，請點「儲存」確認`;
      empStatus.style.color = '#2e7d32';
    } else {
      empStatus.textContent = `員工編號 ${empId} 查無 ORCID，請手動填入下方欄位後點「儲存」`;
      empStatus.style.color = '#9a6000';
    }
    await chrome.storage.local.set(toStore);
  });
}

btnAutoDetect.addEventListener('click', async () => {
  btnAutoDetect.textContent = '偵測中…';
  btnAutoDetect.disabled = true;

  // 清空先前顯示的內容
  empInput.value = '';
  orcidInput.value = '';
  empStatus.textContent = '';
  empStatus.style.color = '';
  orcidStatus.textContent = '';
  newWorksList.innerHTML = '';
  hide(queuePagination);
  worksActions.style.display = 'none';

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];

  if (!/webapp\d*\.nccu\.edu\.tw/.test(tab?.url ?? '')) {
    empStatus.textContent = '請先切換到政大系統頁面再點此按鈕';
    empStatus.style.color = '#c62828';
    btnAutoDetect.textContent = '從政大系統自動帶入員編與 ORCID';
    btnAutoDetect.disabled = false;
    return;
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    func: () => {
      const el = document.querySelector('#IdLb');
      if (el?.textContent?.trim().match(/^\d{4,7}$/)) return el.textContent.trim();
      return null;
    }
  });

  btnAutoDetect.textContent = '從政大系統自動帶入員編與 ORCID';
  btnAutoDetect.disabled = false;

  const empId = results?.find(r => r.result)?.result;
  if (!empId) {
    empStatus.textContent = '無法偵測到員工編號，請確認已登入政大系統';
    empStatus.style.color = '#c62828';
    return;
  }

  empInput.value = empId;
  empStatus.textContent = `偵測到員工編號 ${empId}，查詢 ORCID 中…`;
  empStatus.style.color = '';

  chrome.runtime.sendMessage({ action: 'lookupOrcidByEmpId', empId }, async (res) => {
    if (!res?.orcid) {
      empStatus.textContent = `員工編號 ${empId} 無對應 ORCID 資料`;
      empStatus.style.color = '#c62828';
      return;
    }
    orcidInput.value = res.orcid;
    const toStore2 = { orcidId: res.orcid, savedEmpId: empId, orcidKnown: [], orcidNewWorks: [] };
    if (res.scholarId) toStore2.scholarId = res.scholarId;
    await chrome.storage.local.set(toStore2);
    empStatus.textContent = `已帶入員工編號 ${empId} 與 ORCID`;
    empStatus.style.color = '#2e7d32';
    orcidStatus.textContent = '已儲存，掃描著作中…';

    btnCheckOrcid.textContent = '檢查中…';
    btnCheckOrcid.disabled = true;
    chrome.runtime.sendMessage({ action: 'checkOrcid' }, async () => {
      await loadOrcidSettings();
      await checkNewOrcidWorks();
      btnCheckOrcid.textContent = '立即檢查';
      btnCheckOrcid.disabled = false;
    });
  });
});

btnLookupOrcid.addEventListener('click', () => {
  lookupOrcidByEmpId(empInput.value.trim());
});

empInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') lookupOrcidByEmpId(empInput.value.trim());
});

btnSaveOrcid.addEventListener('click', async () => {
  const id = orcidInput.value.trim();
  if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(id)) {
    alert('請輸入正確格式的 ORCID（如 0000-0001-2345-6789）');
    return;
  }
  const toSave = { orcidId: id, orcidKnown: [], orcidNewWorks: [] };
  // 若有員工編號，一起存入自訂對應表，日後可自動帶入
  const empId = empInput.value.trim();
  if (empId && /^\d{4,7}$/.test(empId)) {
    const { customEmpOrcidMap = {} } = await chrome.storage.sync.get('customEmpOrcidMap');
    customEmpOrcidMap[empId] = id;
    await chrome.storage.sync.set({ customEmpOrcidMap });
    toSave.savedEmpId = empId;
  }
  await chrome.storage.local.set(toSave);
  orcidStatus.textContent = empId
    ? `已儲存，員工編號 ${empId} 與 ORCID 的對應已記住`
    : '已儲存，將於下次檢查時掃描所有著作';
  btnSaveOrcid.textContent = '已儲存 ✓';
  setTimeout(() => { btnSaveOrcid.textContent = '儲存'; }, 2000);
});

btnCheckOrcid.addEventListener('click', async () => {
  btnCheckOrcid.textContent = '檢查中…';
  btnCheckOrcid.disabled = true;
  chrome.runtime.sendMessage({ action: 'checkOrcid' }, async () => {
    await loadOrcidSettings();
    await checkNewOrcidWorks();
    btnCheckOrcid.textContent = '立即檢查';
    btnCheckOrcid.disabled = false;
  });
});


// ── 著作佇列 tab 內容渲染 ────────────────────────────────

async function checkNewOrcidWorks() {
  const { orcidNewWorks = [], orcidQueue = [] } =
    await chrome.storage.local.get(['orcidNewWorks', 'orcidQueue']);

  // 更新 tab badge（只顯示暫存區新著作數）
  if (orcidNewWorks.length > 0) {
    queueTabBadge.textContent = orcidNewWorks.length;
    show(queueTabBadge);
  } else {
    hide(queueTabBadge);
  }

  // ── 暫存區（分頁）
  const totalPages = Math.ceil(orcidNewWorks.length / PAGE_SIZE);
  if (queueNewPage >= totalPages && totalPages > 0) queueNewPage = totalPages - 1;
  if (queueNewPage < 0) queueNewPage = 0;

  const pageStart = queueNewPage * PAGE_SIZE;
  const pageItems = orcidNewWorks.slice(pageStart, pageStart + PAGE_SIZE);

  if (orcidNewWorks.length > 0) {
    const inAhCount  = orcidNewWorks.filter(w => w.alreadyInAh).length;
    const newCount   = orcidNewWorks.length - inAhCount;
    const summaryHtml = inAhCount > 0
      ? `<div class="ah-summary">共 ${orcidNewWorks.length} 篇 ・ <span class="ah-summary-filed">${inAhCount} 篇已在校務系統（標紅）</span> ・ ${newCount} 篇未建檔</div>`
      : `<div class="ah-summary">共 ${orcidNewWorks.length} 篇待建檔</div>`;

    newWorksList.innerHTML = summaryHtml + pageItems.map((w, localIdx) => {
      const actualIdx = pageStart + localIdx;
      const inAh = !!w.alreadyInAh;
      const titleStyle = inAh ? ' style="color:#b83030;"' : '';
      const ahBadge = inAh ? '<span class="ah-badge">已在校務系統</span>' : '';
      return `<label class="new-work-card">
        <input type="checkbox" class="work-check" data-index="${actualIdx}" data-in-ah="${inAh}">
        <div class="work-card-content">
          <div class="new-work-title"${titleStyle}>${w.title}${ahBadge}</div>
          <div class="new-work-meta">${w.year || ''}${w.doi ? '・' + w.doi : '・無 DOI'}</div>
        </div>
      </label>`;
    }).join('');
    worksActions.style.display = 'flex';

    if (totalPages > 1) {
      queuePageInfo.textContent = `第 ${queueNewPage + 1} / ${totalPages} 頁（共 ${orcidNewWorks.length} 篇）`;
      btnQueuePrev.disabled = queueNewPage === 0;
      btnQueueNext.disabled = queueNewPage >= totalPages - 1;
      show(queuePagination);
    } else {
      hide(queuePagination);
    }
  } else {
    newWorksList.innerHTML =
      '<div style="font-size:11px;color:#8a8fa8;text-align:center;padding:10px 0">暫無新偵測著作</div>';
    worksActions.style.display = 'none';
    hide(queuePagination);
  }

}


// ── 待處理佇列（常駐主頁）────────────────────────────────
async function renderPendingQueue() {
  const { orcidQueue = [] } = await chrome.storage.local.get('orcidQueue');

  if (orcidQueue.length === 0) {
    hide(sectionPendingQueue);
    hide(btnNextQueue);
    return;
  }

  show(sectionPendingQueue);
  btnStartQueue.disabled = false;
  const total = orcidQueue.length;
  pendingQueueList.innerHTML = orcidQueue.map((w, i) => {
    const label = w.identifierType?.toUpperCase() || (w.doi ? 'DOI' : 'ORCID');
    const title = w.title || w.identifierValue || w.doi || '未知';
    const meta  = [w.year, label].filter(Boolean).join('・');
    return `<div class="queue-item">
      <div class="queue-move-group">
        <button class="queue-move" data-index="${i}" data-dir="-1" title="上移" ${i === 0 ? 'disabled' : ''}>▲</button>
        <button class="queue-move" data-index="${i}" data-dir="1"  title="下移" ${i === total - 1 ? 'disabled' : ''}>▼</button>
      </div>
      <span class="queue-num">${i + 1}</span>
      <div class="queue-item-content">
        <div class="queue-item-title">${title}</div>
        <div class="queue-item-meta">${meta}</div>
      </div>
      <button class="queue-remove" data-index="${i}" title="從佇列移除">×</button>
    </div>`;
  }).join('');

  pendingQueueList.querySelectorAll('.queue-move').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index);
      const dir = parseInt(btn.dataset.dir);
      const { orcidQueue: q = [] } = await chrome.storage.local.get('orcidQueue');
      const to = idx + dir;
      if (to < 0 || to >= q.length) return;
      [q[idx], q[to]] = [q[to], q[idx]];
      await chrome.storage.local.set({ orcidQueue: q });
      await renderPendingQueue();
    });
  });

  pendingQueueList.querySelectorAll('.queue-remove').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index);
      const { orcidQueue: q = [] } = await chrome.storage.local.get('orcidQueue');
      await chrome.storage.local.set({ orcidQueue: q.filter((_, i) => i !== idx) });
      await renderPendingQueue();
      await checkNewOrcidWorks();
    });
  });

  await updateQueueButton();
}

btnQueuePrev.addEventListener('click', async () => {
  if (queueNewPage > 0) { queueNewPage--; await checkNewOrcidWorks(); }
});
btnQueueNext.addEventListener('click', async () => {
  const { orcidNewWorks = [] } = await chrome.storage.local.get('orcidNewWorks');
  if (queueNewPage < Math.ceil(orcidNewWorks.length / PAGE_SIZE) - 1) {
    queueNewPage++;
    await checkNewOrcidWorks();
  }
});

const btnSelectNone = document.getElementById('btnSelectNone');

btnSelectAll.addEventListener('click', () => {
  newWorksList.querySelectorAll('.work-check').forEach(c => {
    c.checked = c.dataset.inAh !== 'true';
  });
});

btnSelectNone.addEventListener('click', () => {
  newWorksList.querySelectorAll('.work-check').forEach(c => { c.checked = false; });
});

// 匯入勾選的論著 → 排入待處理佇列
btnImportSelected.addEventListener('click', async () => {
  const { orcidNewWorks = [], orcidQueue = [] } =
    await chrome.storage.local.get(['orcidNewWorks', 'orcidQueue']);

  const checkedIdx = [...newWorksList.querySelectorAll('.work-check:checked')]
    .map(cb => parseInt(cb.dataset.index));

  if (checkedIdx.length === 0) {
    alert('請至少勾選一篇論著'); return;
  }

  const inQueue  = new Set(orcidQueue.map(w => w.putCode));
  const selected = checkedIdx.map(i => orcidNewWorks[i])
                             .filter(w => !inQueue.has(w.putCode));
  const newQueue = [...orcidQueue, ...selected];

  await chrome.storage.local.set({ orcidQueue: newQueue });
  await renderPendingQueue();
  await checkNewOrcidWorks();
  const msg = selected.length > 0
    ? `✓ 已加入 ${selected.length} 篇至佇列`
    : '已在佇列中，無需重複加入';
  btnImportSelected.textContent = msg;
  setTimeout(() => { btnImportSelected.textContent = '匯入選取論著'; }, 2000);
});

// 開始批次處理佇列中第一篇
btnStartQueue.addEventListener('click', async () => {
  await processNextFromQueue();
});

// 從佇列取出第一篇開始處理
async function processNextFromQueue() {
  const { orcidQueue = [] } = await chrome.storage.local.get('orcidQueue');
  if (orcidQueue.length === 0) return;

  const [work, ...rest] = orcidQueue;
  await chrome.storage.local.set({ orcidQueue: rest });
  tabDoi.click(); // 切回 DOI tab，離開佇列頁
  await renderPendingQueue();
  btnStartQueue.disabled = true; // 防止在確認/處理中途觸發下一篇

  // 書目檔案匯入（有 DOI）→ 先補查 CrossRef，再合併
  if (work.needsDoi && work.identifierValue) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    pendingTabId = tabs[0].id;
    showLoading('補充 CrossRef 書目資料…');
    chrome.runtime.sendMessage({ action: 'fetchMetadata', doi: work.identifierValue }, (response) => {
      if (chrome.runtime.lastError || !response?.success) {
        // CrossRef 查無結果 → 退回使用檔案資料
        pendingFormattedText = work.formattedText;
        setStep(1, 'done');
        showConfirm(work);
        return;
      }
      const mergedText = mergeFormattedTexts(response.data.formattedText, work.formattedText);
      pendingFormattedText = mergedText;
      setStep(1, 'done');
      showConfirm({
        ...response.data,
        formattedText: mergedText,
        hasAbstract: work.hasAbstract || response.data.hasAbstract,
      });
    });
    return;
  }

  // Stage 1 已預先完成（透過「加入佇列」按鈕）→ 直接進確認 UI
  if (work.formattedText) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    pendingTabId = tabs[0].id;

    // 檔案有 URL 但無 DOI → 先抓頁面 meta tag 試取 DOI / 摘要補強
    const urlInText = !work.identifierValue && work.formattedText.match(/^URL: (.+)$/m)?.[1];
    if (urlInText) {
      setStep(1, 'active');
      showLoading('從連結取得補充書目資料…');
      chrome.runtime.sendMessage({ action: 'fetchMetaFromUrl', url: urlInText.trim() }, (res) => {
        if (res?.doi) {
          // 抓到 DOI → 走 CrossRef 完整補強，並合併原始檔案資料
          chrome.runtime.sendMessage({ action: 'fetchMetadata', doi: res.doi }, (crossRef) => {
            if (crossRef?.success) {
              const mergedText = mergeFormattedTexts(crossRef.data.formattedText, work.formattedText);
              pendingFormattedText = mergedText;
              setStep(1, 'done');
              showConfirm({ ...crossRef.data, formattedText: mergedText });
            } else {
              // CrossRef 失敗但有 DOI → 加進文字讓 AI 能用
              let text = work.formattedText;
              if (!/^DOI: /m.test(text)) text = `DOI: ${res.doi}\n` + text;
              const _ab1 = res.abstract;
              if (_ab1 && !/NCCU\s+Academic\s+Hub|academic\s+output\s+collection|政大學術集成/i.test(_ab1) && !/^Abstract: /m.test(text)) text += `\nAbstract: ${_ab1}`;
              pendingFormattedText = text;
              setStep(1, 'done');
              showConfirm({ ...work, formattedText: text });
            }
          });
        } else {
          // 抓不到 DOI，但可能有摘要
          let text = work.formattedText;
          const _ab2 = res?.abstract;
          if (_ab2 && !/NCCU\s+Academic\s+Hub|academic\s+output\s+collection|政大學術集成/i.test(_ab2) && !/^Abstract: /m.test(text)) text += `\nAbstract: ${_ab2}`;
          pendingFormattedText = text;
          setStep(1, 'done');
          showConfirm({ ...work, formattedText: text });
        }
      });
      return;
    }

    pendingFormattedText = work.formattedText;
    setStep(1, 'done');
    showConfirm(work);
    return;
  }

  // ORCID 無 DOI → 依序嘗試 PMID → arXiv → ORCID 完整書目
  if (work.putCode && !work.doi) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    pendingTabId = tabs[0].id;

    // 有 PMID → 走 PubMed
    if (work.pmid) {
      setStep(1, 'active');
      showLoading('從 PubMed 取得書目資料…');
      chrome.runtime.sendMessage({ action: 'fetchPubMed', pmid: work.pmid }, (response) => {
        if (chrome.runtime.lastError || !response?.success) {
          // PubMed 失敗 → fallback 到 ORCID 書目
          fetchOrcidFallback(work);
          return;
        }
        pendingFormattedText = response.data.formattedText;
        setStep(1, 'done');
        showConfirm(response.data);
      });
      return;
    }

    // 有 arXiv ID → 走 arXiv
    if (work.arxivId) {
      setStep(1, 'active');
      showLoading('從 arXiv 取得書目資料…');
      chrome.runtime.sendMessage({ action: 'fetchArxiv', arxivId: work.arxivId }, (response) => {
        if (chrome.runtime.lastError || !response?.success) {
          fetchOrcidFallback(work);
          return;
        }
        pendingFormattedText = response.data.formattedText;
        setStep(1, 'done');
        showConfirm(response.data);
      });
      return;
    }

    // 其他 → ORCID 完整書目（BibTeX 或基本欄位）
    fetchOrcidFallback(work);
    return;
  }

  // 舊格式 ORCID（有 DOI）或 identifierType 格式 → 填入輸入框讓使用者觸發
  const displayValue = work.doi
    || (work.identifierType === 'pmid' ? `PMID:${work.identifierValue}` : work.identifierValue)
    || '';
  tabDoi.click();
  doiInput.value = displayValue;
  show(sectionInput);
}

function fetchOrcidFallback(work) {
  chrome.storage.local.get('orcidId', ({ orcidId }) => {
    if (!orcidId) { showError('未設定 ORCID，無法取得書目'); return; }
    showLoading('從 ORCID 取得書目資料…');
    chrome.runtime.sendMessage(
      { action: 'fetchOrcidWorkDetail', orcidId, putCode: work.putCode },
      (response) => {
        if (chrome.runtime.lastError) { showError('背景服務錯誤：' + chrome.runtime.lastError.message); return; }
        if (!response?.success) { showError(response?.error || 'ORCID 書目查詢失敗'); return; }
        pendingFormattedText = response.data.formattedText;
        setStep(1, 'done');
        showConfirm(response.data);
      }
    );
  });
}

// 更新「繼續處理下一篇」按鈕狀態
async function updateQueueButton() {
  const { orcidQueue = [] } = await chrome.storage.local.get('orcidQueue');
  if (orcidQueue.length > 0) {
    btnNextQueue.textContent = `繼續處理下一篇（還剩 ${orcidQueue.length} 篇）`;
    show(btnNextQueue);
  } else {
    hide(btnNextQueue);
  }
}

btnNextQueue.addEventListener('click', async () => {
  hide(sectionPreview);
  await processNextFromQueue();
});

function showConfirm(meta) {
  hide(sectionLoading);
  hide(sectionInput);
  show(sectionConfirm);

  const badges = [
    meta.hasAbstract ? '<span class="confirm-badge badge-ok">有摘要</span>' : '<span class="confirm-badge badge-warn">無摘要</span>',
    meta.authorCount ? `<span class="confirm-badge badge-ok">${meta.authorCount} 位作者</span>` : '',
  ].join('');

  confirmBox.innerHTML = `
    <div class="confirm-title">${meta.title || '（無標題）'}</div>
    <div class="confirm-meta">${[meta.journal, meta.year].filter(Boolean).join('・')}</div>
    <div>${badges}</div>`;

  // 儲存待確認狀態，popup 關掉再開也能還原
  chrome.storage.local.set({
    pendingConfirm: {
      formattedText: pendingFormattedText,
      meta: {
        title:       meta.title       || '',
        journal:     meta.journal     || '',
        year:        meta.year        || '',
        authorCount: meta.authorCount || 0,
        hasAbstract: !!meta.hasAbstract
      }
    }
  });
}

function showPreview(data) {
  hide(sectionLoading);
  hide(sectionError);
  show(sectionPreview);

  const rows = [
    { key: '標題',   val: data.title1,                              cls: '' },
    { key: '日期',   val: data.publ_dt,                             cls: 'code' },
    { key: '類別',   val: formatPubl(data.publ_tpe),                cls: 'code' },
    { key: '語言',   val: formatLang(data.lang_cod),                cls: 'code' },
    { key: '期刊',   val: data.jnl_nam,                             cls: '' },
    { key: '卷期頁', val: formatVol(data),                          cls: '' },
    { key: 'DOI',    val: data.doi,                                 cls: 'code' },
    { key: '升等',   val: data.promote === '0' ? '非升等論著' : '⚠ 請確認',
                     cls: data.promote === '0' ? '' : 'warn' },
  ];

  previewBox.innerHTML = rows
    .filter(r => r.val)
    .map(r => `
      <div class="preview-row">
        <span class="preview-key">${r.key}</span>
        <span class="preview-val ${r.cls}">${r.val}</span>
      </div>`)
    .join('');
}

function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

// 接收 content script 通知 / background 事件
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'secondLayerFilled') {
    setStep(4, 'done');
    updateQueueButton();
  }

  // 分頁切換：僅在使用者未進行中流程時更新頁面偵測狀態列
  if (message.type === 'TAB_CHANGED') {
    const cls = id => document.getElementById(id)?.className || '';
    const midFlow = cls('step1').includes('done')
                 || cls('step2').includes('active')
                 || cls('step3').includes('active');
    if (!midFlow) checkCurrentPage();
  }
});

// CrossRef 為主，檔案資料補缺漏欄位
function mergeFormattedTexts(base, supplement) {
  const parse = text => {
    const map = new Map();
    for (const line of text.split('\n')) {
      const i = line.indexOf(': ');
      if (i > 0) map.set(line.slice(0, i), line.slice(i + 2));
    }
    return map;
  };
  const merged = parse(base);
  for (const [k, v] of parse(supplement)) {
    if (!merged.has(k) && v) merged.set(k, v);
  }
  return [...merged.entries()].map(([k, v]) => `${k}: ${v}`).join('\n');
}

function formatPubl(code) {
  const map = {
    '01':'專書', '02':'專書篇章', '03':'期刊論文',
    '04':'會議論文', '05':'研究報告', '10':'其他'
  };
  return code ? `${map[code] || code} (${code})` : '';
}

function formatLang(code) {
  const map = { '50':'中文', '01':'英文', '02':'法文', '03':'德文', '04':'日文' };
  return code ? `${map[code] || code} (${code})` : '';
}

function formatVol(data) {
  const parts = [
    data.vol ? `Vol.${data.vol}` : '',
    data.no  ? `No.${data.no}`  : '',
    data.pp  ? `pp.${data.pp}`  : '',
  ].filter(Boolean);
  return parts.join('  ');
}