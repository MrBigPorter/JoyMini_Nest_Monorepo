# AI Best Practices - 代码示例与最佳实践模式

> 此文件为 `.clinerules` 的补充参考文档，包含详细的代码示例和最佳实践模式。
> 当需要参考具体代码实现模式时，请查阅此文件。

## 水合错误预防模式

```typescript
// ❌ 错误：直接使用浏览器API
const isMobile = window.innerWidth < 768;

//  正确：使用防御性Hook
const useIsMobile = () => {
  const isClient = useIsClient();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (isClient) {
      setIsMobile(window.innerWidth < 768);
    }
  }, [isClient]);

  return isMobile;
};
```

## 类型安全预防模式

```typescript
// ❌ 错误：使用any类型
const handleData = (data: any) => { ... };

//  正确：定义完整interface
interface ApiResponse<T> {
  data: T;
  error?: string;
  success: boolean;
}

const handleData = <T>(response: ApiResponse<T>) => { ... };
```

## 可选依赖处理模式

```typescript
// ❌ 错误：忽略可选依赖类型
const { Preferences } = await import("@capacitor/preferences");

//  正确：创建类型声明文件 + 安全导入
// 1. 创建 src/types/capacitor.d.ts
// 2. 使用try-catch处理导入失败
try {
  const { Preferences } = await import("@capacitor/preferences");
  // 使用Preferences
} catch {
  // fallback逻辑
}
```

## 语言切换预防模式

```typescript
// ❌ 错误：queryKey固定，语言切换时不更新
const useFrontendCategories = () => {
  return useQuery({
    queryKey: ["frontendCategories"], // 缺少locale参数
    queryFn: () => frontendBlogApi.getCategories(),
  });
};

//  正确：queryKey包含locale，语言切换时重新获取
const useFrontendCategories = () => {
  const params = useParams();
  const locale = (params.locale as string) || "zh";

  return useQuery({
    queryKey: ["frontendCategories", locale], // 包含locale参数
    queryFn: () => frontendBlogApi.getCategories(),
  });
};

//  正确：HTTP客户端自动添加lang参数
// 在HTTP拦截器中自动添加lang查询参数
instance.interceptors.request.use((config) => {
  const lang = localStorage.getItem("locale") || "zh";
  config.params = { ...config.params, lang };
  config.headers["Accept-Language"] = lang;
  return config;
});
```

## 问题修复预防模式

```typescript
// ❌ 错误：消防员思维
// 只修复出错的那一行，错误消失就完事了
const locale = cookieLocale || DEFAULT_LOCALE;

//  正确：架构师思维
// 1. 理解根因 2. 修复问题 3. 预防未来 4. 记录知识
const locale =
  cookieLocale && LOCALES.includes(cookieLocale)
    ? cookieLocale
    : DEFAULT_LOCALE;

// 修复完成后必须问自己：
// ▢ 还有哪里有同样的问题？
// ▢ 为什么这个函数被删除了还有地方在引用？
// ▢ 我应该把这个发现记录在哪里？
```
