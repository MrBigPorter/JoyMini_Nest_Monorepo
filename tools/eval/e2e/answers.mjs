/**
 * 动作类用例的「用户补答」驱动。
 *
 * ── 为什么需要 ──
 * 地址工具的设计就是「像表单一样一次问一个字段」（见 createAddress 描述：
 * 先 getUserProfile 预填，再逐个问 province/city/barangay/fullAddress，最后
 * 预览确认）。它不是一个单轮就能完成的动作。测试要真跑通，用户就得像真人
 * 那样回答 AI 的追问——这不是改题，是用真实对话把流程走完。
 *
 * 这里只做「读上一句 AI 在问什么 → 用槽位值回答」，纯函数，便于单测。
 * 没有可答的字段时不乱编，交给上层决定是否补一句「确认」。
 */

const ADDRESS_RULES = [
  {
    key: "name",
    pattern: /(联系人|收货人|姓名|名字|contact\s*name|recipient\s*name)/i,
    value: () => "Maria Santos",
  },
  {
    key: "phone",
    pattern: /(电话|手机号|联系方式|phone|mobile)/i,
    value: (slots) => slots.contactPhone ?? slots.withdrawAccount,
  },
  {
    key: "province",
    pattern: /(省份|省|province|region|[A-Za-z]*\s*province)/i,
    value: (slots) => slots.createAddressProvince ?? "Cebu",
  },
  {
    key: "city",
    pattern: /(城市|市|city|municipality)/i,
    value: (slots) => slots.createAddressCityEn ?? "Cebu City",
  },
  {
    key: "barangay",
    pattern: /(barangay|区|街区|街道|district)/i,
    value: (slots) => slots.createAddressBarangay ?? "Lahug",
  },
  {
    key: "fullAddress",
    pattern: /(详细地址|门牌|楼|单元|街|street|unit|building|full\s*address|address\s*details)/i,
    value: (slots) =>
      slots.createAddressFull ?? "JY Square Mall 3F Unit 302, Lahug",
  },
  {
    key: "label",
    pattern: /(标签|备注|label)/i,
    value: () => "宿务仓",
  },
];

/** AI 正在请用户确认（含预览/确认卡片前的话术）时，用户答「确认」。 */
const CONFIRM_PATTERN = /(请确认|确认要|确认是否|确认后|是否确认|要保存|保存吗|创建吗|提交吗|预览|confirm\s*(it|and|to)?)/i;

/** 确认话术带上动作名：单说「确认」容易被路由到别的意图。 */
const CONFIRM_REPLY = {
  create_address: "确认，帮我保存这个地址",
  update_address: "确认，就改这个地址",
  delete_address: "确认删除这个地址",
};

/** AI 问「哪一个地址」时要报出目标地址的标签。 */
const WHICH_ADDRESS_PATTERN = /(哪一个地址|哪个地址|哪个收货地址|哪一条|具体是哪一个|具体哪一)/i;

/** 改地址时 AI 常问「订单地址还是账户地址」，先答清楚指代。 */
const ADDRESS_SCOPE_PATTERN = /(订单.{0,6}地址|账户.{0,6}地址|收货地址还是|order\s*address|account\s*address)/i;

/**
 * 为地址类动作创建一个「补答器」。
 *
 * @param {{ action: string, slots?: object, label?: string }} options
 * @returns {(replyText: string) => string | null} 返回下一句用户发言，null 表示无可答
 */
export function createAnswerDriver({ action, slots = {}, label = null } = {}) {
  const answered = new Set();
  const isAddressAction = ["create_address", "update_address", "delete_address"].includes(action);

  return function nextAnswer(replyText = "") {
    const text = String(replyText ?? "");
    if (!text.trim()) return null;

    if (isAddressAction && label && !answered.has("which") && WHICH_ADDRESS_PATTERN.test(text)) {
      answered.add("which");
      return label;
    }

    if (isAddressAction && !answered.has("scope") && ADDRESS_SCOPE_PATTERN.test(text)) {
      answered.add("scope");
      return "账户里的收货地址";
    }

    // 预览里会复述「省/城市/电话」，先判断是不是在请确认，避免把预览当成
    // 又问了一遍省份。
    if (!answered.has("confirm") && CONFIRM_PATTERN.test(text)) {
      answered.add("confirm");
      return CONFIRM_REPLY[action] ?? "确认";
    }

    if (isAddressAction) {
      for (const rule of ADDRESS_RULES) {
        if (answered.has(rule.key)) continue;
        if (!rule.pattern.test(text)) continue;
        const value = rule.value(slots);
        if (!value) continue;
        answered.add(rule.key);
        return String(value);
      }
    }

    return null;
  };
}

/** 动作对应的「同意」发言（run.mjs 的兜底同意轮也用这个）。 */
export function confirmReplyFor(action) {
  return CONFIRM_REPLY[action] ?? "确认";
}

export { ADDRESS_RULES, CONFIRM_PATTERN, CONFIRM_REPLY };
