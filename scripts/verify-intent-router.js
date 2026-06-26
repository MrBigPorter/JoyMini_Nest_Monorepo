/**
 * 验证 Intent Router 分类效果
 *
 * 测试 qwen3.5:0.8b 是否能正确分类 9 种意图
 *
 * 用法:
 *   node scripts/verify-intent-router.js
 *
 * 依赖（已在 apps/api 安装）:
 *   @langchain/ollama, @langchain/core
 */

const { ChatOllama } = require("@langchain/ollama");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const { StringOutputParser } = require("@langchain/core/output_parsers");

async function main() {
  console.log("🔍 验证 Intent Router 分类效果\n");

  // 1. 检查 Ollama 服务
  try {
    const resp = await fetch("http://localhost:11434/api/tags");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  } catch {
    console.error("❌ Ollama 服务未启动。请先启动: ollama serve");
    process.exit(1);
  }

  // 2. 创建模型（与 intentRouterNode 完全一致）
  const model = new ChatOllama({
    model: "qwen3.5:0.8b",
    temperature: 0,
    baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
  });

  // 3. 完整 Prompt（与 intent-router.node.ts 一致）
  const prompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      `You are an e-commerce customer service intent classifier. Classify the user input into one of the following nine categories. Output ONLY the category name, nothing else.

## Categories

### order — Order related
User inquires about order status, shipping, refund progress, order details, etc.
Examples: "Where is my order", "I want a refund", "Check order status", "Show my last order"

### wallet — Wallet / Balance
User inquires about wallet balance, recharge history, transactions, withdrawals, etc.
Examples: "How much money do I have", "Check my balance", "I want to withdraw", "My transaction history"

### coupon — Coupon
User inquires about their coupons, available coupons to claim, claiming a coupon, etc.
Examples: "What coupons do I have", "Any available coupons", "Claim a discount coupon"

### user — Personal info
User inquires about personal information, account details, membership level, shipping address, etc.
Examples: "My profile info", "My membership level", "My shipping address"

### product — Product / Group buy
User searches for products, checks product details, inquires about group buying, etc.
Examples: "Search for Bluetooth earphones", "How much is this item", "Any group buys available"

### lucky-draw — Lucky draw
User inquires about lottery tickets, winning records, performing a draw, etc.
Examples: "My lottery tickets", "Did I win", "I want to draw"

### rag — Policies / Rules
User asks about return policy, shipping policy, coupon rules, privacy policy, etc.
Examples: "How to return", "How long does shipping take", "Can I use this coupon", "Privacy policy"

### general — General chat
Greetings, thanks, self-introduction, casual chat that doesn't need data query.
Examples: "Hello", "Thank you", "Who are you", "Nice weather today"

### unknown — Cannot determine
Use this when none of the above categories fit. Falls back to general chat.
Examples: Gibberish, garbled text, incomprehensible input

Output only one word: order or wallet or coupon or user or product or lucky-draw or rag or general or unknown`,
    ],
    ["human", "{input}"],
  ]);

  const chain = prompt.pipe(model).pipe(new StringOutputParser());

  // 4. 测试用例
  const tests = [
    { input: "Where is my order", expected: "order" },
    { input: "How much money do I have", expected: "wallet" },
    { input: "Any coupons available", expected: "coupon" },
    { input: "Hello, who are you", expected: "general" },
    { input: "What is your return policy", expected: "rag" },
    { input: "Search for Bluetooth earphones", expected: "product" },
    { input: "My lottery tickets", expected: "lucky-draw" },
    { input: "My profile info", expected: "user" },
    { input: "asdfghjkl", expected: "unknown" },
  ];

  let passed = 0;
  let failed = 0;

  for (const { input, expected } of tests) {
    const result = await chain.invoke({ input });
    const actual = result.trim().toLowerCase();
    const ok = actual === expected;

    console.log(
      (ok ? "✅" : "❌") +
        "  " +
        input.padEnd(35) +
        "→ " +
        actual.padEnd(15) +
        (ok ? "" : ` (期望: ${expected})`),
    );

    if (ok) passed++;
    else failed++;
  }

  // 5. 汇总
  const total = tests.length;
  console.log(`\n📊 结果: ${passed}/${total} 通过, ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("❌ 脚本异常:", err.message);
  process.exit(1);
});
