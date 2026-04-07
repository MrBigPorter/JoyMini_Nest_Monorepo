# App 原生功能路线图与实现规划

> ✅ 渐进式原生功能增强路线图，按投入产出比排序
> ✅ 零原生开发经验的前端开发者也可以全部实现
> ✅ 所有功能不会增加业务代码维护复杂度

---

## 🎯 核心设计原则

### ✅ 渐进增强原则

```
✅ 同一个功能，同一个API，不同平台自动适配最佳实现：

┌───────────────────┬─────────────────────────┐
│     Web 浏览器     │ 调用 Web 标准 API       │
├───────────────────┼─────────────────────────┤
│     微信H5        │ 调用微信 JS-SDK         │
├───────────────────┼─────────────────────────┤
│     原生App       │ 调用系统原生能力         │
└───────────────────┴─────────────────────────┘
```

✅ 业务开发人员永远不需要知道平台差异
✅ 所有复杂度全部隐藏在适配层后面
✅ 不需要写任何平台判断的业务代码

---

## 🚀 阶段一：基础原生体验 (开发前3天，必须做)

| 功能                  | 实现难度 | 体验提升 | 说明                                    | Capacitor 插件          |
| --------------------- | -------- | -------- | --------------------------------------- | ----------------------- |
| ✅ **系统原生分享**   | 🟢 极低  | 🔴 极高  | 调用系统原生分享面板，支持所有已安装App | `@capacitor/share`      |
| ✅ **外部链接打开**   | 🟢 极低  | 🟠 高    | 外部链接用系统浏览器打开，不占WebView   | `@capacitor/browser`    |
| ✅ **状态栏颜色适配** | 🟢 极低  | 🟠 高    | 根据页面主题自动切换状态栏深色/浅色     | `@capacitor/status-bar` |
| ✅ **手势返回支持**   | 🟢 极低  | 🟠 高    | iOS侧滑手势，Android返回键支持          | 内置                    |
| ✅ **键盘自动适配**   | 🟢 极低  | 🟡 中    | 键盘弹出时自动调整页面布局              | `@capacitor/keyboard`   |

> 💡 这5个功能全部加起来只需要写不到100行代码，但是可以让App看起来和纯原生没有任何区别。

### 代码示例

```tsx
// 业务代码，永远这样写，不需要关心平台
import { useShare } from "@/lib/hooks/useShare";

export default function ShareButton({ article }) {
  const share = useShare();

  return (
    <Button
      onClick={() =>
        share({
          title: article.title,
          text: article.summary,
          url: `https://blog.luckynest.com/articles/${article.slug}`,
        })
      }
    >
      分享
    </Button>
  );
}
```

---

## 🚀 阶段二：核心增强功能 (开发第一周，推荐做)

| 功能              | 实现难度 | 体验提升 | 说明                                     | Capacitor 插件                  |
| ----------------- | -------- | -------- | ---------------------------------------- | ------------------------------- |
| ✅ **推送通知**   | 🟡 中    | 🔴 极高  | 新文章发布推送，支持 Firebase / 极光推送 | `@capacitor/push-notifications` |
| ✅ **离线阅读**   | 🟡 中    | 🔴 极高  | 打开过的文章自动缓存，无网络也可阅读     | `@tanstack/query/persist`       |
| ✅ **本地收藏**   | 🟡 中    | 🟠 高    | 文章收藏，存储在App本地                  | `@capacitor/preferences`        |
| ✅ **阅读历史**   | 🟡 中    | 🟠 高    | 自动记录阅读历史                         | 本地存储                        |
| ✅ **应用内评价** | 🟡 中    | 🟡 中    | 弹窗引导用户在应用商店评分               | `@capacitor/app-launcher`       |

---

## 🚀 阶段三：高级优化功能 (上线后，可选做)

| 功能                  | 实现难度 | 体验提升 | 说明                            | Capacitor 插件             |
| --------------------- | -------- | -------- | ------------------------------- | -------------------------- |
| ✅ 3D Touch 快捷菜单  | 🟠 中    | 🟡 中    | iPhone重按图标直接进入搜索/热门 | `@capacitor/quick-actions` |
| ✅ 桌面 Widget 小组件 | 🟠 中    | 🟡 中    | 桌面显示最新文章                | 原生插件                   |
| ✅ Handoff 接力       | 🟠 中    | 🟡 低    | 手机/电脑跨设备继续阅读         | 内置                       |
| ✅ 系统分享扩展       | 🔴 高    | 🟠 高    | 其他App可以直接分享到博客       | 原生扩展                   |

---

## 🚫 绝对不要做的功能

| 功能            | 为什么不做                  | 替代方案                            |
| --------------- | --------------------------- | ----------------------------------- |
| ❌ 原生登录界面 | 投入产出比极低，需要做3套UI | WebView内登录，用户完全感知不到区别 |
| ❌ 原生评论表单 | 原生开发需要5倍工作量       | React表单体验更好，维护成本低10倍   |
| ❌ 原生列表渲染 | 性能差异小于10%             | React FlatList完全够用              |
| ❌ 原生文章渲染 | 富文本渲染是Web的强项       | React Markdown比原生实现好10倍      |

---

## 📋 集成步骤

### 第一步: 安装插件

```bash
yarn add @capacitor/share @capacitor/browser @capacitor/status-bar @capacitor/keyboard @capacitor/preferences @capacitor/push-notifications
```

### 第二步: 初始化适配层

```typescript
// src/lib/platform/native.ts
import { Share } from "@capacitor/share";
import { Browser } from "@capacitor/browser";
import { StatusBar } from "@capacitor/status-bar";
import { Keyboard } from "@capacitor/keyboard";

export const native = {
  async share(options) {
    if (Capacitor.isNativePlatform()) {
      return await Share.share(options);
    }
    // Web 降级实现
    if (navigator.share) {
      return await navigator.share(options);
    }
    // 降级到复制链接
    await copyToClipboard(options.url);
    toast.success("链接已复制");
  },

  async openUrl(url) {
    if (Capacitor.isNativePlatform()) {
      return await Browser.open({ url });
    }
    window.open(url, "_blank");
  },

  setStatusBarColor(color) {
    if (Capacitor.isNativePlatform()) {
      StatusBar.setBackgroundColor({ color });
    }
  },
};
```

### 第三步: 提供给业务代码

```typescript
// src/lib/hooks/usePlatform.ts
export function usePlatform() {
  const isNative = typeof window !== "undefined" && "Capacitor" in window;

  return {
    isNative,
    share: native.share,
    openUrl: native.openUrl,
    setStatusBarColor: native.setStatusBarColor,
  };
}
```

---

## ✅ 维护成本评估

| 阶段   | 代码量 | 预计维护频率               |
| ------ | ------ | -------------------------- |
| 阶段一 | ~100行 | 整个项目生命周期 < 5次修改 |
| 阶段二 | ~300行 | 每年 < 2次修改             |
| 阶段三 | ~500行 | 每季度 < 1次修改           |

✅ 所有原生功能的总代码量 < 1000 行
✅ 适配层一旦写完基本不会再动
✅ 业务代码零侵入
✅ 不会增加任何业务维护成本

---

## 🎯 最终效果

用户拿到手的时候，他根本不知道这是一个WebView打包的App。
他只会觉得这个App速度很快，体验很好，和他手机上其他的原生App没有任何区别。

这就是跨端开发的最高境界：**没有人知道你是用Web技术做的**。

---

**文档版本**: 1.0.0
**最后更新**: 2026-04-06
**优先级**: 严格按照此文档顺序实现，不要跳过任何阶段
