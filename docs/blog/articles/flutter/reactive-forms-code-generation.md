---
title: '响应式表单 + JSON Schema 代码生成表单系统'
description: '一套 Flutter 响应式表单系统，包含基于 Stream 的 ReactiveFormController（value/status/error BehaviorSubject）、JSON Schema 服务端驱动表单配置、Prisma Schema 到 Dart 代码生成、支持 12+ 字段类型的动态 FormFieldGenerator、跨字段订阅、计算字段、基于 dependsOn 模式的条件可见性、防抖自动保存草稿恢复，以及完整的动态商品表单实战演示。'
slug: reactive-forms-code-generation
tags: Flutter, Forms, Reactive, JSON Schema, Code Generation
---

## 1. 为什么需要响应式表单 + 代码生成？

在构建包含大量表单的 Flutter 应用时，传统方式面临以下挑战：

1. **重复劳动**：每个表单都需要手动编写控制器、验证逻辑和错误处理——即使结构相似
2. **后端不同步**：后端模型变更时，前端表单必须手动更新，极易遗漏
3. **无法热更新**：表单逻辑打包在应用二进制文件中，无法动态调整
4. **样板代码过重**：每个字段都需要 `TextEditingController`、验证状态和错误展示

**响应式表单 + JSON Schema + 代码生成的核心思路**：

- **JSON Schema 驱动**：表单结构由后端 JSON 定义，前端动态渲染
- **响应式控制器**：基于 Stream 的控制器，其值和状态可被订阅
- **代码生成**：从 Prisma Schema 自动生成表单配置，消除重复工作

## 2. 架构概览：ReactiveForm 引擎 + JSON Schema

```
                   ┌──────────────────────────────────────┐
                   │     JSON Schema (Server-Side)        │
                   │  formId, version, sections[]          │
                   └─────────────┬────────────────────────┘
                                 │ Parse
                                 ▼
                   ┌──────────────────────────────────────┐
                   │      FormSchemaParser                 │
                   │  JSON → FormSchema + sections         │
                   └─────────────┬────────────────────────┘
                                 │
           ┌─────────────────────┼──────────────────────────┐
           ▼                     ▼                          ▼
 ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
 │ FormFieldGenerator  │  │ ReactiveFormGroup    │  │   AutoSaveForm      │
 │ (Dynamic Render)    │  │ (Controller Set)     │  │ (Auto-Save Drafts)  │
 └─────────────────────┘  └─────────────────────┘  └─────────────────────┘
           │                     │
           ▼                     ▼
 ┌─────────────────────┐  ┌─────────────────────┐
 │ ReactiveFormCtrl    │◄─┤  Stream Architecture │
 │ valueStream         │  │  statusStream        │
 │ errorStream         │  │  combinedStream      │
 └─────────────────────┘  └─────────────────────┘
```

## 3. ReactiveFormController：值 / 状态 / 错误流

`ReactiveFormController<T>` 是响应式表单的核心。它封装了字段的值、验证状态和错误信息，通过 Stream 发布变更。

### 3.1 控制器实现

```dart
/// Reactive form field status
enum ReactiveFieldStatus {
  pristine,   // Not touched
  dirty,      // Modified
  validating, // Validating
  valid,      // Valid
  invalid,    // Invalid
}

/// Generic reactive form controller
class ReactiveFormController<T> {
  final String fieldName;
  final List<FieldValidator> validators;

  T _value;
  ReactiveFieldStatus _status = ReactiveFieldStatus.pristine;
  String? _error;

  // Value stream (read-only externally, writable internally)
  final BehaviorSubject<T> _valueSubject;
  // Status stream
  final BehaviorSubject<ReactiveFieldStatus> _statusSubject;
  // Error stream
  final BehaviorSubject<String?> _errorSubject;

  ReactiveFormController({
    required this.fieldName,
    T? initialValue,
    this.validators = const [],
  })  : _value = initialValue ?? ('' as T),
      _valueSubject = BehaviorSubject<T>.seeded(initialValue ?? ('' as T)),
      _statusSubject = BehaviorSubject<ReactiveFieldStatus>.seeded(ReactiveFieldStatus.pristine),
      _errorSubject = BehaviorSubject<String?>.seeded(null);

  // ── Public Stream API ──

  /// Value change stream
  Stream<T> get valueStream => _valueSubject.stream;

  /// Status change stream
  Stream<ReactiveFieldStatus> get statusStream => _statusSubject.stream;

  /// Error info stream
  Stream<String?> get errorStream => _errorSubject.stream;

  // ── Current Value Snapshot ──

  T get value => _value;
  ReactiveFieldStatus get status => _status;
  String? get error => _error;
  bool get isValid => _status == ReactiveFieldStatus.valid;
  bool get isDirty => _status != ReactiveFieldStatus.pristine;

  /// Update value and automatically trigger validation
  void updateValue(T newValue) {
    if (newValue == _value) return;

    _value = newValue;
    _valueSubject.add(newValue);

    if (_status == ReactiveFieldStatus.pristine) {
      _updateStatus(ReactiveFieldStatus.dirty);
    }

    validate();
  }

  /// Manually trigger validation
  Future<bool> validate() async {
    _updateStatus(ReactiveFieldStatus.validating);

    for (final validator in validators) {
      final error = await validator.validate(_value?.toString() ?? '');
      if (error != null) {
        _error = error;
        _errorSubject.add(error);
        _updateStatus(ReactiveFieldStatus.invalid);
        return false;
      }
    }

    _error = null;
    _errorSubject.add(null);
    _updateStatus(ReactiveFieldStatus.valid);
    return true;
  }

  /// Mark as modified
  void markAsDirty() {
    if (_status == ReactiveFieldStatus.pristine) {
      _updateStatus(ReactiveFieldStatus.dirty);
    }
  }

  /// Reset to initial state
  void reset(T? initialValue) {
    _value = initialValue ?? ('' as T);
    _error = null;
    _valueSubject.add(_value);
    _errorSubject.add(null);
    _updateStatus(ReactiveFieldStatus.pristine);
  }

  /// Mark as submitting (used to disable button during form submission)
  void setSubmitting(bool isSubmitting) {
    // Status extension: can add flag in stream
  }

  void _updateStatus(ReactiveFieldStatus newStatus) {
    _status = newStatus;
    _statusSubject.add(newStatus);
  }

  void dispose() {
    _valueSubject.close();
    _statusSubject.close();
    _errorSubject.close();
  }
}

/// Field validator interface
abstract class FieldValidator {
  Future<String?> validate(String value);
}

class ReactiveRequiredValidator implements FieldValidator {
  final String message;
  ReactiveRequiredValidator({this.message = 'This field is required'});

  @override
  Future<String?> validate(String value) async {
    if (value.trim().isEmpty) return message;
    return null;
  }
}

class ReactivePatternValidator implements FieldValidator {
  final RegExp pattern;
  final String message;
  ReactivePatternValidator(this.pattern, {this.message = 'Invalid format'});

  @override
  Future<String?> validate(String value) async {
    if (value.isEmpty) return null;
    if (!pattern.hasMatch(value)) return message;
    return null;
  }
}
```

### 3.2 组合表单状态

```dart
/// Reactive form group — manages multiple controllers
class ReactiveFormGroup {
  final Map<String, ReactiveFormController> _controllers = {};

  /// Add controller
  void addController(ReactiveFormController controller) {
    _controllers[controller.fieldName] = controller;
  }

  /// Get controller by name
  ReactiveFormController<T>? controller<T>(String fieldName) {
    return _controllers[fieldName] as ReactiveFormController<T>?;
  }

  /// Current values of all fields
  Map<String, dynamic> get values {
    return _controllers.map((key, ctrl) => MapEntry(key, ctrl.value));
  }

  /// Error info for all fields
  Map<String, String?> get errors {
    return _controllers.map((key, ctrl) => MapEntry(key, ctrl.error));
  }

  /// Validate all fields
  Future<bool> validateAll() async {
    final results = await Future.wait(
      _controllers.values.map((c) => c.validate()),
    );
    return results.every((r) => r);
  }

  /// Mark all fields as modified
  void markAllAsDirty() {
    _controllers.values.forEach((c) => c.markAsDirty());
  }

  /// Combined validity stream (triggered when any field changes)
  Stream<bool> get combinedValidityStream {
    if (_controllers.isEmpty) {
      return Stream.value(true);
    }

    return Rx.combineLatestList(
      _controllers.values.map((c) => c.statusStream),
    ).map((statuses) {
      return statuses.every((s) => s == ReactiveFieldStatus.valid);
    });
  }

  /// Combined value stream (triggered when any field value changes)
  Stream<Map<String, dynamic>> get combinedValueStream {
    if (_controllers.isEmpty) {
      return Stream.value({});
    }

    return Rx.combineLatestList(
      _controllers.values.map((c) => c.valueStream),
    ).map((_) => values);
  }

  /// Reset all fields
  void resetAll() {
    _controllers.values.forEach((c) => c.reset(null));
  }

  void dispose() {
    _controllers.values.forEach((c) => c.dispose());
    _controllers.clear();
  }
}
```

## 4. 表单字段类型体系：text / number / select / date / file

`FormFieldType` 枚举定义了 15+ 种原生表单字段类型，覆盖了广泛的表单场景。

```dart
/// Form field type enum
enum FormFieldType {
  text,          // Text input
  number,        // Number input
  phone,         // Phone number
  email,         // Email address
  password,      // Password (with show/hide toggle)
  select,        // Dropdown select (single)
  multiSelect,   // Multi-select dropdown
  checkbox,      // Checkbox
  radio,         // Radio button
  date,          // Date picker
  time,          // Time picker
  dateTime,      // Date-time picker
  file,          // File upload
  switch_toggle, // Switch toggle
  slider,        // Slider
  textArea,      // Multi-line text
  otp,           // OTP verification code input
}
```

### 4.1 字段配置

```dart
/// Form field configuration (parsed from JSON Schema)
class FormFieldConfig {
  final String name;
  final FormFieldType type;
  final String label;
  final String? hintText;
  final String? helperText;
  final dynamic initialValue;
  final bool required;
  final dynamic placeholder;

  // Type-specific options
  final NumberOptions? numberOptions;
  final SelectOptions? selectOptions;
  final DateOptions? dateOptions;
  final FileOptions? fileOptions;
  final TextOptions? textOptions;

  // Validation rules list
  final List<ValidationRule> validationRules;

  // Conditional visibility
  final String? dependsOn;
  final dynamic dependsOnValue;
  final dynamic visibilityCondition;

  // Layout
  final int flex;       // flex: 1 = half width, 2 = full width
  final String? section;

  const FormFieldConfig({
    required this.name,
    required this.type,
    required this.label,
    this.hintText,
    this.helperText,
    this.initialValue,
    this.required = false,
    this.placeholder,
    this.numberOptions,
    this.selectOptions,
    this.dateOptions,
    this.fileOptions,
    this.textOptions,
    this.validationRules = const [],
    this.dependsOn,
    this.dependsOnValue,
    this.visibilityCondition,
    this.flex = 1,
    this.section,
  });
}

/// Number options
class NumberOptions {
  final double? min;
  final double? max;
  final int? decimalPlaces;
  final String? prefix;  // e.g. '₱'
  final String? suffix;  // e.g. 'kg'

  const NumberOptions({this.min, this.max, this.decimalPlaces, this.prefix, this.suffix});
}

/// Select options
class SelectOptions {
  final List<SelectOption> options;
  final bool searchable;
  final bool multiple;

  const SelectOptions({required this.options, this.searchable = false, this.multiple = false});
}

class SelectOption {
  final String label;
  final dynamic value;

  const SelectOption({required this.label, required this.value});
}

/// Date options
class DateOptions {
  final DateTime? minDate;
  final DateTime? maxDate;

  const DateOptions({this.minDate, this.maxDate});
}

/// File options
class FileOptions {
  final List<String> allowedExtensions;
  final int maxFileSize;   // bytes
  final int maxFileCount;
  final bool multiple;

  const FileOptions({
    this.allowedExtensions = const ['jpg', 'jpeg', 'png'],
    this.maxFileSize = 10485760,
    this.maxFileCount = 1,
    this.multiple = false,
  });
}

/// Text options
class TextOptions {
  final int? maxLength;
  final int? minLength;
  final TextInputType? keyboardType;
  final bool obscureText;

  const TextOptions({this.maxLength, this.minLength, this.keyboardType, this.obscureText = false});
}

/// Validation rule
class ValidationRule {
  final String type;       // 'required', 'minLength', 'maxLength', 'pattern', 'min', 'max', 'email', etc.
  final dynamic value;
  final String message;
  final String? customValidatorId;

  const ValidationRule({
    required this.type,
    this.value,
    this.message = 'Invalid value',
    this.customValidatorId,
  });
}
```

## 5. JSON Schema 定义表单配置

表单配置以 JSON Schema 格式存储在服务端。前端通过 API 获取并动态渲染。这样可以在不发布新版本的情况下更新表单。

### 5.1 JSON Schema 示例

```json
{
  "formId": "product_listing",
  "version": "1.0.0",
  "title": "List Product",
  "sections": [
    {
      "name": "basic_info",
      "label": "Basic Information",
      "fields": [
        {
          "name": "title",
          "type": "text",
          "label": "Product Title",
          "required": true,
          "textOptions": {
            "maxLength": 100,
            "minLength": 5
          },
          "validationRules": [
            { "type": "required", "message": "Product title is required" },
            { "type": "minLength", "value": 5, "message": "Title requires at least 5 characters" },
            { "type": "maxLength", "value": 100, "message": "Title cannot exceed 100 characters" }
          ]
        },
        {
          "name": "description",
          "type": "textArea",
          "label": "Product Description",
          "textOptions": {
            "maxLength": 2000
          },
          "validationRules": [
            { "type": "maxLength", "value": 2000, "message": "Description cannot exceed 2000 characters" }
          ]
        },
        {
          "name": "categoryId",
          "type": "select",
          "label": "Product Category",
          "required": true,
          "selectOptions": {
            "searchable": true,
            "options": [
              { "label": "Electronics", "value": "electronics" },
              { "label": "Fashion & Accessories", "value": "fashion" },
              { "label": "Home & Living", "value": "home" },
              { "label": "Beauty & Personal Care", "value": "beauty" },
              { "label": "Food & Beverage", "value": "food" },
              { "label": "Sports & Outdoors", "value": "sports" },
              { "label": "Other", "value": "other" }
            ]
          },
          "validationRules": [
            { "type": "required", "message": "Please select a product category" }
          ]
        }
      ]
    },
    {
      "name": "pricing",
      "label": "Pricing & Inventory",
      "fields": [
        {
          "name": "price",
          "type": "number",
          "label": "Price",
          "required": true,
          "numberOptions": {
            "min": 0,
            "decimalPlaces": 2,
            "prefix": "₱"
          },
          "validationRules": [
            { "type": "required", "message": "Please enter a price" },
            { "type": "min", "value": 0, "message": "Price cannot be negative" }
          ]
        },
        {
          "name": "stock",
          "type": "number",
          "label": "Stock Quantity",
          "required": true,
          "numberOptions": {
            "min": 0,
            "decimalPlaces": 0
          },
          "validationRules": [
            { "type": "required", "message": "Please enter stock quantity" },
            { "type": "min", "value": 0, "message": "Stock cannot be negative" }
          ]
        },
        {
          "name": "hasDiscount",
          "type": "switch_toggle",
          "label": "Enable Promotion",
          "initialValue": false
        },
        {
          "name": "discountPrice",
          "type": "number",
          "label": "Promotional Price",
          "dependsOn": "hasDiscount",
          "dependsOnValue": true,
          "numberOptions": {
            "min": 0,
            "decimalPlaces": 2,
            "prefix": "₱"
          },
          "validationRules": [
            { "type": "min", "value": 0, "message": "Promotional price cannot be negative" }
          ]
        }
      ]
    },
    {
      "name": "media",
      "label": "Product Images",
      "fields": [
        {
          "name": "images",
          "type": "file",
          "label": "Product Photos",
          "fileOptions": {
            "allowedExtensions": ["jpg", "jpeg", "png", "webp"],
            "maxFileSize": 5242880,
            "maxFileCount": 10,
            "multiple": true
          },
          "validationRules": [
            { "type": "required", "message": "At least one product image is required" },
            { "type": "maxFileCount", "value": 10, "message": "Maximum 10 images" }
          ]
        }
      ]
    }
  ]
}
```

### 5.2 Schema 解析器

```dart
class FormSchemaParser {
  static FormSchema parse(Map<String, dynamic> json) {
    final sections = (json['sections'] as List)
        .map((s) => FormSectionConfig(
              name: s['name'] as String,
              label: s['label'] as String,
              fields: (s['fields'] as List)
                  .map((f) => _parseField(f as Map<String, dynamic>))
                  .toList(),
            ))
        .toList();

    return FormSchema(
      formId: json['formId'] as String,
      version: json['version'] as String? ?? '1.0.0',
      title: json['title'] as String?,
      sections: sections,
    );
  }

  static FormFieldConfig _parseField(Map<String, dynamic> json) {
    final selectOptionsJson = json['selectOptions'] as Map<String, dynamic>?;
    final numberOptionsJson = json['numberOptions'] as Map<String, dynamic>?;
    final dateOptionsJson = json['dateOptions'] as Map<String, dynamic>?;
    final fileOptionsJson = json['fileOptions'] as Map<String, dynamic>?;
    final textOptionsJson = json['textOptions'] as Map<String, dynamic>?;

    return FormFieldConfig(
      name: json['name'] as String,
      type: FormFieldType.values.byName(json['type'] as String),
      label: json['label'] as String,
      hintText: json['hintText'] as String?,
      helperText: json['helperText'] as String?,
      initialValue: json['initialValue'],
      required: json['required'] as bool? ?? false,
      placeholder: json['placeholder'],
      numberOptions: numberOptionsJson != null
          ? NumberOptions(
              min: numberOptionsJson['min'] as double?,
              max: numberOptionsJson['max'] as double?,
              decimalPlaces: numberOptionsJson['decimalPlaces'] as int?,
              prefix: numberOptionsJson['prefix'] as String?,
              suffix: numberOptionsJson['suffix'] as String?,
            )
          : null,
      selectOptions: selectOptionsJson != null
          ? SelectOptions(
              options: (selectOptionsJson['options'] as List)
                  .map((o) => SelectOption(
                        label: o['label'] as String,
                        value: o['value'],
                      ))
                  .toList(),
              searchable: selectOptionsJson['searchable'] as bool? ?? false,
              multiple: selectOptionsJson['multiple'] as bool? ?? false,
            )
          : null,
      dateOptions: dateOptionsJson != null
          ? DateOptions(
              minDate: dateOptionsJson['minDate'] != null
                  ? DateTime.parse(dateOptionsJson['minDate'] as String)
                  : null,
              maxDate: dateOptionsJson['maxDate'] != null
                  ? DateTime.parse(dateOptionsJson['maxDate'] as String)
                  : null,
            )
          : null,
      fileOptions: fileOptionsJson != null
          ? FileOptions(
              allowedExtensions: (fileOptionsJson['allowedExtensions'] as List?)
                      ?.cast<String>() ??
                  ['jpg', 'jpeg', 'png'],
              maxFileSize: fileOptionsJson['maxFileSize'] as int? ?? 10485760,
              maxFileCount: fileOptionsJson['maxFileCount'] as int? ?? 1,
              multiple: fileOptionsJson['multiple'] as bool? ?? false,
            )
          : null,
      textOptions: textOptionsJson != null
          ? TextOptions(
              maxLength: textOptionsJson['maxLength'] as int?,
              minLength: textOptionsJson['minLength'] as int?,
              keyboardType: textOptionsJson['keyboardType'] != null
                  ? TextInputType.values.byName(textOptionsJson['keyboardType'] as String)
                  : null,
              obscureText: textOptionsJson['obscureText'] as bool? ?? false,
            )
          : null,
      validationRules: (json['validationRules'] as List?)
              ?.map((r) => ValidationRule(
                    type: r['type'] as String,
                    value: r['value'],
                    message: r['message'] as String? ?? 'Invalid value',
                    customValidatorId: r['customValidatorId'] as String?,
                  ))
              .toList() ??
          [],
      dependsOn: json['dependsOn'] as String?,
      dependsOnValue: json['dependsOnValue'],
      visibilityCondition: null,
      flex: json['flex'] as int? ?? 1,
      section: json['section'] as String?,
    );
  }
}

class FormSchema {
  final String formId;
  final String version;
  final String? title;
  final List<FormSectionConfig> sections;

  const FormSchema({
    required this.formId,
    required this.version,
    this.title,
    required this.sections,
  });

  List<FormFieldConfig> get allFields =>
      sections.expand((s) => s.fields).toList();
}

class FormSectionConfig {
  final String name;
  final String label;
  final List<FormFieldConfig> fields;

  const FormSectionConfig({
    required this.name,
    required this.label,
    required this.fields,
  });
}
```

---

## 6. 代码生成：从 Prisma Schema 到表单配置

代码生成器将 **Prisma Schema 模型** 转换为 JSON 表单配置。这弥合了后端数据模型与前端表单之间的鸿沟。

### 6.1 Prisma Schema 示例

```prisma
model Product {
  id            String   @id @default(cuid())
  title         String
  description   String?
  categoryId    String
  price         Decimal  @db.Decimal(10, 2)
  stock         Int      @default(0)
  hasDiscount   Boolean  @default(false)
  discountPrice Decimal? @db.Decimal(10, 2)
  images        String[] // URLs
  status        ProductStatus @default(draft)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

enum ProductStatus {
  draft
  active
  archived
}
```

### 6.2 代码生成器（Node.js 脚本）

```typescript
// scripts/generate-form-config.ts
import { readFileSync, writeFileSync } from 'fs';
import { parsePrismaSchema, type PrismaModel } from './schema-parser';

interface GeneratedForm {
  formId: string;
  version: string;
  title: string;
  sections: GeneratedSection[];
}

interface GeneratedSection {
  name: string;
  label: string;
  fields: GeneratedField[];
}

interface GeneratedField {
  name: string;
  type: string;
  label: string;
  required: boolean;
  validationRules: ValidationRule[];
  // ... type-specific options
}

function generateFormFromModel(model: PrismaModel): GeneratedForm {
  const fields: GeneratedField[] = model.fields.map(f => {
    const fieldType = mapPrismaTypeToFormType(f.type, f.isEnum);
    const rules = generateValidationRules(f);

    const baseField: GeneratedField = {
      name: f.name,
      type: fieldType,
      label: f.name.replace(/([A-Z])/g, ' $1')
        .replace(/^./, s => s.toUpperCase()),
      required: !f.isOptional,
      validationRules: rules,
    };

    // Type-specific options
    if (fieldType === 'number' && f.type === 'Decimal') {
      baseField['numberOptions'] = {
        decimalPlaces: 2,
        prefix: f.name.includes('price') ? '₱' : undefined,
      };
    }

    if (f.isEnum && f.enumValues) {
      baseField['selectOptions'] = {
        searchable: true,
        options: f.enumValues.map(v => ({
          label: v.charAt(0).toUpperCase() + v.slice(1),
          value: v,
        })),
      };
    }

    if (f.type === 'String' && f.name === 'images') {
      baseField['type'] = 'file';
      baseField['fileOptions'] = {
        allowedExtensions: ['jpg', 'jpeg', 'png', 'webp'],
        maxFileCount: 10,
        multiple: true,
      };
    }

    return baseField;
  });

  // Detect dependency: hasDiscount → discountPrice
  const discountPriceIdx = fields.findIndex(f => f.name === 'discountPrice');
  const hasDiscountIdx = fields.findIndex(f => f.name === 'hasDiscount');
  if (discountPriceIdx >= 0 && hasDiscountIdx >= 0) {
    fields[discountPriceIdx]['dependsOn'] = 'hasDiscount';
    fields[discountPriceIdx]['dependsOnValue'] = true;
  }

  return {
    formId: `${camelToKebab(model.name)}_form`,
    version: '1.0.0',
    title: `Add ${model.name.replace(/([A-Z])/g, ' $1').trim()}`,
    sections: [
      {
        name: 'main',
        label: 'Basic Information',
        fields,
      },
    ],
  };
}

function mapPrismaTypeToFormType(prismaType: string, isEnum: boolean): string {
  if (isEnum) return 'select';
  switch (prismaType) {
    case 'String': return 'text';
    case 'Int': return 'number';
    case 'Float': return 'number';
    case 'Decimal': return 'number';
    case 'Boolean': return 'switch_toggle';
    case 'DateTime': return 'date';
    case 'Json': return 'text';
    default: return 'text';
  }
}

function generateValidationRules(field: any): ValidationRule[] {
  const rules: any[] = [];
  if (!field.isOptional) {
    rules.push({ type: 'required', message: `${field.name} is required` });
  }
  if (field.type === 'String' && field.name.includes('email')) {
    rules.push({ type: 'email', message: 'Invalid email format' });
  }
  if (field.type === 'Int' || field.type === 'Float' || field.type === 'Decimal') {
    if (field.name.includes('price') || field.name.includes('amount')) {
      rules.push({ type: 'min', value: 0, message: 'Value must be positive' });
    }
  }
  return rules;
}

// Run generation for all models
const schema = readFileSync('schema.prisma', 'utf8');
const models = parsePrismaSchema(schema);

const generatedForms = models.map(generateFormFromModel);
writeFileSync(
  'form-configs.generated.json',
  JSON.stringify(generatedForms, null, 2)
);
```

### 6.3 生成的输出（Dart 常量）

```dart
// This file is auto-generated. Do not edit manually.
// Generated from Prisma Schema v1.2.0

class ProductFormConfig {
  static const formSchema = FormSchema(
    formId: 'product_form',
    version: '1.0.0',
    title: 'Add Product',
    sections: [
      FormSectionConfig(
        name: 'main',
        label: 'Basic Information',
        fields: [
          FormFieldConfig(
            name: 'title',
            type: FormFieldType.text,
            label: 'Title',
            required: true,
            validationRules: [
              ValidationRule(type: 'required', message: 'title is required'),
            ],
          ),
          FormFieldConfig(
            name: 'description',
            type: FormFieldType.textArea,
            label: 'Description',
            required: false,
          ),
          FormFieldConfig(
            name: 'categoryId',
            type: FormFieldType.select,
            label: 'Category ID',
            required: true,
            validationRules: [
              ValidationRule(type: 'required', message: 'categoryId is required'),
            ],
          ),
          FormFieldConfig(
            name: 'price',
            type: FormFieldType.number,
            label: 'Price',
            required: true,
            numberOptions: NumberOptions(
              decimalPlaces: 2,
              prefix: '₱',
            ),
            validationRules: [
              ValidationRule(type: 'required', message: 'price is required'),
              ValidationRule(type: 'min', value: 0, message: 'Value must be positive'),
            ],
          ),
          FormFieldConfig(
            name: 'hasDiscount',
            type: FormFieldType.switch_toggle,
            label: 'Enable Promotion',
            initialValue: false,
          ),
          FormFieldConfig(
            name: 'discountPrice',
            type: FormFieldType.number,
            label: 'Promotional Price',
            numberOptions: NumberOptions(
              decimalPlaces: 2,
              prefix: '₱',
            ),
            dependsOn: 'hasDiscount',
            dependsOnValue: true,
          ),
          FormFieldConfig(
            name: 'images',
            type: FormFieldType.file,
            label: 'Images',
            fileOptions: FileOptions(
              allowedExtensions: ['jpg', 'jpeg', 'png', 'webp'],
              maxFileCount: 10,
              multiple: true,
            ),
          ),
        ],
      ),
    ],
  );
}
```

---

## 7. 动态表单渲染：FormFieldGenerator

[`FormFieldGenerator`] 接收 `FormFieldConfig` 并渲染对应的 Widget，同时连接到 `ReactiveFormController`。

```dart
class FormFieldGenerator extends StatelessWidget {
  final FormFieldConfig config;
  final ReactiveFormGroup formGroup;
  final Map<String, dynamic>? contextValues; // For visibility conditions

  const FormFieldGenerator({
    super.key,
    required this.config,
    required this.formGroup,
    this.contextValues,
  });

  @override
  Widget build(BuildContext context) {
    // Check visibility condition
    if (!_isVisible(context)) {
      return const SizedBox.shrink();
    }

    // Get or create controller
    final controller = _getOrCreateController();

    return _buildField(context, controller);
  }

  bool _isVisible(BuildContext context) {
    if (config.dependsOn != null) {
      final dependsController = formGroup.controller(config.dependsOn!);
      if (dependsController != null) {
        return dependsController.value == config.dependsOnValue;
      }
      // Fallback to context values
      if (contextValues != null && contextValues!.containsKey(config.dependsOn)) {
        return contextValues![config.dependsOn] == config.dependsOnValue;
      }
    }
    return true;
  }

  ReactiveFormController _getOrCreateController() {
    var controller = formGroup.controller(config.name);
    if (controller == null) {
      controller = _createController();
      formGroup.addController(controller);
    }
    return controller;
  }

  ReactiveFormController _createController() {
    final validators = _buildValidators();
    return ReactiveFormController(
      fieldName: config.name,
      initialValue: config.initialValue ?? '',
      validators: validators,
    );
  }

  List<FieldValidator> _buildValidators() {
    final validators = <FieldValidator>[];
    for (final rule in config.validationRules) {
      switch (rule.type) {
        case 'required':
          validators.add(ReactiveRequiredValidator(message: rule.message));
          break;
        case 'minLength':
          validators.add(_MinLengthValidator(
            rule.value as int,
            message: rule.message,
          ));
          break;
        case 'maxLength':
          validators.add(_MaxLengthValidator(
            rule.value as int,
            message: rule.message,
          ));
          break;
        case 'pattern':
          validators.add(ReactivePatternValidator(
            RegExp(rule.value as String),
            message: rule.message,
          ));
          break;
        case 'min':
          validators.add(_MinValueValidator(
            (rule.value as num).toDouble(),
            message: rule.message,
          ));
          break;
        case 'max':
          validators.add(_MaxValueValidator(
            (rule.value as num).toDouble(),
            message: rule.message,
          ));
          break;
      }
    }
    return validators;
  }

  Widget _buildField(BuildContext context, ReactiveFormController controller) {
    final theme = LuckyFormThemeWidget.of(context);

    switch (config.type) {
      case FormFieldType.text:
      case FormFieldType.email:
      case FormFieldType.phone:
      case FormFieldType.password:
        return _buildTextField(controller, theme);

      case FormFieldType.number:
        return _buildNumberField(controller, theme);

      case FormFieldType.textArea:
        return _buildTextArea(controller, theme);

      case FormFieldType.select:
        return _buildSelectField(controller, theme);

      case FormFieldType.switch_toggle:
        return _buildSwitchField(controller, theme);

      case FormFieldType.date:
        return _buildDateField(controller, theme);

      case FormFieldType.file:
        return _buildFileField(controller, theme);

      case FormFieldType.checkbox:
        return _buildCheckboxField(controller, theme);

      case FormFieldType.radio:
        return _buildRadioGroup(controller, theme);

      case FormFieldType.otp:
        return _buildOtpField(controller, theme);

      default:
        return _buildTextField(controller, theme);
    }
  }

  Widget _buildTextField(ReactiveFormController<String> controller, LuckyFormThemeConfig theme) {
    TextInputType keyboardType;
    bool obscure = false;

    switch (config.type) {
      case FormFieldType.email:
        keyboardType = TextInputType.emailAddress;
        break;
      case FormFieldType.phone:
        keyboardType = TextInputType.phone;
        break;
      case FormFieldType.password:
        keyboardType = TextInputType.visiblePassword;
        obscure = true;
        break;
      default:
        keyboardType = config.textOptions?.keyboardType ?? TextInputType.text;
        obscure = config.textOptions?.obscureText ?? false;
    }

    return StreamBuilder<String?>(
      stream: controller.errorStream,
      initialData: controller.error,
      builder: (context, errorSnapshot) {
        return TextField(
          controller: TextEditingController.fromValue(
            TextEditingValue(text: controller.value as String? ?? ''),
          ),
          onChanged: (v) => controller.updateValue(v),
          obscureText: obscure,
          keyboardType: keyboardType,
          maxLength: config.textOptions?.maxLength,
          decoration: InputDecoration(
            labelText: config.label,
            hintText: config.hintText,
            helperText: config.helperText,
            errorText: errorSnapshot.data,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(theme.borderRadius),
            ),
          ),
        );
      },
    );
  }

  Widget _buildNumberField(ReactiveFormController<num> controller, LuckyFormThemeConfig theme) {
    final prefix = config.numberOptions?.prefix;
    final suffix = config.numberOptions?.suffix;

    return StreamBuilder<String?>(
      stream: controller.errorStream,
      initialData: controller.error,
      builder: (context, errorSnapshot) {
        return TextField(
          controller: TextEditingController(
            text: controller.value != null ? controller.value.toString() : '',
          ),
          onChanged: (v) {
            final parsed = num.tryParse(v);
            if (parsed != null) {
              controller.updateValue(parsed);
            }
          },
          keyboardType: TextInputType.numberWithOptions(decimal: true),
          decoration: InputDecoration(
            labelText: config.label,
            hintText: config.hintText,
            errorText: errorSnapshot.data,
            prefixText: prefix,
            suffixText: suffix,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(theme.borderRadius),
            ),
          ),
        );
      },
    );
  }

  Widget _buildSelectField(ReactiveFormController<String> controller, LuckyFormThemeConfig theme) {
    final options = config.selectOptions!.options;

    return StreamBuilder<String?>(
      stream: controller.errorStream,
      initialData: controller.error,
      builder: (context, errorSnapshot) {
        return DropdownButtonFormField<String>(
          value: controller.value as String?,
          decoration: InputDecoration(
            labelText: config.label,
            hintText: config.hintText,
            errorText: errorSnapshot.data,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(theme.borderRadius),
            ),
          ),
          items: options
              .map((o) => DropdownMenuItem(value: o.value, child: Text(o.label)))
              .toList(),
          onChanged: (v) => controller.updateValue(v),
        );
      },
    );
  }

  Widget _buildSwitchField(ReactiveFormController<bool> controller, LuckyFormThemeConfig theme) {
    return StreamBuilder<bool>(
      stream: controller.valueStream.map((v) => v as bool),
      initialData: controller.value as bool? ?? false,
      builder: (context, snapshot) {
        return SwitchListTile(
          title: Text(config.label),
          subtitle: config.hintText != null ? Text(config.hintText!) : null,
          value: snapshot.data ?? false,
          onChanged: (v) => controller.updateValue(v),
        );
      },
    );
  }

  Widget _buildDateField(ReactiveFormController<DateTime?> controller, LuckyFormThemeConfig theme) {
    return StreamBuilder<DateTime?>(
      stream: controller.valueStream.map((v) => v as DateTime?),
      initialData: controller.value as DateTime?,
      builder: (context, snapshot) {
        return InkWell(
          onTap: () async {
            final date = await showDatePicker(
              context: context,
              initialDate: snapshot.data ?? DateTime.now(),
              firstDate: config.dateOptions?.minDate ?? DateTime(1900),
              lastDate: config.dateOptions?.maxDate ?? DateTime(2100),
            );
            if (date != null) controller.updateValue(date);
          },
          child: InputDecorator(
            decoration: InputDecoration(
              labelText: config.label,
              hintText: config.hintText ?? 'Select date',
              suffixIcon: const Icon(Icons.calendar_today),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(theme.borderRadius),
              ),
            ),
            child: Text(
              snapshot.data != null
                  ? '${snapshot.data!.year}-${snapshot.data!.month.toString().padLeft(2, '0')}-${snapshot.data!.day.toString().padLeft(2, '0')}'
                  : '',
            ),
          ),
        );
      },
    );
  }

  Widget _buildFileField(ReactiveFormController<List<String>> controller, LuckyFormThemeConfig theme) {
    // Use image_picker or file_picker package for file selection integration
    return StreamBuilder<List<String>>(
      stream: controller.valueStream.map((v) => v as List<String>? ?? []),
      initialData: (controller.value as List<String>?) ?? [],
      builder: (context, snapshot) {
        final files = snapshot.data ?? [];
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(config.label, style: TextStyle(fontSize: theme.labelFontSize)),
            const SizedBox(height: 8),
            // Display existing files
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                ...files.map((file) => Chip(
                      label: Text(file.split('/').last),
                      onDeleted: () {
                        final updated = List<String>.from(files)..remove(file);
                        controller.updateValue(updated);
                      },
                    )),
                // Add button
                ActionChip(
                  avatar: const Icon(Icons.add),
                  label: Text('Add File'),
                  onPressed: () async {
                    // Trigger file picker
                    // final result = await FilePicker.platform.pickFiles(...);
                    // if (result != null) {
                    //   final urls = result.paths.whereType<String>().toList();
                    //   controller.updateValue([...files, ...urls]);
                    // }
                  },
                ),
              ],
            ),
          ],
        );
      },
    );
  }

  Widget _buildTextArea(ReactiveFormController<String> controller, LuckyFormThemeConfig theme) {
    return StreamBuilder<String?>(
      stream: controller.errorStream,
      initialData: controller.error,
      builder: (context, errorSnapshot) {
        return TextField(
          controller: TextEditingController(text: controller.value as String? ?? ''),
          onChanged: (v) => controller.updateValue(v),
          maxLines: 5,
          minLines: 3,
          decoration: InputDecoration(
            labelText: config.label,
            hintText: config.hintText,
            errorText: errorSnapshot.data,
            alignLabelWithHint: true,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(theme.borderRadius),
            ),
          ),
        );
      },
    );
  }

  Widget _buildCheckboxField(ReactiveFormController<bool> controller, LuckyFormThemeConfig theme) {
    return StreamBuilder<bool>(
      stream: controller.valueStream.map((v) => v as bool),
      initialData: controller.value as bool? ?? false,
      builder: (context, snapshot) {
        return CheckboxListTile(
          title: Text(config.label),
          subtitle: config.hintText != null ? Text(config.hintText!) : null,
          value: snapshot.data ?? false,
          onChanged: (v) => controller.updateValue(v ?? false),
        );
      },
    );
  }

  Widget _buildRadioGroup(ReactiveFormController<String> controller, LuckyFormThemeConfig theme) {
    final options = config.selectOptions?.options ?? [];

    return StreamBuilder<String>(
      stream: controller.valueStream.map((v) => v as String),
      initialData: controller.value as String? ?? '',
      builder: (context, snapshot) {
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(config.label, style: TextStyle(fontSize: theme.labelFontSize)),
            ...options.map((option) => RadioListTile<String>(
                  title: Text(option.label),
                  value: option.value,
                  groupValue: snapshot.data,
                  onChanged: (v) {
                    if (v != null) controller.updateValue(v);
                  },
                )),
          ],
        );
      },
    );
  }

  Widget _buildOtpField(ReactiveFormController<String> controller, LuckyFormThemeConfig theme) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
      children: List.generate(6, (index) {
        return SizedBox(
          width: 48,
          height: 56,
          child: TextField(
            textAlign: TextAlign.center,
            keyboardType: TextInputType.number,
            maxLength: 1,
            decoration: InputDecoration(
              counterText: '',
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(theme.borderRadius),
              ),
            ),
            onChanged: (v) {
              // Update OTP value at specified index
              final currentOtp = (controller.value as String?) ?? '';
              final otpChars = currentOtp.split('');
              otpChars[index] = v;
              controller.updateValue(otpChars.join());
              // Auto focus next
              if (v.isNotEmpty && index < 5) {
                FocusScope.of(context).nextFocus();
              }
            },
          ),
        );
      }),
    );
  }
}
```

---

## 8. 表单状态订阅与跨字段组合

响应式表单通过流组合器实现了强大的**跨字段订阅模式**。

```dart
class CrossFieldSubscription extends StatefulWidget {
  final ReactiveFormGroup formGroup;
  final Widget Function(
    BuildContext,
    Map<String, dynamic> values,
    Map<String, String?> errors,
    bool isValid,
  ) builder;

  const CrossFieldSubscription({
    super.key,
    required this.formGroup,
    required this.builder,
  });

  @override
  State<CrossFieldSubscription> createState() => _CrossFieldSubscriptionState();
}

class _CrossFieldSubscriptionState extends State<CrossFieldSubscription> {
  Map<String, dynamic> _values = {};
  Map<String, String?> _errors = {};
  bool _isValid = false;

  StreamSubscription? _combinedSubscription;

  @override
  void initState() {
    super.initState();
    _subscribe();
  }

  void _subscribe() {
    // Create stream triggered when any field value changes
    final valueStreams = widget.formGroup._controllers.values
        .map((c) => c.valueStream)
        .toList();

    if (valueStreams.isEmpty) return;

    _combinedSubscription = Stream.periodic(Duration.zero)
        .asyncMap((_) async {
          return {
            'values': widget.formGroup.values,
            'errors': widget.formGroup.errors,
            'isValid': await widget.formGroup.validateAll(),
          };
        })
        .listen((data) {
          if (mounted) {
            setState(() {
              _values = data['values'] as Map<String, dynamic>;
              _errors = data['errors'] as Map<String, String?>;
              _isValid = data['isValid'] as bool;
            });
          }
        });
  }

  @override
  void dispose() {
    _combinedSubscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return widget.builder(context, _values, _errors, _isValid);
  }
}

// Usage: enable submit button only when form is valid
CrossFieldSubscription(
  formGroup: formGroup,
  builder: (context, values, errors, isValid) {
    return ElevatedButton(
      onPressed: isValid ? _handleSubmit : null,
      child: const Text('Submit'),
    );
  },
);
```

### 8.1 计算字段（总价 = 价格 × 数量）

```dart
class ComputedFieldExample extends StatefulWidget {
  @override
  State<ComputedFieldExample> createState() => _ComputedFieldExampleState();
}

class _ComputedFieldExampleState extends State<ComputedFieldExample> {
  final formGroup = ReactiveFormGroup();

  @override
  void initState() {
    super.initState();

    final priceController = ReactiveFormController<num>(
      fieldName: 'price',
      initialValue: 0,
    );
    final qtyController = ReactiveFormController<num>(
      fieldName: 'quantity',
      initialValue: 1,
    );

    formGroup.addController(priceController);
    formGroup.addController(qtyController);
  }

  @override
  Widget build(BuildContext context) {
    // Simultaneously listen to price and quantity to compute total
    return StreamBuilder(
      stream: Rx.combineLatest2(
        formGroup.controller<num>('price')!.valueStream,
        formGroup.controller<num>('quantity')!.valueStream,
        (num price, num qty) => price * qty,
      ),
      builder: (context, snapshot) {
        final total = snapshot.data ?? 0;
        return Column(
          children: [
            FormFieldGenerator(config: /* price config */, formGroup: formGroup),
            FormFieldGenerator(config: /* qty config */, formGroup: formGroup),
            Text('Total: ₱${total.toStringAsFixed(2)}'),
          ],
        );
      },
    );
  }
}
```

---

## 9. 基于其他字段值的条件显示/隐藏

可见性系统使用 JSON Schema 中的 `dependsOn` / `dependsOnValue` 模式。[`FormFieldGenerator`] 在渲染前自动检查可见性。

### 9.1 响应式可见性构建器

对于更复杂的条件，使用一个专用组件，在依赖字段变化时重新渲染：

```dart
class ReactiveVisibilityBuilder extends StatelessWidget {
  final ReactiveFormGroup formGroup;
  final String dependsOnField;
  final dynamic expectedValue;
  final Widget Function() childBuilder;
  final Widget? fallback;

  const ReactiveVisibilityBuilder({
    super.key,
    required this.formGroup,
    required this.dependsOnField,
    required this.expectedValue,
    required this.childBuilder,
    this.fallback,
  });

  @override
  Widget build(BuildContext context) {
    final controller = formGroup.controller(dependsOnField);
    if (controller == null) return childBuilder();

    return StreamBuilder(
      stream: controller.valueStream,
      initialData: controller.value,
      builder: (context, snapshot) {
        final isVisible = snapshot.data == expectedValue;
        return isVisible ? childBuilder() : (fallback ?? const SizedBox.shrink());
      },
    );
  }
}

// Usage: show discount fields when switch is on
ReactiveVisibilityBuilder(
  formGroup: formGroup,
  dependsOnField: 'hasDiscount',
  expectedValue: true,
  childBuilder: () => Column(
    children: [
      FormFieldGenerator(
        config: discountPriceConfig,
        formGroup: formGroup,
      ),
      FormFieldGenerator(
        config: discountEndDateConfig,
        formGroup: formGroup,
      ),
    ],
  ),
);
```

---

## 10. 自动保存与恢复表单草稿

表单草稿会自动保存到本地存储（使用 [`HydratedStateNotifier`](./hydrated-state-notifier-abstract-persistence.md) 模式），并在用户返回时恢复。

### 10.1 草稿管理器

```dart
class FormDraftManager {
  static const _draftPrefix = 'form_draft_';

  /// Save form values as draft
  static Future<void> saveDraft(String formId, Map<String, dynamic> values) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      '$_draftPrefix$formId',
      jsonEncode({
        'values': values,
        'savedAt': DateTime.now().toIso8601String(),
      }),
    );
  }

  /// Load form draft
  static Future<Map<String, dynamic>?> loadDraft(String formId) async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString('$_draftPrefix$formId');
    if (raw == null) return null;

    try {
      final data = jsonDecode(raw) as Map<String, dynamic>;
      return data['values'] as Map<String, dynamic>?;
    } catch (e) {
      return null;
    }
  }

  /// Clear draft after successful submission
  static Future<void> clearDraft(String formId) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('$_draftPrefix$formId');
  }
}
```

### 10.2 自动保存组件

```dart
class AutoSaveForm extends StatefulWidget {
  final String formId;
  final ReactiveFormGroup formGroup;
  final Widget child;
  final Duration debounce;

  const AutoSaveForm({
    super.key,
    required this.formId,
    required this.formGroup,
    required this.child,
    this.debounce = const Duration(seconds: 2),
  });

  @override
  State<AutoSaveForm> createState() => _AutoSaveFormState();
}

class _AutoSaveFormState extends State<AutoSaveForm> {
  Timer? _debounceTimer;

  @override
  void initState() {
    super.initState();
    _restoreDraft();
    _subscribeToChanges();
  }

  Future<void> _restoreDraft() async {
    final draft = await FormDraftManager.loadDraft(widget.formId);
    if (draft == null || draft.isEmpty) return;

    // Restore values to controllers
    for (final entry in draft.entries) {
      final controller = widget.formGroup.controller(entry.key);
      if (controller != null) {
        controller.updateValue(entry.value);
      }
    }

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Draft restored'),
          duration: Duration(seconds: 2),
        ),
      );
    }
  }

  void _subscribeToChanges() {
    // Subscribe to all value streams
    for (final controller in widget.formGroup._controllers.values) {
      controller.valueStream.listen((_) {
        _debounceTimer?.cancel();
        _debounceTimer = Timer(widget.debounce, _saveDraft);
      });
    }
  }

  Future<void> _saveDraft() async {
    await FormDraftManager.saveDraft(
      widget.formId,
      widget.formGroup.values,
    );
  }

  @override
  void dispose() {
    _debounceTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
```

---

## 11. 实战：动态商品表单

以下是一个完整的集成示例——基于 JSON Schema 驱动的商品发布表单，包含自动保存、条件字段和响应式验证。

```dart
class DynamicProductFormScreen extends StatefulWidget {
  final String formId;
  final Map<String, dynamic> schemaJson;

  const DynamicProductFormScreen({
    super.key,
    required this.formId,
    required this.schemaJson,
  });

  @override
  State<DynamicProductFormScreen> createState() =>
      _DynamicProductFormScreenState();
}

class _DynamicProductFormScreenState extends State<DynamicProductFormScreen> {
  late final FormSchema _schema;
  late final ReactiveFormGroup _formGroup;
  bool _isSubmitting = false;
  String? _submitError;

  @override
  void initState() {
    super.initState();
    _schema = FormSchemaParser.parse(widget.schemaJson);
    _formGroup = ReactiveFormGroup();
  }

  Future<void> _handleSubmit() async {
    setState(() => _isSubmitting = true);

    _formGroup.markAllAsDirty();
    final isValid = await _formGroup.validateAll();

    if (!isValid) {
      setState(() {
        _isSubmitting = false;
        _submitError = '请修复以上错误';
      });
      return;
    }

    try {
      final payload = _formGroup.values;
      // Submit to API
      // await apiService.createProduct(payload);
      await FormDraftManager.clearDraft(widget.formId);

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('商品发布成功！')),
        );
        Navigator.of(context).pop();
      }
    } catch (e) {
      setState(() => _submitError = '提交失败：$e');
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  void dispose() {
    _formGroup.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = LuckyFormThemeWidget.of(context);

    return Scaffold(
      appBar: AppBar(title: Text(_schema.title ?? '表单')),
      body: AutoSaveForm(
        formId: widget.formId,
        formGroup: _formGroup,
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Render each section
              for (final section in _schema.sections) ...[
                // Section title
                Text(
                  section.label,
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w600,
                    color: theme.textColor,
                  ),
                ),
                const SizedBox(height: 16),

                // Section fields
                Wrap(
                  spacing: 16,
                  runSpacing: 16,
                  children: section.fields.map((fieldConfig) {
                    return SizedBox(
                      width: _fieldWidth(fieldConfig),
                      child: FormFieldGenerator(
                        config: fieldConfig,
                        formGroup: _formGroup,
                      ),
                    );
                  }).toList(),
                ),
                const SizedBox(height: 24),
              ],

              // Submit error
              if (_submitError != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 16),
                  child: Text(
                    _submitError!,
                    style: TextStyle(color: theme.errorColor),
                  ),
                ),

              // Submit button (reactively enabled/disabled)
              CrossFieldSubscription(
                formGroup: _formGroup,
                builder: (context, values, errors, isValid) {
                  return SizedBox(
                    height: 48,
                    child: ElevatedButton(
                      onPressed:
                          (_isSubmitting || !isValid) ? null : _handleSubmit,
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
                              '提交',
                              style: TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                    ),
                  );
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  double _fieldWidth(FormFieldConfig config) {
    if (config.flex == 2) return MediaQuery.of(context).size.width - 32; // full width
    return (MediaQuery.of(context).size.width - 48) / 2; // half width (two columns)
  }
}
```

---

## 12. 总结

`ReactiveForms` + JSON Schema 系统为 Flutter 提供了一套完整的服务端驱动动态表单解决方案：

| 组件 | 职责 | 关键特性 |
|------|------|----------|
| `ReactiveFormController` | 响应式字段状态 | 值 / 状态 / 错误流 |
| `ReactiveFormGroup` | 多字段编排 | 组合验证、值映射 |
| `FormFieldConfig` | 字段定义 | 15+ 表单字段类型体系 |
| `FormSchemaParser` | JSON 反序列化 | 解析服务端驱动的表单配置 |
| `FormFieldGenerator` | 动态组件渲染 | 配置映射到 Widget，连接控制器 |
| `代码生成器` | Prisma → 表单配置 | 从后端模型自动生成表单配置 |
| `FormDraftManager` | 草稿持久化 | 防抖自动保存 / 恢复 |
| `CrossFieldSubscription` | 响应式组合 | 计算字段、条件可见性 |

### 关键要点

- **JSON Schema 作为单一事实来源**——表单可从后端下发，无需发布新版本即可更新
- **从 Prisma Schema 代码生成**——消除重复的表单编码工作；后端字段变更自动传播
- **响应式流支持复杂交互**——条件可见性、计算字段和跨字段验证都变得声明式
- **防抖自动保存防止数据丢失**——2 秒防抖在响应速度和存储 I/O 之间取得平衡
- **15 种字段类型覆盖所有表单场景**——从简单文本到 OTP 输入再到文件上传
- **`dependsOn` 模式处理 90% 的条件字段**——简单的相等检查，无需复杂的表达式解析

### 适用场景

该响应式表单系统适用于：
- 包含 10+ 种不同表单类型的应用（注册、商品、KYC、结账等）
- 需要从服务端更新而无需 App Store 部署的表单
- 需要代码生成以保持前端表单与后端模型同步的场景
- 复杂表单逻辑（条件字段、计算值）难以用命令式方式维护的情况

### 相关文章

- [**F19: LuckyFormTheme + 验证器系统**](./lucky-form-theme-validator-system.md) —— 支持单个表单字段的主题系统和验证器链
- [**F5: HydratedStateNotifier 抽象持久化**](./hydrated-state-notifier-abstract-persistence.md) —— 用于表单草稿自动保存的持久化模式
- [**F21: GlobalUploadService S3 + 压缩 + MIME**](./global-upload-service-s3-compression-mime.md) —— `FormFieldType.file` 的文件上传管道
