// Gemini Proxy v7 — CoreLogic AI Board
// 接收 POST body 入面的 "issue" 欄位，直接建立 Gemini 請求
// Make.com 只需發送: {"issue": "{{2.body.issue}}"}

const PROJECT_ID = "gemini-worker-496408";
const MODEL = "gemini-2.5-flash";
const API_URL = `https://aiplatform.googleapis.com/v1beta1/projects/${PROJECT_ID}/locations/global/publishers/google/models/${MODEL}:generateContent`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    // Health check
    if (request.method === "GET") {
      return Response.json({ status: "ok", version: "7.0.0" }, { headers: CORS });
    }

    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405, headers: CORS });
    }

    try {
      // 讀取 Make.com 發送嘅 body
      const incoming = await request.json();
      
      // 提取 issue 文字（支援多種格式）
      const issue = incoming.issue || incoming.text || incoming.content || JSON.stringify(incoming);
      
      // 系統提示（根據呼叫路徑決定角色）
      const path = new URL(request.url).pathname;
      let systemPrompt = "你係 CoreLogic AI 產品策略董事。Sprint 1 目標係打通高質量數據採集鏈路，成功標準係可信數據先行。請提供3個具體策略建議，每個包含行動步驟、成功指標、時間估算。用繁體中文。";

      // 建立 Gemini 請求
      const geminiBody = {
        contents: [{
          role: "user",
          parts: [{ text: systemPrompt + "\n\n議題：" + issue }]
        }]
      };

      // 呼叫 Gemini
      const response = await fetch(`${API_URL}?key=${env.GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(geminiBody),
      });

      const result = await response.json();

      // 返回完整 Gemini 響應
      return Response.json(result, {
        status: response.status,
        headers: CORS,
      });

    } catch (err) {
      return Response.json({
        error: "Proxy error",
        message: err.message,
      }, { status: 500, headers: CORS });
    }
  }
};
