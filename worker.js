// CoreLogic AI Board — Worker v20.0
// 新增：執行秘書整合層 — 整合三董事 → 執行結論 + 待Johnny回覆問題
// 同步模式：四步串行 → 寫 Notion（含執行結論）→ 回傳完整結果
// Make.com HTTP timeout 需設為 120s

const PERPLEXITY_URL = "https://api.perplexity.ai/chat/completions";
const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";
const NOTION_API = "https://api.notion.com/v1/pages";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function buildAzureUrl(endpoint, deploymentName) {
  const base = endpoint.trim().replace(/\/$/, "");
  if (base.includes("chat/completions")) {
    return base.includes("api-version") ? base : base + "?api-version=2025-01-01-preview";
  }
  if (base.includes("/deployments/")) {
    return `${base}/chat/completions?api-version=2025-01-01-preview`;
  }
  return `${base}/openai/deployments/${deploymentName}/chat/completions?api-version=2025-01-01-preview`;
}

// ─── 情報董事（Perplexity sonar）────────────────────────────────────────────
async function callPerplexity(issue, apiKey) {
  const res = await fetch(PERPLEXITY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "sonar",
      messages: [
        {
          role: "system",
          content: "你係 CoreLogic AI 技術情報董事。專門收集 BLE IMU、MediaPipe、Sensor Fusion、運動科技穿戴最新技術資訊同業界動態。提供具體、可執行的技術建議。用繁體中文回應，格式清晰。"
        },
        {
          role: "user",
          content: `CoreLogic AI 議題：${issue}\n\n請提供：1)最新技術情報 2)可落地方案 3)具體工具/庫推薦`
        }
      ]
    }),
  });
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || JSON.stringify(data);
}

// ─── 審計董事（DeepSeek）────────────────────────────────────────────────────
async function callDeepSeek(issue, perplexityReport, apiKey) {
  const res = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        {
          role: "system",
          content: "你係 CoreLogic AI 數據審計董事。核心原則：「沒有精確時間同步與高質量 raw signal，再強的 AI 模型都沒有意義」。審查情報董事建議，指出風險、盲點，提出改善方案。用繁體中文，語氣嚴謹直接。"
        },
        {
          role: "user",
          content: `議題：${issue}\n\n【情報董事報告】\n${perplexityReport.substring(0, 1200)}\n\n請：1)三大風險 2)策略盲點 3)數據質量要求 4)改善建議`
        }
      ]
    }),
  });
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || JSON.stringify(data);
}

// ─── 策略董事（Azure GPT-4o）────────────────────────────────────────────────
async function callAzureOpenAI(issue, perplexityReport, deepseekReport, endpoint, deploymentName, apiKey) {
  const url = buildAzureUrl(endpoint, deploymentName);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": apiKey },
    body: JSON.stringify({
      messages: [
        {
          role: "system",
          content: "你係 CoreLogic AI 產品策略董事。整合情報董事同審計董事的報告，制定清晰、可執行的產品策略。重點：Sprint 目標達成、資源效率、風險緩解。提供具體行動清單，每項含時間+成功指標。用繁體中文，格式為執行清單。"
        },
        {
          role: "user",
          content: `議題：${issue}\n\n【情報董事】\n${perplexityReport.substring(0, 800)}\n\n【審計董事】\n${deepseekReport.substring(0, 800)}\n\n請：1)最終策略方向 2)行動清單（時間+指標）3)給決策者的建議`
        }
      ],
      max_tokens: 1000
    }),
  });
  const text = await res.text();
  try {
    const data = JSON.parse(text);
    if (data?.error) return `[Azure 錯誤] ${data.error.code}: ${data.error.message}`;
    return data?.choices?.[0]?.message?.content || JSON.stringify(data);
  } catch (e) {
    return `[Azure 解析錯誤] ${text.substring(0, 200)}`;
  }
}

// ─── 執行秘書（Azure GPT-4o 二次呼叫）整合三董事 → 結論 + 待回覆問題 ──────
async function callExecutiveSecretary(issue, perplexity, deepseek, strategy, endpoint, deploymentName, apiKey) {
  const url = buildAzureUrl(endpoint, deploymentName);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": apiKey },
    body: JSON.stringify({
      messages: [
        {
          role: "system",
          content: `你係 CoreLogic AI 執行秘書。負責整合三位董事（情報、審計、策略）的報告，產出：
1. 執行結論：共識點、本次決策、具體行動項（含負責人分類：AI自主執行 / 需Johnny決策 / 待外部回應）
2. 待Johnny回覆：列出需要 Johnny 在下次董事會前作出決定或回覆的問題（如沒有則寫「本次無待決問題」）

格式要求：
【執行結論】
• 共識：[1-2句共識]
• 決策：[本次決策]
• 行動（AI自主執行）：[AI可自行推進的項目]
• 行動（需Johnny決策）：[需要你介入的項目]

【待Johnny回覆】
Q1. [問題]（截止：下次董事會前）
Q2. [問題]（如有）

用繁體中文，簡潔有力。`
        },
        {
          role: "user",
          content: `議題：${issue}\n\n【情報董事報告】\n${perplexity.substring(0, 700)}\n\n【審計董事報告】\n${deepseek.substring(0, 700)}\n\n【策略董事報告】\n${strategy.substring(0, 700)}\n\n請整合以上三份報告，產出執行結論及待回覆問題。`
        }
      ],
      max_tokens: 800
    }),
  });
  const text = await res.text();
  try {
    const data = JSON.parse(text);
    if (data?.error) return { conclusion: `[執行秘書錯誤] ${data.error.code}`, pending: "" };
    const content = data?.choices?.[0]?.message?.content || "";
    // 分拆執行結論 vs 待Johnny回覆
    const conclusionMatch = content.match(/【執行結論】([\s\S]*?)(?=【待Johnny回覆】|$)/);
    const pendingMatch = content.match(/【待Johnny回覆】([\s\S]*?)$/);
    return {
      conclusion: conclusionMatch ? conclusionMatch[1].trim() : content,
      pending: pendingMatch ? pendingMatch[1].trim() : "本次無待決問題"
    };
  } catch (e) {
    return { conclusion: `[執行秘書解析錯誤]`, pending: "" };
  }
}

// ─── 判斷行動負責人 ──────────────────────────────────────────────────────────
function determineResponsible(conclusion) {
  if (!conclusion) return "AI自主執行";
  if (conclusion.includes("需Johnny決策") || conclusion.includes("Q1") || conclusion.includes("Q2")) {
    return "需Johnny決策";
  }
  if (conclusion.includes("待外部回應") || conclusion.includes("大學") || conclusion.includes("Cyberport") || conclusion.includes("CCMF")) {
    return "待外部回應";
  }
  return "AI自主執行";
}

// ─── Notion 寫入（含執行結論 + 待Johnny回覆 + 行動負責人）──────────────────
async function writeNotion(issue, perplexity, deepseek, strategy, conclusion, pending, notionKey, dbId) {
  const today = new Date().toISOString().split("T")[0];
  const responsible = determineResponsible(conclusion);

  const body = {
    parent: { database_id: dbId },
    properties: {
      "議題標題": { title: [{ text: { content: issue.substring(0, 80) } }] },
      "議題描述": { rich_text: [{ text: { content: issue.substring(0, 2000) } }] },
      "情報董事（Perplexity）": { rich_text: [{ text: { content: perplexity.substring(0, 2000) } }] },
      "審計董事（DeepSeek）": { rich_text: [{ text: { content: deepseek.substring(0, 2000) } }] },
      "策略董事（GPT-4o）": { rich_text: [{ text: { content: strategy.substring(0, 2000) } }] },
      "執行結論": { rich_text: [{ text: { content: conclusion.substring(0, 2000) } }] },
      "待Johnny回覆": { rich_text: [{ text: { content: pending.substring(0, 2000) } }] },
      "行動負責人": { select: { name: responsible } },
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

  if (res.ok) {
    const json = await res.json();
    return { ok: true, page_id: json.id || "unknown", responsible };
  } else {
    const errText = await res.text().catch(() => "unknown");
    return { ok: false, status: res.status, error: errText.substring(0, 300) };
  }
}

// ─── 主 handler ──────────────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const urlObj = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    // GET /debug
    if (request.method === "GET" && urlObj.pathname === "/debug") {
      const ep = env.AZURE_OPENAI_ENDPOINT || "NOT_SET";
      const dn = env.AZURE_DEPLOYMENT_NAME || "gpt-4o";
      const builtUrl = ep !== "NOT_SET" ? buildAzureUrl(ep, dn) : "cannot build";
      return Response.json({
        version: "20.0.0",
        mode: "sync + executive_secretary",
        azure_endpoint_stored: ep.substring(0, 60),
        azure_deployment: dn,
        azure_key_set: !!env.AZURE_OPENAI_KEY,
        built_url: builtUrl,
        azure_ready: !!(env.AZURE_OPENAI_KEY && env.AZURE_OPENAI_ENDPOINT),
        notion_ready: !!env.NOTION_API_KEY,
        new_notion_fields: ["執行結論", "待Johnny回覆", "行動負責人"]
      }, { headers: CORS });
    }

    // GET / health
    if (request.method === "GET") {
      return Response.json({
        status: "ok",
        version: "20.0.0",
        mode: "sync",
        board: ["perplexity-sonar", "deepseek-chat", "azure-gpt4o", "executive-secretary"],
        azure_ready: !!(env.AZURE_OPENAI_KEY && env.AZURE_OPENAI_ENDPOINT),
        notion_ready: !!env.NOTION_API_KEY,
        new_in_v20: "執行秘書整合層：執行結論 + 待Johnny回覆 + 行動負責人"
      }, { headers: CORS });
    }

    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405, headers: CORS });
    }

    let issue;
    try {
      const incoming = await request.json();
      issue = (incoming.issue || incoming.text || "請分析此議題").trim();
    } catch (e) {
      return Response.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS });
    }

    const startTime = Date.now();
    const deploymentName = (env.AZURE_DEPLOYMENT_NAME || "gpt-4o").trim();

    try {
      // Step 1: 情報董事
      const perplexity = await callPerplexity(issue, env.PERPLEXITY_API_KEY)
        .catch(e => `[情報董事錯誤] ${e.message}`);

      // Step 2: 審計董事
      const deepseek = await callDeepSeek(issue, perplexity, env.DEEPSEEK_API_KEY)
        .catch(e => `[審計董事錯誤] ${e.message}`);

      // Step 3: 策略董事
      let strategy = "（策略董事未設定）";
      if (env.AZURE_OPENAI_KEY && env.AZURE_OPENAI_ENDPOINT) {
        strategy = await callAzureOpenAI(
          issue, perplexity, deepseek,
          env.AZURE_OPENAI_ENDPOINT, deploymentName, env.AZURE_OPENAI_KEY
        ).catch(e => `[策略董事錯誤] ${e.message}`);
      }

      // Step 4: 執行秘書整合（僅在 Azure 可用時）
      let conclusion = "（執行秘書未執行）";
      let pending = "本次無待決問題";
      if (env.AZURE_OPENAI_KEY && env.AZURE_OPENAI_ENDPOINT && !strategy.startsWith("[")) {
        const secretaryResult = await callExecutiveSecretary(
          issue, perplexity, deepseek, strategy,
          env.AZURE_OPENAI_ENDPOINT, deploymentName, env.AZURE_OPENAI_KEY
        ).catch(e => ({ conclusion: `[執行秘書錯誤] ${e.message}`, pending: "" }));
        conclusion = secretaryResult.conclusion;
        pending = secretaryResult.pending;
      }

      // Step 5: 寫 Notion
      let notionResult = { ok: false, error: "NOTION_API_KEY 未設定" };
      const dbId = (env.NOTION_DB_ID || "3613edccae7a80289007dcc9f99c7d6f").trim();
      if (env.NOTION_API_KEY) {
        notionResult = await writeNotion(
          issue, perplexity, deepseek, strategy, conclusion, pending,
          env.NOTION_API_KEY, dbId
        ).catch(e => ({ ok: false, error: e.message }));
      }

      const elapsed = Math.round((Date.now() - startTime) / 1000);

      return Response.json({
        status: "ok",
        version: "20.0.0",
        elapsed_seconds: elapsed,
        issue,
        perplexity,
        deepseek,
        strategy,
        conclusion,
        pending_questions: pending,
        notion: notionResult,
        board: {
          perplexity_ok: !perplexity.startsWith("[情報董事錯誤]"),
          deepseek_ok: !deepseek.startsWith("[審計董事錯誤]"),
          strategy_ok: !strategy.startsWith("[") && !strategy.startsWith("（"),
          secretary_ok: !conclusion.startsWith("[") && !conclusion.startsWith("（"),
          notion_ok: notionResult.ok,
          responsible: notionResult.responsible || "unknown"
        }
      }, { headers: CORS });

    } catch (err) {
      return Response.json({
        status: "error",
        error: err.message,
        elapsed_seconds: Math.round((Date.now() - startTime) / 1000)
      }, { status: 500, headers: CORS });
    }
  }
};
