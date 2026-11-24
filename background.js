// background.js
// 負責：接收 popup 的指令、查詢 CrossRef API、呼叫 AI API、把結果傳回去
import { CONFIG } from './app-config.js'; // AI 端點、模型、參數一律從此處取得

// API key 由使用者在側邊面板輸入，存 chrome.storage.local；
// 舊版把金鑰寫在 config.js（已列入 .gitignore），若存在則一次性搬進 storage 後即可刪除該檔。
async function getAiApiKey() {
  const storeKey = CONFIG.ai.apiKeyStorageKey;
  const stored = (await chrome.storage.local.get(storeKey))[storeKey];
  if (stored) return stored;

  try {
    await import('./config.js');          // 舊版設定檔（可能不存在）
    const legacy = self._AK;
    if (legacy && legacy !== 'YOUR_API_KEY_HERE') {
      await chrome.storage.local.set({ [storeKey]: legacy });
      return legacy;
    }
  } catch { /* 沒有 config.js，屬正常情況 */ }

  return '';
}

const SYSTEM_PROMPT = `你是一個學術論著資料清洗助手，專門處理政治大學論著目錄系統的資料填寫。
請根據輸入的書目資訊，輸出一個符合以下規格的 JSON 物件。
只輸出 JSON，不要任何說明文字、不要 markdown 的 \`\`\` 符號。

各類別共用欄位（所有 publ_tpe 都必須填）：
- title1: 論文完整標題（字串）
- publ_dt: 出版年月 yyyymm 格式，例如 202608。若只有年份補01，例如2026→202601
- publ_tpe: 論著類別，只能填以下其中一個值：01=專書, 02=專書篇章, 03=期刊論文, 04=會議論文, 05=研究報告, 06=展演, 08=學術資料庫, 09=個案, 10=其他, 12=學術交流
  判斷優先順序（依序檢查，第一個符合者優先）：
  ⓪ Type 欄含 thesis/dissertation/學位論文/博士論文/碩士論文/PhD Thesis/Master's Thesis → 10（其他；學位論文不在正式類別中）
  ① Type 欄含 conference/conferenceObject/conference paper/會議 → 04
  ② Journal/Source 含 proceedings/conference/symposium/workshop/congress/年會/研討會/國際會議 → 04
  ③ Type 欄含 journal article/journalArticle/article → 03（不論是否有卷期頁碼，online-first 也填 03）
  ④ Type 欄含 book chapter/bookPart/專書篇章 → 02
  ⑤ Type 欄含 book/專書，且無會議關鍵字 → 01
  ⑥ Type 欄含 multimedia/展演/performance/演出/音樂會/藝術創作 → 06
  ⑦ 無明確 Type，但 Journal/Source 有 ISSN 或看起來像期刊 → 03
  ⑧ 無法判斷 → 10（其他）
- field_cod: 論著領域，選最符合的一個值。**判斷原則：以論文的主要學科為準，依標題與摘要判斷。** 輸入若有 research-field（OpenAlex 自動學科分類，格式「子學科 (大學科)」）可作參考，但它可能不準，不可直接照套。判斷重點：
  • EA=資訊工程：論文的主要貢獻是電腦科學技術本身（機器學習、NLP、電腦視覺、演算法、系統、資安等）時才填，即使應用在社會議題上也填 EA、不填 0H。只是「使用」統計、模擬或軟體工具來分析某領域問題的論文，依該領域填，不填 EA
  • HE=政治學：以政治學理論/政治現象為主體，不可因論文「使用政治資料」就填；若論文只是用政治資料來驗證技術方法，不填 HE
  • H0=台灣文學：內容主體是台灣本土文學作品/作家，不能因作者是台灣人就填
  • H1=中國文學：內容主體是中國文學（古典或現代）
  • H2=外國文學：英美文學/日本文學/法國文學等非華文圈的文學，Chaucer/Shakespeare/Joyce等西洋文學都填H2
  • H3=語言學：語言分析、音韻、語法、語料庫、翻譯研究
  • H5=哲學：哲學/倫理/邏輯
  • H6=企業管理, H7=資訊管理：管理相關
  • HF=經濟學：以經濟學理論/計量經濟為主體
  • 0H=人文及社會科學類：**只在確認是純人文社科研究時填，絕對不可作為「不確定」時的預設值**；凡論文涉及技術方法（深度學習、演算法、統計模型、電腦系統）者，不填 0H
  完整選項：0B=生物科學類, 0E=工程技術類, 0H=人文及社會科學類, 0M=自然科學類, 0S=科學教育類, B1=植物分子生物學, B2=植物分類及生理, B3=動物學, B4=生物生化、分子生物及微生物, B5=基礎醫學, B6=臨床醫學, B7=藥學, B8=中醫學, B9=醫學工程, BA=農藝及園藝, BB=農化及土壤, BC=農機及農工, BD=植病及昆蟲, BE=森林及水保, BF=漁業及海洋, BG=畜牧及獸醫, BH=食品及營養, BI=生物技術, BJ=環保醫學, BK=環境資源及保育, BL=台灣長期生態學研究, BZ=其他生物科學類, E1=機械固力, E2=機械熱流, E3=化學工程, E4=造船工程, E6=微電工程, E7=醫學工程, E8=金屬及陶瓷材料工程, E9=食品科技, EA=資訊工程, EC=能源科技, ED=環境工程, EE=光電工程, EF=高分子, EG=工業工程與管理, EH=生產自動化技術, EI=航空工程, EJ=太空工程, EK=海洋工程, EL=電力工程, EM=控制工程, EN=土木工程（結構、材料、營建）, EO=土木工程（水利、大地）, EP=土木工程（交通、測量、建築）, EQ=微波工程, ER=通訊工程, ES=訊號處理, EZ=其他工程學類, H0=台灣文學, H1=中國文學, H2=外國文學, H3=語言學, H4=歷史學, H5=哲學, H6=企業管理, H7=資訊管理, H8=教育學, H9=藝術類, HA=體育學, HB=圖書資訊學, HC=心理學, HD=法律學, HE=政治學, HF=經濟學, HG=都市計劃, HH=地政, HI=人文地理, HJ=社會學、社會福利與工作, HK=傳播學, HL=人類學, HZ=其他人文社會科學類, M1=統計, M2=數學, M3=物理, M4=化學, M5=地球科學, M6=大氣科學, M7=海洋科學, MZ=其他自然科學類, S1=數學教育, S2=科學課程及教材, S3=科學學習, S4=電腦輔助教學, S5=科學教學與教師, S6=科學評量, S7=科學教育, S8=環境教育, S9=資訊教育, SA=技術科學教育（專業）, SB=技術科學教育（素養）, SC=通識教育, SD=工程教育, SE=醫學教育, SZ=其他科學教育類, XX=未歸類
- lang_cod: 以 Title 或 Abstract 的實際書寫語言決定代碼（英文→01，中文→50，日文→04）；「Language: xxx」欄位只作參考，若與標題語言矛盾則以標題語言為準。無法判斷時填空字串 ""。可選的值：50=國語(中文), 01=英語(文), 02=法語(文), 03=德語(文), 04=日語(文), 05=俄語(文), 06=西班牙(文), 07=義大利(文), 08=阿拉伯(文), 09=土耳其(文), 10=波斯語(文), 11=荷蘭語(文), 12=韓語(文), 13=泰語(文), 14=越南語(文), 15=馬來語(文), 16=拉丁語(文), 17=緬甸語(文), 18=印尼語(文), 19=印度語(文), 20=寮國語(文), 21=高棉語(文), 22=菲律賓(文), 23=阿富汗(文), 24=瑞典語(文), 25=葡萄牙(文), 26=希臘語(文), 51=回語(文), 52=藏語(文), 53=蒙語(文), 54=捷克語(文)
- publ_txt: 論著摘要，若無則留空字串
- promote: 升等論著。**永遠填 "0"**（非升等論著）——此欄無法從論著資料判斷，由秘書手動調整
- chk_odr: 本人是否為通訊作者，若來源未說明預設 "N"
- auth_cnt: 總作者人數（數字）
- authors: 填**所有**作者（陣列），每位作者一個物件，格式：{"sta_chi":"姓名","sta_ut_nam":"所屬系所","ca_sts":"0"}
  - sta_chi: **只能填資料來源中已明確出現的中文姓名**。若輸入只有英文/拼音姓名（如 "Wen-Hung Liao"），直接填英文姓名（格式：Given Family，如 "Wen-Hung Liao"）。**嚴格禁止從拼音、羅馬字或英文名推測、翻譯或生成中文字**
  - sta_ut_nam 規則：**最高原則——以文稿上實際印出的單位為準。只能照抄輸入中的 affiliation 原文，不得翻譯、不得縮寫、不得改寫成系所簡稱、不得推測。**
    **每位作者的 sta_ut_nam 必須獨立判斷，絕對禁止從其他作者的機構推測、複製或套用。**
    判斷順序：
    ①使用該作者自己的 affiliation 欄位文字（這就是文稿 affiliation 區塊的原文）。**若文稿上該作者標了多個單位，affiliation 會以「; 」（分號＋空白）串接，代表多個單位：必須全部保留、維持原順序、仍以「; 」串接輸出，不可只挑一個、不可重新排序、不可合併或刪減。**下方 ②～④ 對每個單位分別套用。
    ②把 ① 的文字去掉郵遞區號、城市、國家後，**原文照抄**其餘完整單位文字。例如 "Research Center for Information Technology Innovation, Academia Sinica, Taipei 11529, Taiwan; Department of Computer Science, National Chengchi University, Taipei 11605, Taiwan" → "Research Center for Information Technology Innovation, Academia Sinica; Department of Computer Science, National Chengchi University"。例如 "Department of Computer Science, National Chengchi University, Taipei 11605, Taiwan" → "Department of Computer Science, National Chengchi University"；"資訊科學系, 國立政治大學, 台北" → "資訊科學系, 國立政治大學"。**不可翻成中文、不可縮寫成「資科系」之類的簡稱。**
    ③非學術機構（政府、軍方、企業、研究院）同樣去掉城市、國家後保留單位全名，如 "Material Production Center Armaments Bureau, MND, The 401st Factory, Taichung, Taiwan" → "Material Production Center Armaments Bureau, MND, The 401st Factory"。
    ④**只有大學／學院／學校名稱的單位（不含系所）也照文稿保留，不可捨棄、不可留空**——例如 "National Chengchi University, Taipei, Taiwan" → "National Chengchi University"、"Department of Economics, University A; University B" → "Department of Economics, University A; University B"、"政治大學" → "政治大學"。
    ⑤若該作者沒有 affiliation（欄位不存在或為空），才看該作者自己的 orcid-dept：有則填 orcid-dept 原值（**不要**拼上 orcid-org、不要翻譯）。orcid-dept 來自 ORCID 的「目前任職單位」，可能與發表當時文稿上的單位不同，因此優先序最低。
    ⑥以上皆無者，一律填空字串 ""。**寧可留空，也不要填推測值。**
  - ca_sts: 該作者是否為通訊作者："1"=是, "0"=否。**若輸入的 author[i].corresponding 為 true，填 "1"**；否則填 "0"
  **【Department 欄位】若輸入有 "Department: XXX" 欄位（來自機構典藏的系所資訊），且該作者無自己的 affiliation 或 orcid-dept，則將 Department 值原文套用為該作者的 sta_ut_nam（適用於所有無個人系所資訊的作者）**
  **【純文字輸入嚴格警告】若輸入格式為純文字（含 "Authors: A; B" 或 "作者：A；B" 的文字行，而非含有 "author":[...] 的 JSON），Authors 行中的逗號是西方姓名「姓, 名」分隔符（如 "Wang, Wen-Hung" = 姓 Wang、名 Wen-Hung），絕對不是「姓名, 系所」格式。此情況下若有 Department: 欄位則依上方規則套用，若無則所有作者的 sta_ut_nam 均必須填空字串 ""，禁止把姓名的任何部分（包含姓氏、名字、拼音）填入 sta_ut_nam**
  **【作者計數規則】Authors 行中以分號（;）分隔的每個名字，無論外觀是否相似或疑似同一人的不同語言名字（如中文名＋原住民族名、中文名＋英文名），一律各自建立一個獨立的作者物件。有幾個分號分隔的名字，authors 陣列就有幾個物件，auth_cnt 也對應填入該數字。**
- trsnat: 跨國合作。判斷順序：①若輸入有 _author_countries 欄位，依其國碼陣列判斷：全為 "TW" → "0"；含 "CN"/"HK"/"MO" 且無其他非 TW 國碼 → "2"；含任一非 TW 且非 CN/HK/MO 的國碼 → "1"；含 CN/HK/MO 又含其他非 TW 國碼 → "1"。②若無 _author_countries，從各作者 affiliation 文字推斷所屬國家後套用同樣規則。③完全無資訊時填 "0"
- kw1~kw5: 關鍵字，最多5個，不足補空字串
- chk_tag: 審查制度（是否有同儕審查）。**無法從書目資料確定，一律留空字串 ""**，由秘書手動勾選
- sch_publ_tpe: 學校名義論著，預設 "Y"
- sch_publ_rem: 學校名義論著備註，通常留空字串
- lib_flg: 授權機構典藏，預設 "1"
- upld_tpe: 全文上傳，固定填 "0"（系統不處理檔案上傳）
- doi: 數位物件識別碼，只填 DOI 號碼本身（不含 https://doi.org/），若無則留空字串
- _oa_url: 若輸入中有 open-access-url，直接複製其值；否則填空字串

期刊論文專用欄位（publ_tpe 為 03 時才填，其他類別省略不輸出）：
**警告：publ_tpe 不是 "03" 時，以下欄位全部省略不輸出，程式端會自動補入預設值，絕對不可填入會議名稱或任何非空值：acc_flg, jnl_nam, vol, no, nat_tpe, nat_cod, pertpe_cod, publ_type, url_addr**
- acc_flg: **完全由輸入 JSON 的 key 決定，禁止語意推斷**：查輸入 JSON 是否同時存在 "volume"、"issue"、"page" 三個 key 且值均非空字串——若三者全部存在且非空 → 填 "0"；否則（任一 key 不存在，或值為空字串/null）→ 一律填 "1"。published-online、published-print、issued 等日期欄位對此判斷完全無影響。
- jnl_nam: 期刊名稱（只填學術期刊名，不可填會議名稱）
- vol: 卷別
- no: 期別
- pp: 起迄頁次。**格式規則：**①有起頁與迄頁 → 用半形連字號連接，如 "61-73"（來源若是 "61–73"、"61—73"、"61 - 73"、"pp. 61-73" 都要正規化成 "61-73"）；②只有單頁 → 只填該數字，如 "61"；③來源只有文章編號／電子編號（如 MDPI 的 page="6173"、PLOS 的 "e0123456"）→ 原樣只填一個值，**絕對不可自行拆成或湊成區間**；④完全沒有頁碼資訊 → 填空字串 ""。禁止自行推算迄頁
- citelist: 收錄資料庫陣列，從以下選符合的：0=none（未收錄任何資料庫）, a=AHCI, b=SSCI, c=SCIE, d=EI, e=TSSCI, f=MLA, g=CSA, h=LLBA, i=ACM, j=DBLP, k=IEEE, l=CITESEEN, m=SCI, n=THCI, p=CSSCI, q=THCI Core, r=SCOPUS, x=other。**citelist 只能等於輸入中 _known_dbs 的值（原封不動、不可遺漏）；沒有 _known_dbs 時一律填 []。嚴格禁止依自己對期刊的認識加入任何代碼（包括 SCI、SCIE、SSCI、AHCI、SCOPUS、EI、"0"）**——收錄資料庫答錯會影響評鑑，程式查不到的一律由使用者人工勾選。
- citetpe_rem: 一律填空字串 ""（收錄資料庫的人工確認提示由程式產生）
- nat_cod: 期刊出版國 ISO 3碼。**只有一條規則：若輸入有 _journal_country 欄位，填入該值；若沒有該欄位，一律填空字串 ""。**
  **嚴格禁止推測**：不可從 publisher 名稱、publisher-location、期刊名稱、作者機構、作者國籍、語言或任何其他線索推斷出版國。出版國查不到時由使用者在表單上手動選擇，**絕對不可預設為 TWN**（填 TWN 會讓論著被誤判為國內期刊）。程式端已先用「OpenAlex ISSN 登記國 → 期刊主辦學會所在國 → 台灣期刊 ISSN 清單 → CrossRef publisher-location → 出版商對照表」多層確定性判斷，判得出來才會給 _journal_country。
- nat_tpe: "1"=國內期刊（nat_cod 為 "TWN" 時），"2"=國外期刊（nat_cod 為其他非空值時）。**nat_cod 為空字串時，nat_tpe 也必須填空字串 ""**，不可猜測
- pertpe_cod: 論文性質："1"=ARTICLE, "2"=REVIEW, "3"=LETTER, "4"=NOTE
- publ_type: 出版形式："0"=紙本期刊, "1"=電子期刊, "2"=紙本及電子。判斷方式：若輸入 JSON 有 "issn-type" 欄位，檢查其陣列中是否同時含 type="print" 與 type="electronic" → 填 "2"；只含 type="electronic" → 填 "1"；只含 type="print" → 填 "0"；若無 "issn-type" 欄位或陣列為空 → 預設填 "2"
- url_addr: 文章或期刊的網址。優先順序：①若輸入有 URL 欄位，直接複製該 URL（完整連結，包含路徑，DOI 連結、資料庫永久連結、開放取用頁面均可）；②否則若輸入有 _journal_url，直接複製其值；③以上皆無則填空字串 ""

書籍專用欄位（publ_tpe 為 01 或 02 時才填，其他類別省略不輸出）：
- publ_type: 出版形式："0"=紙本, "1"=電子書, "2"=其他
- bktpe_cod: 作者類別："1"=自著者, "2"=翻譯者, "3"=編著者
- bkcat_tpe: 專書性質："0"=學術性, "1"=教科書, "2"=其他
- bkcat_rem: 書籍分類補充說明，通常留空字串
- isbn_num: ISBN號碼，若有則填入(輸入格式：XXX-XXX-XXXXXXX，共13碼)，若無則留空字串
- set_title: 專書篇章（02）時填含章論文的母書書名（即輸入的 Book: 欄位）；一般專書（01）若有叢書名才填，無則空字串
- publ_nam: 出版社名稱（來自 Publisher: 欄位）
- publ_pls: 出版地點（城市或國家）
- publ_rem: 出版形式選其他的補充說明，通常留空字串
- page_num: 起迄頁次（僅 publ_tpe=02 專書篇章才填，來自 Pages: 欄位；其他留空字串）。格式規則與期刊論文的 pp 完全相同：起迄用半形連字號 "45-67"，單頁只填一個數字，不可自行湊出區間

會議論文專用欄位（publ_tpe 為 04 時才填，其他類別省略不輸出）：
**publ_tpe 是 "04" 時，以下欄位必須全部出現在輸出 JSON 中（即使是空字串）；其他類別省略不輸出，程式端會自動補入預設值。**
重要：輸入 JSON 中凡有 _conf_* 開頭的欄位，均為已預先格式化好的值，**必須直接採用**，不得忽略或改寫。
- conf_nam: 會議名稱。**優先用 _conf_nam；若無，從 container-title 欄位取值**（container-title 就是論文集/會議全名）
- conf_dt: 會議日期（格式：2012/07/01-2012/07/02）。**若有 _conf_dt，直接使用其值**
- conf_pls: 會議地點（城市名稱）。**若有 _conf_city，直接使用其值**（與 cty_nam 填相同城市名稱）
- nat_cod: 會議舉辦國 ISO 3碼。**若有 _conf_country，將其英文國名轉為 ISO 3碼**。對照表：Thailand→THA, Japan→JPN, Korea→KOR, China→CHN, Taiwan→TWN, USA→USA, United States→USA, United Kingdom→GBR, Germany→DEU, France→FRA, Australia→AUS, Canada→CAN, Singapore→SGP, India→IND, Italy→ITA, Spain→ESP, Netherlands→NLD, Switzerland→CHE, Sweden→SWE, Vietnam→VNM, Indonesia→IDN, Malaysia→MYS, Philippines→PHL, Hong Kong→HKG
- cty_nam: 舉辦城市名稱。**若有 _conf_city，直接使用其值**
- conf_host: 主辦單位名稱。**若有 _conf_host，直接使用其值**
- intl_conf: 是否為國際學術研討會："0"=否，"1"=是。判斷依據：會議名稱含 International/IEEE/ACM/Global/World 等關鍵字，且舉辦地點非台灣，或作者來自多個不同國家機構 → 填 "1"；否則填 "0"
- proceeding: 是否有出版論文集："y"=是, "n"=否。**若輸入中有 container-title 或 ISBN，填 "y"；否則填 "n"**
- thesis_chi: 論文集（Proceedings）名稱，英文也填此欄。**直接使用 container-title 欄位的值**（與 conf_nam 填相同內容）；若無則留空字串
- pp: 起迄頁次，格式規則與期刊論文的 pp 完全相同（起迄用半形連字號 "45-67"；單頁或文章編號只填一個值，不可湊成區間），若無則留空字串
- citelist: 收錄資料庫陣列，規則與期刊論文完全相同：只能等於 _known_dbs 的值，沒有則填 []，嚴格禁止自行判斷加入
- citetpe_rem: 一律填空字串 ""
- isbn_num: 論文集 ISBN 號碼。**若輸入中有 ISBN 欄位，直接使用其值**；若無則留空字串

研究報告專用欄位（publ_tpe 為 05 時才填，其他類別省略不輸出）：
- prj_nam: 計畫名稱
- repo_num: 研究計畫編號，若無則留空字串
- period: 研究計畫起迄時間，請輸入完整時間格式，例如 2010/07/01-2011/08/01，若無則留空字串
- funds_by: 補助或委託機構名稱，若無則留空字串
- lead_tpe: 是否為計畫主持人："Y"=是, "N"=否
- budget: 研究經費金額（數字，新台幣元），若不明則填 "0"

展演專用欄位（publ_tpe 為 06 時才填，其他類別省略不輸出）：
**若輸入有 Event: 欄位，格式通常為「活動名稱, 日期」（如「東吳大學劉光義教授紀念專題講座, 2026.05.15」）：逗號前為 conf_nam，逗號後的日期轉換為 conf_dt（2026.05.15 → 2026/05/15-2026/05/15；若有區間則對應起迄）**
- conf_nam: 展演名稱
- conf_dt: 展演起迄時間，格式為 "YYYY/MM/DD-YYYY/MM/DD"，如 "2024/03/01-2024/03/31"，若無則留空字串
- nat_cod: 舉辦國家 ISO 3碼，例如 TWN=台灣, USA=美國
- cty_nam: 舉辦城市名稱，若無則留空字串
- conf_pls: 展演場館名稱，若無則留空字串
- conf_host: 主辦單位名稱，若無則留空字串
- adm_nam: 負責人姓名，若無則留空字串
- mbr_cnt: 大約參與人數（數字），若不明則填 "0"

學術資料庫專用欄位（publ_tpe 為 08 時才填，其他類別省略不輸出）：
- cont_info: 目前資料量說明（如筆數、規模），若無則留空字串
- ann_flg: 是否開放："1"=是（開放），"0"=否（不開放）
- db_url: 資料庫網址，若無則留空字串

個案專用欄位（publ_tpe 為 09 時才填，其他類別省略不輸出）：
- publ_ut: 發行單位名稱，若無則留空字串
- case_num: 產品編號，若無則留空字串

其他專用欄位（publ_tpe 為 10 時才填，其他類別省略不輸出）：
- ramtyp_cod: 著作型態，從以下選最符合的值：01=書評, 02=短論, 03=訪談, 04=注釋, 05=創作, 06=Working Paper, 99=其他
- publ_ut: 發行單位名稱，若無則留空字串
- ram_memo: 備注說明，若無則留空字串

學術交流專用欄位（publ_tpe 為 12 時才填，其他類別省略不輸出）：
**若輸入有 Event: 欄位，格式通常為「活動名稱, 日期」：逗號前為 conf_nam，逗號後的日期轉換為 conf_dt（2026.05.15 → 2026/05/15-2026/05/15）**
- conf_tpe: 學術交流種類："1"=演講（境內外學校或機構舉辦，短期3個月內學術專題演講，不含校內自辦）, "2"=研習活動（境內外學校或機構舉辦，短期3個月內學術研習，不含校內自辦）, "3"=講學（非屬演講或研習之境內外教育交流活動，不含校內自辦）
- conf_nam: 活動名稱
- conf_dt: 活動起迄時間，格式為 "YYYY/MM/DD-YYYY/MM/DD"，如 "2024/03/01-2024/03/02"，若無則留空字串
- nat_cod: 舉辦國家 ISO 3碼，例如 TWN=台灣, USA=美國，若無則留空字串
- cty_nam: 舉辦城市名稱，若無則留空字串
- conf_pls: 活動地點（場館或地址），若無則留空字串
- conf_host: 主辦單位名稱，若無則留空字串`;


// ── ORCID 被動追蹤 ───────────────────────────────────────

// 升級時清除舊版留在使用者端的員工編號相關資料（個資移除）
async function purgeLegacyEmployeeData() {
  try { await chrome.storage.local.remove(['savedEmpId']); } catch {}
  try { await chrome.storage.sync.remove(['customEmpOrcidMap']); } catch {}
}

chrome.runtime.onInstalled.addListener(() => {
  purgeLegacyEmployeeData();
  chrome.alarms.create('orcidCheck', { periodInMinutes: 1440 });
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onStartup.addListener(async () => {
  purgeLegacyEmployeeData();
  const alarm = await chrome.alarms.get('orcidCheck');
  if (!alarm) chrome.alarms.create('orcidCheck', { periodInMinutes: 1440 });
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'orcidCheck') checkOrcidWorks();
});

// ── 分頁切換：通知 side panel 更新頁面偵測狀態 ──────────────
chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.runtime.sendMessage({ type: 'TAB_CHANGED', tabId }).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active) {
    chrome.runtime.sendMessage({ type: 'TAB_CHANGED', tabId }).catch(() => {});
  }
});

chrome.notifications.onClicked.addListener(() => {
  chrome.action.openPopup?.().catch(() => {});
});

async function checkOrcidWorks() {
  const { orcidId, scholarId, orcidKnown = [] } =
    await chrome.storage.local.get(['orcidId', 'scholarId', 'orcidKnown']);
  if (!orcidId) return;
  // scholarId 由使用者貼上的 AH 學者頁網址解析而來；沒有就只跳過 AH 比對，不做任何反查

  const works = await fetchOrcidWorks(orcidId);
  if (!works) return;

  const allCodes = works.map(w => w.putCode);
  const newWorks = works.filter(w => !orcidKnown.includes(w.putCode));
  const update = { orcidKnown: allCodes, orcidLastCheck: Date.now() };

  // 每次檢查都重新抓 AH 清單，更新所有待辦著作的 alreadyInAh 狀態
  const ahItems = scholarId ? await fetchAhExistingItems(scholarId).catch(() => []) : [];
  const { orcidNewWorks = [] } = await chrome.storage.local.get('orcidNewWorks');

  if (newWorks.length > 0) {
    const flaggedNewWorks = await annotateAhStatus(newWorks, ahItems);
    const reannotated = await annotateAhStatus(
      orcidNewWorks.filter(old => !flaggedNewWorks.find(n => n.putCode === old.putCode)),
      ahItems
    );
    update.orcidNewWorks = [...reannotated, ...flaggedNewWorks];
    await chrome.storage.local.set(update);

    chrome.notifications.create('orcidNew', {
      type:    'basic',
      iconUrl: 'icons/icon48.png',
      title:   'NCCU 論著助手',
      message: `偵測到 ${flaggedNewWorks.length} 篇新著作，點此開始填入論著系統`
    });
  } else {
    // 無新著作：只更新現有待辦著作的 AH 狀態
    update.orcidNewWorks = await annotateAhStatus(orcidNewWorks, ahItems);
    await chrome.storage.local.set(update);
  }
}

async function fetchOrcidWorks(orcidId) {
  try {
    const res = await fetch(`https://pub.orcid.org/v3.0/${orcidId}/works`, {
      headers: { 'Accept': 'application/json' }
    });
    if (!res.ok) return null;
    const data = await res.json();

    return (data.group || []).map(g => {
      const s = g['work-summary']?.[0];
      if (!s) return null;
      const extIds = s['external-ids']?.['external-id'] || [];
      const findId = type => extIds.find(id => id['external-id-type'] === type)?.['external-id-value'] || null;
      const uri = findId('uri') || findId('source-work-url') || null;
      return {
        putCode: s['put-code'],
        title:   s.title?.title?.value || '（無標題）',
        year:    s['publication-date']?.year?.value || '',
        doi:     findId('doi'),
        pmid:    findId('pmid'),
        arxivId: findId('arxiv'),
        uri,
      };
    }).filter(Boolean);
  } catch {
    return null;
  }
}


// ORCID 單篇完整書目：有 BibTeX 直接用，否則組結構化文字
async function fetchOrcidWorkText(orcidId, putCode) {
  const res = await fetch(`https://pub.orcid.org/v3.0/${orcidId}/work/${putCode}`, {
    headers: { 'Accept': 'application/json' }
  });
  if (!res.ok) throw new Error(`ORCID 著作查詢失敗：${res.status}`);
  const w = await res.json();

  const title   = w.title?.title?.value || '';
  const journal = w['journal-title']?.value || '';
  const year    = w['publication-date']?.year?.value || '';
  const month   = w['publication-date']?.month?.value || '';

  // 有 BibTeX：先嘗試從中取 DOI 走 CrossRef 補全，失敗才用 BibTeX 原文
  const cite = w.citation;
  if (cite?.['citation-type'] === 'BIBTEX' && cite?.['citation-value']?.trim()) {
    const bibtex = cite['citation-value'];
    const doiMatch = bibtex.match(/\bdoi\s*=\s*[{"]([^}"]+)[}"]/i);
    if (doiMatch) {
      const doi = doiMatch[1].trim().replace(/^https?:\/\/doi\.org\//i, '');
      try {
        const full = await fetchMetadataOnly(doi);
        return { ...full, title: full.title || title, journal: full.journal || journal, year: full.year || year };
      } catch { /* fallback to BibTeX */ }
    }
    return { title, journal, year, hasAbstract: false, formattedText: bibtex };
  }

  // 否則從 ORCID 欄位組文字
  const lines = [];
  if (title)   lines.push(`標題：${title}`);
  if (journal) lines.push(`期刊/來源：${journal}`);
  if (year)    lines.push(`出版年：${year}`);
  if (month)   lines.push(`出版月：${month}`);

  const orcidTypeMap = {
    JOURNAL_ARTICLE: 'journal-article', CONFERENCE_PAPER: 'proceedings-article',
    BOOK: 'book', BOOK_CHAPTER: 'book-chapter', REPORT: 'report'
  };
  const wType = orcidTypeMap[w.type] || w.type || '';
  if (wType) lines.push(`類型：${wType}`);

  const authors = (w.contributors?.contributor || [])
    .filter(c => c['contributor-attributes']?.['contributor-role'] === 'AUTHOR')
    .map(c => c['credit-name']?.value).filter(Boolean);
  if (authors.length) {
    lines.push(`作者：${authors.join('；')}`);
    lines.push(`作者人數：${authors.length}`);
  }

  const abstract = w['short-description'] || '';
  if (abstract) lines.push(`摘要：${abstract}`);

  // 試標題搜尋找 DOI
  if (title) {
    const firstAuthor = authors[0] || '';
    const doi = await searchDoiByTitle(title, firstAuthor, year);
    if (doi) {
      try {
        const full = await fetchMetadataOnly(doi);
        return { ...full, title: full.title || title, journal: full.journal || journal, year: full.year || year };
      } catch { /* fallback */ }
    }
  }

  // 最後備援：抓 ORCID 記錄的著作頁面 URL，擷取 meta tag
  const workUrl = w['url']?.value
    || (w['external-ids']?.['external-id'] || [])
        .find(id => ['uri','source-work-url'].includes(id['external-id-type']))
        ?.['external-id-value'];
  if (workUrl) {
    try {
      const htmlMeta = await fetchMetaFromHtml(workUrl);
      if (htmlMeta.doi) {
        const full = await fetchMetadataOnly(htmlMeta.doi);
        return { ...full, title: full.title || title, journal: full.journal || journal, year: full.year || year };
      }
      if (htmlMeta.abstract && !abstract) lines.push(`摘要：${htmlMeta.abstract}`);
      lines.push(`URL: ${workUrl}`);
    } catch { /* 忽略 */ }
  }

  return {
    title, journal, year,
    hasAbstract: !!abstract,
    formattedText: lines.join('\n')
  };
}

// 標題搜尋 DOI：CrossRef → OpenAlex → Semantic Scholar
async function searchDoiByTitle(title, author = '', year = '') {
  const normalize = s => s.toLowerCase().replace(/[^a-z0-9一-鿿]/g, '');
  const titleNorm = normalize(title);
  const similar = candidate =>
    candidate && normalize(candidate).includes(titleNorm.slice(0, 20));

  // 1. CrossRef
  try {
    let url = `https://api.crossref.org/works?query.title=${encodeURIComponent(title)}&rows=1&select=DOI,title`;
    if (author) url += `&query.author=${encodeURIComponent(author)}`;
    if (year)   url += `&filter=from-pub-date:${year},until-pub-date:${year}`;
    const res  = await fetch(url);
    if (res.ok) {
      const item = (await res.json()).message?.items?.[0];
      if (item?.DOI && similar([].concat(item.title)[0])) return item.DOI;
    }
  } catch { /* continue */ }

  // 2. OpenAlex
  try {
    let url = `https://api.openalex.org/works?search=${encodeURIComponent(title)}&per-page=1&select=doi,title&mailto=nccu-plugin`;
    if (year) url += `&filter=publication_year:${year}`;
    const res = await fetch(url);
    if (res.ok) {
      const item = (await res.json()).results?.[0];
      if (item?.doi && similar(item.title)) {
        return item.doi.replace('https://doi.org/', '');
      }
    }
  } catch { /* continue */ }

  // 3. Semantic Scholar
  try {
    const res = await fetch(
      `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(title)}&fields=externalIds,title&limit=1`
    );
    if (res.ok) {
      const item = (await res.json()).data?.[0];
      if (item?.externalIds?.DOI && similar(item.title)) return item.externalIds.DOI;
    }
  } catch { /* continue */ }

  return null;
}


// ── DSpace 書目查詢：REST API (v7) → REST API (v6) → OAI-PMH ─────────────────
async function fetchDSpaceHandle(handle, origin) {
  // 嘗試順序：DSpace 7 REST → DSpace 6 REST → OAI-PMH
  const result = await tryDSpace7(handle, origin)
              || await tryDSpace6(handle, origin)
              || await tryOaiPmh(handle, origin);
  if (!result) throw new Error('此典藏資料無法取得（限制存取或已下架）');
  return result;
}

async function tryDSpace7(handle, origin) {
  try {
    const r = await fetch(`${origin}/server/api/pid/find?id=hdl:${handle}`,
                          { headers: { Accept: 'application/json' } });
    if (!r.ok) return null;
    const item = await r.json();
    return parseDSpaceJson(item, handle, origin);
  } catch { return null; }
}

async function tryDSpace6(handle, origin) {
  try {
    const r = await fetch(`${origin}/rest/handle/${handle}`,
                          { headers: { Accept: 'application/json' } });
    if (!r.ok) return null;
    const item = await r.json();
    // DSpace 6 REST：metadata 在 item.metadata 陣列 [{key, value, language}]
    if (!Array.isArray(item.metadata)) return null;
    return parseDSpace6Array(item.metadata, handle, origin);
  } catch { return null; }
}

async function tryOaiPmh(handle, origin) {
  try {
    // OAI identifier 格式：oai:{hostname}:{handle}
    const hostname = new URL(origin).hostname;
    const oaiId   = `oai:${hostname}:${handle}`;
    const url     = `${origin}/oai/request?verb=GetRecord&identifier=${encodeURIComponent(oaiId)}&metadataPrefix=oai_dc`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const xml = await r.text();
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('error')) return null;
    return parseOaiDc(doc, handle, origin);
  } catch { return null; }
}

// ── 共用欄位格式化 ──────────────────────────────────────────────────────────
function buildFormattedText(f, handle, origin) {
  if (!f.title) return null;

  const isBookChapter = /book.?chapter|book\/chapter|bookpart|專書篇章/i.test(f.type || '');

  // dc.relation 格式 "Book Title, Publisher, pp.X-Y" 拆解為獨立欄位
  let bookTitle = '', bookPages = '', bookPub = f.publisher || '';
  if (isBookChapter && f.source) {
    const pageM = f.source.match(/,?\s*pp\.\s*(\d+)[–\-](\d+)/);
    if (pageM) {
      bookPages = `${pageM[1]}-${pageM[2]}`;
      const withoutPages = f.source.replace(/,?\s*pp\.\s*\d+[–\-]\d+/, '').trim();
      const parts = withoutPages.split(/,\s*/);
      bookTitle = parts.length >= 2 ? parts.slice(0, -1).join(', ') : withoutPages;
      if (!bookPub && parts.length >= 2) bookPub = parts[parts.length - 1].trim();
    } else {
      bookTitle = f.source;
    }
  }

  // 排除 dc.type 值混入 keywords 的情況
  const TYPE_PAT = /^(book.?chapter|book\/chapter|bookpart|article|journal.?article|conference.?paper|thesis|dissertation|report|publications?)$/i;
  const cleanKws = (f.keywords || []).filter(k => !TYPE_PAT.test(k.trim()));

  // 同一作者中英雙語並列去重：中文 N 筆 + 拼音 N 筆 → 只保留中文
  const isCJK   = s => /[一-鿿]/.test(s);
  const cjkA    = f.authors.filter(isCJK);
  const latA    = f.authors.filter(s => !isCJK(s));
  const authors = (cjkA.length > 0 && cjkA.length === latA.length) ? cjkA : f.authors;

  const lines = [`Title: ${f.title}`];
  if (authors.length)     lines.push(`Authors: ${authors.join('; ')}`);
  if (f.year)             lines.push(`Year: ${f.year}`);
  if (f.type)             lines.push(`Type: ${f.type}`);
  if (isBookChapter) {
    if (bookTitle)        lines.push(`Book: ${bookTitle}`);
    if (bookPages)        lines.push(`Pages: ${bookPages}`);
  } else {
    if (f.source)         lines.push(`Journal/Source: ${f.source}`);
  }
  if (f.isbn)             lines.push(`ISBN: ${f.isbn}`);
  if (bookPub)            lines.push(`Publisher: ${bookPub}`);
  if (f.lang)             lines.push(`Language: ${f.lang}`);
  if (cleanKws.length)    lines.push(`Keywords: ${cleanKws.join('; ')}`);
  if (f.abstract)         lines.push(`Abstract: ${f.abstract.slice(0, 2000)}`);
  if (f.doi)              lines.push(`DOI: ${f.doi}`);
  lines.push(`URL: ${origin}/handle/${handle}`);
  return { formattedText: lines.join('\n'), title: f.title, hasAbstract: !!f.abstract, doi: f.doi || null };
}

// DSpace 7 REST（metadata 是 {key: [{value}]} 物件）
function parseDSpaceJson(item, handle, origin) {
  const meta    = item.metadata || {};
  const getVal  = k => meta[k]?.[0]?.value?.trim() || '';
  const getVals = k => (meta[k] || []).map(v => v.value?.trim()).filter(Boolean);
  const doi = getVals('dc.identifier').find(v => /^10\.\d/.test(v))
           || getVal('dc.identifier.doi') || '';
  return buildFormattedText({
    title:     getVal('dc.title'),
    authors:   [...getVals('dc.contributor.author'), ...getVals('dc.creator')],
    year:      (getVal('dc.date.issued') || getVal('dc.date')).match(/\d{4}/)?.[0] || '',
    abstract:  getVal('dc.description.abstract') || getVal('dc.description'),
    source:    getVal('dc.relation.ispartof') || getVal('dc.relation') || getVal('dc.source'),
    publisher: getVal('dc.publisher'),
    lang:      getVal('dc.language.iso') || getVal('dc.language'),
    type:      getVal('dc.type'),
    keywords:  getVals('dc.subject'),
    isbn:      getVal('dc.identifier.isbn'),
    doi,
  }, handle, origin);
}

// DSpace 6 REST（metadata 是 [{key, value}] 陣列）
function parseDSpace6Array(arr, handle, origin) {
  const getVal  = k => arr.find(m => m.key === k)?.value?.trim() || '';
  const getVals = k => arr.filter(m => m.key === k).map(m => m.value?.trim()).filter(Boolean);
  const doi = getVals('dc.identifier').find(v => /^10\.\d/.test(v))
           || getVal('dc.identifier.doi') || '';
  return buildFormattedText({
    title:     getVal('dc.title'),
    authors:   [...getVals('dc.contributor.author'), ...getVals('dc.creator')],
    year:      (getVal('dc.date.issued') || getVal('dc.date')).match(/\d{4}/)?.[0] || '',
    abstract:  getVal('dc.description.abstract') || getVal('dc.description'),
    source:    getVal('dc.relation.ispartof') || getVal('dc.relation') || getVal('dc.source'),
    publisher: getVal('dc.publisher'),
    lang:      getVal('dc.language.iso') || getVal('dc.language'),
    type:      getVal('dc.type'),
    keywords:  getVals('dc.subject'),
    isbn:      getVal('dc.identifier.isbn'),
    doi,
  }, handle, origin);
}

// OAI-PMH oai_dc（XML DOM）
function parseOaiDc(doc, handle, origin) {
  const ns  = 'http://purl.org/dc/elements/1.1/';
  const get  = tag => doc.getElementsByTagNameNS(ns, tag)?.[0]?.textContent?.trim() || '';
  const gets = tag => [...doc.getElementsByTagNameNS(ns, tag)].map(el => el.textContent?.trim()).filter(Boolean);
  const identifiers = gets('identifier');
  const doi = identifiers.find(v => /^10\.\d/.test(v))
           || identifiers.find(v => v.includes('doi.org/'))?.match(/10\.\d{4,}\/\S+/)?.[0]
           || '';
  return buildFormattedText({
    title:     get('title'),
    authors:   gets('creator').concat(gets('contributor')),
    year:      (get('date')).match(/\d{4}/)?.[0] || '',
    abstract:  get('description'),
    source:    get('source') || get('relation'),
    publisher: get('publisher'),
    lang:      get('language'),
    type:      get('type'),
    keywords:  gets('subject'),
    isbn:      '',
    doi,
  }, handle, origin);
}


// ── 身分驗證／解析（取代原先的員編對照表）──────────────────
// 原本以 data/scholar_lookup.json、data/employee_orcid.json（含員工編號、姓名、ORCID 對照）
// 查詢使用者身分，有個資疑慮，已整批移除。現在改由使用者自行輸入 ORCID 與 AH 學者頁網址。

// ORCID 格式 + 最後一碼 checksum（ISO 7064 MOD 11-2）驗證
function validateOrcid(raw) {
  const id = String(raw || '').trim().replace(/^https?:\/\/orcid\.org\//i, '');
  if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(id)) {
    return { ok: false, error: 'ORCID 格式須為 0000-0000-0000-000X（16 碼，最後一碼可為 X）' };
  }
  const digits = id.replace(/-/g, '');
  let total = 0;
  for (let i = 0; i < 15; i++) total = (total + Number(digits[i])) * 2;
  const expected = (12 - (total % 11)) % 11;
  const checkChar = expected === 10 ? 'X' : String(expected);
  if (digits[15].toUpperCase() !== checkChar) {
    return { ok: false, error: 'ORCID 檢核碼不正確，請確認是否輸入錯誤' };
  }
  return { ok: true, orcidId: id };
}

// 從 AH 學者頁網址解析 scholarId；網域／路徑／id 格式任一不符就拒絕，不送出請求
function parseAhScholarUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return { ok: false, error: '請貼上 AH 學者頁網址' };
  let u;
  try { u = new URL(s); } catch { return { ok: false, error: '網址格式不正確，請直接從瀏覽器網址列複製' }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return { ok: false, error: '網址必須是 http(s) 連結' };
  }
  if (u.hostname.toLowerCase() !== 'ah.lib.nccu.edu.tw') {
    return { ok: false, error: `網域必須是 ah.lib.nccu.edu.tw（目前為 ${u.hostname}）` };
  }
  if (u.pathname.replace(/\/+$/, '') !== '/scholar') {
    return { ok: false, error: `路徑必須是 /scholar（目前為 ${u.pathname}）` };
  }
  const id = u.searchParams.get('id') || '';
  if (!/^\d+$/.test(id)) {
    return { ok: false, error: '網址中的 id 參數必須是純數字' };
  }
  return { ok: true, scholarId: id };
}

// 取 ORCID 公開資料中的姓名（供使用者確認是自己的 ORCID）
async function fetchOrcidPersonName(orcidId) {
  try {
    const res = await fetch(`https://pub.orcid.org/v3.0/${orcidId}/person`, {
      headers: { Accept: 'application/json' }
    });
    if (!res.ok) return '';
    const data = await res.json();
    const given  = data?.name?.['given-names']?.value || '';
    const family = data?.name?.['family-name']?.value || '';
    const credit = data?.name?.['credit-name']?.value || '';
    return (credit || [given, family].filter(Boolean).join(' ')).trim();
  } catch { return ''; }
}

// 取 AH 學者頁上的學者姓名（供使用者確認是自己的學者頁）
async function fetchAhScholarName(scholarId) {
  try {
    const res = await fetch(
      `https://ah.lib.nccu.edu.tw/scholar?id=${encodeURIComponent(scholarId)}&title=items&subtitle=all`,
      { headers: { Accept: 'text/html' } }
    );
    if (!res.ok) return '';
    const html = await res.text();
    const decode = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<')
                         .replace(/&gt;/g, '>').replace(/&quot;/g, '"')
                         .replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').trim();
    const h = html.match(/<h[12][^>]*>([^<]{1,80})<\/h[12]>/i);
    if (h) return decode(h[1]);
    const t = html.match(/<title[^>]*>([^<]{1,120})<\/title>/i);
    if (t) return decode(t[1]).replace(/\s*[-|｜–]\s*(?:政治大學|NCCU|學術影響力).*$/, '').trim();
    return '';
  } catch { return ''; }
}


// ── AH 已建檔著作清單（用正規表達式解析，MV3 Service Worker 無 DOM）──
// 注意：ah.lib.nccu.edu.tw 的 robots.txt 拒絕自動化存取，
// 本函式每次僅查一位老師，且只在使用者主動觸發 checkOrcid 時執行，
// 不進行並發或批次抓取。
async function fetchAhPage(scholarId, page) {
  try {
    const url = `https://ah.lib.nccu.edu.tw/scholar?id=${encodeURIComponent(scholarId)}&title=items&subtitle=all&itemPerPage=100&page=${page}`;
    const res = await fetch(url, { headers: { 'Accept': 'text/html' } });
    if (!res.ok) return [];
    const html = await res.text();
    const items = [];
    const rowRe = /<td class="column1 de">([\d-]+)<\/td>\s*<td class="column2 de"><a[^>]+item_id=(\d+)[^>]*>([^<]+)<\/a>/g;
    let m;
    while ((m = rowRe.exec(html)) !== null) {
      items.push({ date: m[1].trim(), itemId: m[2], title: m[3].trim() });
    }
    return items;
  } catch { return []; }
}

async function fetchAhExistingItems(scholarId) {
  if (!scholarId) return [];
  try {
    const first = await fetchAhPage(scholarId, 0); // page=0 是第一頁
    if (first.length < 100) return first;
    const all = [...first];
    for (let page = 1; page <= 20; page++) {
      await new Promise(r => setTimeout(r, 400)); // 每頁間隔 400ms
      const more = await fetchAhPage(scholarId, page);
      all.push(...more);
      if (more.length < 100) break;
    }
    return all;
  } catch { return []; }
}

// 標題正規化（HTML 實體解碼、去開頭冠詞、去空白/標點，轉小寫）
function normalizeTitle(title) {
  return (title || '')
    .toLowerCase()
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/^(a |an |the )/i, '')
    .replace(/[\s　]/g, '')
    .replace(/[：:，,、。.．「」『』（）()\[\]{}\-—_/\\]/g, '');
}


// Session-level DOI cache：避免同一 itemId 在同次 checkOrcidWorks 中重複抓頁
const _ahDoiCache = new Map();

// 從 AH 論著詳細頁面擷取 DOI（純 regex，不需 DOM）
async function fetchAhItemDoi(itemId) {
  if (_ahDoiCache.has(itemId)) return _ahDoiCache.get(itemId);
  try {
    const res = await fetch(`https://ah.lib.nccu.edu.tw/item?id=${itemId}`, { headers: { Accept: 'text/html' } });
    if (!res.ok) { _ahDoiCache.set(itemId, null); return null; }
    const html = await res.text();
    const m = html.match(/\b(10\.\d{4,}\/[^\s"'<>\]]+)/i);
    const doi = m ? m[1].replace(/[.,;:]+$/, '').toLowerCase() : null;
    _ahDoiCache.set(itemId, doi);
    return doi;
  } catch { _ahDoiCache.set(itemId, null); return null; }
}

// 用 AH 清單標記「是否已建檔」，不過濾，只加 alreadyInAh 欄位
// 比對策略一：標準化標題精確包含（含子字串），年份容差 1 年
// 比對策略二（DOI）：標題比對失敗且有 DOI 時，抓 AH 論著詳細頁確認 DOI
async function annotateAhStatus(newWorks, ahItems) {
  const ahNorm = ahItems.map(item => ({
    ...item,
    norm: normalizeTitle(item.title),
    year: (item.date || '').substring(0, 4),
    _matched: false,
  }));

  // 第一階段：標題比對
  const result = newWorks.map(work => {
    const wNorm = normalizeTitle(work.title);
    const wYear = work.year || '';
    const matched = ahNorm.find(ah => {
      if (!ah.norm || !wNorm) return false;
      const exactHit = ah.norm === wNorm
        || (wNorm.length > 10 && ah.norm.includes(wNorm))
        || (ah.norm.length > 10 && wNorm.includes(ah.norm));
      if (!exactHit) return false;
      if (wYear && ah.year && Math.abs(parseInt(wYear) - parseInt(ah.year)) > 1) return false;
      return true;
    });
    if (matched) matched._matched = true;
    return { ...work, alreadyInAh: !!matched };
  });

  // 第二階段：DOI 比對（標題失敗且 ORCID 著作有 DOI 時才執行）
  const normDoi = doi => (doi || '').toLowerCase().replace(/^https?:\/\/doi\.org\//i, '').replace(/[.,;:]+$/, '');
  const unmatchedWithDoi = result.filter(w => !w.alreadyInAh && w.doi);
  if (unmatchedWithDoi.length === 0) return result;

  const relevantYears = new Set(unmatchedWithDoi.flatMap(w => {
    const y = parseInt(w.year || '0');
    return y ? [String(y - 1), String(y), String(y + 1)] : [];
  }));

  // 尚未被標題比對到、且年份在範圍內的 AH 論著
  const candidates = ahNorm.filter(ah => !ah._matched && (!ah.year || relevantYears.has(ah.year)));
  if (candidates.length === 0) return result;

  // 並行抓 AH 論著 DOI（最多 30 筆，5 筆一組，組間 150ms；提早退出）
  const doiMap = new Map(); // itemId → normalizedDoi
  const targetDois = new Set(unmatchedWithDoi.map(w => normDoi(w.doi)));
  const capped = candidates.slice(0, 30);
  const CONCURRENCY = 5;
  for (let i = 0; i < capped.length; i += CONCURRENCY) {
    const chunk = capped.slice(i, i + CONCURRENCY);
    const dois = await Promise.all(chunk.map(ah => fetchAhItemDoi(ah.itemId)));
    dois.forEach((doi, j) => { if (doi) doiMap.set(chunk[j].itemId, normDoi(doi)); });
    // 若所有目標 DOI 都已找到，提早結束
    if ([...targetDois].every(d => [...doiMap.values()].includes(d))) break;
    if (i + CONCURRENCY < capped.length) await new Promise(r => setTimeout(r, 150));
  }

  return result.map(work => {
    if (work.alreadyInAh || !work.doi) return work;
    const wDoi = normDoi(work.doi);
    const matched = candidates.find(ah => {
      const ahDoi = doiMap.get(ah.itemId);
      return ahDoi && ahDoi === wDoi;
    });
    return { ...work, alreadyInAh: !!matched };
  });
}


// 監聽來自 popup.js 的訊息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // 驗證並解析使用者自行輸入的 ORCID 與 AH 學者頁網址，回傳姓名供使用者確認後才存檔
  if (message.action === 'resolveIdentity') {
    (async () => {
      const result = { ok: false, errors: [] };

      const o = validateOrcid(message.orcid);
      if (!o.ok) result.errors.push(o.error);
      else result.orcidId = o.orcidId;

      let ah = null;
      if (message.ahUrl) {
        ah = parseAhScholarUrl(message.ahUrl);
        if (!ah.ok) result.errors.push(ah.error);
        else result.scholarId = ah.scholarId;
      }

      if (result.errors.length) { sendResponse(result); return; }

      const [orcidName, ahName] = await Promise.all([
        fetchOrcidPersonName(result.orcidId),
        result.scholarId ? fetchAhScholarName(result.scholarId) : Promise.resolve('')
      ]);
      result.orcidName = orcidName;
      result.ahName    = ahName;
      result.ok        = true;
      sendResponse(result);
    })();
    return true;
  }

  // 批次測試：一次跑多個 DOI，只到 metadata 階段（不送 AI），結果印在 console
  if (message.action === 'testBatch') {
    (async () => {
      const dois = [].concat(message.dois || []);
      const results = [];
      for (const doi of dois) {
        try {
          const r = await fetchMetadataOnly(doi);
          const preview = { doi, title: r.title, journal: r.journal, year: r.year, authorCount: r.authorCount, hasAbstract: r.hasAbstract };
          results.push({ doi, ok: true, ...preview });
        } catch (e) {
          results.push({ doi, ok: false, error: e.message });
        }
      }
      sendResponse({ results });
    })();
    return true;
  }

  // Stage 1：只查 CrossRef + OpenAlex，不呼叫 OpenAI
  if (message.action === 'fetchMetadata') {
    fetchMetadataOnly(message.doi)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err  => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // 從 URL 頁面的 HTML meta tag 抓 DOI + 摘要 + 完整書目（Airiti 等 SPA 頁面的 service worker 備援路徑）
  if (message.action === 'fetchMetaFromUrl') {
    (async () => {
      try {
        const { doi, abstract, _html } = await fetchMetaFromHtml(message.url, 0, true);
        let pageMeta = null;
        if (_html) {
          const parsed = parseHtmlMeta(_html);
          if (parsed?.title) {
            const lines = [`Title: ${parsed.title}`];
            const authors = (parsed.author || []).map(a => [a.given, a.family].filter(Boolean).join(' ')).filter(Boolean);
            if (authors.length) lines.push(`Authors: ${authors.join('; ')}`);
            const yr = parsed.issued?.['date-parts']?.[0]?.[0];
            if (yr) lines.push(`Year: ${yr}`);
            const jnl = [].concat(parsed['container-title'] || [])[0];
            if (jnl) lines.push(`Journal/Source: ${jnl}`);
            if (parsed.volume) lines.push(`Volume: ${parsed.volume}`);
            if (parsed.issue)  lines.push(`Issue: ${parsed.issue}`);
            if (parsed.page)   lines.push(`Pages: ${parsed.page}`);
            if (parsed.language) lines.push(`Language: ${parsed.language}`);
            const abs = parsed.abstract || abstract;
            if (abs) lines.push(`Abstract: ${abs.slice(0, 2000)}`);
            if (doi) lines.push(`DOI: ${doi}`);
            lines.push(`URL: ${message.url}`);
            pageMeta = { title: parsed.title, formattedText: lines.join('\n'), hasAbstract: !!(parsed.abstract || abstract) };
          }
        }
        sendResponse({ success: true, doi, abstract, ...(pageMeta || {}) });
      } catch {
        sendResponse({ success: false, doi: '', abstract: '' });
      }
    })();
    return true;
  }

  // Stage 2：拿已整理好的文字直接送 OpenAI
  if (message.action === 'processWithAI') {
    (async () => {
      try {
        const raw = message.formattedText || '';
        // _pre_authors_json / _pre_dept：從 DOM 直接取得的作者資訊
        // 送 AI 之前先移除，AI 回傳後強制覆蓋（比 AI 判斷更可靠）
        const _preAuthMatch = raw.match(/^_pre_authors_json: (.+)$/m);
        const _preDeptMatch = raw.match(/^_pre_dept: (.+)$/m);
        let _preAuthors = null;
        if (_preAuthMatch) { try { _preAuthors = JSON.parse(_preAuthMatch[1]); } catch {} }
        const _preDept  = _preDeptMatch?.[1]?.trim() || '';
        const cleanRaw  = raw.replace(/^_pre_(?:authors_json|dept): .+$/gm, '').trim();
        // 純文字（非 JSON）來自文字模式貼上 → 先補查 TSSCI/THCI/Scopus 再送 AI
        const text = cleanRaw.trimStart()[0] !== '{' ? await enrichPublicationText(cleanRaw) : cleanRaw;
        // [耗時統計：暫時停用] 只量 callOpenAI（送出請求到解析完回應），供側欄耗時統計使用
        // const _aiT0  = performance.now();
        const result = await callOpenAI(text);
        // const aiMs   = Math.round(performance.now() - _aiT0);
        // 有 DOM 作者清單時直接覆蓋 AI 判斷
        if (_preAuthors?.length > 0) {
          result.authors  = _preAuthors.map(a => ({ sta_chi: a.sta_chi, sta_ut_nam: _preDept, ca_sts: '0' }));
          result.auth_cnt = _preAuthors.length;
        }
        sendResponse({ success: true, data: result });
        // [耗時統計：暫時停用] sendResponse({ success: true, data: result, timing: { model: CONFIG.ai.model, aiMs } });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // ORCID 單篇完整資料（無 DOI 時走此路徑）
  if (message.action === 'fetchOrcidWorkDetail') {
    fetchOrcidWorkText(message.orcidId, message.putCode)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err  => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // ORCID 手動立即檢查
  if (message.action === 'checkOrcid') {
    checkOrcidWorks()
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // PubMed 查詢
  if (message.action === 'fetchPubMed') {
    fetchPubMedData(message.pmid)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err   => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // arXiv 查詢
  if (message.action === 'fetchArxiv') {
    fetchArxivData(message.arxivId)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err   => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // ISBN 查詢（Google Books + Open Library）
  if (message.action === 'fetchISBN') {
    fetchISBNData(message.isbn)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err   => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // DSpace 7 REST API 查詢（無 meta tag 的機構典藏）
  if (message.action === 'fetchDSpaceHandle') {
    fetchDSpaceHandle(message.handle, message.origin)
      .then(data => sendResponse({ data }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  // PDF URL → 背景下載 → 二進制掃描 DOI；失敗時以 PDF.js 備援
  if (message.action === 'fetchPdfDoi') {
    (async () => {
      try {
        const res = await fetch(message.url, {
          headers: { Accept: 'application/pdf,*/*' },
          redirect: 'follow',
        });
        if (!res.ok) throw new Error(`無法下載 PDF（HTTP ${res.status}）`);
        const buffer = await res.arrayBuffer();
        const raw = new TextDecoder('latin1').decode(buffer);
        const m = raw.match(/10\.\d{4,}\/[^\s\x00-\x1f"'<>\[\]{}\\,]{4,}/);
        if (!m) {
          const fallback = extractFromPdfFallback(buffer);
          if (!fallback.success) {
            const reason = '未在 PDF 中找到 DOI，且無法從 metadata 擷取書目資訊';
            sendResponse({ success: false, error: reason });
            return;
          }
          let rawText = `Title: ${fallback.title}`;
          if (fallback.author) rawText += `\nAuthor: ${fallback.author}`;
          const formattedText = await enrichPublicationText(rawText);
          const title = (fallback.title || formattedText.match(/^Title: (.+)$/m)?.[1] || '（PDF 全文）').substring(0, 80);
          sendResponse({ success: true, fallbackText: true, title, formattedText });
          return;
        }
        const doi = m[0].replace(/[.,;:\]}>]+$/, '').toLowerCase();
        sendResponse({ success: true, doi });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // PDF 擷取後文字前處理（TSSCI/THCI 查詢，popup 端 PDF.js 擷取完後呼叫）
  if (message.action === 'enrichText') {
    enrichPublicationText(message.text)
      .then(enriched => sendResponse({ success: true, formattedText: enriched }))
      .catch(err    => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // 純文字模式：直接把貼上的文字送 OpenAI
  if (message.action === 'processPublicationText') {
    if (!message.text?.trim()) {
      sendResponse({ success: false, error: '請貼上書目資料' });
      return true;
    }
    callOpenAI(message.text)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err  => sendResponse({ success: false, error: err.message }));
    return true;
  }

});


// DOI → URL 安全字串：保留 '/'（DOI 結構），只 encode 空格與非 ASCII 字元
const doiEncode = doi => doi.replace(/[^\x21-\x7E]/g, c => encodeURIComponent(c));

// CrossRef + OpenAlex + S2 + Unpaywall 並行查詢；CrossRef 失敗則試 DataCite
async function fetchMetadataOnly(doi) {
  let cleanDoi = doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  try { cleanDoi = decodeURIComponent(cleanDoi); } catch {}  // 處理使用者貼入的 URL-encoded DOI（如 %20）
  if (!cleanDoi) throw new Error('DOI 不能為空');

  // CrossRef：保留 DOI 中的 '/'，只對其他特殊字元 encode
  const crossrefUrl = `https://api.crossref.org/works/${cleanDoi.replace(/[^!-~]|\s/g, c => encodeURIComponent(c))}`;

  // OpenAlex 先起動，讓 ORCID 查詢能在 OpenAlex 回傳後立刻並行，不必等 DBLP/S2
  const _openAlexPromise    = fetchOpenAlexData(cleanDoi);
  const _orcidDeptsPromise  = _openAlexPromise.then(oaData => fetchOrcidDepts(oaData?.authorships || []));

  const [crossrefRes, openAlexData, s2Data, unpaywallData, inDblp, taiwanJournals, orcidDepts] = await Promise.all([
    fetch(crossrefUrl),
    _openAlexPromise,
    fetchSemanticScholar(`DOI:${cleanDoi}`),
    fetchUnpaywall(cleanDoi),
    checkDblp(cleanDoi),
    getTaiwanJournals(),
    _orcidDeptsPromise,
  ]);

  if (!crossrefRes.ok) {
    if (crossrefRes.status === 404) {
      const dcAttr = await fetchDataCite(cleanDoi);
      if (dcAttr) {
        const title       = dcAttr.titles?.[0]?.title || '';
        const journal     = dcAttr.container?.title   || '';
        const year        = dcAttr.publicationYear ? String(dcAttr.publicationYear) : '';
        const authorCount = dcAttr.creators?.length   || 0;
        const hasAbstract = !!(dcAttr.descriptions?.some(d => d.descriptionType === 'Abstract') || s2Data?.abstract);
        const meeting     = await fetchZenodoMeeting(cleanDoi);   // Zenodo 的會議資訊（DataCite 沒有轉錄）
        return { title, journal, year, authorCount, hasAbstract,
          formattedText: formatDataCiteData(dcAttr, cleanDoi, openAlexData, s2Data, meeting) };
      }
         // 第三備援：doi.org 內容協商（Airiti/台灣期刊等）
      const cslData = await fetchDoiCsl(cleanDoi);
      if (cslData) {
        const title   = [].concat(cslData.title || '')[0] || '';
        const journal = [].concat(cslData['container-title'] || '')[0] || '';
        const dp      = cslData.issued?.['date-parts']?.[0];
        let year      = dp?.[0] ? String(dp[0]) : '';

        // 轉成與 CrossRef 路徑相同的 JSON 格式送 AI
        const d = {};
        if (cslData.type)   d.type              = cslData.type;
        if (title)          d.title             = [title];
        if (journal)        d['container-title']= [journal];
        if (year)           d.issued            = cslData.issued;
        if (cslData.volume) d.volume            = cslData.volume;
        if (cslData.issue)  d.issue             = cslData.issue;
        if (cslData.page)   d.page              = cslData.page;
        // OpenAlex biblio 補強（CSL 無卷期頁時）
        if (!d.volume && openAlexData?.biblio?.volume)  d.volume = openAlexData.biblio.volume;
        if (!d.issue  && openAlexData?.biblio?.issue)   d.issue  = openAlexData.biblio.issue;
        if (!d.page) {
          const fp = openAlexData?.biblio?.first_page, lp = openAlexData?.biblio?.last_page;
          if (fp && lp) d.page = `${fp}-${lp}`;
          else if (fp)  d.page = fp;
        }
        // HTML 頁面補強（CSL JSON 欄位不完整時，追抓出版社頁面 meta tag）
        if (!year || !d.volume || !d.page || !d.abstract) {
          const htmlMeta = await fetchDoiHtmlMeta(cleanDoi);
          if (htmlMeta) {
            // 日期：HTML 通常有完整年月日，優先更新 issued
            const hDp = htmlMeta.issued?.['date-parts']?.[0];
            if (hDp?.[0]) {
              year = String(hDp[0]);
              d.issued = htmlMeta.issued;  // 覆蓋，確保有月日
            }
            if (!d.volume   && htmlMeta.volume)          d.volume   = htmlMeta.volume;
            if (!d.issue    && htmlMeta.issue)           d.issue    = htmlMeta.issue;
            if (!d.page     && htmlMeta.page)            d.page     = htmlMeta.page;
            if (!d.abstract && htmlMeta.abstract)        d.abstract = htmlMeta.abstract;
            if (!d.ISSN?.length && htmlMeta.ISSN?.length) d.ISSN   = htmlMeta.ISSN;
            if (!d.publisher && htmlMeta.publisher)      d.publisher = htmlMeta.publisher;
            if (!d.keywords?.length && htmlMeta.keywords?.length) d.keywords = htmlMeta.keywords;
            if (htmlMeta._pageUrl) d.URL = htmlMeta._pageUrl;
          }
        }
        const issns = [].concat(cslData.ISSN || d.ISSN || []);
        if (issns.length)   d.ISSN              = issns;
        if (cslData.publisher) d.publisher      = cslData.publisher;
        d.DOI = cleanDoi;

        // 作者：literal（台灣期刊）放進 family，given 留空
        const authorObjs = (cslData.author || [])
          .map(a => ({
            given:  a.given  || '',
            family: a.family || a.literal || ''
          }))
          .filter(a => a.family);
        const authorCount = authorObjs.length;

        // ORCID 系所：用 DOI 搜尋，比對姓名後掛上 orcid-dept / orcid-org
        const orcidDepts = authorObjs.length
          ? await fetchOrcidDeptsByDoi(cleanDoi, authorObjs)
          : {};
        if (authorObjs.length) {
          d.author = authorObjs.map((a, i) => {
            if (!orcidDepts[i]) return a;
            const r = { ...a };
            if (orcidDepts[i].dept) r['orcid-dept'] = orcidDepts[i].dept;
            if (orcidDepts[i].org)  r['orcid-org']  = orcidDepts[i].org;
            return r;
          });
        }

        // 摘要：S2 > OpenAlex
        const oaAbstract = openAlexData?.abstract_inverted_index
          ? reconstructAbstract(openAlexData.abstract_inverted_index) : '';
        const abstractText = s2Data?.abstract || oaAbstract || '';
        if (abstractText) d.abstract = abstractText;

        // 關鍵字：OpenAlex > S2
        const kw = openAlexData?.keywords?.map(k => k.display_name).filter(Boolean)
                ?? s2Data?.fieldsOfStudy?.map(f => f.name).filter(Boolean) ?? [];
        if (kw.length) d.keywords = kw.slice(0, 10);

        // OpenAlex 補充
        if (openAlexData?.primary_topic?.display_name)
          d['research-topic'] = openAlexData.primary_topic.display_name;
        if (openAlexResearchField(openAlexData)) d['research-field'] = openAlexResearchField(openAlexData);
        const journalUrl = openAlexData?.primary_location?.source?.homepage_url || '';
        if (journalUrl) d['_journal_url'] = journalUrl;
        const oaUrl = unpaywallData?.best_oa_location?.url_for_pdf
          || unpaywallData?.best_oa_location?.url
          || openAlexData?.open_access?.oa_url || '';
        if (oaUrl) d['open-access-url'] = oaUrl;

        // 期刊收錄資料庫推導
        const indexedIn = openAlexData?.primary_location?.source?.indexed_in || [];
        const pub       = (cslData.publisher || '').toLowerCase();
        const knownDbs  = new Set(indexedIn.includes('scopus') ? ['r'] : []);
        if (/\bieee\b/.test(pub))                                    knownDbs.add('k');
        if (/\bacm\b|association for computing machinery/.test(pub)) knownDbs.add('i');
        if (inDblp)                                                  knownDbs.add('j');
        for (const issn of issns) {
          const tier = taiwanJournals[issn.replace(/-/g, '')];
          if (tier === 'tssci')      knownDbs.add('e');
          if (tier === 'thci')       knownDbs.add('n');
          if (tier === 'thci_core') { knownDbs.add('n'); knownDbs.add('q'); }
        }
        // CSL 無 ISSN 時，以期刊名反查（Airiti 常見情況）
        if (!knownDbs.has('e') && !knownDbs.has('n') && journal && _taiwanByName) {
          const tier = _taiwanByName[journal];
          if (tier === 'tssci')      knownDbs.add('e');
          if (tier === 'thci')       knownDbs.add('n');
          if (tier === 'thci_core') { knownDbs.add('n'); knownDbs.add('q'); }
        }
        // WoS 子資料庫（SCIE/SSCI/AHCI）不從主題領域推導，只標記需人工確認
        if (indexedIn.includes('web_of_science')) d['_wos'] = true;
        if (knownDbs.size) d['_known_dbs'] = [...knownDbs];

        return { title, journal, year, authorCount,
          hasAbstract: !!abstractText, formattedText: JSON.stringify(d, null, 2) };
      }
      throw new Error('找不到此 DOI：' + cleanDoi);
    }
    throw new Error(`CrossRef API 錯誤：${crossrefRes.status}`);
  }

  const work = (await crossrefRes.json()).message;

  // IEEE 論文集封面頁偵測：CrossRef 把個別論文 DOI 指向封面頁（Title Page / Front Matter）
  // 無作者 + 標題含封面關鍵字時，用 Semantic Scholar 覆蓋 title 與 authors
  const FRONT_MATTER_RE = /^(title page|front matter|table of contents|preface|index|cover|copyright|foreword|acknowledgment)/i;
  if (!work.author?.length && FRONT_MATTER_RE.test(work.title?.[0] || '') && s2Data?.title && s2Data?.authors?.length) {
    work.title = [s2Data.title];
    work.author = s2Data.authors.map(a => {
      const parts = a.name.trim().split(/\s+/);
      return { given: parts.slice(0, -1).join(' '), family: parts[parts.length - 1] || a.name, affiliation: [] };
    });
    if (work.page === '1-1') delete work.page;  // 封面頁的假頁碼
  }

  // ② ③ 並行：補摘要 + 預查期刊網址
  // ③ 提前在 Stage 1 完成，Stage 2 送 OpenAI 時 _journal_url 已在文字中，不需再等
  const hasAbstractNow = !!(work.abstract || openAlexData?.abstract_inverted_index || s2Data?.abstract);
  const htmlUrl = unpaywallData?.best_oa_location?.url_for_landing_page
               || unpaywallData?.best_oa_location?.url
               || `https://doi.org/${cleanDoi}`;
  const [extraAbstract, preJournalUrl, oaSource] = await Promise.all([
    hasAbstractNow ? Promise.resolve('') : fetchAbstractFromHtml(htmlUrl),
    fetchJournalUrlFromOpenAlex(work['container-title']?.[0] || ''),
    fetchOpenAlexSourceCountry(work.ISSN || []),   // 期刊 ISSN 登記國（出版國第 ① 層）
  ]);

  let formattedText = formatCrossrefData(work, cleanDoi, openAlexData, s2Data, unpaywallData, inDblp, orcidDepts, extraAbstract, taiwanJournals, oaSource);
  if (preJournalUrl && !/^_journal_url:/m.test(formattedText)) {
    formattedText = `_journal_url: ${preJournalUrl}\n` + formattedText;
  }

  const dateParts = work['published-print']?.['date-parts']?.[0]
    || work['published-online']?.['date-parts']?.[0]
    || work.issued?.['date-parts']?.[0];

  return {
    title:        work.title?.[0] || '',
    journal:      work['container-title']?.[0] || '',
    year:         dateParts?.[0] || '',
    authorCount:  work.author?.length || 0,
    hasAbstract:  !!(hasAbstractNow || extraAbstract),
    formattedText
  };
}


// OpenAlex 期刊首頁查詢（用於無 DOI 時補 url_addr）
async function fetchJournalUrlFromOpenAlex(journalName) {
  if (!journalName) return '';
  try {
    const res = await fetch(
      `https://api.openalex.org/sources?search=${encodeURIComponent(journalName)}&per_page=3&mailto=nccu-plugin`
    );
    if (!res.ok) return '';
    const data = await res.json();
    const normQ = journalName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const match = (data.results || []).find(s => {
      const normS = (s.display_name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      return normS === normQ || normS.startsWith(normQ.slice(0, Math.min(normQ.length, 15)));
    });
    return match?.homepage_url || '';
  } catch { return ''; }
}

// OpenAlex 學科分類（primary_topic 的子學科與大學科），送 AI 作為 field_cod 的參考，不直接決定
function openAlexResearchField(oa) {
  const t = oa?.primary_topic;
  const sub = t?.subfield?.display_name, fld = t?.field?.display_name;
  if (!sub && !fld) return '';
  return sub && fld ? `${sub} (${fld})` : (sub || fld);
}

// 論著領域代碼 → 名稱，從 SYSTEM_PROMPT 的「完整選項」清單解析（單一來源，避免兩份清單不一致）
const FIELD_COD_NAMES = Object.fromEntries(
  [...(SYSTEM_PROMPT.match(/完整選項：0B=[^\n]+/)?.[0] || '').matchAll(/([0-9A-Z]{2})=([^,]+)/g)]
    .map(m => [m[1], m[2].trim()])
);

// acc_flg：卷（volume）、期（issue）、頁（page）三者皆有值 → "0"，否則 "1"。
// 輸入可能是 JSON（前面可能有 _journal_url: 之類的前置行）或純文字（Volume: / Issue: / Pages: 行）。
// 無法辨識格式時回傳 null，保留 AI 的值。
function computeAccFlg(text) {
  const has = v => v != null && String(v).trim() !== '';
  const brace = text.indexOf('{');
  if (brace !== -1) {
    try {
      const j = JSON.parse(text.slice(brace));
      return (has(j.volume) && has(j.issue) && has(j.page)) ? '0' : '1';
    } catch {}
  }
  const line = re => text.match(re)?.[1];
  const vol  = line(/^(?:Volume|卷(?:別|數)?)\s*[:：]\s*(.+)$/mi);
  const iss  = line(/^(?:Issue|期(?:別|數)?)\s*[:：]\s*(.+)$/mi);
  const pg   = line(/^(?:Pages?|頁(?:次|碼)?)\s*[:：]\s*(.+)$/mi);
  if (vol === undefined && iss === undefined && pg === undefined) return null;
  return (has(vol) && has(iss) && has(pg)) ? '0' : '1';
}

// ── 作者名單由程式建立 ───────────────────────────────────────
// 輸入 JSON 有 author 陣列（CrossRef / CSL 路徑）時，作者人數、姓名、通訊作者、單位都直接由程式產生，
// 不交給 AI：實測 gpt-5.4-mini 在 9 位作者時漏掉 1 位、nano 會把姓名順序顛倒、地址常沒去乾淨。

// 單位尾端可刪除的地名：國名（含出版國對照表）、台灣縣市、常見城市
const _AFFIL_EXTRA_PLACES = [
  'roc', 'r.o.c', 'r.o.c.', 'taiwan roc', 'taiwan (roc)', 'taiwan, r.o.c.', 'pr china', 'p.r. china', 'p. r. china',
  'new taipei', 'new taipei city', 'taipei city', 'taoyuan', 'keelung', 'hsinchu city', 'miaoli', 'changhua',
  'nantou', 'yunlin', 'chiayi', 'pingtung', 'yilan', 'hualien', 'taitung', 'penghu', 'kinmen', 'taichung city',
  'tainan city', 'kaohsiung city', '新北', '新北市', '台北市', '臺北市', '桃園', '台中', '臺中', '台南', '臺南', '高雄',
  'armenia', 'ukraine', 'estonia', 'latvia', 'lithuania', 'slovakia', 'slovenia', 'croatia', 'serbia', 'bulgaria',
  'iceland', 'luxembourg', 'cyprus', 'malta', 'pakistan', 'bangladesh', 'sri lanka', 'nepal', 'iran', 'iraq',
  'jordan', 'lebanon', 'qatar', 'kuwait', 'oman', 'bahrain', 'kazakhstan', 'mongolia', 'myanmar', 'cambodia',
  'laos', 'brunei', 'nigeria', 'kenya', 'ghana', 'ethiopia', 'morocco', 'tunisia', 'algeria', 'peru', 'ecuador',
  'venezuela', 'uruguay', 'paraguay', 'bolivia', 'costa rica', 'panama', 'cuba', 'puerto rico',
  'macau sar', 'hong kong sar', 'hong kong sar, china', 'macao sar', 'jyväskylä', 'jyvaskyla',
];
let _affilPlaces = null;
function affilPlaces() {
  if (!_affilPlaces) {
    _affilPlaces = new Set([...Object.keys(COUNTRY_NAME_TO_ISO3), ...Object.keys(CITY_TO_ISO3), ..._AFFIL_EXTRA_PLACES]);
  }
  return _affilPlaces;
}
const _INSTITUTION_RE = /department|dept\b|school|college|institute|universit|center|centre|laborator|\blab\b|program|faculty|graduate|division|hospital|academia|research|\bco\.|ltd|inc\b|corp|bureau|ministry|office|library|foundation|association|society|council|agency|系|所|院|中心|醫院|研究|室|處|館|大學|學會|協會|公司/i;

// 單一單位：去掉郵政信箱、郵遞區號、城市、國家。回傳 { text, unsure }
// unsure = true 表示刪掉了一段不在地名清單裡、靠位置推測是城市的文字，需人工確認
function cleanAffiliationUnit(unit) {
  const places = affilPlaces();
  let parts = unit.split(/\s*[,，]\s*/).map(s => s.trim()).filter(Boolean)
    .filter(p => !/^(?:p\.?\s?o\.?\s*box|postfach|信箱)\b/i.test(p))               // 郵政信箱整段刪
    .map(p => p.replace(/^[A-Z]{1,3}-\d{3,6}\s+(?=\S)/, ''));                     // "FI-40014 University…" 的郵遞區號前綴
  let unsure = false, lastWasPlace = false, guessed = false;
  while (parts.length > 1) {
    const last  = parts[parts.length - 1];
    const low   = last.toLowerCase().replace(/\.$/, '');
    const words = last.split(/\s+/).length;
    const postal = /\d/.test(last) && words <= 3 && !_INSTITUTION_RE.test(last);   // "Taipei 11605"、"SE-10044 Stockholm"
    const usState = /^[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?$/.test(last);                // "MA"、"CA 94305"
    if (places.has(low) || postal || usState) {
      parts.pop(); lastWasPlace = true; continue;
    }
    // 不在清單裡：只有緊接在國名／郵遞區號之前、1～2 個字、不像機構、不是縮寫（如 KAIST）時，才當作城市刪掉一次
    if (lastWasPlace && !guessed && words <= 2 && !_INSTITUTION_RE.test(last) && !/^[A-Z0-9&]{2,}$/.test(last)) {
      parts.pop(); guessed = true; unsure = true; continue;
    }
    break;
  }
  // 剩下的最後一段仍像地名（短、不像機構、不是縮寫）但不在清單裡 → 保留原文，標記需人工確認
  const tail = parts[parts.length - 1] || '';
  if (parts.length > 2 && tail.split(/\s+/).length <= 2 && !_INSTITUTION_RE.test(tail) && !/^[A-Z0-9&]{2,}$/.test(tail)) {
    unsure = true;
  }
  return { text: parts.join(', '), unsure };
}

// 作者的 sta_ut_nam：多個單位以「; 」分隔，逐一清理；只有大學名稱的單位捨棄
// 看起來像參考文獻而不是單位：有年份，且有卷／期／頁等書目記號或書名號。
// 實例：月旦某篇的 CrossRef affiliation 放的是「論法制上權利主體之建構基礎與變化…，法令月刊，2016年3月，67卷3期」
function looksLikeCitation(s) {
  const hasYear = /(?:^|[^\d])(?:19|20)\d{2}(?:\s*年|[^\d]|$)/.test(s);
  const hasBib  = /\d+\s*卷|\d+\s*期|第\s*\d+\s*[卷期頁]|\d+\s*頁|\bvol\.?\s*\d|\bno\.?\s*\d|\bpp?\.\s*\d|\b\d+\s*\(\d+\)\s*[:：,，]\s*\d|[〈《「『][^〉》」』]{4,}[〉》」』]|──|——/i.test(s);
  return hasYear && hasBib;
}

function buildAuthorAffiliation(a) {
  const raw = (a.affiliation || '').trim();
  if (!raw) return { text: (a['orcid-dept'] || '').trim(), unsure: false };
  let unsure = false;
  const units = [];
  for (const u of raw.split(/\s*[;；]\s*/).filter(Boolean)) {
    // 來源資料把參考文獻誤放在單位欄 → 這段不填，標記需人工確認
    if (looksLikeCitation(u)) { unsure = true; continue; }
    const r = cleanAffiliationUnit(u);
    if (r.unsure) unsure = true;
    // 只有學校名稱的單位（例：「National Chengchi University」）也照文稿保留，不捨棄
    if (r.text) units.push(r.text);
  }
  return { text: units.join(AFFIL_SEP), unsure };
}

// 作者姓名：中文姓名「姓名」相連；given 與 family 相同（華藝 CSL 常見）只取一次；西文「Given Family」
function buildAuthorName(a) {
  const g = (a.given || '').trim(), f = (a.family || '').trim();
  if (!g || g === f) return f || (a.name || '').trim();
  if (!f) return g;
  if (/[㐀-鿿]/.test(g + f)) return f + g;
  return `${g} ${f}`;
}

// 從送給 AI 的輸入文字取出作者陣列；不是 JSON 或沒有作者時回傳 null（交給 AI）
// 送給 AI 的輸入若是 JSON（前面可能有 _journal_url: 之類的前置行），解析出物件；否則 null
function parseSourceJson(text) {
  const brace = text.indexOf('{');
  if (brace === -1) return null;
  try { return JSON.parse(text.slice(brace)); } catch { return null; }
}

function sourceAuthors(text) {
  const list = parseSourceJson(text)?.author;
  return Array.isArray(list) && list.length ? list : null;
}

// ── 會議欄位由程式填 ─────────────────────────────────────────
// 會議名稱、日期、地點、主辦單位、論文集名稱、ISBN 在第一階段已查到，直接寫入，不靠 AI 照抄。
// 實測 gpt-5.4-mini 對同一篇 ACM 論文跑 3 次，有 2 次整組會議欄位漏掉。
// 只在來源有值時覆蓋；來源沒有的欄位保留 AI 的結果。
const _PROCEEDINGS_RE = /proceedings|conference|symposium|workshop|congress|colloquium|研討會|年會|\([A-Z][A-Za-z&-]{1,15}\s*['’]?\d{2,4}\)/i;

function pickProceedingsTitle(containerTitles) {
  const list = [].concat(containerTitles || []).filter(Boolean);
  if (!list.length) return '';
  // 有叢書名＋書名時（如 Springer：["STEAM-H …", "… (ICAAHI 2025)"]），取像論文集的那一個，否則取最後一個
  return list.find(t => _PROCEEDINGS_RE.test(t)) || list[list.length - 1];
}

function confCountryIso3(name) {
  const key = (name || '').trim().toLowerCase().replace(/\.$/, '');
  return COUNTRY_NAME_TO_ISO3[key] || '';
}

// 從送給 AI 的輸入取出會議相關欄位：JSON（CrossRef／CSL）直接取物件；
// 文字（DataCite）則讀 "_conf_xxx: 值"、"_is_conference: 值" 這類行。沒有任何會議資訊回傳 null
function sourceConferenceInfo(text) {
  const j = parseSourceJson(text);
  if (j) return j;
  const o = {};
  for (const m of text.matchAll(/^(_conf_(?:nam|dt|city|country|host)|_is_conference):\s*(.+)$/gm)) o[m[1]] = m[2].trim();
  return Object.keys(o).length ? o : null;
}

function applySourceConferenceFields(parsed, src) {
  const set = (k, v) => { if (v != null && String(v).trim() !== '') parsed[k] = String(v).trim(); };
  const proc = pickProceedingsTitle(src['container-title']);
  set('conf_nam',   src._conf_nam || proc);
  set('thesis_chi', proc);
  set('conf_dt',    src._conf_dt);
  set('conf_pls',   src._conf_city);
  set('cty_nam',    src._conf_city);
  set('conf_host',  src._conf_host);
  set('isbn_num',   src.ISBN);
  set('nat_cod',    confCountryIso3(src._conf_country));
  if (proc || src.ISBN) parsed.proceeding = 'y';
  parsed._conf_from_source = true;
}

function buildAuthorsFromSource(list) {
  return list.map(a => {
    const aff = buildAuthorAffiliation(a);
    const o = { sta_chi: buildAuthorName(a), sta_ut_nam: aff.text, ca_sts: a.corresponding === true ? '1' : '0' };
    if (aff.unsure) o._affil_confirm = true;
    return o;
  });
}

// 只在輸入確實有結構化作者時附加：作者由程式產生，請模型不要輸出作者（省時間）。
// 不放進主 prompt：實測 gpt-5.4-nano 會把這條規則誤用在文字輸入上，整份作者名單留空。
const AUTHORS_FROM_CODE_NOTE = '\n\n【本次輸入】輸入 JSON 含 "author" 陣列，作者名單由程式產生：auth_cnt 填 0、authors 填空陣列 []。';

// OpenAI 呼叫（純文字模式與 DOI 確認後共用）
async function callOpenAI(text) {
  const apiKey = await getAiApiKey();
  if (!apiKey) throw new Error('尚未設定 AI API Key，請在側邊面板的「AI 設定」中輸入後再試。');

  // 若文字中無 _journal_url，試用期刊名查 OpenAlex 補上
  if (!/^_journal_url:/m.test(text)) {
    const journalMatch = text.match(/^Journal: (.+)$/m);
    if (journalMatch) {
      const jUrl = await fetchJournalUrlFromOpenAlex(journalMatch[1].trim());
      if (jUrl) {
        text = `_journal_url: ${jUrl}\n` + text;
      }
    }
  }

  const payload = {
    model: CONFIG.ai.model,
    messages: [
      { role: 'system', content: sourceAuthors(text) ? SYSTEM_PROMPT + AUTHORS_FROM_CODE_NOTE : SYSTEM_PROMPT },
      { role: 'user',   content: text }
    ]
  };
  if (CONFIG.ai.maxCompletionTokens != null) payload.max_completion_tokens = CONFIG.ai.maxCompletionTokens;
  if (CONFIG.ai.temperature != null)         payload.temperature           = CONFIG.ai.temperature;
  if (CONFIG.ai.topP != null)                payload.top_p                 = CONFIG.ai.topP;

  const openaiRes = await fetch(CONFIG.ai.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!openaiRes.ok) {
    const err = await openaiRes.json().catch(() => ({}));
    throw new Error(`AI API 錯誤：${err.error?.message || openaiRes.status}`);
  }

  const data = await openaiRes.json();
  const rawJson = data.choices[0].message.content.trim();

  try {
    const parsed = JSON.parse(rawJson);
    // 永遠從標題字元判斷語言並覆蓋 AI（字元偵測比 AI 更可靠）
    {
      let titleForLang = text.match(/^Title:\s*(.+)$/m)?.[1] || '';
      if (!titleForLang) {
        try { titleForLang = [].concat(JSON.parse(text)?.title || '')[0] || ''; } catch {}
      }
      if (titleForLang) {
        const cjk   = (titleForLang.match(/[㐀-鿿豈-﫿가-힯]/g) || []).length;
        const latin = (titleForLang.match(/[a-zA-Z]/g) || []).length;
        const kana  = (titleForLang.match(/[぀-ヿ]/g) || []).length;
        if      (kana > 0 && kana >= cjk) parsed.lang_cod = '04';
        else if (cjk > latin)             parsed.lang_cod = '50';
        else if (latin > 0)               parsed.lang_cod = '01';
      }
    }
    // acc_flg（期刊論文是否已有完整卷期頁）：規則是純粹的欄位檢查，由程式計算後覆蓋 AI。
    // 實測 gpt-5.4-nano / mini 在卷期頁俱全時仍會填 "1"。
    if (parsed.publ_tpe === '03') {
      const acc = computeAccFlg(text);
      if (acc !== null) parsed.acc_flg = acc;
    }
    // 作者名單：輸入有結構化作者時由程式建立，覆蓋 AI（見 buildAuthorsFromSource）
    const _srcAuthors = sourceAuthors(text);
    if (_srcAuthors) {
      parsed.authors  = buildAuthorsFromSource(_srcAuthors);
      parsed.auth_cnt = parsed.authors.length;
      parsed._authors_from_source = true;
    }
    // 會議論文：來源已確認是會議時，類別一律為 04；會議欄位由程式依來源資料填入
    const _confSrc = sourceConferenceInfo(text);
    if (_confSrc?._is_conference && parsed.publ_tpe !== '04') {
      parsed._publ_tpe_ai = parsed.publ_tpe;          // 保留 AI 原判斷，供除錯
      parsed.publ_tpe = '04';
      if (!parsed.pp && parsed.page_num) parsed.pp = parsed.page_num;
      // 專書篇章／期刊論文專用欄位不適用會議論文；nat_cod 在期刊是出版國、在會議是舉辦國，需清掉重填
      for (const k of ['page_num', 'set_title', 'publ_nam', 'publ_pls', 'bktpe_cod', 'bkcat_tpe', 'bkcat_rem',
                       'jnl_nam', 'vol', 'no', 'acc_flg', 'nat_tpe', 'nat_cod', 'pertpe_cod', 'publ_type'])
        delete parsed[k];
    }
    if (_confSrc?._is_conference) parsed._publ_tpe_src = _confSrc._is_conference;
    if (parsed.publ_tpe === '04' && _confSrc) applySourceConferenceFields(parsed, _confSrc);
    // field_cod 沒有唯一正解（AI 判斷），一律標記需人工確認，並附上 OpenAlex 學科供秘書參考
    // 升等論著：書目資料無從判斷（由老師決定哪些著作送升等）。
    // 程式一律預設「0 非升等論著」，並標記需人工確認，避免老師以為已判斷過
    parsed.promote = '0';
    parsed._promote_confirm = true;
    if (parsed.field_cod) {
      parsed._field_confirm = true;
      parsed._field_name = FIELD_COD_NAMES[parsed.field_cod] || '';
      parsed._field_ref  = text.match(/"research-field":\s*"([^"]+)"/)?.[1]
                        || text.match(/^research-field:\s*(.+)$/m)?.[1]?.trim() || '';
    }
    // sta_ut_nam 後處理：整理空白；政大英文系所名轉中文縮寫（CONFIG.affiliation.nccuDeptAbbrev，預設關閉）
    const _NCCU_DEPT_MAP = [
      [/Mathematical\s+Sciences|Applied\s+Mathematics/i,                  '應數系'],
      [/Statistics/i,                                                       '統計系'],
      [/Management\s+Information\s+Systems/i,                              '資管系'],
      [/Information\s+Management/i,                                        '資管系'],
      [/Computer\s+Science\s+and\s+Information\s+Engineering/i,            '資科系'],
      [/Computer\s+Science/i,                                               '資訊系'],
      [/Risk\s+Management\s+and\s+Insurance/i,                             '風管系'],
      [/Public\s+Finance/i,                                                 '財政系'],
      [/Finance/i,                                                           '財管系'],
      [/Accounting/i,                                                        '會計系'],
      [/International\s+Business/i,                                         '國貿系'],
      [/Business\s+Administration/i,                                        '企管系'],
      [/Economics/i,                                                         '經濟系'],
      [/Political\s+Science/i,                                              '政治系'],
      [/Diplomacy/i,                                                         '外交系'],
      [/Public\s+Administration/i,                                          '公行系'],
      [/Sociology/i,                                                         '社會系'],
      [/Psychology/i,                                                        '心理系'],
      [/History/i,                                                           '歷史系'],
      [/Chinese\s+Literature|Department\s+of\s+Chinese(?!\s+Language)/i,   '中文系'],
      [/English/i,                                                           '英文系'],
      [/Journalism/i,                                                        '新聞系'],
      [/Advertising/i,                                                       '廣告系'],
      [/Radio.*Television|Broadcasting|Radio.*Film/i,                       '廣電系'],
      [/Land\s+Economics/i,                                                 '地政系'],
      [/Land\s+Administration/i,                                            '土文系'],
      [/Social\s+Work/i,                                                    '社工所'],
      [/Ethnic\s+Relations/i,                                               '民族系'],
      [/Religious\s+Studies/i,                                              '宗教所'],
      [/Philosophy/i,                                                        '哲學系'],
      [/Law/i,                                                               '法律系'],
      [/East\s+Asian\s+Studies/i,                                           '東亞所'],
      [/Russian\s+Studies/i,                                                '俄研所'],
      [/Development\s+Studies/i,                                            '國發所'],
      [/Korean/i,                                                            '韓文系'],
      [/Arabic/i,                                                            '阿文系'],
      [/Japanese/i,                                                          '日文系'],
      [/European\s+Languages/i,                                             '歐洲語文學系'],
      [/Southeast\s+Asian/i,                                                '東南亞語系'],
      [/Slavic\s+Languages/i,                                               '斯拉夫文系'],
      [/Library.*Information.*Archival|Library\s+Science/i,                '圖檔所'],
      [/Education/i,                                                         '教育系'],
      [/Linguistics/i,                                                       '語言所'],
      [/Labor\s+(?:Relations|Studies)/i,                                    '勞工所'],
      [/Early\s+Childhood/i,                                                '幼教所'],
      [/International\s+Affairs|International\s+Studies/i,                 '國關中心'],
      [/Technology.*Intellectual\s+Property|Science\s+Management/i,        '科管智財所'],
      [/Communication/i,                                                    '新聞系'],
    ];
    if (Array.isArray(parsed.authors)) {
      parsed.authors = parsed.authors.map(a => {
        // 與作者姓名完全相同 → 清空（AI 誤填）
        if (a.sta_ut_nam && a.sta_chi &&
            a.sta_ut_nam.trim() === a.sta_chi.trim()) {
          a.sta_ut_nam = '';
        }
        // 多個單位以「; 」串接時逐一整理空白，保持原順序。
        // 開頭的學校名稱照文稿保留（如 IEEE 的 "National Chengchi University, Department of …"、
        // 「國立政治大學資訊科學系」），不刪除——老師要求作者單位與文稿一致。
        if (a.sta_ut_nam) {
          a.sta_ut_nam = a.sta_ut_nam
            .split(/\s*[;；]\s*/)
            .map(s => s.replace(/\s*,\s*/g, ', ').trim())
            .filter(Boolean)
            .join(AFFIL_SEP);
        }
        // 英文系所名 → 政大中文簡稱。
        // 預設關閉（CONFIG.affiliation.nccuDeptAbbrev=false）：以文稿印出的單位為準，不翻譯、不縮寫。
        // 開啟時也只套用在「該筆單位文字本身就指明政治大學」的作者，避免把外校作者
        // （如台大資工 Department of Computer Science and Information Engineering）誤標成政大系所。
        if (CONFIG.affiliation.nccuDeptAbbrev &&
            a.sta_ut_nam && !/[一-鿿]/.test(a.sta_ut_nam) && _NCCU_RE.test(a.sta_ut_nam)) {
          for (const [re, zh] of _NCCU_DEPT_MAP) {
            if (re.test(a.sta_ut_nam)) { a.sta_ut_nam = zh; break; }
          }
        }
        return a;
      });
    }
    // ── 起迄頁次正規化（破折號統一、單頁不湊區間）──────────
    if (parsed.pp       != null) parsed.pp       = normalizePages(parsed.pp);
    if (parsed.page_num != null) parsed.page_num = normalizePages(parsed.page_num);

    // ── 期刊出版國：改由程式確定性決定，AI 的猜測一律丟棄 ──
    // 期刊論文（03）才有 nat_cod/nat_tpe 的「期刊出版國」語意；
    // 04/06/12 的 nat_cod 是「舉辦國」，不在此處覆寫。
    if (parsed.publ_tpe === '03') {
      const jc = text.match(/^_journal_country:\s*(\S+)/m)?.[1]
              || text.match(/"_journal_country"\s*:\s*"([^"]+)"/)?.[1]
              || '';
      parsed.nat_cod = jc;
      parsed.nat_tpe = jc ? (jc === 'TWN' ? '1' : '2') : '';
      // 出版國若來自第 ④ 層（出版商名稱推導），標記為需人工確認，
      // 表單上會以橘色虛線呈現，提醒秘書核對，而非當成已確定的值
      const needConfirm = /"_journal_country_confirm"\s*:\s*true/.test(text)
                       || /^_journal_country_confirm:\s*true/m.test(text);
      const src = text.match(/"_journal_country_src"\s*:\s*"([^"]+)"/)?.[1]
               || text.match(/^_journal_country_src:\s*(\S+)/m)?.[1] || '';
      if (jc && src)         parsed._nat_cod_src     = src;
      if (jc && needConfirm) parsed._nat_cod_confirm = true;
    }
    // ── 收錄資料庫：只保留程式確定性查到的代碼，AI 自行加入的一律丟棄 ──
    // 收錄資料庫答錯會影響評鑑；WoS（SCIE/SSCI/AHCI/SCI）、Scopus、EI 目前沒有可靠來源，
    // 一律留給人工勾選，並在備註欄與表單上標示。
    if (parsed.publ_tpe === '03' || 'citelist' in parsed) {
      const known = extractKnownDbs(text);
      const wos   = /"_wos"\s*:\s*true/.test(text) || /^_wos:\s*true/m.test(text);
      const dropped = (Array.isArray(parsed.citelist) ? parsed.citelist : [])
        .filter(c => !known.includes(String(c)));
      parsed.citelist = known;
      if (dropped.length) parsed._citelist_dropped = dropped;
      // 列出程式沒查到、需人工確認的資料庫（EI 目前沒有任何自動來源，永遠需要確認）
      const missing = [];
      if (!known.some(c => ['a', 'b', 'c', 'm'].includes(c)))
        missing.push(wos ? 'WoS 子資料庫（期刊收錄於 WoS，請擇 SCIE／SSCI／AHCI）' : 'SCI／SCIE／SSCI／AHCI');
      if (!known.includes('r')) missing.push('Scopus');
      if (!known.includes('d')) missing.push('EI');
      // 提示不寫進「其他」備註欄（citetpe_rem 會被送進系統），改由表單上勾選框旁的提示框顯示
      parsed.citetpe_rem = '';
      parsed._citelist_hint = `程式未自動判斷：${missing.join('、')}，請人工確認後勾選`;
      parsed._citelist_confirm = true;
    }
    // _journal_url 強制覆蓋：OpenAlex 查到的期刊 URL 優先序最高，AI 若沒用就補回來
    const journalUrlLine = text.match(/^_journal_url: (.+)$/m)?.[1]?.trim();
    if (journalUrlLine) parsed.url_addr = journalUrlLine;
    // 專書篇章：Book: 欄位強制填入 set_title（AI 常留空）
    if (parsed.publ_tpe === '02' && !parsed.set_title) {
      const bookLine = text.match(/^Book: (.+)$/m)?.[1]?.trim();
      if (bookLine) parsed.set_title = bookLine;
    }
    return parsed;
  } catch {
    throw new Error(`AI 回傳內容不是合法 JSON：${rawJson.substring(0, 100)}`);
  }
}


// OpenAlex 查詢（失敗時靜默回 null，不中斷主流程）
async function fetchOpenAlexData(doi) {
  try {
    const url = `https://api.openalex.org/works/https://doi.org/${doiEncode(doi)}` +
      `?select=type,abstract_inverted_index,keywords,authorships,open_access,primary_topic,cited_by_count,primary_location,biblio&mailto=nccu-plugin`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}


// ── OpenAlex Sources（期刊 ISSN → indexed_in：Scopus / WoS 等）──
// 供純文字模式補查收錄資料庫使用；DOI 模式由 fetchOpenAlexData 的 primary_location 覆蓋
// 注意：work 物件裡的 primary_location.source 是 OpenAlex 的精簡版物件，**不含 country_code**，
// 必須另外打 /sources 端點才拿得到期刊的 ISSN 登記國（書目學上的「出版國」）。
async function fetchOpenAlexSource(issn) {
  try {
    const res = await fetch(
      // 注意：`indexed_in` 不是 /sources 的合法 select 欄位（會回 400），
      // 這是舊版留下的 bug，導致本函式一直回傳 null。OpenAlex 目前也已不在 /sources
      // 提供 Scopus/WoS 收錄旗標，純文字路徑的 Scopus/WoS 判斷因此無法靠此端點，
      // 需另尋來源（DOI 路徑用的是 work.primary_location.source.indexed_in，不受影響）。
      `https://api.openalex.org/sources?filter=issn:${encodeURIComponent(issn)}&per-page=1` +
      `&select=country_code,display_name,topics,societies&mailto=nccu-plugin`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.results?.[0] || null;
  } catch { return null; }
}

// 依序試每個 ISSN：優先回傳有 country_code 的 source；
// 都沒有時回傳第一筆查到的（其 societies 欄位仍可用於推導出版國）
async function fetchOpenAlexSourceCountry(issns = []) {
  let first = null;
  for (const issn of [].concat(issns).filter(Boolean).slice(0, 3)) {
    const src = await fetchOpenAlexSource(issn);
    if (src?.country_code) return src;
    if (src && !first) first = src;
  }
  return first;
}


// ── Semantic Scholar（通用補強：摘要、作者、領域）────────
// identifier 格式：'DOI:10.xxx/xxx' | 'PMID:123456' | 'ARXIV:2301.00001'
async function fetchSemanticScholar(identifier) {
  try {
    const url = `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(identifier)}` +
      `?fields=title,authors,year,abstract,journal,externalIds,venue,fieldsOfStudy`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}


// ── DataCite（CrossRef 404 時的備援；覆蓋資料集/報告/機構庫 DOI）──
// ── 會議資訊（類別判斷用）──────────────────────────────────
// 實測：CrossRef 把 Springer 論文集的論文標成 book-chapter、DataCite 把 Zenodo 會議簡報標成 Text，
// 但 OpenAlex 的作品 type、CrossRef 的 assertion（ConferenceInfo）、Zenodo 的 meeting 都記錄了會議。
// 30 篇測試中，OpenAlex 有收錄的 25 篇，其 type 與學校登錄類別全部一致。

const _MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const _ymd = (y, m, d) => `${y}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`;

// 單一日期："2025-11-20"、"20 November 2025"、"November 20, 2025" → "2025/11/20"；無法解析回傳 ''
function parseConfDate(s) {
  s = (s || '').trim();
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return _ymd(m[1], m[2], m[3]);
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{4})$/);
  if (m && _MONTHS[m[2].slice(0, 3).toLowerCase()]) return _ymd(m[3], _MONTHS[m[2].slice(0, 3).toLowerCase()], m[1]);
  m = s.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m && _MONTHS[m[1].slice(0, 3).toLowerCase()]) return _ymd(m[3], _MONTHS[m[1].slice(0, 3).toLowerCase()], m[2]);
  return '';
}

// 日期區間："8-12 April 2026"、"April 8-12, 2026"，或單一日期 → "2026/04/08-2026/04/12"
function parseConfDateRange(s) {
  s = (s || '').trim().replace(/[–—]/g, '-');
  let m = s.match(/^(\d{1,2})\s*-\s*(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{4})$/);
  if (m && _MONTHS[m[3].slice(0, 3).toLowerCase()]) {
    const mo = _MONTHS[m[3].slice(0, 3).toLowerCase()];
    return `${_ymd(m[4], mo, m[1])}-${_ymd(m[4], mo, m[2])}`;
  }
  m = s.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2})\s*-\s*(\d{1,2}),?\s+(\d{4})$/);
  if (m && _MONTHS[m[1].slice(0, 3).toLowerCase()]) {
    const mo = _MONTHS[m[1].slice(0, 3).toLowerCase()];
    return `${_ymd(m[4], mo, m[2])}-${_ymd(m[4], mo, m[3])}`;
  }
  return parseConfDate(s);
}

// 地點 "Los Angeles, CA, United States." → { city, country }
function splitConfPlace(place) {
  const parts = (place || '').split(',').map(s => s.trim().replace(/\.$/, '')).filter(Boolean);
  return { city: parts[0] || '', country: parts.length > 1 ? parts[parts.length - 1] : '' };
}

// CrossRef assertion 的 ConferenceInfo 群組（Springer 論文集常見）
function crossrefConferenceInfo(work) {
  const items = (work.assertion || []).filter(a => a.group?.name === 'ConferenceInfo');
  if (!items.length) return null;
  const v = n => items.find(a => a.name === n)?.value || '';
  const start = parseConfDate(v('conference_start_date')), end = parseConfDate(v('conference_end_date'));
  return {
    name: v('conference_name'), acronym: v('conference_acronym'),
    city: v('conference_city'), country: v('conference_country'),
    dt: start ? (end && end !== start ? `${start}-${end}` : start) : '',
  };
}

// Zenodo 紀錄的 meeting 欄位（DataCite 不會轉錄這個欄位）
async function fetchZenodoMeeting(doi) {
  const id = doi.match(/^10\.5281\/zenodo\.(\d+)$/i)?.[1];
  if (!id) return null;
  try {
    const res = await fetch(`https://zenodo.org/api/records/${id}`);
    if (!res.ok) return null;
    const mt = (await res.json()).metadata?.meeting;
    if (!mt?.title) return null;
    const { city, country } = splitConfPlace(mt.place);
    return { name: mt.title, acronym: mt.acronym || '', city, country, dt: parseConfDateRange(mt.dates) };
  } catch { return null; }
}

async function fetchDataCite(doi) {
  try {
    const res = await fetch(`https://api.datacite.org/dois/${doiEncode(doi)}`);
    if (!res.ok) return null;
    return (await res.json()).data?.attributes || null;
  } catch { return null; }
}

// DataCite → 與 CrossRef 路徑相同形狀的 JSON（author 陣列、date-parts、container-title…）
// 改成 JSON 後，作者名單、會議欄位、語言等都能由程式依來源產生，不必讓 LLM 從文字裡讀。
// 實測（Zenodo 會議簡報）：文字格式下 gpt-5.4-mini 多數姓名未轉成「名 姓」、完整日期與作者單位也沒送進去。
function formatDataCiteData(attr, doi, openAlex = null, s2 = null, meeting = null) {
  const d = {};
  const resType = attr.types?.resourceTypeGeneral || attr.types?.resourceType || '';
  // 會議論文判斷：DataCite 類型、Zenodo meeting、OpenAlex type 任一指出是會議
  const confBy = /^conference(paper|proceeding)$/i.test(attr.types?.resourceTypeGeneral || '') ? 'datacite-type'
               : meeting ? 'zenodo-meeting'
               : openAlex?.type === 'conference-paper' ? 'openalex-type' : '';
  d.type = confBy ? 'conference-paper' : (attr.types?.citeproc || resType || '');
  if (resType) d['datacite-type'] = resType;

  const title = attr.titles?.[0]?.title || '';
  if (title) d.title = [title];
  const sub = attr.titles?.find(t => t.titleType === 'Subtitle')?.title;
  if (sub) d.subtitle = [sub];

  // 作者：DataCite 的 affiliation 可能是字串陣列或 {name} 物件陣列，統一成 {name}
  const creators = (attr.creators || []).filter(c => c.nameType !== 'Organizational' || c.name);
  if (creators.length) {
    d.author = creators.map((c, i) => {
      const given  = (c.givenName  || '').trim();
      const family = (c.familyName || '').trim();
      const o = (given || family)
        ? { given, family }
        : { given: '', family: (c.name || '').trim() };
      const affObjs = [].concat(c.affiliation || []).map(x => (typeof x === 'string' ? { name: x } : x));
      const aff = joinManuscriptAffiliations(manuscriptAffiliations({ affiliation: affObjs }, openAlex?.authorships?.[i]));
      if (aff) o.affiliation = aff;
      return o;
    });
  }

  const c = attr.container || {};
  if (c.title)  d['container-title'] = [c.title];
  if (c.volume) d.volume = String(c.volume);
  if (c.issue)  d.issue  = String(c.issue);
  const sp = c.firstPage, ep = c.lastPage;
  const pages = normalizePages(sp && ep ? `${sp}-${ep}` : (sp || ep || ''));
  if (pages) d.page = pages;

  // 日期：優先用 dates 裡的 Issued（完整年月日），否則只有 publicationYear
  const issuedStr = (attr.dates || []).find(x => x.dateType === 'Issued')?.date || '';
  const m = issuedStr.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/);
  if (m) d.issued = { 'date-parts': [[+m[1], ...(m[2] ? [+m[2]] : []), ...(m[3] ? [+m[3]] : [])]] };
  else if (attr.publicationYear) d.issued = { 'date-parts': [[+attr.publicationYear]] };

  if (attr.language)  d.language  = attr.language;
  if (attr.publisher) d.publisher = typeof attr.publisher === 'string' ? attr.publisher : (attr.publisher.name || '');

  const abstractText = attr.descriptions?.find(x => x.descriptionType === 'Abstract')?.description || s2?.abstract || '';
  if (abstractText) d.abstract = abstractText.slice(0, 3000);
  const keywords = attr.subjects?.map(x => x.subject).filter(Boolean) || [];
  if (keywords.length) d.keywords = keywords.slice(0, 10);
  if (openAlex?.primary_topic?.display_name) d['research-topic'] = openAlex.primary_topic.display_name;
  if (openAlexResearchField(openAlex)) d['research-field'] = openAlexResearchField(openAlex);

  // 作者所屬機構國碼（與 CrossRef 路徑相同，供 trsnat 判斷）
  const countries = (openAlex?.authorships || [])
    .flatMap(a => (a.institutions || []).map(inst => (inst.country_code || '').toUpperCase()))
    .filter(Boolean);
  if (countries.length) d['_author_countries'] = countries;

  if (confBy) d['_is_conference'] = confBy;
  if (meeting) {
    if (meeting.name)    d['_conf_nam']     = meeting.name;
    if (meeting.dt)      d['_conf_dt']      = meeting.dt;
    if (meeting.city)    d['_conf_city']    = meeting.city;
    if (meeting.country) d['_conf_country'] = meeting.country;
  }
  d.DOI = doi;
  d.URL = `https://doi.org/${doi}`;
  return JSON.stringify(d, null, 2);
}


// ── ORCID Employments（作者系所）────────────────────────
async function fetchOrcidDept(orcidUrl) {
  try {
    const orcidId = (orcidUrl || '').replace(/^https?:\/\/orcid\.org\//, '');
    if (!orcidId) return null;
    const res = await fetch(`https://pub.orcid.org/v3.0/${orcidId}/employments`, {
      headers: { 'Accept': 'application/json' }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const summaries = (data['affiliation-group'] || [])
      .flatMap(g => (g.summaries || []).map(s => s['employment-summary']))
      .filter(Boolean);
    // 優先取現職（end-date 為 null），其次取最新開始的職位
    const sorted = [...summaries].sort((a, b) => {
      const aEnded = !!a['end-date'];
      const bEnded = !!b['end-date'];
      if (!aEnded && bEnded) return -1;
      if (aEnded && !bEnded) return 1;
      const aYear = parseInt(a['start-date']?.year?.value || '0');
      const bYear = parseInt(b['start-date']?.year?.value || '0');
      return bYear - aYear;
    });
    const best = sorted.find(s => s['department-name'] || s.organization?.name);
    if (!best) return null;
    return {
      dept: best['department-name'] || '',
      org:  best.organization?.name || ''
    };
  } catch { return null; }
}

// 對 OpenAlex authorships 裡有 ORCID 的作者並行查詢系所
async function fetchOrcidDepts(authorships = []) {
  const depts = {};
  await Promise.all(authorships.map(async (authorship, i) => {
    const orcid = authorship.author?.orcid;
    if (!orcid) return;
    const result = await fetchOrcidDept(orcid);
    if (result) depts[i] = result;
  }));
  return depts;
}

// CSL 路徑用：以 DOI 搜 ORCID，比對姓名後回傳 { 作者index: {dept,org} }
async function fetchOrcidDeptsByDoi(doi, authorObjs) {
  try {
    const query = `doi-self:"${doi}"`;
    const searchRes = await fetch(
      `https://pub.orcid.org/v3.0/search/?q=${encodeURIComponent(query)}&rows=20`,
      { headers: { Accept: 'application/json' } }
    );
    if (!searchRes.ok) return {};
    const searchData = await searchRes.json();
    const orcidIds = (searchData.result || [])
      .map(r => r['orcid-identifier']?.path)
      .filter(Boolean);
    if (!orcidIds.length) return {};

    const depts = {};
    await Promise.all(orcidIds.map(async orcidId => {
      // 同時取姓名與系所
      const [personRes, empResult] = await Promise.all([
        fetch(`https://pub.orcid.org/v3.0/${orcidId}/person`, { headers: { Accept: 'application/json' } }),
        fetchOrcidDept(`https://orcid.org/${orcidId}`)
      ]);
      if (!personRes.ok || !empResult) return;
      const person = await personRes.json();
      const creditName = person.name?.['credit-name']?.value || '';
      const givenName  = person.name?.['given-names']?.value || '';
      const familyName = person.name?.['family-name']?.value || '';
      const fullName   = creditName || [givenName, familyName].filter(Boolean).join(' ');
      if (!fullName) return;

      // 比對 CSL 作者：literal 存在 family 欄位
      const idx = authorObjs.findIndex(a => {
        const aName = ([a.given, a.family].filter(Boolean).join(' ')).trim();
        return aName === fullName
          || a.family === fullName
          || fullName === familyName + givenName  // 中文姓名拆開又合回來
          || fullName.replace(/\s/g, '') === aName.replace(/\s/g, '');
      });
      if (idx !== -1 && !(idx in depts)) depts[idx] = empResult;
    }));
    return depts;
  } catch { return {}; }
}

// ── PDF metadata 二進制擷取備援（DOI 掃描失敗時呼叫，不需要 PDF.js）──
// 支援：Info 字典 ASCII 編碼、UTF-16BE hex 字串、XMP XML metadata
function extractFromPdfFallback(arrayBuffer) {
  const raw = new TextDecoder('latin1').decode(arrayBuffer);
  let title = null;
  let author = null;

  // 1. XMP metadata（現代 PDF 最常見）
  const xmpTitle = raw.match(/<dc:title>[\s\S]{0,300}?<rdf:li[^>]*>([^<]{5,})<\/rdf:li>/);
  if (xmpTitle) title = xmpTitle[1].trim();

  const xmpCreator = raw.match(/<dc:creator>[\s\S]{0,600}?<rdf:li[^>]*>([^<]{2,})<\/rdf:li>/);
  if (xmpCreator) author = xmpCreator[1].trim();

  // 2. Info 字典 — ASCII 編碼 /Title (...)
  if (!title) {
    const m = raw.match(/\/Title\s*\(([^)]{5,})\)/);
    if (m) title = m[1].replace(/\\n|\\r|\\t/g, ' ').replace(/\s+/g, ' ').trim();
  }
  if (!author) {
    const m = raw.match(/\/Author\s*\(([^)]+)\)/);
    if (m) author = m[1].trim();
  }

  // 3. Info 字典 — UTF-16BE hex 字串 /Title <FEFF...>
  if (!title) {
    const m = raw.match(/\/Title\s*<(FEFF[0-9A-Fa-f]{8,})>/i);
    if (m) {
      try {
        const bytes = new Uint8Array(m[1].match(/../g).map(h => parseInt(h, 16)));
        title = new TextDecoder('utf-16be').decode(bytes.slice(2)).replace(/\s+/g, ' ').trim();
      } catch {}
    }
  }

  if (!title) return { success: false, reason: 'no-extractable-metadata' };
  return { success: true, source: 'pdf-metadata', title, author };
}

// ── TSSCI / THCI 靜態清單（懶載入，快取）────────────────
let _taiwanJournals = null;
let _taiwanByName   = null;  // 期刊名 → tier，供 CSL 路徑無 ISSN 時使用
async function getTaiwanJournals() {
  if (_taiwanJournals) return _taiwanJournals;
  try {
    const raw = await fetch(chrome.runtime.getURL('data/taiwan_journals.json')).then(r => r.json());
    _taiwanJournals = Object.fromEntries(
      Object.entries(raw).filter(([k, v]) => !k.startsWith('_') && !k.includes('（') && v !== '--- separator ---')
    );
    // 建立 名稱→tier 反查表（來自 _names 欄位）
    _taiwanByName = {};
    for (const [issn, name] of Object.entries(raw._names || {})) {
      const tier = _taiwanJournals[issn];
      if (tier && name) _taiwanByName[name] = tier;
    }
  } catch { _taiwanJournals = {}; _taiwanByName = {}; }
  return _taiwanJournals;
}

// ── 純文字輸入前處理：補查 TSSCI/THCI/Scopus/WoS 並附加 _known_dbs ──
// 在文字模式（使用者貼上 BibTeX / RIS / 純文字引用）送 AI 前呼叫
async function enrichPublicationText(rawText) {
  const knownDbs   = new Set();
  let   wos        = false;

  // ── 1. 從文字萃取 ISSN（支援 XXXX-XXXX 格式）
  const issnMatch = rawText.match(/\b(\d{4}-\d{3}[\dX])\b/i);
  const issn      = issnMatch?.[1];                     // 含 dash，如 "1726-5827"
  const issnClean = issn?.replace(/-/g, '');            // 無 dash，用於靜態清單

  // ── 2. 從文字萃取期刊名（支援 BibTeX / RIS / 純文字標籤 / JSON 片段）
  const jMatch =
    rawText.match(/journal\s*=\s*\{([^}]+)\}/i)              ||  // BibTeX
    rawText.match(/^(?:JO|JF|T2)\s+-\s+(.+)/m)               ||  // RIS
    rawText.match(/^(?:Journal|Source|期刊名?|來源)[：:]\s*(.+)/m) ||  // Plain text
    rawText.match(/"container-title"\s*:\s*\[?\s*"([^"]+)"/);    // JSON fragment
  const journalName = jMatch?.[1]?.replace(/[{}",\s]+$/, '').trim();

  // ── 3. 載入 TSSCI/THCI 清單（已快取）並查詢
  const taiwanJournals = await getTaiwanJournals();
  const applyTier = (tier) => {
    if (tier === 'tssci')      knownDbs.add('e');
    else if (tier === 'thci')  knownDbs.add('n');
    else if (tier === 'thci_core') { knownDbs.add('n'); knownDbs.add('q'); }
  };
  if (issnClean) applyTier(taiwanJournals[issnClean]);
  if (!knownDbs.has('e') && !knownDbs.has('n') && journalName && _taiwanByName)
    applyTier(_taiwanByName[journalName]);

  // ── 4. OpenAlex Sources：查 Scopus / WoS（只在非台灣期刊，或已確認台灣期刊也查 Scopus）
  if (issn) {
    const src = await fetchOpenAlexSource(issn);
    if (src) {
      const indexed = src.indexed_in || [];
      if (indexed.includes('scopus'))         knownDbs.add('r');
      // WoS 子資料庫不推導，只標記需人工確認
      if (indexed.includes('web_of_science')) wos = true;
    }
  }

  // ── 5. 出版商關鍵字偵測（IEEE / ACM）
  const pubMatch = rawText.match(/^(?:Publisher|出版商|出版社)[：:]\s*(.+)/mi);
  const pubLower = (pubMatch?.[1] || '').toLowerCase();
  if (/\bieee\b/.test(pubLower))                                     knownDbs.add('k');
  if (/\bacm\b|association for computing machinery/.test(pubLower))  knownDbs.add('i');

  if (knownDbs.size === 0 && !wos) return rawText;  // 無任何附加資訊，原文回傳

  const annotation = [
    knownDbs.size ? `\n_known_dbs: [${[...knownDbs].map(d => JSON.stringify(d)).join(', ')}]` : '',
    wos           ? `\n_wos: true`                                                             : '',
  ].join('');

  return rawText + annotation;
}


// ── DBLP（電腦科學文獻資料庫）───────────────────────────
async function checkDblp(doi) {
  try {
    const q   = encodeURIComponent(`doi:${doi}`);
    const res = await fetch(`https://dblp.org/search/publ/api?q=${q}&h=1&format=json`);
    if (!res.ok) return false;
    const data = await res.json();
    return (data?.result?.hits?.hit?.length ?? 0) > 0;
  } catch { return false; }
}

// ── Unpaywall（開放取用網址）────────────────────────────
async function fetchUnpaywall(doi) {
  try {
    const res = await fetch(
      `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=nccu-plugin@nccu.edu.tw`
    );
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}


// ── NCL 國家圖書館 ISBN 書目（第三備援，台灣出版中文書）────
async function fetchNCLBook(isbn) {
  try {
    const clean = isbn.replace(/-/g, '');
    // NCL ISBN 中心書目查詢頁
    const res = await fetch(
      `https://isbn.ncl.edu.tw/NCL_ISBNNet/NCL_ISBNNet_Detail.jsp?id=${clean}`,
      { headers: { Accept: 'text/html', 'Accept-Language': 'zh-TW,zh;q=0.9' } }
    );
    if (!res.ok) return null;
    const html = await res.text();

    // 頁面含 "此 ISBN 不存在" 或是 redirect 到搜尋首頁時放棄
    if (!html.includes('書名') && !html.includes('title')) return null;

    const get = (label) => {
      const re = new RegExp(`${label}[^<]*<[^>]+>([^<]+)`, 'i');
      return html.match(re)?.[1]?.replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').trim() || '';
    };

    const title     = get('書名') || get('Title');
    if (!title) return null;
    const author    = get('著者') || get('Author') || get('作者');
    const publisher = get('出版者') || get('Publisher') || get('出版社');
    const year      = (get('出版日期') || get('出版年') || html.match(/民國\s*(\d{2,3})\s*年/)?.[0] || '')
                        .match(/\d{4}/)?.[0]
                   || (html.match(/民國\s*(\d{2,3})\s*年/)?.[1]
                        ? String(+html.match(/民國\s*(\d{2,3})\s*年/)[1] + 1911) : '');
    const place     = get('出版地') || get('Place');

    return { title, author, publisher, year, place };
  } catch { return null; }
}


// ── ISBN → Google Books（主）+ Open Library（備）+ NCL（台灣書第三備援）──
async function fetchISBNData(isbn) {
  const [gbRes, olRes] = await Promise.all([
    fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=1`).catch(() => null),
    fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`).catch(() => null)
  ]);

  const gbData = gbRes?.ok ? await gbRes.json() : null;
  const olData = olRes?.ok ? await olRes.json() : null;
  const gb = gbData?.items?.[0]?.volumeInfo;
  const ol = olData?.[`ISBN:${isbn}`];

  // Google Books / Open Library 都查不到 → 嘗試 NCL（台灣出版書）
  if (!gb && !ol) {
    const ncl = await fetchNCLBook(isbn);
    if (ncl) {
      const lines = [];
      if (ncl.title)     lines.push(`Title: ${ncl.title}`);
      if (ncl.author)    lines.push(`Authors: ${ncl.author}`);
      if (ncl.year)      lines.push(`Year: ${ncl.year}`);
      lines.push('Type: Book');
      if (ncl.publisher) lines.push(`Publisher: ${ncl.publisher}`);
      if (ncl.place)     lines.push(`Place: ${ncl.place}`);
      lines.push(`ISBN: ${isbn}`);
      return {
        title: ncl.title, journal: '', year: ncl.year || '',
        authorCount: ncl.author ? (ncl.author.split(/[；;、，,]/).length) : 0,
        hasAbstract: false,
        formattedText: lines.join('\n')
      };
    }
    throw new Error(`找不到 ISBN：${isbn}`);
  }

  const title     = gb?.title    || ol?.title    || '';
  const authors   = gb?.authors  || ol?.authors?.map(a => a.name)  || [];
  const publisher = gb?.publisher|| ol?.publishers?.[0]?.name      || '';
  const place     = ol?.publish_places?.[0]?.name || '';
  const year      = (gb?.publishedDate || ol?.publish_date || '').match(/\d{4}/)?.[0] || '';
  const pageCount = gb?.pageCount || ol?.number_of_pages || 0;
  const language  = gb?.language || '';
  const abstract  = gb?.description
    || (typeof ol?.description === 'string' ? ol.description : ol?.description?.value ?? '') || '';
  const categories = gb?.categories || ol?.subjects?.map(s => s.name) || [];

  const lines = [];
  if (title)           lines.push(`Title: ${title}`);
  if (authors.length)  lines.push(`Authors: ${authors.join('; ')}`);
  if (year)            lines.push(`Year: ${year}`);
  lines.push(`Type: Book`);
  if (publisher)       lines.push(`Publisher: ${publisher}`);
  if (place)           lines.push(`Place: ${place}`);
  if (pageCount)       lines.push(`Page Count: ${pageCount}`);
  if (language)        lines.push(`Language: ${language}`);
  if (categories.length) lines.push(`Categories: ${categories.slice(0, 5).join('; ')}`);
  if (abstract)        lines.push(`Abstract: ${abstract.replace(/<[^>]+>/g, '').substring(0, 2000)}`);
  lines.push(`ISBN: ${isbn}`);

  return {
    title, journal: '', year,
    authorCount: authors.length,
    hasAbstract: !!abstract,
    formattedText: lines.join('\n')
  };
}


// ── PubMed / NCBI ────────────────────────────────────────
async function fetchPubMedData(pmid) {
  const [summaryRes, s2] = await Promise.all([
    fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmid}&retmode=json`),
    fetchSemanticScholar(`PMID:${pmid}`)
  ]);
  if (!summaryRes.ok) throw new Error(`PubMed API 錯誤：${summaryRes.status}`);
  const json = await summaryRes.json();
  const doc  = json.result?.[pmid];
  if (!doc || doc.error) throw new Error(`找不到 PMID：${pmid}`);

  const title   = doc.title || s2?.title || '';
  const journal = doc.source || s2?.journal?.name || '';
  const year    = doc.pubdate?.match(/\d{4}/)?.[0] || '';
  const authors = doc.authors?.map(a => a.name) || s2?.authors?.map(a => a.name) || [];
  const doi     = doc.articleids?.find(id => id.idtype === 'doi')?.value || s2?.externalIds?.DOI || '';
  const abstract = s2?.abstract || '';

  const monthMap = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
                     Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' };
  const pubMonth = monthMap[doc.pubdate?.split(' ')[1]] || '';

  const lines = [];
  if (title)          lines.push(`標題：${title}`);
  if (authors.length) { lines.push(`作者：${authors.join('；')}`); lines.push(`作者人數：${authors.length}`); }
  if (journal)        lines.push(`期刊：${journal}`);
  if (year)           lines.push(`出版年：${year}`);
  if (pubMonth)       lines.push(`出版月：${pubMonth}`);
  if (doc.volume)     lines.push(`卷：${doc.volume}`);
  if (doc.issue)      lines.push(`期：${doc.issue}`);
  if (doc.pages)      lines.push(`頁碼：${doc.pages}`);
  if (doc.lang?.[0])  lines.push(`語言：${doc.lang[0]}`);
  if (doi)            lines.push(`DOI：${doi}`);
  if (abstract)       lines.push(`摘要：${abstract}`);
  lines.push(`PMID：${pmid}`);

  return { title, journal, year, authorCount: authors.length, hasAbstract: !!abstract, formattedText: lines.join('\n') };
}


// ── arXiv ────────────────────────────────────────────────
async function fetchArxivData(arxivId) {
  const cleanId = arxivId.replace(/^arxiv:/i, '').replace(/v\d+$/, '');
  const [res, s2] = await Promise.all([
    fetch(`https://export.arxiv.org/api/query?id_list=${cleanId}&max_results=1`).catch(() => null),
    fetchSemanticScholar(`ARXIV:${cleanId}`)
  ]);

  // arXiv API 失敗時，若 Semantic Scholar 有資料則直接用 S2 備援
  const xmlOk = res?.ok;
  const xml   = xmlOk ? await res.text() : '';
  const entry = xml.match(/<entry>([\s\S]*?)<\/entry>/)?.[1] || '';

  if (!entry && !s2) throw new Error(`找不到 arXiv 論文：${cleanId}`);

  if (!entry && s2) {
    const title   = s2.title || '';
    const abstract = s2.abstract || '';
    const year    = s2.year ? String(s2.year) : '';
    const authors = s2.authors?.map(a => a.name) || [];
    const doi     = s2.externalIds?.DOI || '';
    const journal = s2.journal?.name || s2.venue || '';
    const lines   = [];
    if (title)          lines.push(`標題：${title}`);
    if (authors.length) { lines.push(`作者：${authors.join('；')}`); lines.push(`作者人數：${authors.length}`); }
    if (journal)        lines.push(`期刊/會議：${journal}`);
    if (year)           lines.push(`出版年：${year}`);
    if (doi)            lines.push(`DOI：${doi}`);
    lines.push(`arXiv ID：${cleanId}`);
    if (abstract)       lines.push(`摘要：${abstract}`);
    return { title, journal, year, authorCount: authors.length, hasAbstract: !!abstract, formattedText: lines.join('\n') };
  }

  const tag = t => entry.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)<\\/${t}>`))?.[1]?.replace(/\s+/g,' ').trim() || '';
  const title      = tag('title');
  const abstract   = tag('summary') || s2?.abstract || '';
  const published  = tag('published');
  const year       = published.match(/(\d{4})/)?.[1] || '';
  const month      = published.match(/\d{4}-(\d{2})/)?.[1] || '';
  const doi        = entry.match(/<arxiv:doi[^>]*>([\s\S]*?)<\/arxiv:doi>/)?.[1]?.trim() || s2?.externalIds?.DOI || '';
  const journalRef = entry.match(/<arxiv:journal_ref[^>]*>([\s\S]*?)<\/arxiv:journal_ref>/)?.[1]?.trim() || '';
  const authors    = [...entry.matchAll(/<name>([\s\S]*?)<\/name>/g)].map(m => m[1].trim());
  const categories = [...entry.matchAll(/category term="([^"]+)"/g)].map(m => m[1]).join(', ');
  const journal    = journalRef || s2?.journal?.name || s2?.venue || '';

  const lines = [];
  if (title)          lines.push(`標題：${title}`);
  if (authors.length) { lines.push(`作者：${authors.join('；')}`); lines.push(`作者人數：${authors.length}`); }
  if (journal)        lines.push(`期刊/會議：${journal}`);
  if (year)           lines.push(`出版年：${year}`);
  if (month)          lines.push(`出版月：${month}`);
  if (categories)     lines.push(`arXiv 分類：${categories}`);
  if (doi)            lines.push(`DOI：${doi}`);
  lines.push(`arXiv ID：${cleanId}`);
  if (abstract)       lines.push(`摘要：${abstract}`);

  return { title, journal, year, authorCount: authors.length, hasAbstract: !!abstract, formattedText: lines.join('\n') };
}

// OpenAlex 摘要是倒排索引，需還原成句子
function reconstructAbstract(invertedIndex) {
  let maxPos = 0;
  for (const positions of Object.values(invertedIndex)) {
    for (const p of positions) if (p > maxPos) maxPos = p;
  }
  const words = new Array(maxPos + 1).fill('');
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const p of positions) words[p] = word;
  }
  return words.join(' ').trim();
}


// 把 CrossRef + OpenAlex + Semantic Scholar + Unpaywall 整理成 JSON 給 AI 看
// ── 作者單位（以文稿原文為準）──────────────────────────────
// 收集某位作者在文稿上印出的所有 affiliation 原文字串，保持文稿順序、去重後回傳。
// CrossRef 由出版社登記，順序與文稿上標一致，有就只用它；
// OpenAlex raw_affiliation_strings 的順序可能被打亂（實測 10.3390/s23136173 作者 1 的
// 政大被排到第一位），因此只在 CrossRef 完全沒有單位時才當備援。
function manuscriptAffiliations(crAuthor = {}, oaAuthorship = null) {
  const dedupe = arr => {
    const out = [];
    const seen = new Set();
    for (const s of arr) {
      const t = (s || '').replace(/\s+/g, ' ').trim();
      if (!t) continue;
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
    return out;
  };
  const cr = dedupe((crAuthor.affiliation || []).map(x => x?.name));
  if (cr.length) return cr;
  return dedupe(oaAuthorship?.raw_affiliation_strings || []);
}

// 文稿上同一位作者若標了多個單位，全部依文稿順序列出，以「; 」分隔（老師要求與文稿一致）。
const AFFIL_SEP = '; ';
function joinManuscriptAffiliations(list = []) {
  return list.join(AFFIL_SEP);
}

const _NCCU_RE    = /National\s+Chengchi\s+University|國立政治大學|政治大學|\bNCCU\b/i;

// ── 收錄資料庫：從送給 AI 的輸入中取出程式查到的 _known_dbs ──
// 支援 JSON（DOI 路徑，"_known_dbs": ["e","j"]）與純文字（文字模式，_known_dbs: ["e"]）兩種格式
const _CITELIST_CODES = new Set(['a','b','c','d','e','f','g','h','i','j','k','l','m','n','p','q','r','x']);
function extractKnownDbs(text = '') {
  const m = text.match(/"_known_dbs"\s*:\s*\[([\s\S]*?)\]/) || text.match(/^_known_dbs:\s*\[([^\]]*)\]/m);
  if (!m) return [];
  return [...new Set((m[1].match(/"([a-z])"/g) || []).map(s => s.slice(1, -1)))]
    .filter(c => _CITELIST_CODES.has(c));
}

// ── 起迄頁次正規化 ────────────────────────────────────────
// 來源可能是 "61-73"、"61–73"(en dash)、"61—73"(em dash)、"pp. 61-73"、"61"、"6173"(文章編號)
// 一律輸出半形連字號格式；單頁／文章編號／起迄相同時只輸出一個數字，不硬湊區間。
function normalizePages(raw) {
  let s = String(raw ?? '').trim();
  if (!s) return '';
  s = s
    .replace(/^(?:pp?\.?|頁次?|頁)\s*/i, '')           // 去開頭 pp. / p. / 頁
    .replace(/[‐-―−﹘﹣－~～]/g, '-') // 各式破折號／波浪號 → 半形連字號
    .replace(/\s*-\s*/g, '-')                           // 連字號前後空白
    .replace(/\s+/g, ' ')
    .replace(/[-,;]+$/, '')                             // 尾端殘留的分隔符
    .trim();
  if (!s) return '';
  const m = s.match(/^(\S+)-(\S+)$/);
  if (m) {
    if (m[1] === m[2]) return m[1];                     // 61-61 → 61
    // 縮寫式區間 "61-3" → "61-63"
    if (/^\d+$/.test(m[1]) && /^\d+$/.test(m[2]) && m[2].length < m[1].length) {
      return `${m[1]}-${m[1].slice(0, m[1].length - m[2].length) + m[2]}`;
    }
    return `${m[1]}-${m[2]}`;
  }
  return s;                                             // 單頁或文章編號，原樣保留
}

// ── 期刊出版國（確定性判斷，查不到就留空）────────────────
// 出版商 → 註冊／總部所在國 ISO 3 碼。只列可明確對應者；查不到一律不給值。
const PUBLISHER_COUNTRY = [
  [/\bmdpi\b/i,                                             'CHE'],
  [/frontiers\s+media/i,                                    'CHE'],
  [/\bkarger\b/i,                                           'CHE'],
  [/elsevier|\bnorth-holland\b/i,                           'NLD'],
  [/\bbrill\b|\bios\s+press\b/i,                            'NLD'],
  [/springer\s+nature|springer(?:-|\s)?verlag|\bspringer\b/i,'DEU'],
  [/de\s+gruyter|thieme/i,                                  'DEU'],
  [/nature\s+(?:portfolio|publishing)/i,                    'GBR'],
  // Wiley-VCH 是德國公司（Weinheim），必須排在 Wiley 之前
  [/wiley[-‐-―\s]?vch|\bvch\s+verlag/i,           'DEU'],
  [/\bwiley\b|john\s+wiley/i,                               'USA'],
  [/taylor\s*&?\s*francis|\broutledge\b|informa/i,          'GBR'],
  [/\bsage\b/i,                                             'USA'],
  [/oxford\s+university\s+press/i,                          'GBR'],
  [/cambridge\s+university\s+press/i,                       'GBR'],
  [/\bemerald\b/i,                                          'GBR'],
  [/\bhindawi\b/i,                                          'GBR'],
  [/\bbmj\b|british\s+medical/i,                            'GBR'],
  [/royal\s+society/i,                                      'GBR'],
  [/\biop\s+publishing\b|institute\s+of\s+physics\s+publishing/i, 'GBR'],
  [/\bieee\b|institute\s+of\s+electrical/i,                 'USA'],
  [/association\s+for\s+computing\s+machinery|\bacm\b/i,    'USA'],
  [/\bplos\b|public\s+library\s+of\s+science/i,             'USA'],
  [/american\s+(?:chemical|physical|medical|psychological|mathematical|economic|political)/i, 'USA'],
  [/american\s+institute\s+of\s+physics|\baip\s+publishing\b/i, 'USA'],
  [/\bjstor\b|university\s+of\s+chicago\s+press/i,          'USA'],
  [/\bmit\s+press\b|princeton\s+university\s+press|harvard\s+university\s+press/i, 'USA'],
  [/\bapa\b|\baaas\b|\bnejm\b|massachusetts\s+medical/i,    'USA'],
  [/\bjohns?\s+hopkins\b|duke\s+university\s+press/i,       'USA'],
  [/world\s+scientific/i,                                   'SGP'],
  // 台灣的判斷放在中國之前，避免「China Medical University（台灣的中國醫藥大學）」之類被誤判
  [/\bairiti\b|華藝|國立|中央研究院|academia\s+sinica|\btaiwan\b|台灣|臺灣/i, 'TWN'],
  [/\bj-?stage\b|日本|\bjapan(?:ese)?\b/i,                   'JPN'],
  // 中國大陸：只比對不會與台灣同名的機構／出版社，不比對單獨的 China / Chinese（避免台灣校名誤判）。
  // 刻意不收「Chinese Society of …／Chinese Chemical Society／Chinese Medical Association／Chinese Physical／
  // Chinese Optical」：兩岸有同名學會（例：台北的中國化學會出版 J. Chinese Chemical Society、
  // 中華醫學會出版 JCMA），光看名稱無法分辨 → 不給值，留空由使用者手動選擇。
  [/\bchinese\s+academy\s+of\s+(?:sciences|social\s+sciences|engineering|medical\s+sciences|agricultural\s+sciences)\b|科学出版社|高等教育出版社|\bscience\s+press\b|higher\s+education\s+press/i, 'CHN'],
  [/\bcsiro\b/i,                                            'AUS'],
  [/\bedp\s+sciences\b/i,                                   'FRA'],
];

function publisherCountry(publisher) {
  const p = (publisher || '').trim();
  if (!p) return '';
  for (const [re, iso3] of PUBLISHER_COUNTRY) if (re.test(p)) return iso3;
  return '';
}

// 國碼頂級網域 → ISO 3 碼。只收錄確實代表國家的 ccTLD；
// 刻意排除被當作一般用途的 .io / .co / .me / .tv / .cc / .eu
const CCTLD_TO_ISO3 = {
  tw:'TWN', jp:'JPN', cn:'CHN', kr:'KOR', hk:'HKG', mo:'MAC', sg:'SGP',
  uk:'GBR', de:'DEU', fr:'FRA', nl:'NLD', ch:'CHE', at:'AUT', be:'BEL',
  it:'ITA', es:'ESP', pt:'PRT', se:'SWE', no:'NOR', dk:'DNK', fi:'FIN',
  pl:'POL', cz:'CZE', hu:'HUN', ro:'ROU', gr:'GRC', ie:'IRL', ru:'RUS',
  us:'USA', ca:'CAN', mx:'MEX', br:'BRA', ar:'ARG', cl:'CHL',
  au:'AUS', nz:'NZL', in:'IND', id:'IDN', th:'THA', vn:'VNM', my:'MYS',
  ph:'PHL', tr:'TUR', il:'ISR', za:'ZAF', eg:'EGY', sa:'SAU', ae:'ARE',
};

// 從 OpenAlex source.societies 推導出版國：
// societies 是期刊背後的學會／主辦團體，欄位形如
//   { url: "http://www.cie.org.tw/", organization: "Chinese Institute of Engineers, Taipei, Taiwan, Republic of China" }
// 這是 country_code 為 null 時唯一可靠的線索（例如掛外國發行商的台灣學會期刊）。
// organization 文字裡明確寫出國名 → 高可信；只有 ccTLD → 標記需人工確認。
function societyCountry(societies = []) {
  for (const soc of [].concat(societies || [])) {
    const org = (soc?.organization || '').trim();
    if (org) {
      const parts = org.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      // 由後往前找國名（國名通常在最後，如 "…, Taipei, Taiwan, Republic of China"）
      for (const seg of parts.reverse()) {
        const iso3 = COUNTRY_NAME_TO_ISO3[seg];
        if (iso3) return { iso3, confident: true };
      }
    }
  }
  for (const soc of [].concat(societies || [])) {
    try {
      const host = new URL(soc?.url).hostname.toLowerCase();
      const tld  = host.split('.').pop();
      if (CCTLD_TO_ISO3[tld]) return { iso3: CCTLD_TO_ISO3[tld], confident: false };
    } catch { /* url 缺漏或格式錯誤，跳過 */ }
  }
  return null;
}

// CrossRef publisher-location 常見國名 / 城市 → ISO 3 碼（全小寫 key）
const COUNTRY_NAME_TO_ISO3 = {
  'taiwan': 'TWN', 'taiwan, roc': 'TWN', 'republic of china': 'TWN', '台灣': 'TWN', '臺灣': 'TWN',
  'usa': 'USA', 'u.s.a.': 'USA', 'united states': 'USA', 'united states of america': 'USA', 'us': 'USA',
  'uk': 'GBR', 'u.k.': 'GBR', 'united kingdom': 'GBR', 'england': 'GBR', 'scotland': 'GBR', 'great britain': 'GBR',
  'netherlands': 'NLD', 'the netherlands': 'NLD', 'holland': 'NLD',
  'germany': 'DEU', 'deutschland': 'DEU', 'france': 'FRA', 'switzerland': 'CHE', 'suisse': 'CHE',
  'japan': 'JPN', 'china': 'CHN', "people's republic of china": 'CHN', 'prc': 'CHN',
  'hong kong': 'HKG', 'macau': 'MAC', 'macao': 'MAC',
  'korea': 'KOR', 'south korea': 'KOR', 'republic of korea': 'KOR',
  'singapore': 'SGP', 'australia': 'AUS', 'new zealand': 'NZL', 'canada': 'CAN',
  'italy': 'ITA', 'italia': 'ITA', 'spain': 'ESP', 'españa': 'ESP', 'portugal': 'PRT',
  'belgium': 'BEL', 'austria': 'AUT', 'sweden': 'SWE', 'norway': 'NOR', 'denmark': 'DNK',
  'finland': 'FIN', 'poland': 'POL', 'czech republic': 'CZE', 'czechia': 'CZE',
  'russia': 'RUS', 'russian federation': 'RUS', 'india': 'IND', 'brazil': 'BRA',
  'mexico': 'MEX', 'israel': 'ISR', 'turkey': 'TUR', 'türkiye': 'TUR',
  'ireland': 'IRL', 'greece': 'GRC', 'hungary': 'HUN', 'romania': 'ROU',
  'south africa': 'ZAF', 'egypt': 'EGY', 'thailand': 'THA', 'vietnam': 'VNM',
  'malaysia': 'MYS', 'indonesia': 'IDN', 'philippines': 'PHL', 'saudi arabia': 'SAU',
  'united arab emirates': 'ARE', 'chile': 'CHL', 'argentina': 'ARG', 'colombia': 'COL',
};

// 只收錄不會與其他國家混淆的出版城市
const CITY_TO_ISO3 = {
  'taipei': 'TWN', 'taichung': 'TWN', 'kaohsiung': 'TWN', 'tainan': 'TWN', 'hsinchu': 'TWN',
  '台北': 'TWN', '臺北': 'TWN',
  'new york': 'USA', 'washington': 'USA', 'washington, dc': 'USA', 'boston': 'USA',
  'cambridge, ma': 'USA', 'chicago': 'USA', 'philadelphia': 'USA', 'san francisco': 'USA',
  'los angeles': 'USA', 'thousand oaks': 'USA', 'hoboken': 'USA', 'piscataway': 'USA',
  'london': 'GBR', 'oxford': 'GBR', 'edinburgh': 'GBR', 'bristol': 'GBR', 'abingdon': 'GBR',
  'amsterdam': 'NLD', 'leiden': 'NLD', 'dordrecht': 'NLD', 'rotterdam': 'NLD',
  'berlin': 'DEU', 'heidelberg': 'DEU', 'munich': 'DEU', 'münchen': 'DEU', 'stuttgart': 'DEU',
  'basel': 'CHE', 'zurich': 'CHE', 'zürich': 'CHE', 'geneva': 'CHE', 'lausanne': 'CHE',
  'paris': 'FRA', 'lyon': 'FRA', 'tokyo': 'JPN', 'osaka': 'JPN', 'kyoto': 'JPN',
  'beijing': 'CHN', 'shanghai': 'CHN', 'seoul': 'KOR', 'singapore': 'SGP',
  'vienna': 'AUT', 'wien': 'AUT', 'milan': 'ITA', 'milano': 'ITA', 'rome': 'ITA', 'roma': 'ITA',
  'madrid': 'ESP', 'barcelona': 'ESP', 'copenhagen': 'DNK', 'stockholm': 'SWE', 'oslo': 'NOR',
  'helsinki': 'FIN', 'brussels': 'BEL', 'dublin': 'IRL', 'warsaw': 'POL', 'moscow': 'RUS',
  'toronto': 'CAN', 'montreal': 'CAN', 'ottawa': 'CAN', 'melbourne': 'AUS', 'sydney': 'AUS',
};

function formatCrossrefData(work, doi, openAlex = null, s2 = null, unpaywall = null, inDblp = false, orcidDepts = {}, extraAbstract = '', taiwanJournals = {}, oaSource = null) {
  const d = {};

  // ── CrossRef 欄位（全部有用的直接保留，不逐一挑選）──────
  const pick = (...keys) => keys.forEach(k => { if (work[k] != null) d[k] = work[k]; });
  pick('type', 'title', 'subtitle', 'container-title', 'short-container-title',
       'volume', 'issue', 'page', 'language', 'publisher', 'publisher-location',
       'published-print', 'published-online', 'issued',
       'ISSN', 'ISBN', 'issn-type', 'keyword', 'subject', 'event');

  // CrossRef 的題名／期刊名常帶 HTML 跳脫字元（如 "Business &amp; Economic"），先還原，
  // 否則模型可能原樣照抄進表單
  const unescapeEnt = s => typeof s !== 'string' ? s : s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'").replace(/&amp;/g, '&');
  for (const k of ['title', 'subtitle', 'container-title', 'short-container-title', 'publisher']) {
    if (Array.isArray(d[k])) d[k] = d[k].map(unescapeEnt);
    else if (typeof d[k] === 'string') d[k] = unescapeEnt(d[k]);
  }

  // ISBN：多個時優先取 print（依 isbn-type），否則取第一個，避免 AI 收到陣列
  if (Array.isArray(d.ISBN) && d.ISBN.length > 0) {
    const isbnTypes = work['isbn-type'] || [];
    const printEntry = isbnTypes.find(t => t.type === 'print');
    d.ISBN = printEntry ? printEntry.value : d.ISBN[0];
  }

  // 作者：一律以「文稿上實際印出的單位」為準。
  // 來源優先序：CrossRef affiliation（即文稿 affiliation 區塊原文）
  //           → OpenAlex raw_affiliation_strings（同樣是文稿原文）
  // 不使用 OpenAlex institutions[].display_name（那是正規化後的機構名，非文稿原文）。
  // ORCID Employment 只作為「完全沒有文稿單位」時的備援，存在 orcid-dept，優先序最低。
  if (work.author?.length) {
    d.author = work.author.map((a, i) => {
      const affList = manuscriptAffiliations(a, openAlex?.authorships?.[i]);
      const obj = {
        given:         a.given  || '',
        family:        a.family || '',
        affiliation:   joinManuscriptAffiliations(affList) || undefined,
        corresponding: a.corresponding
                    ?? openAlex?.authorships?.[i]?.is_corresponding
                    ?? undefined
      };
      if (orcidDepts[i]) {
        if (orcidDepts[i].dept) obj['orcid-dept'] = orcidDepts[i].dept;
        if (orcidDepts[i].org)  obj['orcid-org']  = orcidDepts[i].org;
      }
      return obj;
    });
  }
  if (work.editor?.length) {
    d.editor = work.editor.map(e => ({ given: e.given || '', family: e.family || '' }));
  }

  // 作者所屬機構國碼（OpenAlex authorships → 供 trsnat 判斷用）
  const _authorCountries = (openAlex?.authorships || [])
    .flatMap(a => (a.institutions || []).map(inst => (inst.country_code || '').toUpperCase()))
    .filter(Boolean);
  if (_authorCountries.length) d['_author_countries'] = _authorCountries;

  d.DOI = doi;
  if (doi) d['URL'] = `https://doi.org/${doi}`;

  // ── 卷/期/頁補強（CrossRef 無時用 OpenAlex biblio 填補）──
  if (!d.volume  && openAlex?.biblio?.volume)      d.volume = openAlex.biblio.volume;
  if (!d.issue   && openAlex?.biblio?.issue)       d.issue  = openAlex.biblio.issue;
  if (!d.page) {
    const fp = openAlex?.biblio?.first_page, lp = openAlex?.biblio?.last_page;
    if (fp && lp) d.page = `${fp}-${lp}`;
    else if (fp)  d.page = fp;
  }
  // 頁次正規化：破折號統一為半形 "-"，起迄相同（如 MDPI 的文章編號 6173-6173）只留一個數字
  if (d.page) {
    const np = normalizePages(d.page);
    if (np) d.page = np; else delete d.page;
  }

  // ── 摘要補強（CrossRef > OpenAlex > S2）────────────────
  const abstractText = work.abstract?.replace(/<[^>]+>/g, '').trim()
    || (openAlex?.abstract_inverted_index
        ? reconstructAbstract(openAlex.abstract_inverted_index) : '')
    || s2?.abstract || extraAbstract || '';
  if (abstractText) d.abstract = abstractText;

  // ── 關鍵字補強（CrossRef > OpenAlex > S2）──────────────
  const kw = work.keyword?.length ? work.keyword
           : work.subject?.length  ? work.subject
           : openAlex?.keywords?.map(k => k.display_name).filter(Boolean)
          ?? s2?.fieldsOfStudy?.map(f => f.name).filter(Boolean) ?? [];
  if (kw.length) d.keywords = kw.slice(0, 10);

  // ── OpenAlex 補充──────────────────────────────────────
  if (openAlex?.primary_topic?.display_name)
    d['research-topic'] = openAlex.primary_topic.display_name;
  if (openAlexResearchField(openAlex)) d['research-field'] = openAlexResearchField(openAlex);

  // 期刊首頁網址（供 url_addr 欄位使用）
  const journalUrl = openAlex?.primary_location?.source?.homepage_url || '';
  if (journalUrl) d['_journal_url'] = journalUrl;

  // 期刊出版國（OpenAlex source.country_code → ISO 3碼）
  const _iso2to3 = {
    AF:'AFG',AL:'ALB',DZ:'DZA',AD:'AND',AO:'AGO',AR:'ARG',AM:'ARM',AU:'AUS',AT:'AUT',
    AZ:'AZE',BH:'BHR',BD:'BGD',BY:'BLR',BE:'BEL',BZ:'BLZ',BJ:'BEN',BT:'BTN',BO:'BOL',
    BA:'BIH',BW:'BWA',BR:'BRA',BN:'BRN',BG:'BGR',BF:'BFA',BI:'BDI',KH:'KHM',CM:'CMR',
    CA:'CAN',CV:'CPV',CF:'CAF',TD:'TCD',CL:'CHL',CN:'CHN',CO:'COL',CG:'COG',CR:'CRI',
    HR:'HRV',CU:'CUB',CY:'CYP',CZ:'CZE',DK:'DNK',DJ:'DJI',DO:'DOM',EC:'ECU',EG:'EGY',
    SV:'SLV',EE:'EST',ET:'ETH',FJ:'FJI',FI:'FIN',FR:'FRA',GA:'GAB',GE:'GEO',DE:'DEU',
    GH:'GHA',GR:'GRC',GT:'GTM',GN:'GIN',GY:'GUY',HT:'HTI',HN:'HND',HK:'HKG',HU:'HUN',
    IS:'ISL',IN:'IND',ID:'IDN',IR:'IRN',IQ:'IRQ',IE:'IRL',IL:'ISR',IT:'ITA',JM:'JAM',
    JP:'JPN',JO:'JOR',KZ:'KAZ',KE:'KEN',KP:'PRK',KR:'KOR',KW:'KWT',KG:'KGZ',LA:'LAO',
    LV:'LVA',LB:'LBN',LY:'LBY',LI:'LIE',LT:'LTU',LU:'LUX',MK:'MKD',MG:'MDG',MY:'MYS',
    MV:'MDV',ML:'MLI',MT:'MLT',MR:'MRT',MX:'MEX',MD:'MDA',MC:'MCO',MN:'MNG',ME:'MNE',
    MA:'MAR',MZ:'MOZ',MM:'MMR',NA:'NAM',NP:'NPL',NL:'NLD',NZ:'NZL',NI:'NIC',NG:'NGA',
    NO:'NOR',OM:'OMN',PK:'PAK',PA:'PAN',PG:'PNG',PY:'PRY',PE:'PER',PH:'PHL',PL:'POL',
    PT:'PRT',QA:'QAT',RO:'ROU',RU:'RUS',RW:'RWA',SA:'SAU',SN:'SEN',RS:'SRB',SL:'SLE',
    SG:'SGP',SK:'SVK',SI:'SVN',SO:'SOM',ZA:'ZAF',SS:'SSD',ES:'ESP',LK:'LKA',SD:'SDN',
    SR:'SUR',SZ:'SWZ',SE:'SWE',CH:'CHE',SY:'SYR',TW:'TWN',TJ:'TJK',TZ:'TZA',TH:'THA',
    TL:'TLS',TG:'TGO',TT:'TTO',TN:'TUN',TR:'TUR',TM:'TKM',UG:'UGA',UA:'UKR',AE:'ARE',
    GB:'GBR',US:'USA',UY:'URY',UZ:'UZB',VE:'VEN',VN:'VNM',YE:'YEM',ZM:'ZMB',ZW:'ZWE',
    MO:'MAC',PR:'PRI',CD:'COD',CI:'CIV',BS:'BHS',BB:'BRB',GL:'GRL',PS:'PSE',MU:'MUS',
    VA:'VAT',AG:'ATG',GM:'GMB',NE:'NER',SC:'SYC',
  };
  // 判斷順序（全部為確定性來源，查不到就不給值，絕不預設 TWN）：
  //   ① OpenAlex /sources 的 country_code（期刊 ISSN 登記國，書目學上的出版國，最權威）
  //   ② ISSN 命中 Airiti ACI（TSSCI/THCI）清單 → 確定是台灣期刊
  //   ③ CrossRef publisher-location 的國名／城市
  //   ④ 出版商名稱對照表（PUBLISHER_COUNTRY）→ 這層只是「出版商所在國」，
  //      與期刊出版國可能不同（例：中國期刊掛 Elsevier 發行），一律標記為需人工確認
  // 注意：work 內嵌的 primary_location.source 是精簡物件、不含 country_code，
  //      只能靠 oaSource（另打 /sources 端點取得），不可改回讀 primary_location。
  const _cc2 = (oaSource?.country_code || '').toUpperCase();
  let _cc3 = _iso2to3[_cc2] || '';
  let _ccSrc = _cc3 ? 'openalex-issn-country' : '';
  let _ccConfident = !!_cc3;

  // ①b OpenAlex country_code 為 null 時，從 societies（期刊背後的學會）推導。
  //    這是掛外國發行商的台灣學會期刊唯一抓得到的線索（例：中國工程學刊由 T&F 發行）。
  if (!_cc3) {
    const soc = societyCountry(oaSource?.societies);
    if (soc) {
      _cc3 = soc.iso3;
      _ccSrc = soc.confident ? 'openalex-society-name' : 'openalex-society-tld';
      _ccConfident = soc.confident;
    }
  }

  if (!_cc3) {
    const hit = (work.ISSN || []).some(issn => taiwanJournals[issn.replace(/-/g, '')]);
    if (hit) { _cc3 = 'TWN'; _ccSrc = 'taiwan-journal-issn'; _ccConfident = true; }
  }
  if (!_cc3) {
    const loc = (work['publisher-location'] || '').trim();
    if (loc) {
      const tail = loc.split(',').map(s => s.trim()).filter(Boolean).pop() || '';
      const byName = COUNTRY_NAME_TO_ISO3[tail.toLowerCase()] || CITY_TO_ISO3[tail.toLowerCase()] || '';
      if (byName) { _cc3 = byName; _ccSrc = 'crossref-publisher-location'; _ccConfident = true; }
    }
  }
  if (!_cc3) {
    const byPub = publisherCountry(work.publisher);
    // 出版商所在國 ≠ 期刊出版國（例：中國期刊掛 Elsevier 發行），一律要求人工複核
    if (byPub) { _cc3 = byPub; _ccSrc = 'publisher-name'; _ccConfident = false; }
  }

  if (_cc3) {
    d['_journal_country']     = _cc3;
    d['_journal_country_src'] = _ccSrc;
    if (!_ccConfident) d['_journal_country_confirm'] = true;
  }

  // ── 開放取用網址──────────────────────────────────────
  const oaUrl = unpaywall?.best_oa_location?.url_for_pdf
    || unpaywall?.best_oa_location?.url
    || openAlex?.open_access?.oa_url || '';
  if (oaUrl) d['open-access-url'] = oaUrl;

  // ── 期刊收錄資料庫預推導 ─────────────────────────────────
  const indexedIn  = openAlex?.primary_location?.source?.indexed_in || [];
  const publisher  = (work.publisher || '').toLowerCase();
  const knownDbs   = new Set(indexedIn.includes('scopus') ? ['r'] : []);
  if (/\bieee\b/.test(publisher))                                    knownDbs.add('k');
  if (/\bacm\b|association for computing machinery/.test(publisher)) knownDbs.add('i');
  if (inDblp)                                                        knownDbs.add('j');

  // TSSCI / THCI：查靜態清單（以 ISSN 去掉破折號為 key）
  for (const issn of (work.ISSN || [])) {
    const tier = taiwanJournals[issn.replace(/-/g, '')];
    if (tier === 'tssci')      knownDbs.add('e');
    if (tier === 'thci')       knownDbs.add('n');
    if (tier === 'thci_core') { knownDbs.add('n'); knownDbs.add('q'); }
  }

  // WoS 子資料庫（SCIE/SSCI/AHCI）不從主題領域推導，只標記需人工確認。
  // 註：OpenAlex 已改用 source.listed_in，不再提供 indexed_in 的 scopus / web_of_science，
  // 目前這裡與上方 Scopus 判斷實際上都不會觸發；保留以便日後換成可靠來源。
  if (indexedIn.includes('web_of_science')) d['_wos'] = true;

  if (knownDbs.size) d['_known_dbs'] = [...knownDbs];

  // ── 會議欄位預推導（AI 直接使用，不必自行解析 date-parts）
  if (work.event) {
    const ev = work.event;
    const fmtDate = p => p ? `${p[0]}/${String(p[1]||1).padStart(2,'0')}/${String(p[2]||1).padStart(2,'0')}` : '';
    const startP  = ev.start?.['date-parts']?.[0];
    const endP    = ev.end?.['date-parts']?.[0];
    if (ev.name)     d['_conf_nam']     = ev.name;
    if (startP) {
      d['_conf_dt'] = endP ? `${fmtDate(startP)}-${fmtDate(endP)}` : fmtDate(startP);
    }
    if (ev.location) {
      const parts = ev.location.split(',').map(s => s.trim()).filter(Boolean);
      let city = parts[0] || '', country = parts.length > 1 ? parts[parts.length - 1] : '';
      // 沒有逗號時（如 ACM 的 "Barcelona Spain"），從尾端比對國名清單拆出國家
      if (parts.length === 1) {
        const words = city.split(/\s+/);
        for (let k = Math.min(3, words.length - 1); k >= 1; k--) {
          const tail = words.slice(-k).join(' ');
          if (COUNTRY_NAME_TO_ISO3[tail.toLowerCase()]) { country = tail; city = words.slice(0, -k).join(' '); break; }
        }
      }
      d['_conf_city']    = city;
      if (country) d['_conf_country'] = country;
    }
    if (work.publisher) d['_conf_host'] = work.publisher;
  }
  // CrossRef 沒有 event、但 assertion 有 ConferenceInfo（Springer 論文集）→ 用它補會議欄位
  const _ci = crossrefConferenceInfo(work);
  if (_ci) {
    if (!d['_conf_nam']     && _ci.name)    d['_conf_nam']     = _ci.name;
    if (!d['_conf_dt']      && _ci.dt)      d['_conf_dt']      = _ci.dt;
    if (!d['_conf_city']    && _ci.city)    d['_conf_city']    = _ci.city;
    if (!d['_conf_country'] && _ci.country) d['_conf_country'] = _ci.country;
  }
  // 會議論文判斷：CrossRef event、ConferenceInfo、OpenAlex type 任一指出是會議論文 →
  // 把 type 改成 conference-paper 讓 AI 依規則①判為 04，並由程式在 AI 回傳後確保類別為 04
  const _confBy = work.event ? 'crossref-event' : _ci ? 'crossref-conference-info'
                : openAlex?.type === 'conference-paper' ? 'openalex-type' : '';
  if (_confBy) {
    if (d.type && d.type !== 'proceedings-article' && d.type !== 'conference-paper') d['crossref-type'] = d.type;
    d.type = 'conference-paper';
    d['_is_conference'] = _confBy;
  }

  // DOI 路徑永遠補 URL（供 url_addr 使用）
  if (doi) d['URL'] = `https://doi.org/${doi}`;

  // 空陣列欄位不傳（避免干擾 AI）
  for (const k of Object.keys(d)) {
    if (Array.isArray(d[k]) && d[k].length === 0) delete d[k];
  }

  return JSON.stringify(d, null, 2);
}

// 出版商 HTML 頁面抓 DOI + 摘要（用於檔案匯入無 DOI、以及 CrossRef 無摘要等備援情境）
// 資料庫平台（需要機構登入，抓不到有意義的 meta tag）
const DB_SKIP_HOSTS = [
  'ebsco.com', 'research.ebsco.com',
  'proquest.com', 'jstor.org',
  'webofscience.com', 'clarivate.com',
  'scopus.com', 'elsevier.com/locate',
  'search.proquest.com',
];

async function fetchMetaFromHtml(url, _depth = 0, _returnHtml = false) {
  if (_depth > 3) return { doi: '', abstract: '' };  // 防無限遞迴
  try {
    const host = new URL(url).hostname;
    if (DB_SKIP_HOSTS.some(h => host === h || host.endsWith('.' + h))) {
      return { doi: '', abstract: '' };
    }
    const res = await fetch(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      },
      redirect: 'follow',
      credentials: 'include',
    });
    if (!res.ok) return { doi: '', abstract: '' };
    const html = await res.text();

    // 偵測 JavaScript redirect shell（linkinghub.elsevier.com 等短頁面）
    if (html.length < 8000) {
      const finalHost = (() => { try { return new URL(res.url).hostname; } catch { return ''; } })();
      let redirectUrl = '';

      // linkinghub.elsevier.com/retrieve/pii/{PII} → sciencedirect.com 直接構造
      if (finalHost === 'linkinghub.elsevier.com') {
        const piiM = res.url.match(/\/retrieve\/pii\/([A-Z0-9]+)/i);
        if (piiM) redirectUrl = `https://www.sciencedirect.com/science/article/pii/${piiM[1]}`;
      }

      // meta http-equiv refresh
      if (!redirectUrl) {
        const metaM = html.match(/<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^;]*;\s*url=([^\s"'&>]+)/i)
                   || html.match(/content=["'][^;]*;\s*url=([^\s"'&>]+)[^"']*["'][^>]+http-equiv=["']refresh["']/i);
        if (metaM) redirectUrl = metaM[1];
      }

      // 任意 JS redirect 模式
      if (!redirectUrl) {
        const jsM = html.match(/(?:window\.)?location(?:\.href|\.replace\s*\()?\s*[=(]\s*["']([^"']{15,})["']/i);
        if (jsM) redirectUrl = jsM[1];
      }

      // <link rel="canonical"> 指向真實 URL
      if (!redirectUrl) {
        const canonM = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
        if (canonM && canonM[1] !== res.url) redirectUrl = canonM[1];
      }

      if (redirectUrl) {
        try {
          const absUrl = new URL(redirectUrl, res.url).href;
          const absHost = new URL(absUrl).hostname;
          if (!DB_SKIP_HOSTS.some(h => absHost === h || absHost.endsWith('.' + h))) {
            return fetchMetaFromHtml(absUrl, _depth + 1, _returnHtml);
          }
        } catch {}
      }
    }

    // 通用 meta 抓取（minLen 控制最短字元數，避免抓到無意義短字串）
    // 雙引號與單引號分開處理，避免摘要中的 apostrophe 提前截斷
    const getMeta = (minLen, ...names) => {
      for (const name of names) {
        for (const q of ['"', "'"]) {
          const re1 = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=${q}([^${q}]{${minLen},})${q}`, 'i');
          const re2 = new RegExp(`<meta[^>]+content=${q}([^${q}]{${minLen},})${q}[^>]+(?:name|property)=["']${name}["']`, 'i');
          const m = html.match(re1) || html.match(re2);
          if (m?.[1]) return m[1].trim()
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'");
        }
      }
      return '';
    };

    // DOI：citation_doi / DC.identifier / prism.doi（最短 7 字元 = "10.x/y"）
    const rawDoi = getMeta(7, 'citation_doi', 'DC.identifier', 'dc.identifier', 'prism.doi');
    const doi = rawDoi.replace(/^https?:\/\/doi\.org\//i, '').match(/10\.\d{4,}\/\S+/)?.[0] || '';

    // 摘要 Level 1：標準 meta tag（最短 50 字元）
    // citation_abstract / DC.description 優先；og:description / description 常被截斷（SEO 用），放後面
    let abstract = getMeta(50, 'citation_abstract', 'DC.description', 'dc.description', 'og:description', 'description');
    const _level1Truncated = /[.…]{3}\s*$/.test(abstract); // og:description 截斷標記

    // Level 1 後處理：若為 Highlights 開頭，嘗試截取 "Abstract" 後半；若無則清空讓後續 Level 嘗試
    if (abstract && /^highlights?\b/i.test(abstract)) {
      const realAbs = abstract.match(/\bAbstract\b\s*([\s\S]{50,})/i)?.[1]?.trim();
      abstract = realAbs || '';
    }
    // AH 平台樣板（非論著摘要）：過濾掉
    if (/NCCU\s+Academic\s+Hub|academic\s+output\s+collection|政大學術集成/i.test(abstract)) abstract = '';
    // Level 1 截斷（以 ... 結尾）：繼續往下找完整版，找到才取代
    if (_level1Truncated) abstract = '';

    // 摘要 Level 2a：class/id 含 "abstract(s)" 的元素（跳過含 "highlight" 的元素）
    if (!abstract) {
      const bodyRe = /<(div|section|p)([^>]*)>([\s\S]{50,4000}?)<\/(?:div|section|p)>/gi;
      for (const m of html.matchAll(bodyRe)) {
        const attrs = m[2];
        if (!/(?:class|id)=["'][^"']*\b(?:abstracts?|abstract-content|abstract-text|摘要)\b/i.test(attrs)) continue;
        if (/(?:class|id)=["'][^"']*\bhighlights?\b/i.test(attrs)) continue;
        const stripped = m[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (stripped.length >= 50 && !/^highlights?\b/i.test(stripped)) {
          abstract = stripped;
          break;
        }
      }
    }

    // 摘要 Level 2b：找 "Abstract / 摘要 / 要旨" 標題後的內文
    if (!abstract) {
      const headingMatch = html.match(
        /<(?:h[1-6]|strong|b)[^>]*>\s*(?:Abstract|摘要|要旨)\s*<\/(?:h[1-6]|strong|b)>\s*([\s\S]{50,4000}?)(?=<h[1-6][\s>]|<section[\s>]|<\/article|<footer[\s>])/i
      );
      if (headingMatch) {
        const stripped = headingMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (stripped.length >= 50) abstract = stripped;
      }
    }

    // 摘要 Level 3：__NEXT_DATA__ JSON（ScienceDirect / Next.js 應用程式）
    if (!abstract) {
      const ndMatch = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]+?)<\/script>/i);
      if (ndMatch) {
        try {
          const nd = JSON.parse(ndMatch[1]);
          const findA = (o, depth = 0) => {
            if (depth > 12 || !o || typeof o !== 'object') return '';
            for (const k of ['abstract', 'abstractText', 'abstract_text', 'abstracts', 'content']) {
              if (typeof o[k] === 'string' && o[k].length >= 50) return o[k];
              if (k === 'abstracts' && typeof o[k] === 'object') {
                for (const v of Object.values(o[k])) {
                  if (typeof v?.content === 'string' && v.content.length >= 50) return v.content;
                  if (typeof v === 'string' && v.length >= 50) return v;
                }
              }
            }
            for (const v of Object.values(o)) {
              if (typeof v === 'object') {
                const found = findA(v, depth + 1);
                if (found) return found;
              }
            }
            return '';
          };
          const ja = findA(nd);
          if (ja) abstract = ja;
        } catch {}
      }
    }

    // 摘要 Level 4：其他嵌入 JSON（如 application/ld+json schema.org）
    if (!abstract) {
      const ldMatches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]+?)<\/script>/gi)];
      for (const m of ldMatches) {
        try {
          const ld = JSON.parse(m[1]);
          const desc = ld.description || ld.abstract;
          if (typeof desc === 'string' && desc.length >= 50) { abstract = desc; break; }
        } catch {}
      }
    }

    // HTML entity decode & HTML tag strip for all sources
    if (abstract) {
      abstract = abstract
        .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
        .replace(/^(?:Abstract|摘要|要旨)\s*/i, '')  // 去掉 div 內標題留下的前綴
        .trim();
    }

    return { doi, abstract, ...(_returnHtml ? { _html: html } : {}) };
  } catch {
    return { doi: '', abstract: '' };
  }
}

// 包裝：只取摘要（供 CrossRef 無摘要備援路徑使用）
async function fetchAbstractFromHtml(url) {
  const { abstract } = await fetchMetaFromHtml(url);
  return abstract;
}

// DOI 備援查詢：CSL-JSON 內容協商 → HTML meta tag 解析
async function fetchDoiCsl(doi) {
  try {
    // 1. 試 CSL-JSON（CrossRef / DataCite 支援的 DOI）
    const cslRes = await fetch('https://doi.org/' + doiEncode(doi), {
      headers: { Accept: 'application/vnd.citationstyles.csl+json' },
      redirect: 'follow'
    });
    if (cslRes.ok) {
      const ct = cslRes.headers.get('content-type') || '';
      if (ct.includes('json') || ct.includes('csl')) return await cslRes.json();
      // 回傳 HTML（Airiti 等台灣資料庫）→ 解析 meta tag
      const html = await cslRes.text();
      return parseHtmlMeta(html) || null;
    }
    return null;
  } catch { return null; }
}

// DOI → 跟隨 HTML 重定向抓頁面 meta tag（CSL JSON 欄位不完整時補強）
async function fetchDoiHtmlMeta(doi) {
  try {
    const res = await fetch('https://doi.org/' + doiEncode(doi), {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
      },
      redirect: 'follow'
    });
    const ct = res.headers.get('content-type') || '';
    if (!res.ok) return null;
    if (!ct.includes('html')) return null;
    const html = await res.text();
    const meta = parseHtmlMeta(html);
    if (!meta) return null;
    return { ...meta, _pageUrl: res.url };
  } catch {
    return null;
  }
}

// 從 HTML 文字用 regex 解析 DC/OG/Highwire meta tag
function parseHtmlMeta(html) {
  const getMeta = (names) => {
    for (const name of [].concat(names)) {
      for (const q of ['"', "'"]) {
        const m = html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=${q}([^${q}]+)${q}`, 'i'))
               || html.match(new RegExp(`<meta[^>]+content=${q}([^${q}]+)${q}[^>]+(?:name|property)=["']${name}["']`, 'i'));
        if (m?.[1]) return m[1].trim();
      }
    }
    return '';
  };
  const getMetas = (name) => {
    const results = [];
    for (const q of ['"', "'"]) {
      const re = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=${q}([^${q}]+)${q}`, 'gi');
      let m;
      while ((m = re.exec(html)) !== null) results.push(m[1].trim());
      if (results.length) break;
    }
    return results;
  };

  // 優先讀學術 meta tag（citation_title / DC.title），og:title 僅作最後備援
  const title = getMeta(['citation_title','DC.title','dc.title'])
             || (/cookie/i.test(getMeta(['og:title'])) ? '' : getMeta(['og:title']));
  if (!title) return null;

  const journal = getMeta(['citation_journal_title','DC.source','dc.source','og:site_name']);
  // 日期：完整解析 年/月/日
  const dateStr  = getMeta(['citation_date', 'citation_online_date', 'DC.date', 'dc.date']) || '';
  const dateM    = dateStr.match(/(\d{4})[\/\-](\d{1,2})(?:[\/\-](\d{1,2}))?/) || dateStr.match(/(\d{4})/);
  const year     = dateM?.[1] || '';
  const month    = dateM?.[2] ? +dateM[2] : null;
  const day      = dateM?.[3] ? +dateM[3] : null;
  const dateParts = year ? [[+year, ...(month ? [month, ...(day ? [day] : [])] : [])]] : [];

  const authors  = getMetas('citation_author').concat(getMetas('DC.creator')).concat(getMetas('dc.creator'));
  // 摘要：citation_abstract 優先（Airiti 裡最完整），og:description 作備援
  const abstract = getMeta(['citation_abstract', 'DC.description', 'dc.description', 'og:description', 'description']);
  const volume   = getMeta('citation_volume');
  const issue    = getMeta('citation_issue');
  const page     = [getMeta('citation_firstpage'), getMeta('citation_lastpage')].filter(Boolean).join('-');
  const lang     = getMeta(['DC.language', 'dc.language', 'citation_language']);

  // ISSN（citation_issn 或 DC.identifier）
  const issnRaw  = getMeta(['citation_issn', 'prism.issn']);
  const issns    = issnRaw ? [issnRaw] : [];

  // 出版商
  const publisher = getMeta(['citation_publisher', 'DC.publisher', 'dc.publisher']);

  // 關鍵字：以 ; ； ｜ | 分隔，各段不超過 50 字元
  const kwRaw    = getMeta(['citation_keywords', 'DC.subject', 'dc.subject', 'keywords']);
  const keywords = kwRaw
    ? kwRaw.split(/[;；｜|]/).map(k => k.trim()).filter(k => k.length > 0 && k.length <= 50)
    : [];

  const dp = {
    title, 'container-title': [journal],
    issued: { 'date-parts': dateParts },
    author: authors.map(n => { const p = n.split(/[,，]/); return { family: p[0]?.trim(), given: p[1]?.trim() || '' }; }),
    abstract, volume, issue, page, language: lang, type: 'article-journal',
    ...(issns.length    ? { ISSN: issns }       : {}),
    ...(publisher       ? { publisher }           : {}),
    ...(keywords.length ? { keywords }            : {}),
  };
  return dp;
}
