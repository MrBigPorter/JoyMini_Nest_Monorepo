---
title: "LuckyFormTheme: Form Theme System + Custom Validator Chain"
description: "A comprehensive Flutter form framework featuring InheritedWidget-based centralized theme configuration, chained validators (Required → Email → Phone → Length → Pattern → Custom), async validation with debouncing, cross-field validation (password confirmation, cascading selectors, dynamic fields), configurable validation triggers, state machine tracking, and automatic focus management."
slug: lucky-form-theme-validator-system
tags: [Flutter, Forms, Validation, UI, State Machine]
---

# LuckyFormTheme: Form Theme System + Custom Validator Chain

## Table of Contents

- [Form Consistency Challenges in Flutter](#form-consistency-challenges-in-flutter)
- [Architecture Overview: LuckyFormTheme + Validator Chain](#architecture-overview-luckyformtheme--validator-chain)
- [LuckyFormTheme: Unified Style Configuration via InheritedWidget](#luckyformtheme-unified-style-configuration-via-inheritedwidget)
  - [Theme Configuration](#theme-configuration)
  - [InheritedWidget Provider](#inheritedwidget-provider)
  - [App-Level Setup](#app-level-setup)
- [Form Field Variants: Outlined / Filled / Underlined](#form-field-variants-outlined--filled--underlined)
  - [Variant Implementation](#variant-implementation)
  - [Variant Visual Comparison](#variant-visual-comparison)
- [Chained Validators: Required → Email → Phone → Length → Pattern → Custom](#chained-validators-required--email--phone--length--pattern--custom)
  - [Validator Interface](#validator-interface)
  - [Built-in Validators](#built-in-validators)
  - [Validator Chain Usage](#validator-chain-usage)
  - [Validator Execution Flow](#validator-execution-flow)
- [Async Validators: Real-time Server Validation](#async-validators-real-time-server-validation)
  - [AsyncValidator Implementation](#asyncvalidator-implementation)
  - [Debounced Async Validation](#debounced-async-validation)
- [Form Interlocking: Password Confirmation, Cascading Select, Dynamic Fields](#form-interlocking-password-confirmation-cascading-select-dynamic-fields)
  - [Password Confirmation](#password-confirmation)
  - [Cascading Dropdown Select (Region Selector)](#cascading-dropdown-select-region-selector)
  - [Dynamic Show/Hide Fields](#dynamic-showhide-fields)
- [Validation Trigger Configuration: onChange / onBlur / onSubmit / manual](#validation-trigger-configuration-onchange--onblur--onsubmit--manual)
  - [Trigger Behavior Matrix](#trigger-behavior-matrix)
  - [Form-Level Submit Validation](#form-level-submit-validation)
- [Validation State Machine: Valid / Invalid / Validating / Pristine / Dirty](#validation-state-machine-valid--invalid--validating--pristine--dirty)
  - [State Machine Definition](#state-machine-definition)
  - [State Transition Diagram](#state-transition-diagram)
  - [State Consumer Component](#state-consumer-component)
- [Automatic Focus Management: nextFieldAction](#automatic-focus-management-nextfieldaction)
  - [Focus Manager](#focus-manager)
  - [LuckyTextField Integration](#luckytextfield-integration)
- [Practice: Complete Registration Form](#practice-complete-registration-form)
- [Summary](#summary)
  - [Key Takeaways](#key-takeaways)
  - [When to Use This Pattern](#when-to-use-this-pattern)
  - [Related Articles](#related-articles)

## Form Consistency Challenges in Flutter

When building forms in Flutter, developers often face the following challenges:

1. **Style duplication**: Every `TextFormField` requires repeated configuration of `InputDecoration`, borders, colors, border radius, etc.
2. **Scattered validation logic**: Validation rules are scattered across forms, making reuse difficult
3. **Inflexible validation timing**: Flutter's built-in `Form.validate()` only triggers on submit, lacking `onChange` or `onBlur` validation
4. **Complex cross-field validation**: Scenarios like password confirmation and cascading dropdowns require access to other field values
5. **Difficult async validation**: Checking username/email availability requires server interaction, but Flutter natively lacks async validation support

The `LuckyFormTheme` + Validator system solves these problems through:

- **Centralized theme configuration**: Provides globally unified form styles via `InheritedWidget`
- **Chainable validators**: Each validator handles a single rule, executed sequentially
- **Flexible validation trigger timing**: Supports four modes: `onChange`, `onBlur`, `onSubmit`, `manual`
- **Async validation support**: Built-in debouncing and graceful degradation
- **Cross-field interlocking**: Password confirmation, cascading selectors, dynamic show/hide

## Architecture Overview: LuckyFormTheme + Validator Chain

```
┌────────────────────────────────────────────────────────────┐
│                    LuckyFormThemeConfig                     │
│  (colors / borders / typography / icons / animations)       │
└─────────────────────────┬──────────────────────────────────┘
                          │ Distributed via InheritedWidget
                          ▼
┌────────────────────────────────────────────────────────────┐
│                   LuckyFormThemeWidget                      │
│              context.luckyFormTheme extension method        │
└─────────────────────────┬──────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
┌─────────────────┐ ┌────────────┐ ┌──────────────┐
│  LuckyTextField  │ │ Validator   │ │ FocusManager │
│ (3 variants)     │ │ Chain      │ │ (Auto Focus) │
└─────────────────┘ └────────────┘ └──────────────┘
```

## LuckyFormTheme: Unified Style Configuration via InheritedWidget

`LuckyFormThemeConfig` centrally manages all form style properties, distributed to the entire widget tree via `InheritedWidget`.

### Theme Configuration

```dart
/// Complete form theme configuration
class LuckyFormThemeConfig {
  // ── Borders & Background ──
  final double borderRadius;
  final Color? fillColor;
  final Color? focusedBorderColor;
  final Color? enabledBorderColor;
  final Color? errorBorderColor;

  // ── Text & Typography ──
  final double fontSize;
  final FontWeight fontWeight;
  final Color textColor;
  final Color labelColor;
  final Color hintColor;
  final double labelFontSize;

  // ── Height & Padding ──
  final double height;
  final EdgeInsetsGeometry contentPadding;

  // ── Icons ──
  final double? iconSize;
  final Color? iconColor;

  // ── Validation Feedback ──
  final Color errorColor;
  final Color successColor;
  final Color validatingColor;

  // ── Animations ──
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

  /// Create from theme data (supports generation from Design Tokens)
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

  /// Light theme defaults
  static const light = LuckyFormThemeConfig();

  /// Dark theme defaults
  static const dark = LuckyFormThemeConfig(
    fillColor: Color(0xFF1E293B),
    textColor: Color(0xFFF1F5F9),
    labelColor: Color(0xFF94A3B8),
    hintColor: Color(0xFF64748B),
    enabledBorderColor: Color(0xFF334155),
  );

  /// Merge two configs (caller overrides defaults)
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

### InheritedWidget Provider

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

/// Convenient access via BuildContext extension
extension LuckyFormThemeContext on BuildContext {
  LuckyFormThemeConfig get luckyFormTheme => LuckyFormThemeWidget.of(this);
}
```

### App-Level Setup

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

## Form Field Variants: Outlined / Filled / Underlined

`LuckyTextField` supports three visual variants, controlled by the `LuckyFieldVariant` enum.

### Variant Implementation

```dart
/// Form field variant
enum LuckyFieldVariant {
  outlined,  // Outline border, floating label
  filled,    // Filled background, no border
  underlined,// Bottom line, minimal style
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

  /// Manually trigger validation (for onSubmit mode)
  Future<void> validate() => _validate();

  /// Build variant-based InputDecoration
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

  /// Validation status suffix icon
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

### Variant Visual Comparison

| Variant | Visual Style | Use Case |
|---------|-------------|----------|
| **outlined** | Rectangular border, floating label on focus | Login/registration, standalone fields |
| **filled** | Solid background, no border | Search bar, secondary input |
| **underlined** | Bottom line, minimal style | Inline editing, settings forms |

---

## Chained Validators: Required → Email → Phone → Length → Pattern → Custom

The validator system is built on a simple abstract interface with concrete implementations for common validation rules. Validators are **chainable** — they execute in sequence, stopping at the first failure.

### Validator Interface

```dart
abstract class FieldValidator {
  /// Returns error message on failure, null on success
  Future<String?> validate(String value);
}

/// Convenient base class for synchronous validators
abstract class SyncValidator implements FieldValidator {
  @override
  Future<String?> validate(String value) async => validateSync(value);

  String? validateSync(String value);
}
```

### Built-in Validators

```dart
class RequiredValidator extends SyncValidator {
  final String message;

  RequiredValidator({this.message = 'This field is required'});

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

  EmailValidator({this.message = 'Please enter a valid email address'});

  @override
  String? validateSync(String value) {
    if (value.isEmpty) return null; // Skip empty (use RequiredValidator for required check)
    if (!_emailRegExp.hasMatch(value)) return message;
    return null;
  }
}

class PhoneValidator extends SyncValidator {
  final String message;
  final String? countryCode;

  PhoneValidator({this.message = 'Please enter a valid phone number', this.countryCode});

  @override
  String? validateSync(String value) {
    if (value.isEmpty) return null;

    // Strip common formatting characters
    final digits = value.replaceAll(RegExp(r'[\s\-\(\)\+]'), '');

    if (countryCode != null && !digits.startsWith(countryCode!)) {
      return 'Number must start with $countryCode';
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
      : message = message ?? 'At least $minLength characters required';

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
      : message = message ?? 'Cannot exceed $maxLength characters';

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

  PatternValidator(this.pattern, {this.message = 'Invalid format'});

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

### Validator Chain Usage

```dart
LuckyTextField(
  label: 'Email',
  hintText: 'Enter your email address',
  keyboardType: TextInputType.emailAddress,
  validators: [
    RequiredValidator(message: 'Email is required'),
    EmailValidator(),
    MaxLengthValidator(254, message: 'Email address is too long'),
  ],
  validationTrigger: ValidationTrigger.onBlur, // Validate on focus loss
)
```

### Validator Execution Flow

```
User enters "test@ex"
         │
         ▼
RequiredValidator.validate("test@ex") → null (non-empty)
         │
         ▼
EmailValidator.validate("test@ex") → "Please enter a valid email address"
         │
         ▼
         ⚠️ Validation failed → display error message
         (MaxLengthValidator is never called — short-circuit)
```

---

## Async Validators: Real-time Server Validation

Async validators are essential for data requiring server-side validation, such as **username availability** or **email uniqueness**. They inherit from the same [`FieldValidator`] interface but execute HTTP requests.

### AsyncValidator Implementation

```dart
abstract class AsyncValidator implements FieldValidator {
  /// Override this to perform async validation
  @override
  Future<String?> validate(String value);
}

class UsernameAvailabilityValidator extends AsyncValidator {
  final ApiService apiService;
  final String message;

  UsernameAvailabilityValidator({
    required this.apiService,
    this.message = 'This username is already taken',
  });

  @override
  Future<String?> validate(String value) async {
    if (value.isEmpty) return null;
    if (value.length < 3) return null; // Skip short values

    try {
      final available = await apiService.checkUsernameAvailability(value);
      return available ? null : message;
    } catch (e) {
      // Network error — don't block form submission, just show warning
      return null;
    }
  }
}

class EmailUniquenessValidator extends AsyncValidator {
  final ApiService apiService;
  final String message;

  EmailUniquenessValidator({
    required this.apiService,
    this.message = 'This email is already registered',
  });

  @override
  Future<String?> validate(String value) async {
    if (value.isEmpty) return null;

    // First perform basic email format check (sync guard)
    if (!RegExp(r'^[^@]+@[^@]+\.[^@]+$').hasMatch(value)) return null;

    try {
      final exists = await apiService.checkEmailExists(value);
      return exists ? message : null;
    } catch (e) {
      return null; // Graceful degradation on network failure
    }
  }
}
```

### Debounced Async Validation

To avoid sending a server request on every keystroke, async validators should be **debounced**:

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

    // If value unchanged and cached result exists, return immediately
    if (value == _lastValue && _lastResult != null) {
      return _lastResult;
    }

    _lastValue = value;

    // Wait for debounce delay
    await Future.delayed(delay);

    // If value changed during delay, skip this validation
    if (value != _lastValue) return null;

    _lastResult = await inner.validate(value);
    return _lastResult;
  }
}
```

---

## Form Interlocking: Password Confirmation, Cascading Select, Dynamic Fields

Form interlocking refers to field validation that depends on **other fields'** values.

### Password Confirmation

```dart
class PasswordMatchValidator extends SyncValidator {
  final String Function() getPassword;
  final String message;

  PasswordMatchValidator({
    required this.getPassword,
    this.message = 'Passwords do not match',
  });

  @override
  String? validateSync(String value) {
    if (value.isEmpty) return null;
    if (value != getPassword()) return message;
    return null;
  }
}

// Usage in form
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
            label: 'Password',
            obscureText: true,
            controller: _passwordController,
            validators: [
              RequiredValidator(message: 'Password is required'),
              MinLengthValidator(8),
              PatternValidator(
                RegExp(r'(?=.*[A-Z])(?=.*[a-z])(?=.*\d)'),
                message: 'Must include uppercase, lowercase, and numbers',
              ),
            ],
          ),
          const SizedBox(height: 16),
          LuckyTextField(
            label: 'Confirm Password',
            obscureText: true,
            validators: [
              RequiredValidator(message: 'Please confirm your password'),
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

### Cascading Dropdown Select (Region Selector)

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
        // Province dropdown
        DropdownButtonFormField<String>(
          value: _selectedProvince,
          decoration: InputDecoration(
            labelText: 'Province',
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(theme.borderRadius),
            ),
          ),
          items: _provinces.map((p) => DropdownMenuItem(value: p, child: Text(p))).toList(),
          onChanged: _onProvinceChanged,
          validator: (v) => v == null ? 'Please select a province' : null,
        ),
        const SizedBox(height: 12),

        // City dropdown (only enabled after province selection)
        DropdownButtonFormField<String>(
          value: _selectedCity,
          decoration: InputDecoration(
            labelText: 'City/Municipality',
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(theme.borderRadius),
            ),
          ),
          items: _cities.map((c) => DropdownMenuItem(value: c, child: Text(c))).toList(),
          onChanged: _onCityChanged,
          validator: (v) => v == null ? 'Please select a city' : null,
        ),
        const SizedBox(height: 12),

        // Barangay dropdown (only enabled after city selection)
        DropdownButtonFormField<String>(
          value: _selectedBarangay,
          decoration: InputDecoration(
            labelText: 'District/Barangay',
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(theme.borderRadius),
            ),
          ),
          items: _barangays.map((b) => DropdownMenuItem(value: b, child: Text(b))).toList(),
          onChanged: (v) => setState(() => _selectedBarangay = v),
          validator: (v) => v == null ? 'Please select a district' : null,
        ),
      ],
    );
  }
}
```

### Dynamic Show/Hide Fields

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
          // Field 1: Do you have a referral code?
          SwitchListTile(
            title: const Text('I have a referral code'),
            value: _hasReferral,
            onChanged: (v) => setState(() => _hasReferral = v),
          ),

          // Field 2: Referral code (shown only when checked)
          if (_hasReferral)
            LuckyTextField(
              label: 'Referral Code',
              hintText: 'Enter referral code',
              validators: [
                RequiredValidator(message: 'Please enter a referral code'),
              ],
            ),

          const SizedBox(height: 16),

          // Field 3: Registering as a business?
          SwitchListTile(
            title: const Text('Register as a business'),
            value: _useBusinessName,
            onChanged: (v) => setState(() => _useBusinessName = v),
          ),

          // Field 4: Business name (shown only when checked)
          if (_useBusinessName)
            LuckyTextField(
              label: 'Business Name',
              hintText: 'Enter registered business name',
              validators: [
                RequiredValidator(message: 'Business name is required'),
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

## Validation Trigger Configuration: onChange / onBlur / onSubmit / manual

Different user experience patterns require different validation timing. The [`ValidationTrigger`] enum provides four modes:

```dart
enum ValidationTrigger {
  onChange,  // Validate on every keystroke
  onBlur,    // Validate when field loses focus
  onSubmit,  // Validate only on form submit
  manual,    // Validate only via explicit call
}
```

### Trigger Behavior Matrix

| Trigger | Validation Timing | Best Practice |
|---------|---------------------|---------------|
| `onChange` | Every `TextEditingController` change | Character count, password strength |
| `onBlur` | When `FocusNode` loses focus | Email, phone — avoid premature error hints |
| `onSubmit` | Only on explicit `formKey.currentState!.validate()` call | Long forms, avoid interrupting user |
| `manual` | Never auto-validate; only via `field.validate()` call | Custom UI triggers |

### Form-Level Submit Validation

```dart
class MyForm extends StatefulWidget {
  @override
  State<MyForm> createState() => _MyFormState();
}

class _MyFormState extends State<MyForm> {
  final _formKey = GlobalKey<FormState>();
  final _fieldKeys = <GlobalKey<_LuckyTextFieldState>>[];

  Future<void> _onSubmit() async {
    // Validate all fields
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
      // Focus first error field
      // Show error notification
      return;
    }

    // Continue with form submission
  }

  @override
  Widget build(BuildContext context) {
    return Form(
      key: _formKey,
      child: Column(
        children: [
          LuckyTextField(
            key: _fieldKeys[0],
            label: 'Email',
            validationTrigger: ValidationTrigger.onSubmit, // Validate only on submit
            validators: [
              RequiredValidator(),
              EmailValidator(),
            ],
          ),
          const SizedBox(height: 16),
          ElevatedButton(
            onPressed: _onSubmit,
            child: const Text('Submit'),
          ),
        ],
      ),
    );
  }
}
```

---

## Validation State Machine: Valid / Invalid / Validating / Pristine / Dirty

The validation state machine tracks each field's user interaction and validation status, enabling UI components to render corresponding states.

### State Machine Definition

```dart
enum ValidationStatus {
  pristine,   // User has not interacted with this field
  dirty,      // User has typed but not yet validated
  validating, // Validation in progress (e.g., async check)
  valid,      // Validation passed
  invalid,    // Validation failed
}
```

### State Transition Diagram

```
                  ┌─────────────┐
                  │   PRISTINE   │
                  └──────┬──────┘
                         │ User input
                         ▼
                  ┌─────────────┐
         ┌───────│    DIRTY     │────────┐
         │       └──────┬──────┘        │
         │              │                │
         │    Trigger validation         │
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
    │  VALID  │  │ INVALID  │  │ Timeout│ │
    └────────┘  └─────────┘  └────────┘  │
         │         │                      │
         └────┬────┘                      │
              │ User types again          │
              └───────────────────────────┘
```

### State Consumer Component

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

// Usage: Display different border colors based on state
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
      child: // ... form field
    );
  },
);
```

---

## Automatic Focus Management: nextFieldAction

The automatic focus manager allows users to **navigate between fields** using the keyboard's Next/Done button, significantly improving form filling speed — especially for long registration forms.

### Focus Manager

```dart
class FormFocusManager {
  final Map<String, FocusNode> _focusNodes = {};
  final List<String> _fieldOrder = [];
  int _currentIndex = 0;

  /// Register a field in the focus order
  FocusNode registerField(String fieldId) {
    final node = FocusNode();
    _focusNodes[fieldId] = node;
    _fieldOrder.add(fieldId);
    return node;
  }

  /// Move focus to the next field
  void focusNext(String currentFieldId) {
    final currentIndex = _fieldOrder.indexOf(currentFieldId);
    if (currentIndex < _fieldOrder.length - 1) {
      final nextId = _fieldOrder[currentIndex + 1];
      _focusNodes[nextId]?.requestFocus();
    }
  }

  /// Move focus to the previous field
  void focusPrevious(String currentFieldId) {
    final currentIndex = _fieldOrder.indexOf(currentFieldId);
    if (currentIndex > 0) {
      final prevId = _fieldOrder[currentIndex - 1];
      _focusNodes[prevId]?.requestFocus();
    }
  }

  /// Check if this is the last field
  bool isLastField(String fieldId) {
    return _fieldOrder.last == fieldId;
  }

  /// Unfocus all (dismiss keyboard)
  void unfocusAll() {
    _focusNodes.values.forEach((n) => n.unfocus());
  }

  void dispose() {
    _focusNodes.values.forEach((n) => n.dispose());
    _focusNodes.clear();
  }
}
```

### LuckyTextField Integration

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
          label: 'Full Name',
          textInputAction: TextInputAction.next,
          focusNode: _focusManager.registerField('fullName'),
          onSubmitted: (_) => _focusManager.focusNext('fullName'),
          validators: [RequiredValidator()],
        ),
        const SizedBox(height: 16),
        LuckyTextField(
          fieldId: 'email',
          label: 'Email',
          keyboardType: TextInputType.emailAddress,
          textInputAction: TextInputAction.next,
          focusNode: _focusManager.registerField('email'),
          onSubmitted: (_) => _focusManager.focusNext('email'),
          validators: [RequiredValidator(), EmailValidator()],
        ),
        const SizedBox(height: 16),
        LuckyTextField(
          fieldId: 'phone',
          label: 'Phone Number',
          keyboardType: TextInputType.phone,
          textInputAction: TextInputAction.next,
          focusNode: _focusManager.registerField('phone'),
          onSubmitted: (_) => _focusManager.focusNext('phone'),
          validators: [RequiredValidator(), PhoneValidator()],
        ),
        const SizedBox(height: 16),
        LuckyTextField(
          fieldId: 'password',
          label: 'Password',
          obscureText: true,
          textInputAction: TextInputAction.done, // Last field → Done
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

## Practice: Complete Registration Form

Below is an example of all components working together in a real registration screen.

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
    // Trigger validation on all fields
    if (!_formKey.currentState!.validate()) {
      // Scroll to first error field
      return;
    }

    setState(() => _isSubmitting = true);

    try {
      // Submit registration
      await _apiService.register(
        username: _usernameController.text,
        email: _emailController.text,
        phone: _phoneController.text,
        password: _passwordController.text,
      );

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Registration successful!')),
        );
        Navigator.of(context).pushReplacementNamed('/home');
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Registration failed: $e')),
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
      appBar: AppBar(title: const Text('Create Account')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Username (with async availability check)
              LuckyTextField(
                fieldId: 'username',
                label: 'Username',
                hintText: 'Choose a unique username',
                prefixIcon: const Icon(Icons.person_outline),
                textInputAction: TextInputAction.next,
                focusNode: _focusManager.registerField('username'),
                onSubmitted: (_) => _focusManager.focusNext('username'),
                validators: [
                  RequiredValidator(message: 'Username is required'),
                  MinLengthValidator(3, message: 'Username requires at least 3 characters'),
                  PatternValidator(
                    RegExp(r'^[a-zA-Z0-9_]+$'),
                    message: 'Only letters, numbers, and underscores allowed',
                  ),
                  DebouncedAsyncValidator(
                    inner: UsernameAvailabilityValidator(apiService: _apiService),
                  ),
                ],
                validationTrigger: ValidationTrigger.onBlur,
              ),
              const SizedBox(height: 20),

              // Email
              LuckyTextField(
                fieldId: 'email',
                label: 'Email Address',
                hintText: 'you@example.com',
                prefixIcon: const Icon(Icons.email_outlined),
                keyboardType: TextInputType.emailAddress,
                textInputAction: TextInputAction.next,
                focusNode: _focusManager.registerField('email'),
                onSubmitted: (_) => _focusManager.focusNext('email'),
                validators: [
                  RequiredValidator(message: 'Email is required'),
                  EmailValidator(),
                  DebouncedAsyncValidator(
                    inner: EmailUniquenessValidator(apiService: _apiService),
                  ),
                ],
                validationTrigger: ValidationTrigger.onBlur,
              ),
              const SizedBox(height: 20),

              // Phone
              LuckyTextField(
                fieldId: 'phone',
                label: 'Phone Number',
                hintText: '+63 912 345 6789',
                prefixIcon: const Icon(Icons.phone_outlined),
                keyboardType: TextInputType.phone,
                textInputAction: TextInputAction.next,
                focusNode: _focusManager.registerField('phone'),
                onSubmitted: (_) => _focusManager.focusNext('phone'),
                validators: [
                  RequiredValidator(message: 'Phone number is required'),
                  PhoneValidator(countryCode: '63'),
                ],
                validationTrigger: ValidationTrigger.onBlur,
              ),
              const SizedBox(height: 20),

              // Password
              LuckyTextField(
                fieldId: 'password',
                label: 'Password',
                hintText: 'At least 8 characters',
                prefixIcon: const Icon(Icons.lock_outlined),
                obscureText: true,
                textInputAction: TextInputAction.next,
                focusNode: _focusManager.registerField('password'),
                onSubmitted: (_) => _focusManager.focusNext('confirmPassword'),
                validators: [
                  RequiredValidator(message: 'Password is required'),
                  MinLengthValidator(8),
                  PatternValidator(
                    RegExp(r'(?=.*[A-Z])(?=.*[a-z])(?=.*\d)'),
                    message: 'Must include uppercase, lowercase, and numbers',
                  ),
                ],
                validationTrigger: ValidationTrigger.onBlur,
              ),
              const SizedBox(height: 20),

              // Confirm Password
              LuckyTextField(
                fieldId: 'confirmPassword',
                label: 'Confirm Password',
                hintText: 'Re-enter password',
                prefixIcon: const Icon(Icons.lock_outlined),
                obscureText: true,
                textInputAction: TextInputAction.done,
                focusNode: _focusManager.registerField('confirmPassword'),
                onSubmitted: (_) => _focusManager.unfocusAll(),
                validators: [
                  RequiredValidator(message: 'Please confirm your password'),
                  PasswordMatchValidator(
                    getPassword: () => _passwordController.text,
                  ),
                ],
                validationTrigger: ValidationTrigger.onBlur,
              ),
              const SizedBox(height: 32),

              // Submit button
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
                          'Create Account',
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

## Summary

The `LuckyFormTheme` + `Validator` system provides a comprehensive form framework that fills the gaps in Flutter's default form components:

| Component | Responsibility | Key Features |
|-----------|---------------|-------------|
| `LuckyFormThemeConfig` | Style configuration | 20+ style properties, light/dark theme support |
| `LuckyFormThemeWidget` | Theme distribution | `InheritedWidget` + `context.luckyFormTheme` |
| `LuckyTextField` | Form field wrapper | 3 variants (outlined/filled/underlined), theme-aware |
| `FieldValidator` chain | Validation rules | Required → Email → Phone → Length → Pattern → Custom |
| `AsyncValidator` | Server validation | Debounced username/email availability check |
| `PasswordMatchValidator` | Form interlocking | Cross-field validation |
| `ValidationStatus` | State machine | pristine → dirty → validating → valid/invalid |
| `ValidationTrigger` | Timing control | onChange / onBlur / onSubmit / manual |
| `FormFocusManager` | Focus management | Auto-advance via `TextInputAction.next` |

### Key Takeaways

- **Centralize form styles via `InheritedWidget`** — no more repeated `InputDecoration` configuration
- **Compose validators in a chain** — each validator has a single responsibility, short-circuit on first failure
- **Debounce async validators** — 500ms debounce prevents excessive API calls during typing
- **Use `onBlur` for most fields** — `onChange` validation is too aggressive for fields like email and phone
- **Implement a validation state machine** — enables better UI feedback (color changes, icons, loading animations)
- **Automatic focus management is a UX win** — keyboard Tab navigation in long forms significantly improves filling speed

### When to Use This Pattern

This form system is suitable for scenarios where:
- Your app has multiple forms requiring visual consistency
- You need async validation (username/email uniqueness)
- You need configurable validation timing
- You need form interlocking (password confirmation, cascading dropdowns)
- You need keyboard-friendly auto-focus navigation

### Related Articles

- [**Design Tokens Generated System**](./design-tokens-generated-system.md) — Token system powering `LuckyFormThemeConfig` colors and spacing
- [**ReactiveForms + Code-Generated Forms**](./reactive-forms-code-generation.md) — Reactive form controllers and JSON Schema auto-generation built on this theme system
- [**HydratedStateNotifier Abstract Persistence**](./hydrated-state-notifier-abstract-persistence.md) — Save form drafts across app restarts
