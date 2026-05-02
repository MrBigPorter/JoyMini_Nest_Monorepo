# LuckyFormTheme：表单主题系统 + 自定义验证器链

> **文章难度：** ⭐⭐⭐⭐ (高级)
> **关注领域：** 表单设计、验证模式、UI 一致性、状态管理
> **阅读时间：** 20 分钟

## 目录

- [Flutter 中表单一致性的挑战](#flutter-中表单一致性的挑战)
- [架构总览：LuckyFormTheme + 验证器链](#架构总览luckyformtheme--验证器链)
- [LuckyFormTheme：通过 InheritedWidget 统一样式配置](#luckyformtheme通过-inheritedwidget-统一样式配置)
  - [主题配置](#主题配置)
  - [InheritedWidget 提供者](#inheritedwidget-提供者)
  - [应用级设置](#应用级设置)
- [表单字段变体：Outlined / Filled / Underlined](#表单字段变体outlined--filled--underlined)
  - [变体实现](#变体实现)
  - [变体视觉对比](#变体视觉对比)
- [链式验证器：Required → Email → Phone → Length → Pattern → Custom](#链式验证器required--email--phone--length--pattern--custom)
  - [验证器接口](#验证器接口)
  - [内置验证器](#内置验证器)
  - [验证器链使用](#验证器链使用)
  - [验证器执行流程](#验证器执行流程)
- [异步验证器：实时服务器验证](#异步验证器实时服务器验证)
  - [AsyncValidator 实现](#asyncvalidator-实现)
  - [防抖异步验证](#防抖异步验证)
- [表单联动：密码确认、级联选择、动态字段](#表单联动密码确认级联选择动态字段)
  - [密码确认](#密码确认)
  - [级联下拉选择（地区选择）](#级联下拉选择地区选择)
  - [动态显示/隐藏字段](#动态显示隐藏字段)
- [验证触发配置：onChange / onBlur / onSubmit / manual](#验证触发配置onchange--onblur--onsubmit--manual)
  - [触发行为矩阵](#触发行为矩阵)
  - [表单级提交警卫](#表单级提交验证)
- [验证状态机：有效 / 无效 / 验证中 / 未触及 / 已修改](#验证状态机有效--无效--验证中--未触及--已修改)
  - [状态机定义](#状态机定义)
  - [状态转换图](#状态转换图)
  - [状态消费者组件](#状态消费者组件)
- [自动焦点管理：nextFieldAction](#自动焦点管理nextfieldaction)
  - [焦点管理器](#焦点管理器)
  - [与 LuckyTextField 集成](#与-luckytextfield-集成)
- [实践：完整的注册表单](#实践完整的注册表单)
- [总结](#总结)
  - [关键要点](#关键要点)
  - [何时使用此模式](#何时使用此模式)
  - [相关文章](#相关文章)

## Flutter 中表单一致性的挑战

在 Flutter 中构建表单时，开发者经常面临以下挑战：

1. **样式重复**：每个 `TextFormField` 都需要重复配置 `InputDecoration`、边框、颜色、圆角等属性
2. **验证逻辑分散**：验证规则散落在各个表单中，难以复用
3. **验证时机不灵活**：Flutter 内置的 `Form.validate()` 只在提交时触发，不支持 `onChange` 或 `onBlur` 验证
4. **跨字段验证复杂**：密码确认、级联下拉等场景需要访问其他字段的值
5. **异步验证困难**：检查用户名/邮箱是否已被注册需要服务器交互，但 Flutter 原生不支持异步验证

`LuckyFormTheme` + 验证器系统通过以下方式解决这些问题：

- **集中式主题配置**：通过 `InheritedWidget` 提供全局统一的表单样式
- **可链式组合的验证器**：每个验证器只负责一个规则，按顺序执行
- **灵活的验证触发时机**：支持 `onChange`、`onBlur`、`onSubmit`、`manual` 四种模式
- **异步验证支持**：内置防抖和优雅降级
- **跨字段联动**：密码确认、级联选择、动态显示/隐藏

## 架构总览：LuckyFormTheme + 验证器链

```
┌────────────────────────────────────────────────────────────┐
│                    LuckyFormThemeConfig                     │
│  (colors / borders / typography / icons / animations)       │
└─────────────────────────┬──────────────────────────────────┘
                          │ 通过 InheritedWidget 下发
                          ▼
┌────────────────────────────────────────────────────────────┐
│                   LuckyFormThemeWidget                      │
│              context.luckyFormTheme 扩展方法                │
└─────────────────────────┬──────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
┌─────────────────┐ ┌────────────┐ ┌──────────────┐
│  LuckyTextField  │ │ 验证器链    │ │ FocusManager │
│ (3 种变体)       │ │ (链式)      │ │ (自动焦点)   │
└─────────────────┘ └────────────┘ └──────────────┘
```

## LuckyFormTheme：通过 InheritedWidget 统一样式配置

`LuckyFormThemeConfig` 集中管理所有表单样式属性，通过 `InheritedWidget` 下发到整个组件树。

### 主题配置

```dart
/// 完整的表单主题配置
class LuckyFormThemeConfig {
  // ── 边框与背景 ──
  final double borderRadius;
  final Color? fillColor;
  final Color? focusedBorderColor;
  final Color? enabledBorderColor;
  final Color? errorBorderColor;

  // ── 文本与字体 ──
  final double fontSize;
  final FontWeight fontWeight;
  final Color textColor;
  final Color labelColor;
  final Color hintColor;
  final double labelFontSize;

  // ── 高度与内边距 ──
  final double height;
  final EdgeInsetsGeometry contentPadding;

  // ── 图标 ──
  final double? iconSize;
  final Color? iconColor;

  // ── 验证反馈 ──
  final Color errorColor;
  final Color successColor;
  final Color validatingColor;

  // ── 动画 ──
  final Duration animationDuration;

  const LuckyFormThemeConfig({
    this.borderRadius = 8.0,
    this.fillColor,
    this.focusedBorderColor = const Color(0xFF6366F1),
    this.enabledBorderColor = const Color(0xFFE2E8F0),
    this.errorBorderColor = Colors.red,
    this.fontSize = 16.0,
    this.fontWeight = FontWeight.w400,
    this.textColor = const Color(0xFF1E293B),
    this.labelColor = const Color(0xFF64748B),
    this.hintColor = const Color(0xFF94A3B8),
    this.labelFontSize = 14.0,
    this.height = 48.0,
    this.contentPadding = const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
    this.iconSize,
    this.iconColor,
    this.errorColor = Colors.red,
    this.successColor = Colors.green,
    this.validatingColor = Colors.orange,
    this.animationDuration = const Duration(milliseconds: 200),
  });

  /// 从主题数据创建（支持从 Design Tokens 生成）
  factory LuckyFormThemeConfig.fromThemeData(ThemeData theme) {
    return LuckyFormThemeConfig(
      borderRadius: 8,
      fillColor: theme.brightness == Brightness.light
          ? Colors.white
          : const Color(0xFF1E293B),
      textColor: theme.textTheme.bodyLarge?.color ?? const Color(0xFF1E293B),
      labelColor: theme.textTheme.bodySmall?.color ?? const Color(0xFF64748B),
      errorColor: theme.colorScheme.error,
    );
  }

  /// 亮色主题默认值
  static const light = LuckyFormThemeConfig();

  /// 暗色主题默认值
  static const dark = LuckyFormThemeConfig(
    fillColor: Color(0xFF1E293B),
    textColor: Color(0xFFF1F5F9),
    labelColor: Color(0xFF94A3B8),
    hintColor: Color(0xFF64748B),
    enabledBorderColor: Color(0xFF334155),
  );

  /// 合并两个配置（调用者覆盖默认值）
  LuckyFormThemeConfig merge(LuckyFormThemeConfig? other) {
    if (other == null) return this;
    return LuckyFormThemeConfig(
      borderRadius: other.borderRadius,
      fillColor: other.fillColor ?? fillColor,
      focusedBorderColor: other.focusedBorderColor ?? focusedBorderColor,
      enabledBorderColor: other.enabledBorderColor ?? enabledBorderColor,
      errorBorderColor: other.errorBorderColor ?? errorBorderColor,
      fontSize: other.fontSize,
      fontWeight: other.fontWeight,
      textColor: other.textColor,
      labelColor: other.labelColor,
      hintColor: other.hintColor,
      labelFontSize: other.labelFontSize,
      height: other.height,
      contentPadding: other.contentPadding,
      iconSize: other.iconSize ?? iconSize,
      iconColor: other.iconColor ?? iconColor,
      errorColor: other.errorColor,
      successColor: other.successColor,
      validatingColor: other.validatingColor,
      animationDuration: other.animationDuration,
    );
  }
}
```

### InheritedWidget 提供者

```dart
class LuckyFormThemeWidget extends InheritedWidget {
  final LuckyFormThemeConfig config;

  const LuckyFormThemeWidget({
    super.key,
    required this.config,
    required super.child,
  });

  static LuckyFormThemeConfig of(BuildContext context) {
    final widget = context.dependOnInheritedWidgetOfExactType<LuckyFormThemeWidget>();
    assert(widget != null, 'No LuckyFormThemeWidget found in context');
    return widget!.config;
  }

  @override
  bool updateShouldNotify(LuckyFormThemeWidget oldWidget) {
    return oldWidget.config != config;
  }
}

/// 通过 BuildContext 扩展便捷访问
extension LuckyFormThemeContext on BuildContext {
  LuckyFormThemeConfig get luckyFormTheme => LuckyFormThemeWidget.of(this);
}
```

### 应用级设置

```dart
class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      theme: ThemeData.light(),
      darkTheme: ThemeData.dark(),
      home: LuckyFormThemeWidget(
        config: LuckyFormThemeConfig.light,
        child: const HomeScreen(),
      ),
    );
  }
}
```

## 表单字段变体：Outlined / Filled / Underlined

`LuckyTextField` 支持三种视觉变体，由 `LuckyFieldVariant` 枚举控制。

### 变体实现

```dart
/// 表单字段变体
enum LuckyFieldVariant {
  outlined,  // 轮廓边框，标签浮起
  filled,    // 填充背景，无边框
  underlined,// 底部线条，极简风格
}

class LuckyTextField extends StatefulWidget {
  final String? fieldId;
  final String label;
  final String? hintText;
  final String? helperText;
  final bool obscureText;
  final Widget? prefixIcon;
  final Widget? suffixIcon;
  final int? maxLines;
  final int? minLines;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final FocusNode? focusNode;
  final TextEditingController? controller;
  final LuckyFieldVariant variant;
  final List<FieldValidator> validators;
  final ValidationTrigger validationTrigger;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;
  final VoidCallback? onTap;
  final bool enabled;
  final bool readOnly;

  const LuckyTextField({
    super.key,
    this.fieldId,
    required this.label,
    this.hintText,
    this.helperText,
    this.obscureText = false,
    this.prefixIcon,
    this.suffixIcon,
    this.maxLines = 1,
    this.minLines,
    this.keyboardType,
    this.textInputAction,
    this.focusNode,
    this.controller,
    this.variant = LuckyFieldVariant.outlined,
    this.validators = const [],
    this.validationTrigger = ValidationTrigger.onBlur,
    this.onChanged,
    this.onSubmitted,
    this.onTap,
    this.enabled = true,
    this.readOnly = false,
  });

  @override
  State<LuckyTextField> createState() => _LuckyTextFieldState();
}

class _LuckyTextFieldState extends State<LuckyTextField> {
  late final TextEditingController _controller;
  late final FocusNode _focusNode;
  final ValueNotifier<ValidationStatus> _statusNotifier =
      ValueNotifier(ValidationStatus.pristine);
  final ValueNotifier<String?> _errorNotifier =
      ValueNotifier(null);
  bool _obscured = false;

  @override
  void initState() {
    super.initState();
    _controller = widget.controller ?? TextEditingController();
    _focusNode = widget.focusNode ?? FocusNode();
    _obscured = widget.obscureText;

    _controller.addListener(_onValueChanged);
    _focusNode.addListener(_onFocusChanged);

    if (widget.validationTrigger == ValidationTrigger.onChange) {
      _controller.addListener(_onChangeValidation);
    }
  }

  void _onValueChanged() {
    widget.onChanged?.call(_controller.text);
  }

  void _onFocusChanged() {
    if (!_focusNode.hasFocus &&
        widget.validationTrigger == ValidationTrigger.onBlur) {
      _validate();
    }
  }

  void _onChangeValidation() {
    if (widget.validationTrigger == ValidationTrigger.onChange) {
      _validate();
    }
  }

  Future<void> _validate() async {
    final validators = widget.validators;
    if (validators.isEmpty) return;

    _statusNotifier.value = ValidationStatus.validating;

    for (final validator in validators) {
      final error = await validator.validate(_controller.text);
      if (error != null) {
        _errorNotifier.value = error;
        _statusNotifier.value = ValidationStatus.invalid;
        return;
      }
    }

    _errorNotifier.value = null;
    _statusNotifier.value = ValidationStatus.valid;
  }

  /// 手动触发验证（用于 onSubmit 模式）
  Future<void> validate() => _validate();

  /// 构建基于变体的 InputDecoration
  InputDecoration _buildDecoration(LuckyFormThemeConfig theme, {String? errorText}) {
    switch (widget.variant) {
      case LuckyFieldVariant.outlined:
        return InputDecoration(
          labelText: widget.label,
          hintText: widget.hintText,
          helperText: widget.helperText,
          errorText: errorText,
          prefixIcon: widget.prefixIcon,
          suffixIcon: _buildSuffixIcon(),
          filled: false,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(theme.borderRadius),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(theme.borderRadius),
            borderSide: BorderSide(color: theme.focusedBorderColor, width: 2),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(theme.borderRadius),
            borderSide: BorderSide(color: theme.enabledBorderColor),
          ),
          errorBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(theme.borderRadius),
            borderSide: BorderSide(color: theme.errorBorderColor),
          ),
          contentPadding: theme.contentPadding,
        );

      case LuckyFieldVariant.filled:
        return InputDecoration(
          labelText: widget.label,
          hintText: widget.hintText,
          errorText: errorText,
          prefixIcon: widget.prefixIcon,
          suffixIcon: _buildSuffixIcon(),
          filled: true,
          fillColor: theme.fillColor ?? Colors.grey[100],
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(theme.borderRadius),
            borderSide: BorderSide.none,
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(theme.borderRadius),
            borderSide: BorderSide.none,
          ),
          contentPadding: theme.contentPadding,
        );

      case LuckyFieldVariant.underlined:
        return InputDecoration(
          labelText: widget.label,
          hintText: widget.hintText,
          errorText: errorText,
          prefixIcon: widget.prefixIcon,
          suffixIcon: _buildSuffixIcon(),
          border: const UnderlineInputBorder(),
          enabledBorder: UnderlineInputBorder(
            borderSide: BorderSide(color: theme.enabledBorderColor),
          ),
          focusedBorder: UnderlineInputBorder(
            borderSide: BorderSide(color: theme.focusedBorderColor, width: 2),
          ),
          contentPadding: const EdgeInsets.only(bottom: 8),
        );
    }
  }

  /// 验证状态后缀图标
  Widget? _buildSuffixIcon() {
    return ValueListenableBuilder<ValidationStatus>(
      valueListenable: _statusNotifier,
      builder: (context, status, _) {
        switch (status) {
          case ValidationStatus.valid:
            return const Icon(Icons.check_circle, color: Colors.green, size: 20);
          case ValidationStatus.invalid:
            return const Icon(Icons.error, color: Colors.red, size: 20);
          case ValidationStatus.validating:
            return const SizedBox(
              width: 20,
              height: 20,
              child: CircularProgressIndicator(strokeWidth: 2),
            );
          default:
            return widget.suffixIcon;
        }
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = context.luckyFormTheme;

    return ValueListenableBuilder<String?>(
      valueListenable: _errorNotifier,
      builder: (context, error, _) {
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              height: widget.maxLines > 1 ? null : theme.height,
              child: TextFormField(
                controller: _controller,
                focusNode: _focusNode,
                obscureText: _obscured,
                keyboardType: widget.keyboardType,
                textInputAction: widget.textInputAction,
                onChanged: widget.onChanged,
                onFieldSubmitted: (value) {
                  widget.onSubmitted?.call(value);
                },
                onTap: widget.onTap,
                enabled: widget.enabled,
                readOnly: widget.readOnly,
                maxLines: widget.maxLines,
                minLines: widget.minLines,
                style: TextStyle(
                  fontSize: theme.fontSize,
                  fontWeight: theme.fontWeight,
                  color: theme.textColor,
                ),
                decoration: _buildDecoration(theme).copyWith(
                  errorText: error,
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}
```

### 变体视觉对比

| 变体 | 视觉风格 | 适用场景 |
|---------|-------------|----------|
| **outlined** | 矩形边框，聚焦时标签浮起 | 登录/注册，独立字段 |
| **filled** | 纯色背景，无边框 | 搜索栏，次要输入 |
| **underlined** | 底部线条，极简风格 | 内联编辑，设置表单 |

---

## 链式验证器：Required → Email → Phone → Length → Pattern → Custom

验证器系统建立在简单的抽象接口之上，为常见验证规则提供具体实现。验证器是**可链式组合**的——它们按顺序执行，在第一个失败处停止。

### 验证器接口

```dart
abstract class FieldValidator {
  /// 验证失败返回错误信息，验证通过返回 null
  Future<String?> validate(String value);
}

/// 同步验证器便捷基类
abstract class SyncValidator implements FieldValidator {
  @override
  Future<String?> validate(String value) async => validateSync(value);

  String? validateSync(String value);
}
```

### 内置验证器

```dart
class RequiredValidator extends SyncValidator {
  final String message;

  RequiredValidator({this.message = '此字段为必填项'});

  @override
  String? validateSync(String value) {
    if (value.trim().isEmpty) return message;
    return null;
  }
}

class EmailValidator extends SyncValidator {
  final String message;
  static final _emailRegExp = RegExp(
    r'^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$',
  );

  EmailValidator({this.message = '请输入有效的邮箱地址'});

  @override
  String? validateSync(String value) {
    if (value.isEmpty) return null; // 空值跳过（使用 RequiredValidator 做必填校验）
    if (!_emailRegExp.hasMatch(value)) return message;
    return null;
  }
}

class PhoneValidator extends SyncValidator {
  final String message;
  final String? countryCode;

  PhoneValidator({this.message = '请输入有效的手机号码', this.countryCode});

  @override
  String? validateSync(String value) {
    if (value.isEmpty) return null;

    // 移除常见格式字符
    final digits = value.replaceAll(RegExp(r'[\s\-\(\)\+]'), '');

    if (countryCode != null && !digits.startsWith(countryCode!)) {
      return '号码必须以 $countryCode 开头';
    }

    if (digits.length < 10 || digits.length > 15) {
      return message;
    }

    return null;
  }
}

class MinLengthValidator extends SyncValidator {
  final int minLength;
  final String message;

  MinLengthValidator(this.minLength, {String? message})
      : message = message ?? '至少需要 $minLength 个字符';

  @override
  String? validateSync(String value) {
    if (value.isEmpty) return null;
    if (value.length < minLength) return message;
    return null;
  }
}

class MaxLengthValidator extends SyncValidator {
  final int maxLength;
  final String message;

  MaxLengthValidator(this.maxLength, {String? message})
      : message = message ?? '不能超过 $maxLength 个字符';

  @override
  String? validateSync(String value) {
    if (value.isEmpty) return null;
    if (value.length > maxLength) return message;
    return null;
  }
}

class PatternValidator extends SyncValidator {
  final RegExp pattern;
  final String message;

  PatternValidator(this.pattern, {this.message = '格式不正确'});

  @override
  String? validateSync(String value) {
    if (value.isEmpty) return null;
    if (!pattern.hasMatch(value)) return message;
    return null;
  }
}

class CustomValidator extends SyncValidator {
  final String? Function(String value) validator;
  final String? message;

  CustomValidator({required this.validator, this.message});

  @override
  String? validateSync(String value) {
    return validator(value) ?? message;
  }
}
```

### 验证器链使用

```dart
LuckyTextField(
  label: '邮箱',
  hintText: '请输入您的邮箱地址',
  keyboardType: TextInputType.emailAddress,
  validators: [
    RequiredValidator(message: '邮箱为必填项'),
    EmailValidator(),
    MaxLengthValidator(254, message: '邮箱地址过长'),
  ],
  validationTrigger: ValidationTrigger.onBlur, // 离开焦点时验证
)
```

### 验证器执行流程

```
用户输入 "test@ex"
         │
         ▼
RequiredValidator.validate("test@ex") → null（非空）
         │
         ▼
EmailValidator.validate("test@ex") → "请输入有效的邮箱地址"
         │
         ▼
         ⚠️ 验证失败 → 显示错误信息
         （MaxLengthValidator 不会被调用——短路）
```

---

## 异步验证器：实时服务器验证

异步验证器对于需要服务端验证的数据至关重要，例如**用户名可用性**或**邮箱唯一性**。它们继承自相同的 [`FieldValidator`] 接口，但执行 HTTP 请求。

### AsyncValidator 实现

```dart
abstract class AsyncValidator implements FieldValidator {
  /// 重写此方法以执行异步验证
  @override
  Future<String?> validate(String value);
}

class UsernameAvailabilityValidator extends AsyncValidator {
  final ApiService apiService;
  final String message;

  UsernameAvailabilityValidator({
    required this.apiService,
    this.message = '此用户名已被注册',
  });

  @override
  Future<String?> validate(String value) async {
    if (value.isEmpty) return null;
    if (value.length < 3) return null; // 太短的值不检查

    try {
      final available = await apiService.checkUsernameAvailability(value);
      return available ? null : message;
    } catch (e) {
      // 网络错误——不阻止表单提交，仅显示警告
      return null;
    }
  }
}

class EmailUniquenessValidator extends AsyncValidator {
  final ApiService apiService;
  final String message;

  EmailUniquenessValidator({
    required this.apiService,
    this.message = '此邮箱已被注册',
  });

  @override
  Future<String?> validate(String value) async {
    if (value.isEmpty) return null;

    // 先进行基本邮箱格式检查（同步守卫）
    if (!RegExp(r'^[^@]+@[^@]+\.[^@]+$').hasMatch(value)) return null;

    try {
      final exists = await apiService.checkEmailExists(value);
      return exists ? message : null;
    } catch (e) {
      return null; // 网络故障时优雅降级
    }
  }
}
```

### 防抖异步验证

为避免每次按键都重复请求服务器，异步验证器应当**防抖处理**：

```dart
class DebouncedAsyncValidator extends AsyncValidator {
  final AsyncValidator inner;
  final Duration delay;
  Timer? _timer;
  String? _lastValue;
  String? _lastResult;

  DebouncedAsyncValidator({
    required this.inner,
    this.delay = const Duration(milliseconds: 500),
  });

  @override
  Future<String?> validate(String value) async {
    if (value.isEmpty) return null;

    // 如果值未变化且已有缓存结果，直接返回
    if (value == _lastValue && _lastResult != null) {
      return _lastResult;
    }

    _lastValue = value;

    // 等待防抖延迟
    await Future.delayed(delay);

    // 如果延迟期间值已变化，跳过此次验证
    if (value != _lastValue) return null;

    _lastResult = await inner.validate(value);
    return _lastResult;
  }
}
```

---

## 表单联动：密码确认、级联选择、动态字段

表单联动是指字段的验证依赖于**其他字段**的值。

### 密码确认

```dart
class PasswordMatchValidator extends SyncValidator {
  final String Function() getPassword;
  final String message;

  PasswordMatchValidator({
    required this.getPassword,
    this.message = '两次输入的密码不一致',
  });

  @override
  String? validateSync(String value) {
    if (value.isEmpty) return null;
    if (value != getPassword()) return message;
    return null;
  }
}

// 在表单中使用
class RegistrationForm extends StatefulWidget {
  @override
  State<RegistrationForm> createState() => _RegistrationFormState();
}

class _RegistrationFormState extends State<RegistrationForm> {
  final _passwordController = TextEditingController();

  @override
  void dispose() {
    _passwordController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Form(
      child: Column(
        children: [
          LuckyTextField(
            label: '密码',
            obscureText: true,
            controller: _passwordController,
            validators: [
              RequiredValidator(message: '密码为必填项'),
              MinLengthValidator(8),
              PatternValidator(
                RegExp(r'(?=.*[A-Z])(?=.*[a-z])(?=.*\d)'),
                message: '必须包含大写字母、小写字母和数字',
              ),
            ],
          ),
          const SizedBox(height: 16),
          LuckyTextField(
            label: '确认密码',
            obscureText: true,
            validators: [
              RequiredValidator(message: '请确认您的密码'),
              PasswordMatchValidator(
                getPassword: () => _passwordController.text,
              ),
            ],
          ),
        ],
      ),
    );
  }
}
```

### 级联下拉选择（地区选择）

```dart
class CascadingRegionSelector extends StatefulWidget {
  @override
  State<CascadingRegionSelector> createState() => _CascadingRegionSelectorState();
}

class _CascadingRegionSelectorState extends State<CascadingRegionSelector> {
  final RegionService _regionService = RegionService();

  List<String> _provinces = [];
  List<String> _cities = [];
  List<String> _barangays = [];

  String? _selectedProvince;
  String? _selectedCity;
  String? _selectedBarangay;

  @override
  void initState() {
    super.initState();
    _loadProvinces();
  }

  Future<void> _loadProvinces() async {
    final provinces = await _regionService.getProvinces();
    setState(() => _provinces = provinces);
  }

  Future<void> _onProvinceChanged(String? province) async {
    setState(() {
      _selectedProvince = province;
      _selectedCity = null;
      _selectedBarangay = null;
      _cities = [];
      _barangays = [];
    });
    if (province != null) {
      final cities = await _regionService.getCities(province);
      setState(() => _cities = cities);
    }
  }

  Future<void> _onCityChanged(String? city) async {
    setState(() {
      _selectedCity = city;
      _selectedBarangay = null;
      _barangays = [];
    });
    if (city != null) {
      final barangays = await _regionService.getBarangays(
        _selectedProvince!,
        city,
      );
      setState(() => _barangays = barangays);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = context.luckyFormTheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // 省/直辖市下拉
        DropdownButtonFormField<String>(
          value: _selectedProvince,
          decoration: InputDecoration(
            labelText: '省份',
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(theme.borderRadius),
            ),
          ),
          items: _provinces.map((p) => DropdownMenuItem(value: p, child: Text(p))).toList(),
          onChanged: _onProvinceChanged,
          validator: (v) => v == null ? '请选择一个省份' : null,
        ),
        const SizedBox(height: 12),

        // 城市下拉（仅在选择省份后启用）
        DropdownButtonFormField<String>(
          value: _selectedCity,
          decoration: InputDecoration(
            labelText: '城市/直辖市',
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(theme.borderRadius),
            ),
          ),
          items: _cities.map((c) => DropdownMenuItem(value: c, child: Text(c))).toList(),
          onChanged: _onCityChanged,
          validator: (v) => v == null ? '请选择一个城市' : null,
        ),
        const SizedBox(height: 12),

        // 区/县下拉（仅在选择城市后启用）
        DropdownButtonFormField<String>(
          value: _selectedBarangay,
          decoration: InputDecoration(
            labelText: '区/县',
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(theme.borderRadius),
            ),
          ),
          items: _barangays.map((b) => DropdownMenuItem(value: b, child: Text(b))).toList(),
          onChanged: (v) => setState(() => _selectedBarangay = v),
          validator: (v) => v == null ? '请选择一个区/县' : null,
        ),
      ],
    );
  }
}
```

### 动态显示/隐藏字段

```dart
class DynamicFieldsForm extends StatefulWidget {
  @override
  State<DynamicFieldsForm> createState() => _DynamicFieldsFormState();
}

class _DynamicFieldsFormState extends State<DynamicFieldsForm> {
  bool _hasReferral = false;
  bool _useBusinessName = false;

  @override
  Widget build(BuildContext context) {
    return Form(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 字段 1：是否有推荐码？
          SwitchListTile(
            title: const Text('我有推荐码'),
            value: _hasReferral,
            onChanged: (v) => setState(() => _hasReferral = v),
          ),

          // 字段 2：推荐码（仅在勾选后显示）
          if (_hasReferral)
            LuckyTextField(
              label: '推荐码',
              hintText: '输入推荐码',
              validators: [
                RequiredValidator(message: '请输入推荐码'),
              ],
            ),

          const SizedBox(height: 16),

          // 字段 3：是否以企业身份注册？
          SwitchListTile(
            title: const Text('以企业身份注册'),
            value: _useBusinessName,
            onChanged: (v) => setState(() => _useBusinessName = v),
          ),

          // 字段 4：企业名称（仅在勾选后显示）
          if (_useBusinessName)
            LuckyTextField(
              label: '企业名称',
              hintText: '输入注册的企业名称',
              validators: [
                RequiredValidator(message: '企业名称为必填项'),
                MinLengthValidator(3),
              ],
            ),
        ],
      ),
    );
  }
}
```

---

## 验证触发配置：onChange / onBlur / onSubmit / manual

不同的用户体验模式需要不同的验证时机。[`ValidationTrigger`] 枚举提供了四种模式：

```dart
enum ValidationTrigger {
  onChange,  // 每次按键都验证
  onBlur,    // 字段失去焦点时验证
  onSubmit,  // 仅提交表单时验证
  manual,    // 仅通过显式调用验证
}
```

### 触发行为矩阵

| 触发方式 | 验证时机 | 最佳实践 |
|---------|---------------------|---------------|
| `onChange` | 每次 `TextEditingController` 变化 | 字符计数、密码强度 |
| `onBlur` | `FocusNode` 失去焦点时 | 邮箱、电话——避免过早提示错误 |
| `onSubmit` | 仅在显式调用 `formKey.currentState!.validate()` 时 | 长表单，避免干扰用户 |
| `manual` | 从不自动验证；仅通过 `field.validate()` 调用 | 自定义 UI 触发器 |

### 表单级提交验证

```dart
class MyForm extends StatefulWidget {
  @override
  State<MyForm> createState() => _MyFormState();
}

class _MyFormState extends State<MyForm> {
  final _formKey = GlobalKey<FormState>();
  final _fieldKeys = <GlobalKey<_LuckyTextFieldState>>[];

  Future<void> _onSubmit() async {
    // 验证所有字段
    bool allValid = true;
    for (final fieldKey in _fieldKeys) {
      final field = fieldKey.currentState;
      if (field != null) {
        await field.validate();
        if (field.status != ValidationStatus.valid) {
          allValid = false;
        }
      }
    }

    if (!allValid) {
      // 聚焦第一个错误字段
      // 显示错误提示
      return;
    }

    // 继续提交表单
  }

  @override
  Widget build(BuildContext context) {
    return Form(
      key: _formKey,
      child: Column(
        children: [
          LuckyTextField(
            key: _fieldKeys[0],
            label: '邮箱',
            validationTrigger: ValidationTrigger.onSubmit, // 仅在提交时验证
            validators: [
              RequiredValidator(),
              EmailValidator(),
            ],
          ),
          const SizedBox(height: 16),
          ElevatedButton(
            onPressed: _onSubmit,
            child: const Text('提交'),
          ),
        ],
      ),
    );
  }
}
```

---

## 验证状态机：有效 / 无效 / 验证中 / 未触及 / 已修改

验证状态机追踪每个字段的用户交互和验证状态，使 UI 组件能够渲染相应的状态。

### 状态机定义

```dart
enum ValidationStatus {
  pristine,   // 用户尚未与此字段交互
  dirty,      // 用户已输入但尚未验证
  validating, // 验证进行中（例如异步检查）
  valid,      // 验证通过
  invalid,    // 验证失败
}
```

### 状态转换图

```
                  ┌─────────────┐
                  │   PRISTINE   │
                  └──────┬──────┘
                         │ 用户输入
                         ▼
                  ┌─────────────┐
         ┌───────│    DIRTY     │────────┐
         │       └──────┬──────┘        │
         │              │                │
         │    触发验证                    │
         │              │                │
         │              ▼                │
         │       ┌─────────────┐         │
         │       │  VALIDATING │         │
         │       └──────┬──────┘         │
         │              │                │
         │    ┌────┬────┴────┬────┐      │
         │    │         │         │      │
         ▼    ▼         ▼         ▼      │
    ┌────────┐  ┌─────────┐  ┌────────┐  │
    │  VALID  │  │ INVALID  │  │ 超时   │ │
    └────────┘  └─────────┘  └────────┘  │
         │         │                      │
         └────┬────┘                      │
              │ 用户再次输入               │
              └───────────────────────────┘
```

### 状态消费者组件

```dart
class ValidationStateBuilder extends StatelessWidget {
  final ValueNotifier<ValidationStatus> statusNotifier;
  final Widget Function(BuildContext, ValidationStatus) builder;

  const ValidationStateBuilder({
    super.key,
    required this.statusNotifier,
    required this.builder,
  });

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<ValidationStatus>(
      valueListenable: statusNotifier,
      builder: (context, status, _) => builder(context, status),
    );
  }
}

// 使用：根据状态显示不同边框颜色
ValidationStateBuilder(
  statusNotifier: _statusNotifier,
  builder: (context, status) {
    Color borderColor;
    switch (status) {
      case ValidationStatus.invalid:
        borderColor = Colors.red;
        break;
      case ValidationStatus.valid:
        borderColor = Colors.green;
        break;
      case ValidationStatus.validating:
        borderColor = Colors.orange;
        break;
      default:
        borderColor = Colors.grey;
    }

    return Container(
      decoration: BoxDecoration(
        border: Border.all(color: borderColor),
        borderRadius: BorderRadius.circular(8),
      ),
      child: // ... 表单字段
    );
  },
);
```

---

## 自动焦点管理：nextFieldAction

自动焦点管理器允许用户通过键盘的 Next/Done 按钮**在字段间跳转**，显著提升表单填写速度——尤其对于长注册表单。

### 焦点管理器

```dart
class FormFocusManager {
  final Map<String, FocusNode> _focusNodes = {};
  final List<String> _fieldOrder = [];
  int _currentIndex = 0;

  /// 注册字段到焦点顺序中
  FocusNode registerField(String fieldId) {
    final node = FocusNode();
    _focusNodes[fieldId] = node;
    _fieldOrder.add(fieldId);
    return node;
  }

  /// 将焦点移到下一个字段
  void focusNext(String currentFieldId) {
    final currentIndex = _fieldOrder.indexOf(currentFieldId);
    if (currentIndex < _fieldOrder.length - 1) {
      final nextId = _fieldOrder[currentIndex + 1];
      _focusNodes[nextId]?.requestFocus();
    }
  }

  /// 将焦点移到上一个字段
  void focusPrevious(String currentFieldId) {
    final currentIndex = _fieldOrder.indexOf(currentFieldId);
    if (currentIndex > 0) {
      final prevId = _fieldOrder[currentIndex - 1];
      _focusNodes[prevId]?.requestFocus();
    }
  }

  /// 检查是否为最后一个字段
  bool isLastField(String fieldId) {
    return _fieldOrder.last == fieldId;
  }

  /// 取消所有焦点（收起键盘）
  void unfocusAll() {
    _focusNodes.values.forEach((n) => n.unfocus());
  }

  void dispose() {
    _focusNodes.values.forEach((n) => n.dispose());
    _focusNodes.clear();
  }
}
```

### 与 LuckyTextField 集成

```dart
class AutoFocusForm extends StatefulWidget {
  @override
  State<AutoFocusForm> createState() => _AutoFocusFormState();
}

class _AutoFocusFormState extends State<AutoFocusForm> {
  final FormFocusManager _focusManager = FormFocusManager();

  @override
  void dispose() {
    _focusManager.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        LuckyTextField(
          fieldId: 'fullName',
          label: '姓名',
          textInputAction: TextInputAction.next,
          focusNode: _focusManager.registerField('fullName'),
          onSubmitted: (_) => _focusManager.focusNext('fullName'),
          validators: [RequiredValidator()],
        ),
        const SizedBox(height: 16),
        LuckyTextField(
          fieldId: 'email',
          label: '邮箱',
          keyboardType: TextInputType.emailAddress,
          textInputAction: TextInputAction.next,
          focusNode: _focusManager.registerField('email'),
          onSubmitted: (_) => _focusManager.focusNext('email'),
          validators: [RequiredValidator(), EmailValidator()],
        ),
        const SizedBox(height: 16),
        LuckyTextField(
          fieldId: 'phone',
          label: '手机号',
          keyboardType: TextInputType.phone,
          textInputAction: TextInputAction.next,
          focusNode: _focusManager.registerField('phone'),
          onSubmitted: (_) => _focusManager.focusNext('phone'),
          validators: [RequiredValidator(), PhoneValidator()],
        ),
        const SizedBox(height: 16),
        LuckyTextField(
          fieldId: 'password',
          label: '密码',
          obscureText: true,
          textInputAction: TextInputAction.done, // 最后一个字段 → Done
          focusNode: _focusManager.registerField('password'),
          onSubmitted: (_) => _focusManager.unfocusAll(),
          validators: [
            RequiredValidator(),
            MinLengthValidator(8),
          ],
        ),
      ],
    );
  }
}
```

---

## 实践：完整的注册表单

以下是所有组件在真实注册界面中的协作示例。

```dart
class RegistrationScreen extends StatefulWidget {
  @override
  State<RegistrationScreen> createState() => _RegistrationScreenState();
}

class _RegistrationScreenState extends State<RegistrationScreen> {
  final _formKey = GlobalKey<FormState>();
  final _focusManager = FormFocusManager();
  final _passwordController = TextEditingController();
  final _apiService = ApiService();

  bool _isSubmitting = false;

  @override
  void dispose() {
    _passwordController.dispose();
    _focusManager.dispose();
    super.dispose();
  }

  Future<void> _handleSubmit() async {
    // 触发所有字段验证
    if (!_formKey.currentState!.validate()) {
      // 滚动到第一个错误字段
      return;
    }

    setState(() => _isSubmitting = true);

    try {
      // 提交注册
      await _apiService.register(
        username: _usernameController.text,
        email: _emailController.text,
        phone: _phoneController.text,
        password: _passwordController.text,
      );

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('注册成功！')),
        );
        Navigator.of(context).pushReplacementNamed('/home');
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('注册失败：$e')),
        );
      }
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = context.luckyFormTheme;

    return Scaffold(
      appBar: AppBar(title: const Text('创建账号')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // 用户名（带异步可用性检查）
              LuckyTextField(
                fieldId: 'username',
                label: '用户名',
                hintText: '选择一个独一无二的用户名',
                prefixIcon: const Icon(Icons.person_outline),
                textInputAction: TextInputAction.next,
                focusNode: _focusManager.registerField('username'),
                onSubmitted: (_) => _focusManager.focusNext('username'),
                validators: [
                  RequiredValidator(message: '用户名是必填项'),
                  MinLengthValidator(3, message: '用户名至少需要 3 个字符'),
                  PatternValidator(
                    RegExp(r'^[a-zA-Z0-9_]+$'),
                    message: '只能包含字母、数字和下划线',
                  ),
                  DebouncedAsyncValidator(
                    inner: UsernameAvailabilityValidator(apiService: _apiService),
                  ),
                ],
                validationTrigger: ValidationTrigger.onBlur,
              ),
              const SizedBox(height: 20),

              // 邮箱
              LuckyTextField(
                fieldId: 'email',
                label: '邮箱地址',
                hintText: 'you@example.com',
                prefixIcon: const Icon(Icons.email_outlined),
                keyboardType: TextInputType.emailAddress,
                textInputAction: TextInputAction.next,
                focusNode: _focusManager.registerField('email'),
                onSubmitted: (_) => _focusManager.focusNext('email'),
                validators: [
                  RequiredValidator(message: '邮箱是必填项'),
                  EmailValidator(),
                  DebouncedAsyncValidator(
                    inner: EmailUniquenessValidator(apiService: _apiService),
                  ),
                ],
                validationTrigger: ValidationTrigger.onBlur,
              ),
              const SizedBox(height: 20),

              // 手机号
              LuckyTextField(
                fieldId: 'phone',
                label: '手机号码',
                hintText: '+63 912 345 6789',
                prefixIcon: const Icon(Icons.phone_outlined),
                keyboardType: TextInputType.phone,
                textInputAction: TextInputAction.next,
                focusNode: _focusManager.registerField('phone'),
                onSubmitted: (_) => _focusManager.focusNext('phone'),
                validators: [
                  RequiredValidator(message: '手机号是必填项'),
                  PhoneValidator(countryCode: '63'),
                ],
                validationTrigger: ValidationTrigger.onBlur,
              ),
              const SizedBox(height: 20),

              // 密码
              LuckyTextField(
                fieldId: 'password',
                label: '密码',
                hintText: '至少 8 个字符',
                prefixIcon: const Icon(Icons.lock_outlined),
                obscureText: true,
                textInputAction: TextInputAction.next,
                focusNode: _focusManager.registerField('password'),
                onSubmitted: (_) => _focusManager.focusNext('confirmPassword'),
                validators: [
                  RequiredValidator(message: '密码是必填项'),
                  MinLengthValidator(8),
                  PatternValidator(
                    RegExp(r'(?=.*[A-Z])(?=.*[a-z])(?=.*\d)'),
                    message: '必须包含大写字母、小写字母和数字',
                  ),
                ],
                validationTrigger: ValidationTrigger.onBlur,
              ),
              const SizedBox(height: 20),

              // 确认密码
              LuckyTextField(
                fieldId: 'confirmPassword',
                label: '确认密码',
                hintText: '再次输入密码',
                prefixIcon: const Icon(Icons.lock_outlined),
                obscureText: true,
                textInputAction: TextInputAction.done,
                focusNode: _focusManager.registerField('confirmPassword'),
                onSubmitted: (_) => _focusManager.unfocusAll(),
                validators: [
                  RequiredValidator(message: '请确认您的密码'),
                  PasswordMatchValidator(
                    getPassword: () => _passwordController.text,
                  ),
                ],
                validationTrigger: ValidationTrigger.onBlur,
              ),
              const SizedBox(height: 32),

              // 提交按钮
              SizedBox(
                height: 48,
                child: ElevatedButton(
                  onPressed: _isSubmitting ? null : _handleSubmit,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF6366F1),
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(theme.borderRadius),
                    ),
                  ),
                  child: _isSubmitting
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Text(
                          '创建账号',
                          style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
                        ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
```

---

## 总结

`LuckyFormTheme` + `Validator` 系统提供了一个全面的表单框架，弥补了 Flutter 默认表单组件的不足：

| 组件 | 职责 | 关键特性 |
|-----------|---------------|-------------|
| `LuckyFormThemeConfig` | 样式配置 | 20+ 样式属性，明暗主题支持 |
| `LuckyFormThemeWidget` | 主题下发 | `InheritedWidget` + `context.luckyFormTheme` |
| `LuckyTextField` | 表单字段包装 | 3 种变体（outlined/filled/underlined），主题感知 |
| `FieldValidator` 链 | 验证规则 | Required → Email → Phone → Length → Pattern → Custom |
| `AsyncValidator` | 服务器验证 | 防抖用户名/邮箱可用性检查 |
| `PasswordMatchValidator` | 表单联动 | 跨字段验证 |
| `ValidationStatus` | 状态机 | pristine → dirty → validating → valid/invalid |
| `ValidationTrigger` | 时机控制 | onChange / onBlur / onSubmit / manual |
| `FormFocusManager` | 焦点管理 | 通过 `TextInputAction.next` 自动跳转 |

### 关键要点

- **通过 `InheritedWidget` 集中管理表单样式**——不再重复配置 `InputDecoration`
- **在链中组合验证器**——每个验证器职责单一，首个失败即短路
- **防抖异步验证器**——500ms 防抖防止输入过程中过多的 API 调用
- **大多数字段使用 `onBlur`**——`onChange` 验证对邮箱和电话等字段来说过于激进
- **实现验证状态机**——为更好的 UI 反馈提供支持（颜色变化、图标、加载动画）
- **自动焦点管理是用户体验利器**——长表单中键盘 Tab 导航显著提升填写速度

### 何时使用此模式

此表单系统适用于以下场景：
- 应用中有多个表单需要视觉一致性
- 需要异步验证（用户名/邮箱唯一性）
- 需要可配置的验证时机
- 需要表单联动（密码确认、级联下拉）
- 需要键盘友好的自动焦点导航

### 相关文章

- [**F6: Design Tokens 生成系统**](./design-tokens-generated-system.md) — 为 `LuckyFormThemeConfig` 颜色和间距提供支持的令牌系统
- [**F20: ReactiveForms + 代码生成表单**](./reactive-forms-code-generation.md) — 在此主题系统基础上构建响应式表单控制器和 JSON Schema 自动生成
- [**F5: HydratedStateNotifier 抽象持久化**](./hydrated-state-notifier-abstract-persistence.md) — 跨应用重启保存表单草稿
