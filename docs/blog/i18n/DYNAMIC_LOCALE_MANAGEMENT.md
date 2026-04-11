# 动态语言管理系统 - 架构设计文档

## 🌐 设计哲学

> 我们不知道未来需要支持多少种语言。
> 所以我们不做 "N语言系统"，我们做 "无限语言系统"，然后用开关控制。

---

## 🏗️ 整体架构

```
System Config (DB)
       ↓
useAvailableLocales Hook (Singleton)
       ↓
├───────────┬───────────┬───────────┐
↓           ↓           ↓           ↓
LanguageSwitch  getDefaultLocalizedValue  AI Translation Queue  Frontend Render
```

✅ 整个系统只有一个真实数据源
✅ 所有组件自动响应变更
✅ 没有任何硬编码
✅ 零停机语言开关

---

## 📋 API 接口定义

### 1. 获取已启用语言列表

```http
GET /v1/admin/system/locales
```

**Response:**

```json
{
  "locales": [
    { "code": "zh", "name": "中文", "enabled": true },
    { "code": "en", "name": "English", "enabled": true },
    { "code": "ja", "name": "日本語", "enabled": false },
    { "code": "ko", "name": "한국어", "enabled": false },
    { "code": "fr", "name": "Français", "enabled": false },
    { "code": "de", "name": "Deutsch", "enabled": false }
  ]
}
```

### 2. 开关单个语言

```http
PATCH /v1/admin/system/locales/:code
```

**Request Body:**

```json
{ "enabled": true }
```

---

## 🧩 核心组件

### 1. useAvailableLocales Hook

```typescript
// 全局单例，整个系统共享同一个状态
export function useAvailableLocales() {
  const { data } = useSWR("/v1/admin/system/locales");
  return {
    locales: data?.locales ?? [],
    enabledLocales: data?.locales.filter((l) => l.enabled) ?? [],
    isEnabled: (code: Locale) =>
      data?.locales.find((l) => l.code === code)?.enabled ?? false,
  };
}
```

✅ 自动缓存
✅ 实时更新
✅ 所有组件自动同步

### 2. getDefaultLocalizedValue 工具函数

```typescript
export function getDefaultLocalizedValue(): LocalizedString {
  const { enabledLocales } = useAvailableLocales();
  return Object.fromEntries(
    enabledLocales.map((locale) => [locale.code, ""]),
  ) as LocalizedString;
}
```

✅ 自动生成当前启用语言的空对象
✅ 不需要修改任何代码，加语言自动适配

### 3. LanguageSwitch 组件

```typescript
export function LanguageSwitch() {
  const { enabledLocales } = useAvailableLocales()
  // 自动只显示启用的语言按钮
  return enabledLocales.map(locale => (
    <Button key={locale.code}>{locale.name}</Button>
  ))
}
```

✅ 不需要传任何参数
✅ 全局自动响应语言开关变更

---

## 🔄 AI 翻译逻辑

```typescript
async function translateDocument(id: string, sourceLocale: Locale) {
  const { enabledLocales } = useAvailableLocales();

  // 只翻译当前已启用的语言
  const targetLocales = enabledLocales
    .filter((l) => l.code !== sourceLocale)
    .map((l) => l.code);

  // 进入翻译队列
  await queueTranslation(id, sourceLocale, targetLocales);
}
```

✅ 关闭的语言不会浪费 API 额度
✅ 语言打开后自动开始翻译历史数据
✅ 可以随时开关，不影响已有翻译

---

## 🚀 现有表单迁移指南

### 标准 3 步升级流程:

1. **替换默认值:**

```typescript
// ❌ 旧的硬编码写法
const defaultValues = {
  name: { zh: "", en: "" },
};

// ✅ 新的动态写法
const defaultValues = {
  name: getDefaultLocalizedValue(),
};
```

2. **添加 localize 绑定:**

```typescript
<FormTextField {...localize('name')} />
```

3. **语言开关会自动出现:**
   > 不需要做任何其他事情！

---

## 🛡️ 边界情况处理

| 场景            | 处理逻辑                                     |
| --------------- | -------------------------------------------- |
| ✅ 语言被关闭   | 已有的翻译完整保留，只是不在表单上显示       |
| ✅ 语言重新打开 | 之前的翻译自动恢复，不需要重新翻译           |
| ✅ 新增语言     | 所有历史数据自动有了新字段，后台开始批量翻译 |
| ✅ 删除语言     | 翻译数据永久保留，随时可以重新启用           |
| ✅ 翻译错误     | 管理员随时可以手动覆盖单个语言               |

---

## ⏳ 渐进式上线路线图

| 阶段   | 操作                                     | 时间         |
| ------ | ---------------------------------------- | ------------ |
| 阶段 1 | 只打开中文，系统和普通单语言系统完全一样 | 上线第 0 天  |
| 阶段 2 | 打开英语，AI 开始在后台翻译所有历史内容  | 出海准备期   |
| 阶段 3 | 打开日语/韩语，针对特定市场开放          | 进入新市场时 |
| 阶段 N | 打开任意新语言，5 秒钟切换完成           | 任何时间     |

---

## ✅ 设计原则

1.  **零侵入设计** - 业务开发者不需要知道多语言的存在
2.  **零停机变更** - 开关语言不需要重启，不需要部署
3.  **零数据丢失** - 关闭语言不会删除任何已有翻译
4.  **零代码扩展** - 新增语言不需要修改一行代码

---

## 📅 实施时间估算

| 模块                              | 所需时间 |
| --------------------------------- | -------- |
| 系统配置 API + 管理页面           | 30 分钟  |
| useAvailableLocales Hook          | 10 分钟  |
| getDefaultLocalizedValue 工具函数 | 5 分钟   |
| LanguageSwitch 动态适配           | 5 分钟   |
| AI 翻译队列过滤逻辑               | 10 分钟  |

**✅ 总时间: 60 分钟**

---

_最后更新: 2026-04-10_
_作者: 架构组_
