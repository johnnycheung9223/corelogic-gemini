// ============================================================
// Gemini Agent Platform Proxy — v6.0
// Supports query parameter for issue, auto-escapes special chars
// ============================================================

const PROJECT_ID = "gemini-worker-496408";
const API_BASE = "https://aiplatform.googleapis.com/v1beta1/projects/" + PROJECT_ID + "/locations/global/publishers/google/models";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method === "GET" && url.pathname === "/") {
      return Response.json({
        status: "ok",
        message: "Gemini Agent Platform Proxy is running",
        version: "6.0.0",
        project_id: PROJECT_ID,
        timestamp: new Date().toISOString(),
      }, { status: 200, headers: corsHeaders });
    }

    if (request.method === "POST" && url.pathname.includes("generateContent")) {
      try {
        const modelMatch = url.pathname.match(/models\/([^:]+):generateContent/) ||
                           url.pathname.match(/models\/([^/]+)\/generateContent/) ||
                           url.pathname.match(/models\/([^?]+)/);
        const model = modelMatch ? modelMatch[1].replace(":generateContent","").replace("/generateContent","") : "gemini-2.5-flash";

        const rawBody = await request.text();

        let finalBody;

        try {
          JSON.parse(rawBody);
          // If body has a placeholder text, replace with query param issue
          const issue = url.searchParams.get("issue");
          if (issue) {
            const systemPrompt = "你係 CoreLogic AI 產品策略董事。Sprint 1 目標係打通高質量數據採集鏈路，成功標準係可信數據先行。請提供3個具體策略建議，每個包含行動步驟、成功指標、時間估算。用繁體中文。";
            finalBody = JSON.stringify({
              contents: [{
                role: "user",
                parts: [{ text: systemPrompt + "\n\n議題：" + issue }]
              }]
            });
          } else {
            finalBody = rawBody;
          }
        } catch(e) {
          const issue = url.searchParams.get("issue") || "請分析此議題";
          const systemPrompt = "你係 CoreLogic AI 產品策略董事。Sprint 1 目標係打通高質量數據採集鏈路，成功標準係可信數據先行。請提供3個具體策略建議，每個包含行動步驟、成功指標、時間估算。用繁體中文。";
          finalBody = JSON.stringify({
            contents: [{
              role: "user",
              parts: [{ text: systemPrompt + "\n\n議題：" + issue }]
            }]
          });
        }

        const apiKey = env.GEMINI_API_KEY;
        const targetUrl = `${API_BASE}/${model}:generateContent?key=${apiKey}`;

        const response = await fetch(targetUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: finalBody,
        });

        const responseText = await response.text();

        return new Response(responseText, {
          status: response.status,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        });

      } catch (error) {
        return Response.json({
          error: "Proxy error",
          message: error.message,
        }, { status: 502, headers: corsHeaders });
      }
    }

    return Response.json({ error: "Not Found" }, { status: 404, headers: corsHeaders });
  },
};
