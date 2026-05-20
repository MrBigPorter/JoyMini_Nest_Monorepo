# Hydration Mismatch 排查与预防指南

> 写给自己的直白说明。不讲原理，只讲怎么做。  
> 背景：2026-05-20 花了整整一天踩了 3 个这类 Bug，整理此文。

---

## 先理解一件事：SSR 是什么意思

Next.js 会把页面在**服务器上跑一遍**，生成 HTML 发给浏览器。  
浏览器收到 HTML 后，React 再在客户端"接管"这个 HTML —— 这个过程叫 **Hydration（水合）**。

水合时 React 会对比：

```
服务器生成的 HTML   vs   客户端 React 渲染的虚拟 DOM
```

**两者必须完全一致**，否则就报 Hydration Mismatch。

---

## 错误分三级，严重程度不同

| 控制台报错关键字                                                              | 严重级别 | 后果                                              |
| ----------------------------------------------------------------------------- | -------- | ------------------------------------------------- |
| `Hydration failed...tree will be regenerated`                                 | 🔴 严重  | 整棵树丢弃重建，用户看到页面闪烁/白屏             |
| `A tree hydrated but some attributes didn't match...This won't be patched up` | 🟡 一般  | 只有属性不一致，树保留，但可能图片加载错误 srcSet |
| `Warning: Prop did not match`                                                 | 🟢 轻微  | 样式轻微闪烁                                      |

**原则：看到 🔴 立刻修，不要积累。🟡 当天修。**

---

## 四种常见原因 + 对应修法

### 原因一：`typeof window !== 'undefined'` 出现在 render 里

**服务器上没有 `window`，所以服务器永远返回 `false`，客户端返回 `true`，两边不一样。**

```tsx
// ❌ 错误写法 — 直接在 render 路径里判断
const isClient = typeof window !== "undefined";
const savedUrl = isClient ? window.location.pathname : "";

// ❌ 错误写法 — 在 useState 初始值里判断
const [isBack, setIsBack] = useState(
  typeof window !== "undefined" && getNavDirection() === "backward",
);
```

```tsx
// ✅ 正确写法 — useState 给稳定初始值，useEffect 里再读 window
const [isBack, setIsBack] = useState(false); // 服务器/客户端都是 false，一致

useEffect(() => {
  // useEffect 只在客户端跑，不影响水合
  setIsBack(getNavDirection() === "backward");
}, []);
```

**速记：所有 `typeof window`、`window.xxx`、`document.xxx`、`navigator.xxx` 必须在 `useEffect` 里。**

---

### 原因二：`useState` 初始值在服务器和客户端计算结果不同

最常见的坑：在 `useState` 的懒初始化函数里读浏览器 API。

```tsx
// ❌ 错误写法 — navigator 在服务器上不存在
const [quality, setQuality] = useState(() => {
  if (typeof navigator === "undefined") return 75; // 服务器走这里 → 75
  return navigator.connection?.effectiveType === "3g" // 客户端走这里 → 可能 45
    ? 45
    : 75;
});
// 结果：服务器渲染 quality=75，客户端水合时 quality=45 → srcSet 不同 → mismatch
```

```tsx
// ✅ 正确写法 — 初始值固定，useEffect 里改
const [quality, setQuality] = useState(75); // 服务器/客户端初始值都是 75

useEffect(() => {
  const conn = (navigator as any).connection;
  if (conn?.effectiveType === "3g") setQuality(45);
  // 这里的 setQuality 发生在水合完成后，不影响水合
}, []);
```

**速记：`useState` 的初始值 = 服务器渲染值。所有"需要浏览器才能知道"的值都不能作为初始值。**

---

### 原因三：浏览器专属的库放进了 SSR

有些库在服务器上根本不能运行，比如 `hls.js`（操作 `<video>`）、`canvas` 相关、WebGL 相关。

```tsx
// ❌ 错误写法 — 直接 import 并渲染
import { HlsVideoPlayer } from './HlsVideoPlayer';  // hls.js 依赖 document/window
<HlsVideoPlayer ... />
// 服务器渲染时生成了 HTML，客户端水合时 hls.js 初始化状态不同 → mismatch
```

```tsx
// ✅ 正确写法 — dynamic + ssr:false，服务器不渲染，水合时直接挂载
import dynamic from "next/dynamic";

const HlsVideoPlayer = dynamic(
  () => import("./HlsVideoPlayer").then((m) => ({ default: m.HlsVideoPlayer })),
  {
    ssr: false, // 服务器跳过渲染这个组件
    loading: () => <div className="animate-pulse h-full" />, // 骨架占位
  },
);
// 服务器不渲染 → 客户端不用对比 → 永远不会 mismatch
```

**速记：组件用到浏览器专属 API 或库时，加 `dynamic({ ssr: false })`。**

---

### 原因四：Docker 里 `.next` 目录被命名 volume 缓存（开发环境专项）

这个问题很隐蔽：改了代码，服务端热更新了，但客户端 bundle 还是旧的。看起来像代码 bug，实际上是 Docker 缓存问题。

```yaml
# ❌ 危险写法 —— .next 被持久化到命名 volume
volumes:
  - blog_next_build:/app/apps/frontend-blog/.next # 改了代码，旧 bundle 永远留着


# ✅ 正确写法 —— 删掉这行，.next 留在容器内（容器销毁即清除）
# 什么都不写，Next.js 自己管理 .next 目录
```

**症状**：server 渲染用新代码，client bundle 还是旧代码，两端不一致。  
**快速解决**：`docker compose down && docker volume rm <项目名>_blog_next_build && docker compose up`

---

## 遇到报错时的排查步骤

```
1. 看报错的 diff（+ 是客户端，- 是服务器）
   ├── 标签名不同（如 h2 vs h3）→ 原因三（缓存问题）或原因一
   ├── className/style 不同 → 原因一或原因二
   ├── srcSet/href 不同 → 原因二（quality/URL 计算依赖浏览器状态）
   └── 整棵子树缺失 → 原因三（组件只在客户端存在）

2. 找到报错组件（Call Stack 里找源码文件名）

3. 在该组件里找：
   ├── 有没有 typeof window → 移进 useEffect
   ├── 有没有 useState 读浏览器 API → 固定初始值 + useEffect 更新
   ├── 有没有 Date.now() / Math.random() → 移进 useEffect
   └── 有没有只能在浏览器运行的库 → dynamic({ ssr: false })

4. 如果代码看起来完全正确 → 大概率是 Docker volume 缓存
   docker compose restart <服务名>
```

---

## 速查：哪些东西必须在 useEffect 里

| 必须在 useEffect 里的               | 例子                                         |
| ----------------------------------- | -------------------------------------------- |
| `window.*`                          | `window.location`, `window.scrollY`          |
| `document.*`                        | `document.title`, `document.cookie`          |
| `navigator.*`                       | `navigator.connection`, `navigator.language` |
| `localStorage` / `sessionStorage`   | 读取保存的偏好设置                           |
| `Date.now()` / 当前时间             | 显示"X 分钟前"                               |
| `Math.random()`                     | 随机 ID、随机位置                            |
| `screen.width` / `devicePixelRatio` | 响应式判断                                   |

| 可以在 render 里安全用的 | 例子                                  |
| ------------------------ | ------------------------------------- |
| 来自 props 的数据        | `article.title`, `article.coverImage` |
| 来自 URL 参数的数据      | `searchParams.get('category')`        |
| 来自服务端 fetch 的数据  | `initialData.items`                   |
| 静态常量                 | `const MAX = 100`                     |

---

## 这个项目已知修复过的案例

| 问题                                                       | 根因                                                       | 修复方式                                 | 文件                             |
| ---------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------- | -------------------------------- |
| `BottomNavigation` 完整子树消失                            | Zustand persist + platform.ts 模块级常量在 SSR/Client 不同 | `dynamic({ ssr: false })`                | `BottomNavigation.tsx`           |
| `HlsVideoPlayer` className 不同（`object-contain` 多出来） | Docker 命名 volume 缓存了旧 client bundle                  | `dynamic({ ssr: false })` + 删 volume    | `ArticleCard.tsx`, `compose.yml` |
| `BlurhashImage` srcSet 不同（quality=75 vs quality=45）    | `useNetworkQuality` 初始值读 `navigator.connection`        | 固定初始值为 `'unknown'`，useEffect 更新 | `useNetworkQuality.ts`           |
| `<img>` srcSet 属性不同（width 列表差异）                  | Turbopack dev 模式下 image config server/client 不同步     | `suppressHydrationWarning`               | `BlurhashImage.tsx`              |
| `isBackNavigation` 导致 displayArticles 顺序不同           | `typeof window !== 'undefined'` 在 render 路径里           | `useState(false)` + `useEffect` 设置     | `page.client.tsx`                |
| `AboutFounderAvatar` 的 `<img>` data-nimg/srcSet 属性不同  | Turbopack server/client bundle 不同步：fill 分支 SSR 用 plain `<img>`，client bundle 用旧 `<Image>` 代码，导致 `data-nimg="fill"` 和 `srcSet` 在客户端出现 | `suppressHydrationWarning` 双层防御 + 增强 `dev-clean.sh` 进程杀死逻辑 | `BlurhashImage.tsx` + `dev-clean.sh` |

---

## 一句话记忆法

> **服务器能跑的代码 = 水合安全。服务器跑不了的逻辑，必须在 `useEffect` 里。**

如果不确定某段代码服务器能不能跑，就想：**这段代码放在一台没有浏览器的 Node.js 服务器上，会报错吗？** 会报错 → 必须移到 `useEffect`。

---

_最后更新：2026-05-20_  
_问题排查历时：约 10 小时（请引以为戒 😭）_
