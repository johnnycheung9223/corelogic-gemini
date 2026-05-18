// Gemini + Perplexity + DeepSeek Unified Proxy — v11.0
// 修復：還原 gemini-2.5-flash，三個 AI 完全並行（唔再串行）
// POST / with {"issue": "..."} → returns {gemini, perplexity, deepseek}

const PROJECT_ID = "gemini-worker-496408";
const MODEL = "gemini-2.5-flash";
const GEMINI_URL = `https://aiplatform.googleapis.com/v1beta1/projects/${PROJECT_ID}/locations/global/publishers/google/models/${MODEL}:generateContent`;
const PERPLEXITY_URL = "https://api.perplexity.ai/chat/completions";
const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

async function callGemini(issue, apiKey) {
  const body = {
    contents: [{
      role: "user",
      parts: [{ text: `你係 CoreLogic AI 產品策略董事。請用繁體中文提供3個策略建議（每個含行動步驟+成功指標）。\n\n議題：${issue}` }]
    }]
  };
  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || JSON.stringify(data);
}

async function callPerplexity(issue, apiKey) {
  const body = {
    model: "sonar",
    messages: [
      { role: "system", content: "你係 CoreLogic AI 技術情報董事。收集 BLE IMU、MediaPipe、Sensor Fusion 技術資訊。用繁體中文。" },
      { role: "user", content: `議題：${issue}` }
    ]
  };
  const res = await fetch(PERPLEXITY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || JSON.stringify(data);
}

async function callDeepSeek(issue, apiKey) {
  // v11: DeepSeek 唔再等 Gemini，直接並行處理議題
  const body = {
    model: "deepseek-chat",
    messages: [
      { role: "system", content: "你係 CoreLogic AI 數據審計董事。核心原則：沒有精確時間同步與高質量 raw signal，再強的 AI 模型都沒有意義。用繁體中文。" },
      { role: "user", content: `議題：${issue}\n\n請指出：1)三大風險 2)策略盲點 3)改善建議` }
    ]
  };
  const res = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || JSON.stringify(data);
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (request.method === "GET") {
      return Response.json({ status: "ok", version: "11.0.0" }, { headers: CORS });
    }

    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405, headers: CORS });
    }

    try {
      const incoming = await request.json();
      const issue = incoming.issue || incoming.text || "請分析此議題";

      // 三個 AI 完全並行，最慢那個決定總時間
      const [geminiText, perplexityText, deepseekText] = await Promise.all([
        callGemini(issue, env.GEMINI_API_KEY).catch(e => `[Gemini 錯誤] ${e.message}`),
        callPerplexity(issue, env.PERPLEXITY_API_KEY).catch(e => `[Perplexity 錯誤] ${e.message}`),
        callDeepSeek(issue, env.DEEPSEEK_API_KEY).catch(e => `[DeepSeek 錯誤] ${e.message}`),
      ]);

      return Response.json({
        issue,
        gemini: geminiText,
        perplexity: perplexityText,
        deepseek: deepseekText,
      }, { headers: CORS });

    } catch (err) {
      return Response.json({ error: err.message }, { status: 500, headers: CORS });
    }
  }
};
