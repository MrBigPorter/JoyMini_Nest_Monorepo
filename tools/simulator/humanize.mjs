/**
 * 像人一样的消息节奏与文本扰动。
 *
 * 纯函数模块，不发起网络请求，也不依赖 Task 1/2 的实现：
 * - `nextDelayMs`：把 rng 映射到 5–60 秒
 * - `humanize`：偶尔追加语气词、偶尔做一次轻量错别字，保持可读
 * - `pickPersona`：为中/英文与短句/正常/急躁三种风格生成画像
 *
 * 所有随机性都来自注入的 `rng`（返回 [0, 1)），方便测试与复现。
 * 约束：只做“人味”扰动，绝不生成不可读乱码，也不改动语义。
 */

const MIN_DELAY_MS = 5000;
const MAX_DELAY_MS = 60000;

/** 语气词出现概率（中文/英文共用 20%）。 */
const PARTICLE_CHANCE = 0.2;
/** 轻量错别字概率（仅中文，5%）。 */
const TYPO_CHANCE = 0.05;

/** 中文人设占比 80%，英文 20%；风格：短句 30%、正常 50%、急躁 20%。 */
const ZH_CHANCE = 0.8;
const SHORT_STYLE_CHANCE = 0.3;
const NORMAL_STYLE_CHANCE = 0.8;

export const PERSONA_LANGUAGES = Object.freeze(["zh", "en"]);
export const PERSONA_STYLES = Object.freeze(["short", "normal", "impatient"]);

const ZH_PARTICLES = Object.freeze(["呢", "啊", "谢谢"]);
const EN_PARTICLES = Object.freeze([" please", " thanks"]);

/** 中文轻量噪声：只替换一次，且只在原文确实包含该字时生效。 */
const ZH_NOISE = Object.freeze([
  ["的", "得"],
  ["吗", "嘛"],
]);

/** 句末标点，用于把语气词放到标点前面（“要多久呢？”）。 */
const TERMINAL_PUNCTUATION = /([。！？!?…])$/;

/** 读取一次 rng 并钳制到 [0, 1]，异常值直接报错而不是静默产出坏数据。 */
function roll(rng) {
  const value = rng();
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new TypeError("rng must return a number");
  }
  return Math.min(1, Math.max(0, value));
}

/** 按 rng 从数组取一个元素（rng 必须已钳制）。 */
function pickFrom(list, value) {
  return list[Math.min(list.length - 1, Math.floor(value * list.length))];
}

/**
 * 把 rng 映射为毫秒延迟，范围 [5000, 60000]（含两端）。
 *
 * rng 返回 1（越界）时钳制为 60000，保证 driver 不会因坏 rng 切到极端值。
 *
 * @param {() => number} [rng]
 * @returns {number}
 */
export function nextDelayMs(rng = Math.random) {
  const span = MAX_DELAY_MS - MIN_DELAY_MS + 1;
  const delay = MIN_DELAY_MS + Math.floor(roll(rng) * span);
  return Math.min(MAX_DELAY_MS, delay);
}

/** 在句末标点前插入中文语气词；“谢谢”作为独立短句追加。 */
function appendZhParticle(text, particle) {
  if (particle === "谢谢") {
    return TERMINAL_PUNCTUATION.test(text) ? `${text}谢谢` : `${text}，谢谢`;
  }

  const terminal = text.match(TERMINAL_PUNCTUATION);
  if (!terminal) return `${text}${particle}`;

  const head = text.slice(0, -terminal[1].length);
  return `${head}${particle}${terminal[1]}`;
}

/** 英文语气词：please 放在问句/句末标点前，thanks 追加在末尾。 */
function appendEnParticle(text, particle) {
  if (particle === " please") {
    const terminal = text.match(/[.!?]$/);
    if (!terminal) return `${text}${particle}`;
    return `${text.slice(0, -1)}${particle}${terminal[0]}`;
  }
  return `${text}${particle}`;
}

/** 只替换原文中真实存在的一个字，避免制造无关乱码。 */
function applyZhNoise(text, value) {
  const candidates = ZH_NOISE.filter(([from]) => text.includes(from));
  if (candidates.length === 0) return text;

  const [from, to] = pickFrom(candidates, value);
  return text.replace(from, to);
}

/**
 * 给一句用户消息加上轻微的人类痕迹。
 *
 * - 空串/纯空白：原样返回（driver 不应发送空消息）
 * - 20%：追加“呢 / 啊 / 谢谢”（英文为 please / thanks）
 * - 若未追加语气词，5%：把“的”换成“得”或“吗”换成“嘛”（仅中文）
 * - 其余情况：原样返回
 *
 * @param {string} text
 * @param {() => number} [rng]
 * @param {{ language?: "zh" | "en" }} [opts]
 * @returns {string}
 */
export function humanize(text, rng = Math.random, opts = {}) {
  if (typeof text !== "string") {
    throw new TypeError(`humanize: text must be a string, got ${typeof text}`);
  }

  const language = opts.language ?? "zh";
  if (!PERSONA_LANGUAGES.includes(language)) {
    throw new Error(
      `humanize: language must be one of ${PERSONA_LANGUAGES.join(", ")}, got "${language}"`,
    );
  }

  if (text.trim() === "") return text;

  if (roll(rng) < PARTICLE_CHANCE) {
    const particles = language === "en" ? EN_PARTICLES : ZH_PARTICLES;
    const particle = pickFrom(particles, roll(rng));
    return language === "en"
      ? appendEnParticle(text, particle)
      : appendZhParticle(text, particle);
  }

  // 英文只加语气词，不做错别字替换，避免破坏意图表达。
  if (language === "en") return text;

  if (roll(rng) >= TYPO_CHANCE) return text;
  return applyZhNoise(text, roll(rng));
}

/**
 * 随机生成一个用户画像（语言 + 说话风格）。
 *
 * 语言：中文 80% / 英文 20%；风格：短句 30% / 正常 50% / 急躁 20%。
 * 返回冻结对象，可安全地放进账号池或并发任务里共享。
 *
 * @param {() => number} [rng]
 * @returns {{ language: "zh" | "en", style: "short" | "normal" | "impatient" }}
 */
export function pickPersona(rng = Math.random) {
  const languageRoll = roll(rng);
  const styleRoll = roll(rng);

  const language = languageRoll < ZH_CHANCE ? "zh" : "en";
  let style = "impatient";
  if (styleRoll < SHORT_STYLE_CHANCE) style = "short";
  else if (styleRoll < NORMAL_STYLE_CHANCE) style = "normal";

  return Object.freeze({ language, style });
}
