// 测试语言检测工具
const {
  LanguageDetectionService,
} = require("./apps/api/dist/common/services/language-detection.service");

// 创建服务实例
const service = new LanguageDetectionService();

console.log("=== 语言检测工具测试 ===\n");

// 测试1: 检测支持的语言
console.log("1. 支持的语言列表:");
console.log(service.getSupportedLanguages());

// 测试2: 语言检测
console.log("\n2. 语言检测测试:");

const testCases = [
  { text: "Hello world", expected: "en" },
  { text: "你好世界", expected: "zh" },
  { text: "こんにちは世界", expected: "ja" },
  { text: "안녕하세요 세계", expected: "ko" },
  { text: "Bonjour le monde", expected: "fr" },
  { text: "Hallo Welt", expected: "de" },
  { text: "React is a JavaScript library", expected: "en" },
  { text: "React是一个JavaScript库", expected: "zh" },
  { text: "ReactはJavaScriptライブラリです", expected: "ja" },
  { text: "React는 JavaScript 라이브러리입니다", expected: "ko" },
  { text: "React est une bibliothèque JavaScript", expected: "fr" },
  { text: "React ist eine JavaScript-Bibliothek", expected: "de" },
];

testCases.forEach((testCase, index) => {
  const result = service.detectLanguage(testCase.text);
  const passed = result.language === testCase.expected;
  console.log(`  ${index + 1}. "${testCase.text.substring(0, 20)}..."`);
  console.log(
    `     检测: ${result.language} (置信度: ${result.confidence.toFixed(2)})`,
  );
  console.log(`     预期: ${testCase.expected} ${passed ? "✅" : "❌"}`);
});

// 测试3: 翻译完整性检查
console.log("\n3. 翻译完整性检查:");

const completenessTests = [
  {
    source: "你好世界",
    target: "Hello world",
    language: "en",
    expected: "高完整性",
  },
  {
    source: "你好世界",
    target: "Hi",
    language: "en",
    expected: "低完整性",
  },
  {
    source: "React是一个JavaScript库",
    target: "React is a JavaScript library",
    language: "en",
    expected: "高完整性",
  },
  {
    source: "React是一个JavaScript库",
    target: "React",
    language: "en",
    expected: "低完整性",
  },
];

completenessTests.forEach((test, index) => {
  const result = service.checkTranslationCompleteness(
    test.source,
    test.target,
    test.language,
  );
  console.log(`  ${index + 1}. 源: "${test.source}"`);
  console.log(`     目标: "${test.target}" (${test.language})`);
  console.log(`     完整性: ${result.completeness}%`);
  console.log(
    `     问题: ${result.issues.length > 0 ? result.issues.join(", ") : "无"}`,
  );
});

// 测试4: 字段翻译检查
console.log("\n4. 字段翻译检查:");

const fieldTests = [
  {
    source: "你好世界",
    target: "Hello world",
    language: "en",
    expected: true,
  },
  {
    source: "你好世界",
    target: "你好世界", // 与源相同
    language: "en",
    expected: false,
  },
  {
    source: "React",
    target: "React", // 英文标签，与源相同是正常的
    language: "en",
    expected: true,
  },
  {
    source: "你好世界",
    target: "", // 空目标
    language: "en",
    expected: false,
  },
  {
    source: "你好世界",
    target: "Hi", // 过短
    language: "en",
    expected: false,
  },
];

fieldTests.forEach((test, index) => {
  const result = service.isFieldTranslated(
    test.source,
    test.target,
    test.language,
  );
  const passed = result.translated === test.expected;
  console.log(
    `  ${index + 1}. 源: "${test.source}" -> 目标: "${test.target}" (${test.language})`,
  );
  console.log(
    `     已翻译: ${result.translated} (置信度: ${result.confidence.toFixed(2)})`,
  );
  console.log(`     原因: ${result.reason}`);
  console.log(`     预期: ${test.expected} ${passed ? "✅" : "❌"}`);
});

// 测试5: 残留字符检测
console.log("\n5. 残留字符检测:");

const residualTests = [
  {
    sourceLang: "zh",
    targetText: "Hello 世界",
    targetLang: "en",
    expected: ["世", "界"],
  },
  {
    sourceLang: "zh",
    targetText: "こんにちは世界",
    targetLang: "ja",
    expected: ["世", "界"],
  },
  {
    sourceLang: "zh",
    targetText: "Hello world",
    targetLang: "en",
    expected: [],
  },
  {
    sourceLang: "zh",
    targetText: "안녕하세요 세계",
    targetLang: "ko",
    expected: [],
  },
];

residualTests.forEach((test, index) => {
  const result = service.detectResidualCharacters(
    test.sourceLang,
    test.targetText,
    test.targetLang,
  );
  const passed =
    JSON.stringify(result.sort()) === JSON.stringify(test.expected.sort());
  console.log(
    `  ${index + 1}. 源语言: ${test.sourceLang}, 目标语言: ${test.targetLang}`,
  );
  console.log(`     文本: "${test.targetText}"`);
  console.log(`     检测到: ${result.length > 0 ? result.join(", ") : "无"}`);
  console.log(
    `     预期: ${test.expected.length > 0 ? test.expected.join(", ") : "无"} ${passed ? "✅" : "❌"}`,
  );
});

console.log("\n=== 测试完成 ===");
