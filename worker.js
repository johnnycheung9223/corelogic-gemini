// Gemini + Perplexity + DeepSeek Unified Proxy — v10.0
// 修復：改用 gemini-2.0-flash + 縮短 prompt，確保 35 秒內完成
// POST / with {"issue": "..."} → returns {gemini, perplexity, deepseek}

const PROJECT_ID = "gemini-worker-496408";
const MODEL = "gemini-2.0-flash";
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

async function callDeepSeek(issue, geminiOutput, apiKey) {
  const body = {
    model: "deepseek-chat",
    messages: [
      { role: "system", content: "你係 CoreLogic AI 數據審計董事。用繁體中文指出風險同改善建議。" },
      { role: "user", content: `議題：${issue}\n\n策略建議摘要：${geminiOutput.substring(0, 300)}\n\n請指出：1)三大風險 2)改善建議` }
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
      return Response.json({ status: "ok", version: "10.0.0" }, { headers: CORS });
    }

    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405, headers: CORS });
    }

    try {
      const incoming = await request.json();
      const issue = incoming.issue || incoming.text || "請分析此議題";

      // 並行呼叫 Gemini 同 Perplexity
      const [geminiText, perplexityText] = await Promise.all([
        callGemini(issue, env.GEMINI_API_KEY).catch(e => `[Gemini 錯誤] ${e.message}`),
        callPerplexity(issue, env.PERPLEXITY_API_KEY).catch(e => `[Perplexity 錯誤] ${e.message}`),
      ]);

      // DeepSeek 參考 Gemini 輸出
      const deepseekText = await callDeepSeek(issue, geminiText, env.DEEPSEEK_API_KEY)
        .catch(e => `[DeepSeek 錯誤] ${e.message}`);

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
