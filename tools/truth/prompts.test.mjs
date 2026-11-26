import assert from "node:assert/strict";
import test from "node:test";

import { scanPrompts } from "./prompts.mjs";

function prompt(config, { name = "wallet", activeVersion = 5 } = {}) {
  return { name, activeVersion, config };
}

test("占位文本不误报：金额与进度都指向工具结果", () => {
  const report = scanPrompts([
    prompt({
      role: "You are the wallet assistant.",
      displayFormat: "Cash balance uses ₱ as the unit. All amounts MUST use ₱ (Philippine peso).",
      examples:
        'Reply: "Your balance: ₱[amount from tool result]"',
      domainRules: 'Show "[progress from result]% sold" exactly as returned.',
    }),
  ]);
  assert.equal(report.scanned, 1);
  assert.deepEqual(report.violations, []);
});

test("比例字面量：判违规并指出提示词、版本与字段路径", () => {
  const report = scanPrompts([
    prompt({ role: "You are the wallet assistant.", domainRules: "Withdrawal fee is 0.8% of the amount." }),
  ]);
  assert.equal(report.scanned, 1);
  assert.equal(report.violations.length, 1);
  const [violation] = report.violations;
  assert.equal(violation.name, "wallet");
  assert.equal(violation.version, 5);
  assert.equal(violation.kind, "percent");
  assert.match(violation.path, /domainRules/);
  assert.match(violation.match, /0\.8%/);
});

test("金额字面量：比索符号与 PHP 前缀都算违规", () => {
  const report = scanPrompts([
    prompt({
      hardRules: [
        "Minimum deposit is ₱100.",
        "The bank transfer limit is PHP 80,000 per transaction.",
      ],
    }),
  ]);
  assert.equal(report.violations.length, 2);
  assert.deepEqual(
    report.violations.map((violation) => violation.kind),
    ["money", "money"],
  );
  assert.match(report.violations[0].path, /hardRules\[0\]/);
  assert.match(report.violations[1].path, /hardRules\[1\]/);
});

test("金额字面量：数字加 pesos 字样也算违规", () => {
  const report = scanPrompts([prompt({ flowContext: "Charge 15 pesos for every payout." })]);
  assert.equal(report.violations.length, 1);
  assert.equal(report.violations[0].kind, "peso");
});

test("没有任何生效提示词：scanned 为 0（加载失败由调用方判失败）", () => {
  const report = scanPrompts([]);
  assert.deepEqual(report, { scanned: 0, violations: [] });
});
