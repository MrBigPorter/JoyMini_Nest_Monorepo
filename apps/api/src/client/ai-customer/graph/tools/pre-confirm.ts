/**
 * pre-confirm — 写工具「弹卡前参数校验」
 *
 * ── 解决什么问题？ ──
 * 写工具（createAddress / updateAddress / deleteAddress）在 Agent 循环里
 * 被截停，工具函数体根本不执行，参数直接写进确认卡片。工具函数体内
 * 的归属校验（`addressService.detail`）因此在这条链路上是死代码：
 * 模型把 userId 当成 addressId 填进来，卡片照样弹出来，用户点确认才报错。
 *
 * 把校验挂到工具对象上，让 Agent 循环在「截停之前」先跑一遍：
 *   - 返回 null  → 参数合法，照常弹卡；
 *   - 返回字符串 → 校验失败，把这句话作为 ToolMessage 喂回模型，
 *     模型可以改用 listAddresses 查到的真实 ID 重试，或者反问用户。
 *
 * ── 为什么用 WeakMap 而不是给工具加字段？ ──
 * 工具是 LangChain 的 DynamicStructuredTool，给它塞私有字段会和库的
 * 序列化/绑定行为耦合；WeakMap 随工具对象回收，不污染工具本身，也不需要
 * 把 AddressService 一路透传到 agent-runner。
 */

type PreConfirmCheck = (
  args: Record<string, any>,
) => Promise<string | null> | string | null;

const checks = new WeakMap<object, PreConfirmCheck>();

/** 给工具挂上「弹卡前校验」。同一个工具重复挂载以最后一次为准。 */
export function attachPreConfirm(
  tool: object,
  check: PreConfirmCheck,
): void {
  checks.set(tool, check);
}

/** 取工具的弹卡前校验；没挂返回 undefined（视为合法）。 */
export function getPreConfirm(
  tool: object | undefined,
): PreConfirmCheck | undefined {
  return tool ? checks.get(tool) : undefined;
}
