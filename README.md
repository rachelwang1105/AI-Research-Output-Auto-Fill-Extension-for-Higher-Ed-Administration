# NCCU 論著助手

政治大學論著目錄系統的 Chrome 側欄擴充功能。輸入 DOI、網址、書目文字或匯入引用格式檔，AI 自動解析欄位並填入線上表單。

---

## 安裝

### 1. 取得程式碼

```bash
git clone https://github.com/rachelwang1105/AI-Research-Output-Auto-Fill-Extension-for-Higher-Ed-Administration.git
cd AI-Research-Output-Auto-Fill-Extension-for-Higher-Ed-Administration
```

### 2. 載入後設定 API 金鑰

本專案不在程式碼或設定檔中存放金鑰。載入擴充功能後（見下一步），
在側欄「著作佇列」分頁的「**AI 設定**」輸入 AI API Key 並按「儲存」即可；
金鑰只存在使用者自己的瀏覽器（`chrome.storage.local`），不會進版控。

AI 端點、模型與參數集中在 `app-config.js` 的 `CONFIG.ai`，要換服務或換模型只改這個檔案。

### 3. 載入至 Chrome

1. 開啟 Chrome，網址列輸入 `chrome://extensions`
2. 右上角開啟「**開發人員模式**」
3. 點選「**載入未封裝項目**」，選取整個專案資料夾
4. 擴充功能列出現「NCCU 論著助手」即表示安裝成功

---

## 初始設定：ORCID 與 AH 學者頁

首次使用前先設定個人識別資訊，讓系統追蹤你的新著作並比對 AH 既有建檔。**只需設定一次。**

1. 點選 Chrome 工具列的論著助手圖示，開啟側欄
2. 切換至「**著作佇列**」分頁
3. 在「**我的身分設定**」填入兩項：
   - **我的 ORCID**：格式 `0000-0000-0000-000X`（程式會驗證格式與最後一碼檢核碼）
   - **我的 AH 學者頁網址**：在 AH（`ah.lib.nccu.edu.tw`）搜尋自己的名字，
     進入個人學者頁後直接複製瀏覽器網址列的網址，例如
     `https://ah.lib.nccu.edu.tw/scholar?id=12398&title=items&subtitle=all`
     （程式只接受網域 `ah.lib.nccu.edu.tw`、路徑 `/scholar`、且 `id` 為純數字的網址）
4. 按「**驗證並顯示解析結果**」，畫面會顯示從 ORCID 公開資料與 AH 學者頁讀到的姓名，
   確認是本人資料後再按「**確認是我，儲存**」
5. 之後開啟擴充功能會自動讀取，可隨時用「修改」／「清除」調整

> 本擴充功能不再內建任何員工編號／姓名／ORCID 對照表，也不會從校務系統讀取登入者員編。

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

切換至「文字 / 檔案」分頁：

- **引用文字**：直接貼上引用文字（支援 APA、BibTeX、RIS、純文字），AI 直接解析。
- **引用格式檔**：匯入 `.ris` / `.bib` / `.enw` 檔案，可一次匯入多筆。
- **PDF 檔案**：匯入 `.pdf`，系統依序執行三層書目擷取（二進制 DOI 掃描 → metadata 擷取 → PDF.js 首兩頁文字擷取），有 DOI 則轉 CrossRef 完整查詢，否則將文字送 AI 解析。

#### 方式 C：從 ORCID 自動偵測

切換至「著作佇列」分頁，按「**立即檢查著作**」，系統每次均重新比對全部 ORCID 著作與論著系統現有資料，自動列出尚未建檔的論著，勾選後按「**匯入選取論著**」批次加入佇列。

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
| DOI | CrossRef（主）→ DataCite（備援）；並行查詢 OpenAlex、Semantic Scholar、Unpaywall |
| PMID | PubMed Central |
| arXiv | arXiv API |
| ISBN | Open Library → CrossRef |
| 網址 | 頁面 HTML meta tag（支援 AH 機構典藏、Airiti、各大期刊網站） |
| PDF | 三層遞進：二進制 DOI 掃描 → metadata 擷取 → PDF.js 首兩頁文字擷取（含亂碼偵測） |
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
A：本擴充功能已移除所有員編／姓名／ORCID 對照表（個資考量）。
請在側欄「我的身分設定」自行輸入 ORCID 與 AH 學者頁網址。

---

## 檔案結構

```
.
├── background.js          # Service Worker：API 查詢、AI 呼叫、資料整合
├── content_script.js      # 注入論著系統頁面：自動填表
├── popup/
│   ├── popup.html         # 側欄 UI
│   └── popup.js           # 側欄邏輯（含 PDF.js Layer 3 執行）
├── lib/
│   ├── pdf.mjs            # PDF.js 主程式
│   └── pdf.worker.mjs     # PDF.js Worker
├── data/
│   └── taiwan_journals.json   # 台灣期刊資料庫（TSSCI / THCI 等）
├── app-config.js          # CONFIG：AI 端點／模型／參數與行為開關
└── manifest.json          # 擴充功能描述（MV3）
```
