// CoreLogic AI Board — Worker v18.0
// 異步模式：立即回應 Make.com "accepted"，後台執行三董事 + 直接寫 Notion + 發 Gmail
// 解決 Make.com 90s 超時問題

const PERPLEXITY_URL = "https://api.perplexity.ai/chat/completions";
const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";
const NOTION_API = "https://api.notion.com/v1/pages";
const GMAIL_API = "https://www.googleapis.com/gmail/v1/users/me/messages/send";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function buildAzureUrl(endpoint, deploymentName) {
  const base = endpoint.trim().replace(/\/$/, "");
  if (base.includes("chat/completions")) {
    return base.includes("api-version") ? base : base + (base.includes("?") ? "&" : "?") + "api-version=2024-10-21";
  }
  if (base.includes("/deployments/")) return `${base}/chat/completions?api-version=2024-10-21`;
  return `${base}/openai/deployments/${deploymentName}/chat/completions?api-version=2024-10-21`;
}

async function callPerplexity(issue, apiKey) {
  const res = await fetch(PERPLEXITY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "sonar",
      messages: [
        { role: "system", content: "你係 CoreLogic AI 技術情報董事。專門收集 BLE IMU、MediaPipe、Sensor Fusion、運動科技穿戴最新技術資訊同業界動態。提供具體、可執行的技術建議。用繁體中文回應，格式清晰。" },
        { role: "user", content: `CoreLogic AI 議題：${issue}\n\n請提供：1)最新技術情報 2)可落地方案 3)具體工具/庫推薦` }
      ]
    }),
  });
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || JSON.stringify(data);
}

async function callDeepSeek(issue, perplexityReport, apiKey) {
  const res = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: "你係 CoreLogic AI 數據審計董事。核心原則：「沒有精確時間同步與高質量 raw signal，再強的 AI 模型都沒有意義」。審查情報董事建議，指出風險、盲點，提出改善方案。用繁體中文，語氣嚴謹直接。" },
        { role: "user", content: `議題：${issue}\n\n【情報董事報告】\n${perplexityReport.substring(0, 1200)}\n\n請：1)三大風險 2)策略盲點 3)數據質量要求 4)改善建議` }
      ]
    }),
  });
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || JSON.stringify(data);
}

async function callAzureOpenAI(issue, perplexityReport, deepseekReport, endpoint, deploymentName, apiKey) {
  const url = buildAzureUrl(endpoint, deploymentName);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": apiKey },
    body: JSON.stringify({
      messages: [
        { role: "system", content: "你係 CoreLogic AI 產品策略董事。整合情報董事同審計董事的報告，制定清晰、可執行的產品策略。重點：Sprint 目標達成、資源效率、風險緩解。提供具體行動清單，每項含時間+成功指標。用繁體中文，格式為執行清單。" },
        { role: "user", content: `議題：${issue}\n\n【情報董事】\n${perplexityReport.substring(0, 800)}\n\n【審計董事】\n${deepseekReport.substring(0, 800)}\n\n請：1)最終策略方向 2)行動清單（時間+指標）3)給決策者的建議` }
      ],
      max_tokens: 1000
    }),
  });
  const text = await res.text();
  try {
    const data = JSON.parse(text);
    if (data?.error) return `[Azure 錯誤] ${data.error.code}: ${data.error.message}`;
    return data?.choices?.[0]?.message?.content || JSON.stringify(data);
  } catch(e) {
    return `[Azure 解析錯誤] ${text.substring(0, 200)}`;
  }
}

// 直接寫 Notion DB
async function writeNotion(issue, perplexity, deepseek, strategy, notionKey, dbId) {
  const today = new Date().toISOString().split('T')[0];
  const title = issue.substring(0, 80);
  const body = {
    parent: { database_id: dbId },
    properties: {
      "議題標題": { title: [{ text: { content: title } }] },
      "議題描述": { rich_text: [{ text: { content: issue } }] },
      "情報董事（Perplexity）": { rich_text: [{ text: { content: perplexity.substring(0, 2000) } }] },
      "審計董事（DeepSeek）": { rich_text: [{ text: { content: deepseek.substring(0, 2000) } }] },
      "策略董事（GPT-4o）": { rich_text: [{ text: { content: strategy.substring(0, 2000) } }] },
      "狀態": { select: { name: "待審閱" } },
      "日期": { date: { start: today } }
    }
  };
  const res = await fetch(NOTION_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${notionKey}`,
      "Notion-Version": "2022-06-28"
    },
    body: JSON.stringify(body)
  });
  return res.ok ? "✅ Notion 已寫入" : `❌ Notion 錯誤 ${res.status}`;
}

// 發 Gmail（via Make.com webhook 通知 — 簡化版：直接 POST 回 Make.com Gmail webhook）
// 改為：發送摘要通知 email via Mailgun-style or just log
// 實際 Gmail 仍由 Make.com 處理，但我們改流程：
// Worker POST /notify → Make.com 接收簡短 JSON → Gmail 發出
// 為保持架構簡單，v18 改為：Worker 完成後 POST 到 Make.com 的 notify webhook（同一個 webhook）
// 附加 "type":"result" 欄位，Make.com 用 filter 區分

// 後台處理：三董事 + 寫 Notion + 通知
async function runBoardAsync(issue, env, ctx) {
  try {
    const deploymentName = env.AZURE_DEPLOYMENT_NAME || "gpt-4o";

    const perplexity = await callPerplexity(issue, env.PERPLEXITY_API_KEY)
      .catch(e => `[Perplexity 錯誤] ${e.message}`);

    const deepseek = await callDeepSeek(issue, perplexity, env.DEEPSEEK_API_KEY)
      .catch(e => `[DeepSeek 錯誤] ${e.message}`);

    let strategy = "（策略董事未設定）";
    if (env.AZURE_OPENAI_KEY && env.AZURE_OPENAI_ENDPOINT) {
      strategy = await callAzureOpenAI(issue, perplexity, deepseek, env.AZURE_OPENAI_ENDPOINT, deploymentName, env.AZURE_OPENAI_KEY)
        .catch(e => `[Azure 錯誤] ${e.message}`);
    }

    // 寫 Notion
    let notionStatus = "（未設定 Notion Key）";
    if (env.NOTION_API_KEY) {
      notionStatus = await writeNotion(issue, perplexity, deepseek, strategy, env.NOTION_API_KEY, env.NOTION_DB_ID || "3613edccae7a80289007dcc9f99c7d6f")
        .catch(e => `[Notion 錯誤] ${e.message}`);
    }

    // 回傳結果到 Make.com webhook（Gmail 模組用）
    if (env.MAKE_WEBHOOK_URL) {
      await fetch(env.MAKE_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "result",
          issue: issue.substring(0, 200),
          perplexity: perplexity.substring(0, 1800),
          deepseek: deepseek.substring(0, 1800),
          strategy: strategy.substring(0, 1800),
          notion_status: notionStatus
        })
      }).catch(() => {});
    }

  } catch(e) {
    console.error("Board async error:", e.message);
  }
}

export default {
  async fetch(request, env, ctx) {
    const urlObj = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (request.method === "GET" && urlObj.pathname === "/debug") {
      const ep = env.AZURE_OPENAI_ENDPOINT || "NOT_SET";
      const dn = env.AZURE_DEPLOYMENT_NAME || "gpt-4o";
      const key = env.AZURE_OPENAI_KEY ? env.AZURE_OPENAI_KEY.substring(0, 8) + "..." : "NOT_SET";
      const builtUrl = (ep !== "NOT_SET") ? buildAzureUrl(ep, dn) : "cannot build";
      return Response.json({
        azure_endpoint_stored: ep.substring(0, 60),
        azure_deployment: dn,
        azure_key_prefix: key,
        built_url: builtUrl,
        azure_ready: !!(env.AZURE_OPENAI_KEY && env.AZURE_OPENAI_ENDPOINT),
        notion_ready: !!env.NOTION_API_KEY,
        make_webhook_set: !!env.MAKE_WEBHOOK_URL,
        mode: "async_v18"
      }, { headers: CORS });
    }

    if (request.method === "GET") {
      return Response.json({
        status: "ok", version: "18.0.0",
        board: ["perplexity", "deepseek", "azure-gpt4o"],
        mode: "async",
        azure_ready: !!(env.AZURE_OPENAI_KEY && env.AZURE_OPENAI_ENDPOINT),
        notion_ready: !!env.NOTION_API_KEY,
        azure_deployment: env.AZURE_DEPLOYMENT_NAME || "gpt-4o"
      }, { headers: CORS });
    }

    if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: CORS });

    try {
      const incoming = await request.json();
      const issue = incoming.issue || incoming.text || "請分析此議題";

      // 異步模式：立即返回，後台處理
      // ctx.waitUntil 確保 Worker 在返回後繼續執行後台任務
      ctx.waitUntil(runBoardAsync(issue, env, ctx));

      return Response.json({
        status: "accepted",
        message: "三董事正在後台分析中，結果將直接寫入 Notion（約60-90秒）",
        issue: issue.substring(0, 100),
        mode: "async"
      }, { headers: CORS });

    } catch (err) {
      return Response.json({ error: err.message }, { status: 500, headers: CORS });
    }
  }
};
