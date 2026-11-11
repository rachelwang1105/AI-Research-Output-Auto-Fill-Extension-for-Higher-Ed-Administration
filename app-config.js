// app-config.js
// 全專案唯一的設定來源。切換 AI 服務／模型只改這個檔案，程式內不得再出現寫死的端點或模型字串。
// ⚠️ 不要把 API key 寫在這裡（此檔會進版控）。API key 由使用者在側邊面板的「AI 設定」輸入，
//    存放於 chrome.storage.local 的 aiApiKey。

export const CONFIG = {
  ai: {
    // OpenAI 相容的 chat completions 端點
    endpoint: 'https://www.myai168.com/tw/api/openai/v1/chat/completions',
    model: 'gpt-5.4-nano',
    // 以下參數為 null 時不會送出（部分模型不接受 temperature 等參數）
    maxCompletionTokens: 4000,
    temperature: null,
    topP: null,
    // 存放 API key 的 chrome.storage.local 欄位名稱
    apiKeyStorageKey: 'aiApiKey',
  },

  affiliation: {
    // true 時，才會把英文系所名轉成政大中文系所簡稱（例如 Department of Computer Science → 資科系），
    // 且只套用在 affiliation 文字本身含「政治大學 / National Chengchi University / NCCU」的作者。
    // 預設 false：一律以文稿上實際印出的單位為準，不翻譯、不縮寫。
    nccuDeptAbbrev: false,
  },

  journalCountry: {
    // 查不到出版國時是否允許 AI 自行推測。永遠保持 false：查不到就留空，交由使用者手動選擇。
    allowAiGuess: false,
  },
};

export default CONFIG;
