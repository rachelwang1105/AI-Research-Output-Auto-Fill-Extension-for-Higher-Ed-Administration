# NCCU 論著助手

政治大學論著目錄系統的 Chrome 側欄擴充功能。輸入 DOI、網址、書目文字或匯入引用格式檔，AI 自動解析欄位並填入線上表單。

---

## 安裝

### 1. 取得程式碼

```bash
git clone https://github.com/rachelwang1105/AI-Research-Output-Auto-Fill-Extension-for-Higher-Ed-Administration.git
cd AI-Research-Output-Auto-Fill-Extension-for-Higher-Ed-Administration
```

### 2. 建立 API 金鑰設定檔

將 `config.example.js` 複製為 `config.js`，填入實際的 API 金鑰：

```bash
cp config.example.js config.js
```

開啟 `config.js`，將 `YOUR_API_KEY_HERE` 換成實際金鑰後存檔（此檔案已列入 `.gitignore`，不會上傳至 GitHub）。

### 3. 載入至 Chrome

1. 開啟 Chrome，網址列輸入 `chrome://extensions`
2. 右上角開啟「**開發人員模式**」
3. 點選「**載入未封裝項目**」，選取整個專案資料夾
4. 擴充功能列出現「NCCU 論著助手」即表示安裝成功

---

## 初始設定：員工編號與 ORCID

首次使用前，建議先設定個人識別資訊，讓系統在所有著作中自動標記本人並套用系所。

1. 點選 Chrome 工具列的論著助手圖示，開啟側欄
2. 切換至「**著作佇列**」分頁
3. 點選「**從政大系統自動帶入員編與 ORCID**」（需已登入政大網頁）
   - 或手動輸入員工編號後按「查 ORCID」
4. 確認下方顯示正確的 ORCID 後按「**儲存**」

---

## 使用流程

論著助手以**側欄**形式運作，與論著系統填表頁面並排顯示。操作步驟共四個階段：

```
擷取 → AI 清洗 → 填入 → 確認
```

### 步驟一：開啟論著系統並啟動側欄

1. 登入政大論著系統，進入新增論著的頁面
2. 點選 Chrome 工具列的論著助手圖示，在右側展開側欄
3. 狀態列顯示「**已偵測到論著系統**」即可開始使用

### 步驟二：輸入論文資料（三種方式）

#### 方式 A：DOI / 網址

在「DOI / 網址」欄位貼上以下任一格式：

| 格式 | 範例 |
|------|------|
| DOI | `10.1016/j.xxx.2024.01.001` |
| DOI 完整網址 | `https://doi.org/10.xxxx/xxxxx` |
| PMID | `PMID:12345678` 或 `12345678` |
| arXiv ID | `2301.00001` 或 `arXiv:2301.00001` |
| ISBN | `978-3-16-148410-0` |
| 學術頁面網址 | 期刊或機構典藏的論文網頁 |

按 Enter 或「**加入佇列**」，系統自動從 CrossRef、OpenAlex、Semantic Scholar 等來源抓取書目。

#### 方式 B：文字 / 引用格式

切換至「文字 / 檔案」分頁，直接貼上引用文字（支援 APA、BibTeX、RIS、純文字）或匯入 `.ris` / `.bib` / `.enw` 檔案，可一次匯入多筆。

#### 方式 C：從 ORCID 自動偵測

切換至「著作佇列」分頁，按「**立即檢查著作**」，系統比對 ORCID 紀錄與論著系統現有資料，自動列出尚未建檔的論著，勾選後按「**匯入選取論著**」批次加入佇列。

### 步驟三：確認書目

擷取完成後，側欄顯示書目摘要（標題、作者、期刊、年份）供確認。確認正確後按「**確認，AI 欄位對應並填入**」。若有誤可按「重新輸入」。

### 步驟四：填入表單

AI 解析完成後，預覽區顯示各欄位對應結果。按「**填入表單**」，擴充功能自動將資料寫入目前的論著系統頁面。

- 若為**多位作者**，填完第一層後系統會自動跳至第二層繼續填入作者資料
- 若佇列還有下一篇，填完後按「**繼續處理下一篇**」

---

## 資料來源說明

| 識別碼 | 查詢來源 |
|--------|----------|
| DOI | CrossRef → OpenAlex → Semantic Scholar → Unpaywall |
| PMID | PubMed Central |
| arXiv | arXiv API |
| ISBN | Open Library → CrossRef |
| 網址 | 頁面 HTML meta tag（支援 AH 機構典藏、Airiti、各大期刊網站） |
| 純文字 / 引用格式 | GPT 直接解析（無外部查詢） |

---

## 常見問題

**Q：按下圖示後沒有出現側欄？**
A：Chrome 側欄需手動開啟。點選圖示後，若未彈出側欄，請在擴充功能圖示上按右鍵 → 選「開啟側面板」。

**Q：抓到的摘要是空的？**
A：部分付費期刊或機構典藏的 HTML 結構較特殊，摘要仍需手動補填。

**Q：系所顯示英文而非中文？**
A：若 CrossRef 資料僅有英文系所名，系統會自動對照政大系所名稱翻成中文縮寫。若仍顯示英文，表示該系所名稱尚未收錄，請手動修改。

**Q：如何更新 CSV 中的人員資料？**
A：更新 `e-personid.csv` 後，在專案根目錄執行：
```bash
node scripts/build-scholar-lookup.js
```
重新產生 `data/scholar_lookup.json`，再重新載入擴充功能。

---

## 檔案結構

```
.
├── background.js          # Service Worker：API 查詢、AI 呼叫、資料整合
├── content_script.js      # 注入論著系統頁面：自動填表
├── popup/
│   ├── popup.html         # 側欄 UI
│   └── popup.js           # 側欄邏輯
├── data/
│   ├── scholar_lookup.json    # 員工編號 → ORCID / 中文系所對照
│   ├── taiwan_journals.json   # 台灣期刊資料庫（TSSCI / THCI 等）
│   └── employee_orcid.json    # 員工 ORCID 補充對應
├── config.js              # API 金鑰（本地，不上傳）
├── config.example.js      # 金鑰設定範本
└── manifest.json          # 擴充功能描述（MV3）
```
