// CoreLogic AI Board — Worker v17.2
// v17.1: 加入 /debug 端點診斷 Azure 連線問題

const PERPLEXITY_URL = "https://api.perplexity.ai/chat/completions";
const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function buildAzureUrl(endpoint, deploymentName) {
  const base = endpoint.trim().replace(/\/$/, "");
  if (base.includes("/deployments/")) {
    return `${base}/chat/completions?api-version=2024-10-21`;
  } else {
    return `${base}/openai/deployments/${deploymentName}/chat/completions?api-version=2024-10-21`;
  }
}

async function callPerplexity(issue, apiKey) {
  const body = {
    model: "sonar",
    messages: [
      { role: "system", content: "你係 CoreLogic AI 技術情報董事。專門收集 BLE IMU、MediaPipe、Sensor Fusion、運動科技穿戴最新技術資訊同業界動態。提供具體、可執行的技術建議。用繁體中文回應，格式清晰。" },
      { role: "user", content: `CoreLogic AI 議題：${issue}\n\n請提供：1)最新技術情報 2)可落地方案 3)具體工具/庫推薦` }
    ]
  };
  const res = await fetch(PERPLEXITY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || JSON.stringify(data);
}

async function callDeepSeek(issue, perplexityReport, apiKey) {
  const body = {
    model: "deepseek-chat",
    messages: [
      { role: "system", content: "你係 CoreLogic AI 數據審計董事。核心原則：「沒有精確時間同步與高質量 raw signal，再強的 AI 模型都沒有意義」。你的職責係審查情報董事的建議，指出風險、盲點，並提出改善方案。用繁體中文，語氣嚴謹直接。" },
      { role: "user", content: `議題：${issue}\n\n【情報董事報告】\n${perplexityReport.substring(0, 1200)}\n\n請以審計角度：1)三大風險 2)策略盲點 3)數據質量要求 4)改善建議` }
    ]
  };
  const res = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || JSON.stringify(data);
}

async function callAzureOpenAI(issue, perplexityReport, deepseekReport, endpoint, deploymentName, apiKey) {
  const url = buildAzureUrl(endpoint, deploymentName);
  const body = {
    messages: [
      { role: "system", content: "你係 CoreLogic AI 產品策略董事。整合情報董事同審計董事的報告，制定清晰、可執行的產品策略。用繁體中文，格式為執行清單。" },
      { role: "user", content: `議題：${issue}\n\n【情報董事】\n${perplexityReport.substring(0, 800)}\n\n【審計董事】\n${deepseekReport.substring(0, 800)}\n\n請制定：1)最終策略方向 2)行動清單（含時間+指標）3)給決策者的建議` }
    ],
    max_tokens: 1000
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": apiKey },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  // Try parse JSON, if fails return raw text for debugging
  try {
    const data = JSON.parse(text);
    if (data?.error) return `[Azure 錯誤] code=${data.error.code} msg=${data.error.message}`;
    return data?.choices?.[0]?.message?.content || JSON.stringify(data);
  } catch(e) {
    return `[Azure HTML錯誤] URL=${url} Status=${res.status} Body=${text.substring(0,300)}`;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    // GET /debug — show Azure config (masked key) and test URL
    if (request.method === "GET" && url.pathname === "/debug") {
      const ep = env.AZURE_OPENAI_ENDPOINT || "NOT_SET";
      const dn = env.AZURE_DEPLOYMENT_NAME || "gpt-4o";
      const key = env.AZURE_OPENAI_KEY ? env.AZURE_OPENAI_KEY.substring(0,8) + "..." : "NOT_SET";
      const builtUrl = (ep !== "NOT_SET") ? buildAzureUrl(ep, dn) : "cannot build — endpoint not set";
      return Response.json({
        azure_endpoint: ep,
        azure_deployment: dn,
        azure_key_prefix: key,
        built_url: builtUrl,
        azure_ready: !!(env.AZURE_OPENAI_KEY && env.AZURE_OPENAI_ENDPOINT)
      }, { headers: CORS });
    }

    if (request.method === "GET") {
      return Response.json({
        status: "ok", version: "17.2.0",
        board: ["perplexity","deepseek","azure-gpt4o"],
        azure_ready: !!(env.AZURE_OPENAI_KEY && env.AZURE_OPENAI_ENDPOINT),
        azure_deployment: env.AZURE_DEPLOYMENT_NAME || "gpt-4o"
      }, { headers: CORS });
    }

    if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: CORS });

    try {
      const incoming = await request.json();
      const issue = incoming.issue || incoming.text || "請分析此議題";
      const deploymentName = env.AZURE_DEPLOYMENT_NAME || "gpt-4o";

      const perplexityText = await callPerplexity(issue, env.PERPLEXITY_API_KEY)
        .catch(e => `[Perplexity 錯誤] ${e.message}`);

      const deepseekText = await callDeepSeek(issue, perplexityText, env.DEEPSEEK_API_KEY)
        .catch(e => `[DeepSeek 錯誤] ${e.message}`);

      let strategyText = "（策略董事待設定：需要 Azure OpenAI API Key）";
      if (env.AZURE_OPENAI_KEY && env.AZURE_OPENAI_ENDPOINT) {
        strategyText = await callAzureOpenAI(
          issue, perplexityText, deepseekText,
          env.AZURE_OPENAI_ENDPOINT, deploymentName, env.AZURE_OPENAI_KEY
        ).catch(e => `[Azure GPT-4o 錯誤] ${e.message}`);
      }

      return Response.json({
        issue,
        perplexity: perplexityText.substring(0, 1800),
        deepseek: deepseekText.substring(0, 1800),
        strategy: strategyText.substring(0, 1800),
      }, { headers: CORS });

    } catch (err) {
      return Response.json({ error: err.message }, { status: 500, headers: CORS });
    }
  }
};
