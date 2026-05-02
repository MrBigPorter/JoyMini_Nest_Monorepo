---
title: "Design Tokens Generation System — 1215 Lines of Code Generating Flutter Design Language"
slug: design-tokens-generated-system
tags: Flutter, DesignTokens, Theme, UI, CodeGeneration
description: A comprehensive Design Tokens generation system for Flutter covering color tokens, typography, spacing, radius, shadows, motion, and light/dark theme switching with automated code generation.
---

# Design Tokens Generation System — 1215 Lines of Code Generating Flutter Design Language

## 1. Why Design Tokens?

In a social + e-commerce + gaming hybrid app like JoyMini, **visual consistency** directly impacts brand trust and user experience. Traditional approaches have three major pain points:

| Pain Point | Manifestation | Consequence |
|------|------|------|
| **Hardcoded values scattered** | `Color(0xFFE53935)` scattered across 200+ files | Changing theme color requires global search-and-replace |
| **Designer-Developer disconnect** | Figma uses `Primary/500`, code writes `#FF6B35` | Implementation drifts from design |
| **Multi-theme maintenance** | Light/Dark values synced manually | Missed updates cause UI bugs |

**Design Tokens** solution: centralize all visual decisions into a declarative config → code generation → strongly-typed access.

```
Figma Tokens Studio
       ↓ (export JSON)
   tokens.json
       ↓ (build_runner)
   tokens.g.dart  ← 1215 lines generated code
       ↓
   context.extension theme access
```

## 2. Token Classification System

Generated tokens cover **6 major categories**, each with Light/Dark values:

### 2.1 Color Tokens

```dart
// tokens.g.dart — Color tokens (~400 lines)
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

  // Primary color scale
  final ColorSwatchToken primary;    // Primary/50 ~ Primary/900
  final ColorSwatchToken secondary;  // Secondary/50 ~ Secondary/900
  final NeutralToken neutral;        // Neutral/0 ~ Neutral/1000 (with opacity)

  // Semantic colors
  final ColorToken success;    // #34C759
  final ColorToken warning;    // #FF9500
  final ColorToken error;      // #FF3B30
  final ColorToken info;       // #007AFF
}
```

**ColorSwatchToken** is a value object containing 10-level color scales:

```dart
class ColorSwatchToken {
  final Color shade50;
  final Color shade100;
  final Color shade200;
  final Color shade300;
  final Color shade400;
  final Color shade500;  // Primary
  final Color shade600;
  final Color shade700;
  final Color shade800;
  final Color shade900;
}
```

**NeutralToken** additionally supports opacity variants:

```dart
class NeutralToken {
  final Color shade0;    // Pure white
  final Color shade50;   // Background
  final Color shade100;  // Card
  final Color shade200;  // Divider
  final Color shade300;  // Disabled
  final Color shade400;
  final Color shade500;  // Secondary text
  final Color shade600;
  final Color shade700;
  final Color shade800;  // Primary text
  final Color shade900;  // Headings
  final Color shade1000; // Pure black

  // With opacity
  final Color overlay;   // Overlay
}
```

### 2.2 Typography Tokens

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

**TextStyleToken** structure:

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

### 2.3 Spacing Tokens

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

### 2.4 Radius Tokens

```dart
class AppRadiusTokens {
  final double none;     // 0
  final double xs;       // 4
  final double sm;       // 6
  final double md;       // 8
  final double lg;       // 12
  final double xl;       // 16
  final double xxl;      // 24
  final double full;     // 9999 (circular)
}
```

### 2.5 Shadow Tokens

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

### 2.6 Motion Tokens

```dart
class AppMotionTokens {
  final Duration durationFast;     // 150ms
  final Duration durationNormal;   // 250ms
  final Duration durationSlow;     // 400ms
  final Curve curveEaseIn;
  final Curve curveEaseOut;
  final Curve curveEaseInOut;
  final Curve curveSpring;        // Overshoot spring curve
}
```

## 3. Theme Container: `AppTheme` Class

The generated `AppTheme` wraps tokens into a complete Flutter theme:

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

  // Preset Light/Dark themes
  static final AppTheme light = _buildLightTheme();
  static final AppTheme dark = _buildDarkTheme();

  // Convert to Flutter ThemeData
  ThemeData toThemeData() {
    return ThemeData(
      useMaterial3: true,
      colorScheme: _buildColorScheme(),
      textTheme: _buildTextTheme(),
      // ... map tokens → ThemeData properties
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

## 4. `context.extension` Theme Access Pattern

The critical architectural decision: expose tokens via **`BuildContext` extension**, not global singletons.

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

### 4.1 Usage Example

```dart
// ❌ Old way: hardcoded
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

// ✅ New way: Design Tokens
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

### 4.2 InheritedWidget Implementation

`AppTheme.of(context)` is implemented via a custom InheritedWidget:

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

## 5. Code Generation Pipeline

### 5.1 Input Format (JSON)

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

### 5.2 Generator Core Logic

```dart
// build_runner generator — token code generation
class DesignTokenGenerator extends Generator {
  @override
  Future<String> generate(LibraryReader library, BuildStep buildStep) async {
    final jsonContent = await buildStep.readAsString(
      AssetId('joy_mini_app', 'assets/tokens.json'),
    );
    final tokens = jsonDecode(jsonContent) as Map<String, dynamic>;

    final buffer = StringBuffer();
    buffer.writeln('// Auto-generated by DesignTokenGenerator');
    buffer.writeln('// DO NOT EDIT — regenerate by modifying tokens.json');
    buffer.writeln();

    // Generate color token classes
    _generateColorTokens(buffer, tokens['global']['color']);

    // Generate typography token classes
    _generateTypographyTokens(buffer, tokens['global']['typography']);

    // Generate spacing / radius / shadow / motion
    _generateSpacingTokens(buffer, tokens['global']['spacing']);
    _generateRadiusTokens(buffer, tokens['global']['borderRadius']);
    _generateShadowTokens(buffer, tokens['global']['shadow']);
    _generateMotionTokens(buffer, tokens['global']['motion']);

    // Generate AppTheme assembly
    _generateAppTheme(buffer, tokens);

    return buffer.toString();
  }

  void _generateColorTokens(StringBuffer buf, Map<String, dynamic> colors) {
    // Generate ColorSwatchToken / ColorToken for each color family
    for (final entry in colors.entries) {
      final name = entry.key;
      final value = entry.value as Map<String, dynamic>;

      if (value.containsKey('50')) {
        // Generate ColorSwatchToken (10-level scale)
        buf.writeln('  static const ColorSwatchToken $name = '
            'ColorSwatchToken(');
        for (final shade in _shades) {
          final hex = value['$shade']['value'] as String;
          buf.writeln("    shade$shade: Color(${_hexToInt(hex)}),");
        }
        buf.writeln('  );');
      } else {
        // Generate single ColorToken
        final hex = value['value'] as String;
        buf.writeln('  static const ColorToken $name = '
            'ColorToken(Color(${_hexToInt(hex)}));');
      }
    }
  }
}
```

### 5.3 Validation Layer

The generator includes **3 validations** to ensure token data integrity:

```dart
class TokenValidator {
  /// Validation 1: Required shade completeness
  static void validateColorSwatch(Map<String, dynamic> swatch) {
    const requiredShades = ['50', '100', '200', '300', '400',
      '500', '600', '700', '800', '900'];
    for (final shade in requiredShades) {
      assert(swatch.containsKey(shade),
          'ColorSwatch missing shade $shade: ${swatch['500']}');
    }
  }

  /// Validation 2: Contrast compliance
  static void validateContrast(AppTheme theme) {
    // WCAG AA: normal text ≥ 4.5:1
    final contrast = _calculateContrast(
      theme.colors.neutral.shade800,
      theme.colors.neutral.shade0,
    );
    assert(contrast >= 4.5, 'Body text contrast ${contrast.toStringAsFixed(1)}:1 < 4.5:1');
  }

  /// Validation 3: Type safety
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

## 6. Light / Dark Theme Switching

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

Integration in `MaterialApp`:

```dart
MaterialApp(
  theme: AppTheme.light.toThemeData(),
  darkTheme: AppTheme.dark.toThemeData(),
  themeMode: Provider.of<ThemeProvider>(context).mode,
  builder: (context, child) {
    return AppThemeWidget(
      theme: AppTheme.of(context), // Sync current theme
      child: child!,
    );
  },
)
```

## 7. Performance Considerations

| Mode | Memory | Rebuild Scope | Use Case |
|------|------|----------|----------|
| InheritedWidget | Singleton (~2KB) | Subtree | 🏆 Recommended |
| Provider + ChangeNotifier | Extra listeners | Global | Theme switching |
| Static singleton | Resident memory | None | Read-only |

**Key optimization**: `updateShouldNotify` uses reference comparison to avoid unnecessary rebuilds:

```dart
@override
bool updateShouldNotify(covariant AppThemeWidget oldWidget) {
  return oldWidget.theme != theme;
  // Reference comparison: AppTheme.light / AppTheme.dark are compile-time constants
}
```

## 8. Summary

| Aspect | Design Tokens | Traditional Hardcoding |
|------|--------------|-----------|
| Consistency | ⭐⭐⭐⭐⭐ Single source of truth | ⭐⭐ Scattered everywhere |
| Change management | Modify tokens.json → global effect | Modify 50+ files |
| Multi-theme | Native support | Manual if/else |
| Type safety | Compile-time check | Runtime discovery |
| Developer experience | IDE autocomplete | Need to search color values |

The **Design Tokens Generation System** upgrades JoyMini's visual language from "scattered magic numbers" to a "maintainable design system." The 1215 lines of generated code represent a trinity architecture of code generation + type safety + context extension.
