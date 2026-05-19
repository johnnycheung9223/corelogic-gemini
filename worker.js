// Perplexity + DeepSeek Unified Proxy — v14.0
// Gemini 移除（香港地區限制）
// POST / with {"issue": "..."} → returns {perplexity, deepseek, gemini}

const PERPLEXITY_URL = "https://api.perplexity.ai/chat/completions";
const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

async function callPerplexity(issue, apiKey) {
  const body = {
    model: "sonar",
    messages: [
      { role: "system", content: "你係 CoreLogic AI 技術情報董事。專門收集 BLE IMU、MediaPipe、Sensor Fusion 最新技術資訊。用繁體中文回應。" },
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
  const body = {
    model: "deepseek-chat",
    messages: [
      { role: "system", content: "你係 CoreLogic AI 數據審計董事。核心原則係「沒有精確時間同步與高質量 raw signal，再強的 AI 模型都沒有意義」。審查所有技術方案，用繁體中文。" },
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
      return Response.json({ status: "ok", version: "15.0.0" }, { headers: CORS });
    }
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405, headers: CORS });
    }
    try {
      const incoming = await request.json();
      const issue = incoming.issue || incoming.text || "請分析此議題";

      const [perplexityText, deepseekText] = await Promise.all([
        callPerplexity(issue, env.PERPLEXITY_API_KEY).catch(e => `[Perplexity 錯誤] ${e.message}`),
        callDeepSeek(issue, env.DEEPSEEK_API_KEY).catch(e => `[DeepSeek 錯誤] ${e.message}`),
      ]);

      return Response.json({
        issue,
        gemini: "（Gemini 香港地區不支援）",
        perplexity: perplexityText.substring(0, 1800),
        deepseek: deepseekText.substring(0, 1800),
      }, { headers: CORS });

    } catch (err) {
      return Response.json({ error: err.message }, { status: 500, headers: CORS });
    }
  }
};
