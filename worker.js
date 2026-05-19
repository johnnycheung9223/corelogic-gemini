// CoreLogic AI Board — Worker v17.0
// 三董事架構：Perplexity（情報）→ DeepSeek（審計）→ Azure OpenAI GPT-4o（策略）
// v17 改進：Azure URL 自動組合（支援兩種 endpoint 格式）+ Deployment Name 環境變數

const PERPLEXITY_URL = "https://api.perplexity.ai/chat/completions";
const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Azure URL 組合：支援兩種格式
// 格式A: https://resource.openai.azure.com/ + deployments/<name>/
// 格式B: https://resource.openai.azure.com/openai/deployments/<name>/ (已含路徑)
function buildAzureUrl(endpoint, deploymentName) {
  const base = endpoint.replace(/\/$/, ""); // 移除尾部斜線
  if (base.includes("/deployments/")) {
    // 格式B：endpoint 已包含 deployment path
    return `${base}/chat/completions?api-version=2024-10-21`;
  } else {
    // 格式A：標準 resource endpoint，需組合 deployment name
    return `${base}/openai/deployments/${deploymentName}/chat/completions?api-version=2024-10-21`;
  }
}

// Step 1: 情報董事 Perplexity — 收集最新技術情報
async function callPerplexity(issue, apiKey) {
  const body = {
    model: "sonar",
    messages: [
      {
        role: "system",
        content: "你係 CoreLogic AI 技術情報董事。專門收集 BLE IMU、MediaPipe、Sensor Fusion、運動科技穿戴最新技術資訊同業界動態。提供具體、可執行的技術建議。用繁體中文回應，格式清晰。"
      },
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

// Step 2: 審計董事 DeepSeek — 審計 Perplexity 的情報，指出風險
async function callDeepSeek(issue, perplexityReport, apiKey) {
  const body = {
    model: "deepseek-chat",
    messages: [
      {
        role: "system",
        content: "你係 CoreLogic AI 數據審計董事。核心原則：「沒有精確時間同步與高質量 raw signal，再強的 AI 模型都沒有意義」。你的職責係審查情報董事的建議，指出風險、盲點，並提出改善方案。用繁體中文，語氣嚴謹直接。"
      },
      {
        role: "user",
        content: `議題：${issue}\n\n【情報董事報告】\n${perplexityReport.substring(0, 1200)}\n\n請以審計角度：1)三大風險 2)策略盲點 3)數據質量要求 4)改善建議`
      }
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

// Step 3: 策略董事 Azure OpenAI GPT-4o — 整合兩份報告，制定最終策略
async function callAzureOpenAI(issue, perplexityReport, deepseekReport, endpoint, deploymentName, apiKey) {
  const url = buildAzureUrl(endpoint, deploymentName);
  const body = {
    messages: [
      {
        role: "system",
        content: "你係 CoreLogic AI 產品策略董事。你的職責係整合情報董事同審計董事的報告，制定清晰、可執行的產品策略。重點係：Sprint 目標達成、資源效率、風險緩解。提供具體行動清單，每項有負責方向、時間估算、成功指標。用繁體中文，格式為執行清單。"
      },
      {
        role: "user",
        content: `議題：${issue}\n\n【情報董事報告摘要】\n${perplexityReport.substring(0, 800)}\n\n【審計董事報告摘要】\n${deepseekReport.substring(0, 800)}\n\n請制定：1)本議題最終策略方向 2)具體行動清單（每項含時間+成功指標）3)給最終決策者的建議`
      }
    ],
    max_tokens: 1000
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data?.error) return `[Azure 錯誤] ${JSON.stringify(data.error)}`;
  return data?.choices?.[0]?.message?.content || JSON.stringify(data);
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method === "GET") {
      const azureReady = !!(env.AZURE_OPENAI_KEY && env.AZURE_OPENAI_ENDPOINT);
      return Response.json({
        status: "ok",
        version: "17.0.0",
        board: ["perplexity", "deepseek", "azure-gpt4o"],
        azure_ready: azureReady,
        azure_deployment: env.AZURE_DEPLOYMENT_NAME || "gpt-4o"
      }, { headers: CORS });
    }
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405, headers: CORS });
    }

    try {
      const incoming = await request.json();
      const issue = incoming.issue || incoming.text || "請分析此議題";
      const deploymentName = env.AZURE_DEPLOYMENT_NAME || "gpt-4o";

      // Step 1: 情報董事
      const perplexityText = await callPerplexity(issue, env.PERPLEXITY_API_KEY)
        .catch(e => `[Perplexity 錯誤] ${e.message}`);

      // Step 2: 審計董事（參考情報董事報告）
      const deepseekText = await callDeepSeek(issue, perplexityText, env.DEEPSEEK_API_KEY)
        .catch(e => `[DeepSeek 錯誤] ${e.message}`);

      // Step 3: 策略董事（整合兩份報告）
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
