# Design Tokens 生成系统 — 1215 行代码生成的 Flutter 设计语言

> **Article F6** | **Difficulty:** ⭐⭐⭐⭐ | **Source:** `joy_mini_app/lib/gen/` (generated design tokens, ~1215L)

## 1. 为什么需要 Design Tokens？

在 JoyMini 这种社交+电商+游戏混合应用中，**视觉一致性**直接影响品牌信任度和用户体验。传统做法存在三大痛点：

| 痛点 | 表现 | 后果 |
|------|------|------|
| **硬编码散落** | `Color(0xFFE53935)` 散布在 200+ 文件中 | 修改主题色需要全局搜索替换 |
| **设计师-开发脱节** | Figma 设计稿用 `Primary/500`，代码写 `#FF6B35` | 实现与设计偏离 |
| **多主题维护** | Light/Dark 两套值手动同步 | 漏改导致 UI 异常 |

**Design Tokens** 的解法：所有视觉决策集中到一份声明式配置 → 代码生成 → 强类型访问。

```
Figma Tokens Studio
       ↓ (export JSON)
   tokens.json
       ↓ (build_runner)
   tokens.g.dart  ← 1215 行生成代码
       ↓
   context.extension 主题访问
```

## 2. Token 分类体系

生成的 tokens 覆盖 **6 大类别**，每类包含 Light/Dark 两套值：

### 2.1 颜色（Color Tokens）

```dart
// tokens.g.dart — 颜色令牌（~400 行）
class AppColorTokens {
  const AppColorTokens({
    required this.primary,
    required this.secondary,
    required this.neutral,
    required this.success,
    required this.warning,
    required this.error,
    required this.info,
  });

  // 主色阶梯
  final ColorSwatchToken primary;    // Primary/50 ~ Primary/900
  final ColorSwatchToken secondary;  // Secondary/50 ~ Secondary/900
  final NeutralToken neutral;        // Neutral/0 ~ Neutral/1000 (含透明度)

  // 语义色
  final ColorToken success;    // #34C759
  final ColorToken warning;    // #FF9500
  final ColorToken error;      // #FF3B30
  final ColorToken info;       // #007AFF
}
```

**ColorSwatchToken** 是一个包含 10 级色阶的值对象：

```dart
class ColorSwatchToken {
  final Color shade50;
  final Color shade100;
  final Color shade200;
  final Color shade300;
  final Color shade400;
  final Color shade500;  // 主色
  final Color shade600;
  final Color shade700;
  final Color shade800;
  final Color shade900;
}
```

**NeutralToken** 额外支持透明度变体：

```dart
class NeutralToken {
  final Color shade0;    // 纯白
  final Color shade50;   // 背景
  final Color shade100;  // 卡片
  final Color shade200;  // 分割线
  final Color shade300;  // 禁用态
  final Color shade400;
  final Color shade500;  // 次要文字
  final Color shade600;
  final Color shade700;
  final Color shade800;  // 主要文字
  final Color shade900;  // 标题
  final Color shade1000; // 纯黑

  // 带透明度
  final Color overlay;   // 遮罩层
}
```

### 2.2 字体（Typography Tokens）

```dart
class AppTypographyTokens {
  final TextStyleToken displayLarge;   // 32px/40px Bold
  final TextStyleToken displayMedium;  // 28px/36px Bold
  final TextStyleToken displaySmall;   // 24px/32px Bold
  final TextStyleToken headlineLarge;  // 22px/28px SemiBold
  final TextStyleToken headlineMedium; // 20px/26px SemiBold
  final TextStyleToken headlineSmall;  // 18px/24px SemiBold
  final TextStyleToken titleLarge;     // 16px/22px Medium
  final TextStyleToken titleMedium;    // 14px/20px Medium
  final TextStyleToken titleSmall;     // 12px/18px Medium
  final TextStyleToken bodyLarge;      // 16px/24px Regular
  final TextStyleToken bodyMedium;     // 14px/20px Regular
  final TextStyleToken bodySmall;      // 12px/16px Regular
  final TextStyleToken labelLarge;     // 14px/18px Medium
  final TextStyleToken labelMedium;    // 12px/16px Medium
  final TextStyleToken labelSmall;     // 10px/14px Medium
}
```

**TextStyleToken** 结构：

```dart
class TextStyleToken {
  final double fontSize;
  final double height;      // line-height / fontSize
  final FontWeight fontWeight;
  final double letterSpacing;
  final TextDecoration? decoration;

  TextStyle toTextStyle(Color color) => TextStyle(
    fontSize: fontSize,
    height: height,
    fontWeight: fontWeight,
    letterSpacing: letterSpacing,
    decoration: decoration,
    color: color,
  );
}
```

### 2.3 间距（Spacing Tokens）

```dart
class AppSpacingTokens {
  final double xxs;   // 2
  final double xs;    // 4
  final double sm;    // 8
  final double md;    // 12
  final double lg;    // 16
  final double xl;    // 20
  final double xxl;   // 24
  final double xxxl;  // 32
  final double huge;  // 48
  final double massive; // 64
}
```

### 2.4 圆角（Radius Tokens）

```dart
class AppRadiusTokens {
  final double none;     // 0
  final double xs;       // 4
  final double sm;       // 6
  final double md;       // 8
  final double lg;       // 12
  final double xl;       // 16
  final double xxl;      // 24
  final double full;     // 9999 (圆形)
}
```

### 2.5 阴影（Shadow Tokens）

```dart
class AppShadowTokens {
  final ShadowToken sm;   // elevation 1
  final ShadowToken md;   // elevation 3
  final ShadowToken lg;   // elevation 6
  final ShadowToken xl;   // elevation 12
}

class ShadowToken {
  final double blurRadius;
  final double offsetX;
  final double offsetY;
  final Color color;

  List<BoxShadow> toBoxShadows() => [
    BoxShadow(
      blurRadius: blurRadius,
      offset: Offset(offsetX, offsetY),
      color: color,
    ),
  ];
}
```

### 2.6 动效（Motion Tokens）

```dart
class AppMotionTokens {
  final Duration durationFast;     // 150ms
  final Duration durationNormal;   // 250ms
  final Duration durationSlow;     // 400ms
  final Curve curveEaseIn;
  final Curve curveEaseOut;
  final Curve curveEaseInOut;
  final Curve curveSpring;        // 过冲弹性曲线
}
```

## 3. 主题容器：`AppTheme` 类

生成的 `AppTheme` 将 tokens 包装为完整的 Flutter 主题：

```dart
class AppTheme {
  final AppColorTokens colors;
  final AppTypographyTokens typography;
  final AppSpacingTokens spacing;
  final AppRadiusTokens radius;
  final AppShadowTokens shadows;
  final AppMotionTokens motion;

  const AppTheme({
    required this.colors,
    required this.typography,
    required this.spacing,
    required this.radius,
    required this.shadows,
    required this.motion,
  });

  // 预置 Light/Dark 主题
  static final AppTheme light = _buildLightTheme();
  static final AppTheme dark = _buildDarkTheme();

  // 转换为 Flutter ThemeData
  ThemeData toThemeData() {
    return ThemeData(
      useMaterial3: true,
      colorScheme: _buildColorScheme(),
      textTheme: _buildTextTheme(),
      // ... 映射 tokens → ThemeData 属性
    );
  }

  ColorScheme _buildColorScheme() {
    return ColorScheme(
      primary: colors.primary.shade500,
      onPrimary: colors.neutral.shade0,
      primaryContainer: colors.primary.shade100,
      secondary: colors.secondary.shade500,
      surface: colors.neutral.shade0,
      onSurface: colors.neutral.shade800,
      error: colors.error,
      brightness: _isLight ? Brightness.light : Brightness.dark,
    );
  }
}
```

## 4. `context.extension` 主题访问模式

最关键的架构决策：**通过 `BuildContext` 扩展暴露 tokens**，而非全局单例。

```dart
extension AppThemeExtension on BuildContext {
  AppColorTokens get colors => AppTheme.of(this).colors;
  AppTypographyTokens get typography => AppTheme.of(this).typography;
  AppSpacingTokens get spacing => AppTheme.of(this).spacing;
  AppRadiusTokens get radius => AppTheme.of(this).radius;
  AppShadowTokens get shadows => AppTheme.of(this).shadows;
  AppMotionTokens get motion => AppTheme.of(this).motion;
}
```

### 4.1 使用示例

```dart
// ❌ 旧方式：硬编码
Container(
  padding: const EdgeInsets.all(16),
  decoration: BoxDecoration(
    color: Color(0xFFF5F5F5),
    borderRadius: BorderRadius.circular(8),
  ),
  child: Text(
    'Hello',
    style: TextStyle(
      fontSize: 16,
      color: Color(0xFF333333),
    ),
  ),
)

// ✅ 新方式：Design Tokens
Container(
  padding: EdgeInsets.all(context.spacing.lg),
  decoration: BoxDecoration(
    color: context.colors.neutral.shade50,
    borderRadius: BorderRadius.circular(context.radius.md),
  ),
  child: Text(
    'Hello',
    style: context.typography.bodyLarge.toTextStyle(
      context.colors.neutral.shade800,
    ),
  ),
)
```

### 4.2 InheritedWidget 实现

`AppTheme.of(context)` 通过自定义 InheritedWidget 实现：

```dart
class AppThemeWidget extends InheritedWidget {
  final AppTheme theme;

  const AppThemeWidget({
    super.key,
    required this.theme,
    required super.child,
  });

  static AppTheme of(BuildContext context) {
    final widget = context.dependOnInheritedWidgetOfExactType<AppThemeWidget>();
    assert(widget != null, 'No AppThemeWidget found in context');
    return widget!.theme;
  }

  @override
  bool updateShouldNotify(AppThemeWidget oldWidget) =>
      oldWidget.theme != theme;
}
```

## 5. 代码生成流水线

### 5.1 输入格式（JSON）

```json
{
  "global": {
    "color": {
      "primary": {
        "50": { "value": "#FFF3E0" },
        "500": { "value": "#FF6B35" },
        "900": { "value": "#BF360C" }
      },
      "neutral": {
        "0": { "value": "#FFFFFF" },
        "800": { "value": "#212121" }
      }
    },
    "typography": {
      "displayLarge": {
        "fontSize": { "value": "32" },
        "lineHeight": { "value": "40" },
        "fontWeight": { "value": "Bold" }
      }
    }
  }
}
```

### 5.2 生成器核心逻辑

```dart
// build_runner generator — token 代码生成
class DesignTokenGenerator extends Generator {
  @override
  Future<String> generate(LibraryReader library, BuildStep buildStep) async {
    final jsonContent = await buildStep.readAsString(
      AssetId('joy_mini_app', 'assets/tokens.json'),
    );
    final tokens = jsonDecode(jsonContent) as Map<String, dynamic>;

    final buffer = StringBuffer();
    buffer.writeln('// Auto-generated by DesignTokenGenerator');
    buffer.writeln('// DO NOT EDIT — 修改 tokens.json 后重新生成');
    buffer.writeln();

    // 生成颜色令牌类
    _generateColorTokens(buffer, tokens['global']['color']);

    // 生成字体令牌类
    _generateTypographyTokens(buffer, tokens['global']['typography']);

    // 生成间距/圆角/阴影/动效
    _generateSpacingTokens(buffer, tokens['global']['spacing']);
    _generateRadiusTokens(buffer, tokens['global']['borderRadius']);
    _generateShadowTokens(buffer, tokens['global']['shadow']);
    _generateMotionTokens(buffer, tokens['global']['motion']);

    // 生成 AppTheme 组装
    _generateAppTheme(buffer, tokens);

    return buffer.toString();
  }

  void _generateColorTokens(StringBuffer buf, Map<String, dynamic> colors) {
    // 为每个色系生成 ColorSwatchToken / ColorToken
    for (final entry in colors.entries) {
      final name = entry.key;
      final value = entry.value as Map<String, dynamic>;

      if (value.containsKey('50')) {
        // 生成 ColorSwatchToken（10 级色阶）
        buf.writeln('  static const ColorSwatchToken $name = '
            'ColorSwatchToken(');
        for (final shade in _shades) {
          final hex = value['$shade']['value'] as String;
          buf.writeln("    shade$shade: Color(${_hexToInt(hex)}),");
        }
        buf.writeln('  );');
      } else {
        // 生成单色 ColorToken
        final hex = value['value'] as String;
        buf.writeln('  static const ColorToken $name = '
            'ColorToken(Color(${_hexToInt(hex)}));');
      }
    }
  }
}
```

### 5.3 验证层

生成器包含 **3 道验证**，确保 tokens 数据完整性：

```dart
class TokenValidator {
  /// 验证 1: 必需色阶完整性
  static void validateColorSwatch(Map<String, dynamic> swatch) {
    const requiredShades = ['50', '100', '200', '300', '400',
      '500', '600', '700', '800', '900'];
    for (final shade in requiredShades) {
      assert(swatch.containsKey(shade),
          'ColorSwatch missing shade $shade: ${swatch['500']}');
    }
  }

  /// 验证 2: 对比度合规
  static void validateContrast(AppTheme theme) {
    // WCAG AA: 正常文本 ≥ 4.5:1
    final contrast = _calculateContrast(
      theme.colors.neutral.shade800,
      theme.colors.neutral.shade0,
    );
    assert(contrast >= 4.5, 'Body text contrast ${contrast.toStringAsFixed(1)}:1 < 4.5:1');
  }

  /// 验证 3: 类型安全
  static void validateTokenTypes(Map<String, dynamic> json) {
    for (final entry in json.entries) {
      final value = entry.value;
      if (value is Map && value.containsKey('fontSize')) {
        assert(value['fontSize'] is num, 'fontSize must be numeric');
        assert(value['fontWeight'] is String, 'fontWeight must be string');
      }
    }
  }
}
```

## 6. Light / Dark 主题切换

```dart
class ThemeProvider extends ChangeNotifier {
  ThemeMode _mode = ThemeMode.system;

  ThemeMode get mode => _mode;

  AppTheme get currentTheme =>
      _mode == ThemeMode.dark ? AppTheme.dark : AppTheme.light;

  void setThemeMode(ThemeMode mode) {
    _mode = mode;
    notifyListeners();
  }

  void toggle() {
    _mode = _mode == ThemeMode.dark ? ThemeMode.light : ThemeMode.dark;
    notifyListeners();
  }
}
```

在 `MaterialApp` 中集成：

```dart
MaterialApp(
  theme: AppTheme.light.toThemeData(),
  darkTheme: AppTheme.dark.toThemeData(),
  themeMode: Provider.of<ThemeProvider>(context).mode,
  builder: (context, child) {
    return AppThemeWidget(
      theme: AppTheme.of(context), // 同步当前主题
      child: child!,
    );
  },
)
```

## 7. 性能考量

| 模式 | 内存 | 重建范围 | 适用场景 |
|------|------|----------|----------|
| InheritedWidget | 单例（~2KB） | 子树 | 🏆 推荐 |
| Provider + ChangeNotifier | 额外监听器 | 全局 | 主题切换 |
| Static singleton | 常驻内存 | 无 | 仅读取 |

**关键优化**：`updateShouldNotify` 做引用比较，避免不必要重建：

```dart
@override
bool updateShouldNotify(covariant AppThemeWidget oldWidget) {
  return oldWidget.theme != theme;
  // 引用比较：AppTheme.light / AppTheme.dark 是编译期常量
}
```

## 8. 总结

| 方面 | Design Tokens | 传统硬编码 |
|------|--------------|-----------|
| 一致性 | ⭐⭐⭐⭐⭐ 单源 truth | ⭐⭐ 散落各处 |
| 修改变更 | 改 tokens.json → 全局生效 | 改 50+ 文件 |
| 多主题 | 原生支持 | 手动 if/else |
| 类型安全 | 编译期检查 | runtime 才能发现 |
| 开发体验 | IDE 自动补全 | 需要搜索颜色值 |

**Design Tokens 生成系统** 将 JoyMini 的视觉语言从"散落的魔法数字"升级为"可维护的设计系统"。1215 行生成代码的背后，是代码生成 + 类型安全 + 上下文扩展三位一体的架构决策。

---

**下一篇预告**: [F7 — Pipeline Runner 顺序执行模式] — 构建异步操作的有序执行流水线
