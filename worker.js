// CoreLogic AI Board — Worker v21.0
// 新增：每位董事注入完整 CoreLogic AI 系統背景（永久記憶）
// 新增：/chat endpoint 供多董事對話介面使用
// 繼承：執行秘書整合層（v20）、同步模式、Gmail fallback

const PERPLEXITY_URL = "https://api.perplexity.ai/chat/completions";
const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";
const NOTION_API = "https://api.notion.com/v1/pages";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ─── CoreLogic AI 永久系統背景（每位董事都會讀到）─────────────────────────
const CORELOGIC_CONTEXT = `
【CoreLogic AI 系統背景 — 每位董事必須遵守】

產品定位：
- CoreLogic AI 係一個運動表現提升及運動創傷預防平台，唔係醫療器械
- 目標用戶：運動愛好者 + 專業運動員
- 核心技術：BLE IMU 穿戴傳感器 + 手機鏡頭 MediaPipe 姿態分析 + 即時生物力學回饋（觸覺/語音）
- 長期願景：Apple Watch 級別日常穿戴

Phase 1 MVP（進行中）：
- 硬件：Nordic nRF5340 + Bosch BMI270 IMU，放置於胸椎背心Pod（T4-T7位置）
- 軟件：Flutter app（iOS/Android）+ BLE 數據串流 + MediaPipe 姿態估算
- Sprint 1 Go/No-Go 門控：BLE IMU 同步誤差 <5ms，MediaPipe 關節角度誤差 <3°

9條治理守則（AI董事必須遵守）：
1. 數據邊界：只分析 CoreLogic AI 項目數據
2. AI自主：以最少監督推進項目
3. 反對機制：可以用證據推翻 Johnny 想法
4. 最低成本最高效益
5. 最終目標：有用的產品 → 商業化/IPO
6. 外部資金：先申請資助（CCMF HKD 100K），再天使，再股權
7. 財務紀律：Phase 1 ~HKD 78-117K；Phase 2 ~HKD 335-382K；Phase 3 ~HKD 2.3-3.9M
8. 偏差即停：Sprint 1 未達 Go/No-Go 門控必須暫停
9. 嚴格執行：更新需要 Johnny 書面批准

競品：Catapult、STATSports、Playermaker、WHOOP、Kinexon、Uplift Labs
差異化：BLE 低延遲同步 <5ms + 姿態角度誤差 <3° + 香港本地運動市場切入

當前重點任務（Sprint 1）：
- Nordic nRF5340 + BMI270 開發套件採購
- Flutter app 骨架：BLE 掃描、連接、IMU 數據顯示
- ReBAIT 開源框架整合
- MediaPipe 姿態估算（iOS/Android）
- GitHub repo + CI/CD
- CCMF HKD 100K 申請書提交

決策者：Johnny Cheung（香港，建築工程顧問 + AI產品創業者）
`;

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
          content: `你係 CoreLogic AI 技術情報董事。${CORELOGIC_CONTEXT}\n\n你的職責：收集最新 BLE IMU、MediaPipe、Sensor Fusion、運動科技穿戴技術情報及業界動態。提供具體可執行建議。用繁體中文回應，格式清晰。`
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
          content: `你係 CoreLogic AI 數據審計董事。${CORELOGIC_CONTEXT}\n\n你的核心原則：「沒有精確時間同步與高質量 raw signal，再強的 AI 模型都沒有意義」。你嘅職責：批判風險、指出盲點、保護項目數據質量。語氣嚴謹直接，用繁體中文。`
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
          content: `你係 CoreLogic AI 產品策略董事。${CORELOGIC_CONTEXT}\n\n你的職責：整合情報董事同審計董事報告，制定清晰可執行的產品策略。重點係 Sprint 目標達成、資源效率、風險緩解。提供具體行動清單，每項含時間+成功指標。用繁體中文。`
        },
        {
          role: "user",
          content: `議題：${issue}\n\n【情報董事】\n${perplexityReport.substring(0, 800)}\n\n【審計董事】\n${deepseekReport.substring(0, 800)}\n\n請：1)最終策略方向 2)行動清單（時間+指標）3)給決策者建議`
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

// ─── 執行秘書整合 ────────────────────────────────────────────────────────────
async function callExecutiveSecretary(issue, perplexity, deepseek, strategy, endpoint, deploymentName, apiKey) {
  const url = buildAzureUrl(endpoint, deploymentName);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": apiKey },
    body: JSON.stringify({
      messages: [
        {
          role: "system",
          content: `你係 CoreLogic AI 執行秘書。${CORELOGIC_CONTEXT}\n\n你的職責：整合三位董事報告，產出執行結論及待回覆問題。\n\n格式：\n【執行結論】\n• 共識：[1-2句]\n• 決策：[本次決策]\n• 行動（AI自主執行）：[AI可自行推進]\n• 行動（需Johnny決策）：[需介入項目]\n\n【待Johnny回覆】\nQ1. [問題]（截止：下次董事會前）\n（如無問題：本次無待決問題）\n\n用繁體中文，簡潔有力。`
        },
        {
          role: "user",
          content: `議題：${issue}\n\n【情報董事】\n${perplexity.substring(0, 700)}\n\n【審計董事】\n${deepseek.substring(0, 700)}\n\n【策略董事】\n${strategy.substring(0, 700)}\n\n請整合產出執行結論及待回覆問題。`
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

function determineResponsible(conclusion) {
  if (!conclusion) return "AI自主執行";
  if (conclusion.includes("需Johnny決策") || conclusion.includes("Q1")) return "需Johnny決策";
  if (conclusion.includes("待外部回應") || conclusion.includes("CCMF") || conclusion.includes("大學")) return "待外部回應";
  return "AI自主執行";
}

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
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${notionKey}`, "Notion-Version": "2022-06-28" },
    body: JSON.stringify(body)
  });
  if (res.ok) {
    const json = await res.json();
    return { ok: true, page_id: json.id || "unknown", responsible };
  }
  const errText = await res.text().catch(() => "unknown");
  return { ok: false, status: res.status, error: errText.substring(0, 300) };
}

// ─── 主 handler ──────────────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const urlObj = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (request.method === "GET" && urlObj.pathname === "/debug") {
      const ep = env.AZURE_OPENAI_ENDPOINT || "NOT_SET";
      const dn = env.AZURE_DEPLOYMENT_NAME || "gpt-4o";
      return Response.json({
        version: "21.0.0",
        mode: "sync + full_context + executive_secretary",
        azure_ready: !!(env.AZURE_OPENAI_KEY && env.AZURE_OPENAI_ENDPOINT),
        notion_ready: !!env.NOTION_API_KEY,
        built_url: ep !== "NOT_SET" ? buildAzureUrl(ep, dn) : "cannot build",
        new_in_v21: "每位董事注入完整 CoreLogic AI 系統背景，消除思維誤導"
      }, { headers: CORS });
    }

    if (request.method === "GET") {
      return Response.json({
        status: "ok",
        version: "21.0.0",
        board: ["perplexity-sonar", "deepseek-chat", "azure-gpt4o", "executive-secretary"],
        azure_ready: !!(env.AZURE_OPENAI_KEY && env.AZURE_OPENAI_ENDPOINT),
        notion_ready: !!env.NOTION_API_KEY,
        new_in_v21: "所有董事現已注入完整 CoreLogic AI 背景記憶，確保分析一致性"
      }, { headers: CORS });
    }

    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405, headers: CORS });
    }

    let issue;
    try {
      const incoming = await request.json();
      issue = (incoming.issue || incoming.question || incoming.text || "請分析此議題").trim();
    } catch (e) {
      return Response.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS });
    }

    const startTime = Date.now();
    const deploymentName = (env.AZURE_DEPLOYMENT_NAME || "gpt-4o").trim();
    const isChat = urlObj.pathname === "/chat";

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
        strategy = await callAzureOpenAI(issue, perplexity, deepseek, env.AZURE_OPENAI_ENDPOINT, deploymentName, env.AZURE_OPENAI_KEY)
          .catch(e => `[策略董事錯誤] ${e.message}`);
      }

      // Step 4: 執行秘書
      let conclusion = "（執行秘書未執行）";
      let pending = "本次無待決問題";
      if (env.AZURE_OPENAI_KEY && env.AZURE_OPENAI_ENDPOINT && !strategy.startsWith("[")) {
        const sec = await callExecutiveSecretary(issue, perplexity, deepseek, strategy, env.AZURE_OPENAI_ENDPOINT, deploymentName, env.AZURE_OPENAI_KEY)
          .catch(e => ({ conclusion: `[執行秘書錯誤] ${e.message}`, pending: "" }));
        conclusion = sec.conclusion;
        pending = sec.pending;
      }

      // Step 5: 寫 Notion（僅董事會模式，非 /chat）
      let notionResult = { ok: false, skipped: true };
      if (!isChat) {
        const dbId = (env.NOTION_DB_ID || "3613edccae7a80289007dcc9f99c7d6f").trim();
        if (env.NOTION_API_KEY) {
          notionResult = await writeNotion(issue, perplexity, deepseek, strategy, conclusion, pending, env.NOTION_API_KEY, dbId)
            .catch(e => ({ ok: false, error: e.message }));
        }
      }

      const elapsed = Math.round((Date.now() - startTime) / 1000);

      return Response.json({
        status: "ok",
        version: "21.0.0",
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
          context_injected: true,
          responsible: notionResult.responsible || "N/A"
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
