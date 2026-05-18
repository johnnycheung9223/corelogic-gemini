// Gemini + Perplexity + DeepSeek Unified Proxy — v9.0
// 修復：每個 AI 呼叫加入 25 秒 timeout，確保 Make.com 40 秒限制內完成
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

// 每個 AI 呼叫限時 25 秒
function withTimeout(promise, ms, name) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`${name} timeout after ${ms}ms`)), ms)
  );
  return Promise.race([promise, timeout]);
}

async function callGemini(issue, apiKey) {
  const body = {
    contents: [{
      role: "user",
      parts: [{ text: `你係 CoreLogic AI 產品策略董事。Sprint 1 目標係打通高質量數據採集鏈路，成功標準係可信數據先行。請提供3個具體策略建議，每個包含行動步驟、成功指標、時間估算。用繁體中文。\n\n議題：${issue}` }]
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

async function callDeepSeek(issue, geminiOutput, apiKey) {
  const body = {
    model: "deepseek-chat",
    messages: [
      { role: "system", content: "你係 CoreLogic AI 數據審計董事。核心原則係「沒有精確時間同步與高質量 raw signal，再強的 AI 模型都沒有意義」。審查所有技術方案，用繁體中文。" },
      { role: "user", content: `議題：${issue}\n\n策略董事建議：${geminiOutput.substring(0, 500)}\n\n請指出：1)三大風險 2)策略盲點 3)改善建議` }
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
      return Response.json({ status: "ok", version: "9.0.0" }, { headers: CORS });
    }

    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405, headers: CORS });
    }

    try {
      const incoming = await request.json();
      const issue = incoming.issue || incoming.text || "請分析此議題";

      // 並行呼叫 Gemini 同 Perplexity，各限時 25 秒
      const [geminiText, perplexityText] = await Promise.all([
        withTimeout(callGemini(issue, env.GEMINI_API_KEY), 25000, "Gemini").catch(e => `[Gemini 超時] ${e.message}`),
        withTimeout(callPerplexity(issue, env.PERPLEXITY_API_KEY), 25000, "Perplexity").catch(e => `[Perplexity 超時] ${e.message}`),
      ]);

      // DeepSeek 限時 25 秒
      const deepseekText = await withTimeout(
        callDeepSeek(issue, geminiText, env.DEEPSEEK_API_KEY),
        25000,
        "DeepSeek"
      ).catch(e => `[DeepSeek 超時] ${e.message}`);

      return Response.json({
        issue: issue,
        gemini: geminiText,
        perplexity: perplexityText,
        deepseek: deepseekText,
      }, { headers: CORS });

    } catch (err) {
      return Response.json({ error: err.message }, { status: 500, headers: CORS });
    }
  }
};
