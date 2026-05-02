# ReactiveForms + JSON Schema 代码生成表单

> **文章难度：** ⭐⭐⭐⭐⭐ (专家)
> **关注领域：** 表单引擎、响应式编程、代码生成、架构设计
> **阅读时间：** 25 分钟

## 目录

- [为什么需要响应式表单 + 代码生成？](#为什么需要响应式表单--代码生成)
- [架构总览：ReactiveForm 引擎 + JSON Schema](#架构总览reactiveform-引擎--json-schema)
- [ReactiveFormController：值 / 状态 / 错误流](#reactiveformcontroller值--状态--错误流)
  - [控制器实现](#控制器实现)
  - [组合表单状态](#组合表单状态)
- [表单字段类型系统：text / number / select / date / file](#表单字段类型系统text--number--select--date--file)
  - [字段配置](#字段配置)
- [JSON Schema 定义表单配置](#json-schema-定义表单配置)
  - [JSON Schema 示例](#json-schema-示例)
  - [Schema 解析器](#schema-解析器)
- [代码生成：从 Prisma Schema 到表单配置](#代码生成从-prisma-schema-到表单配置)
  - [Prisma Schema 示例](#prisma-schema-示例)
  - [代码生成器（Node.js 脚本）](#代码生成器nodejs-脚本)
  - [生成输出（Dart 常量）](#生成输出dart-常量)
- [动态表单渲染：FormFieldGenerator](#动态表单渲染formfieldgenerator)
- [表单状态订阅与跨字段组合](#表单状态订阅与跨字段组合)
  - [计算字段（总价 = 价格 × 数量）](#计算字段总价--价格--数量)
- [基于其他字段值的条件显示/隐藏](#基于其他字段值的条件显示隐藏)
  - [响应式可见性构建器](#响应式可见性构建器)
- [自动保存与恢复表单草稿](#自动保存与恢复表单草稿)
  - [草稿管理器](#草稿管理器)
  - [自动保存组件](#自动保存组件)
- [实践：动态商品表单](#实践动态商品表单)
- [总结](#总结)
  - [关键要点](#关键要点)
  - [何时使用此模式](#何时使用此模式)
  - [相关文章](#相关文章)

## 为什么需要响应式表单 + 代码生成？

在构建包含大量表单的 Flutter 应用时，传统做法面临以下问题：

1. **重复劳动**：每个表单都需要手写控制器、验证逻辑、错误处理——即使结构相似
2. **后端不同步**：后端模型变更后，前端表单需要手动更新，容易遗漏
3. **无法热更新**：表单逻辑捆绑在 App 二进制文件中，无法动态调整
4. **大量样板代码**：每个字段需要 `TextEditingController`、验证状态、错误展示

**响应式表单 + JSON Schema + 代码生成** 方案的核心思想：

- **JSON Schema 驱动**：表单结构由后端 JSON 定义，前端动态渲染
- **响应式控制器**：基于 Stream 的控制器，值和状态变化可被订阅
- **代码生成**：从 Prisma Schema 自动生成表单配置，消除重复工作

## 架构总览：ReactiveForm 引擎 + JSON Schema

```
                  ┌──────────────────────────────┐
                  │     JSON Schema (服务端)      │
                  │  formId, version, sections[]   │
                  └─────────────┬────────────────┘
                                │ 解析
                                ▼
                  ┌──────────────────────────────┐
                  │      FormSchemaParser         │
                  │  JSON → FormSchema + sections │
                  └─────────────┬────────────────┘
                                │
          ┌─────────────────────┼─────────────────────┐
          ▼                     ▼                     ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ FormFieldGenerator│  │ ReactiveFormGroup │  │  AutoSaveForm    │
│ (动态渲染)        │  │ (控制器集合)      │  │ (草稿自动保存)   │
└──────────────────┘  └──────────────────┘  └──────────────────┘
          │                     │
          ▼                     ▼
┌──────────────────┐  ┌──────────────────┐
│ ReactiveFormCtrl  │◄─┤  Stream 架构      │
│ valueStream       │  │  statusStream     │
│ errorStream       │  │  combinedStream   │
└──────────────────┘  └──────────────────┘
```

## ReactiveFormController：值 / 状态 / 错误流

`ReactiveFormController<T>` 是响应式表单的核心。它封装了字段的值、验证状态和错误信息，通过 Stream 对外发布变化。

### 控制器实现

```dart
/// 响应式表单字段状态
enum ReactiveFieldStatus {
  pristine,   // 未触及
  dirty,      // 已修改
  validating, // 验证中
  valid,      // 有效
  invalid,    // 无效
}

/// 泛型响应式表单控制器
class ReactiveFormController<T> {
  final String fieldName;
  final List<FieldValidator> validators;

  T _value;
  ReactiveFieldStatus _status = ReactiveFieldStatus.pristine;
  String? _error;

  // 值流（对外只读，对内可写）
  final BehaviorSubject<T> _valueSubject;
  // 状态流
  final BehaviorSubject<ReactiveFieldStatus> _statusSubject;
  // 错误流
  final BehaviorSubject<String?> _errorSubject;

  ReactiveFormController({
    required this.fieldName,
    T? initialValue,
    this.validators = const [],
  })  : _value = initialValue ?? ('' as T),
      _valueSubject = BehaviorSubject<T>.seeded(initialValue ?? ('' as T)),
      _statusSubject = BehaviorSubject<ReactiveFieldStatus>.seeded(ReactiveFieldStatus.pristine),
      _errorSubject = BehaviorSubject<String?>.seeded(null);

  // ── 公共 Stream API ──

  /// 值变化流
  Stream<T> get valueStream => _valueSubject.stream;

  /// 状态变化流
  Stream<ReactiveFieldStatus> get statusStream => _statusSubject.stream;

  /// 错误信息流
  Stream<String?> get errorStream => _errorSubject.stream;

  // ── 当前值快照 ──

  T get value => _value;
  ReactiveFieldStatus get status => _status;
  String? get error => _error;
  bool get isValid => _status == ReactiveFieldStatus.valid;
  bool get isDirty => _status != ReactiveFieldStatus.pristine;

  /// 更新值并自动触发验证
  void updateValue(T newValue) {
    if (newValue == _value) return;

    _value = newValue;
    _valueSubject.add(newValue);

    if (_status == ReactiveFieldStatus.pristine) {
      _updateStatus(ReactiveFieldStatus.dirty);
    }

    validate();
  }

  /// 手动触发验证
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

  /// 标记为已修改
  void markAsDirty() {
    if (_status == ReactiveFieldStatus.pristine) {
      _updateStatus(ReactiveFieldStatus.dirty);
    }
  }

  /// 重置到初始状态
  void reset(T? initialValue) {
    _value = initialValue ?? ('' as T);
    _error = null;
    _valueSubject.add(_value);
    _errorSubject.add(null);
    _updateStatus(ReactiveFieldStatus.pristine);
  }

  /// 标记为提交中（用于表单提交时禁用按钮）
  void setSubmitting(bool isSubmitting) {
    // 状态扩展：可在流中添加标记
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

/// 字段验证器接口
abstract class FieldValidator {
  Future<String?> validate(String value);
}

class ReactiveRequiredValidator implements FieldValidator {
  final String message;
  ReactiveRequiredValidator({this.message = '此字段为必填项'});

  @override
  Future<String?> validate(String value) async {
    if (value.trim().isEmpty) return message;
    return null;
  }
}

class ReactivePatternValidator implements FieldValidator {
  final RegExp pattern;
  final String message;
  ReactivePatternValidator(this.pattern, {this.message = '格式不正确'});

  @override
  Future<String?> validate(String value) async {
    if (value.isEmpty) return null;
    if (!pattern.hasMatch(value)) return message;
    return null;
  }
}
```

### 组合表单状态

```dart
/// 响应式表单组——管理多个控制器
class ReactiveFormGroup {
  final Map<String, ReactiveFormController> _controllers = {};

  /// 添加控制器
  void addController(ReactiveFormController controller) {
    _controllers[controller.fieldName] = controller;
  }

  /// 获取指定名称的控制器
  ReactiveFormController<T>? controller<T>(String fieldName) {
    return _controllers[fieldName] as ReactiveFormController<T>?;
  }

  /// 所有字段当前值
  Map<String, dynamic> get values {
    return _controllers.map((key, ctrl) => MapEntry(key, ctrl.value));
  }

  /// 所有字段错误信息
  Map<String, String?> get errors {
    return _controllers.map((key, ctrl) => MapEntry(key, ctrl.error));
  }

  /// 验证所有字段
  Future<bool> validateAll() async {
    final results = await Future.wait(
      _controllers.values.map((c) => c.validate()),
    );
    return results.every((r) => r);
  }

  /// 标记所有字段为已修改
  void markAllAsDirty() {
    _controllers.values.forEach((c) => c.markAsDirty());
  }

  /// 组合有效性流（任一字段变化时触发）
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

  /// 组合值流（任一字段值变化时触发）
  Stream<Map<String, dynamic>> get combinedValueStream {
    if (_controllers.isEmpty) {
      return Stream.value({});
    }

    return Rx.combineLatestList(
      _controllers.values.map((c) => c.valueStream),
    ).map((_) => values);
  }

  /// 重置所有字段
  void resetAll() {
    _controllers.values.forEach((c) => c.reset(null));
  }

  void dispose() {
    _controllers.values.forEach((c) => c.dispose());
    _controllers.clear();
  }
}
```

## 表单字段类型系统：text / number / select / date / file

`FormFieldType` 枚举定义了 15+ 种原生表单字段类型，支持丰富的表单场景。

```dart
/// 表单字段类型枚举
enum FormFieldType {
  text,          // 文本输入
  number,        // 数字输入
  phone,         // 电话号码
  email,         // 邮箱地址
  password,      // 密码（带显隐切换）
  select,        // 下拉选择（单选）
  multiSelect,   // 多选下拉
  checkbox,      // 复选框
  radio,         // 单选框
  date,          // 日期选择器
  time,          // 时间选择器
  dateTime,      // 日期时间选择器
  file,          // 文件上传
  switch_toggle, // 开关切换
  slider,        // 滑块
  textArea,      // 多行文本
  otp,           // OTP 验证码输入
}
```

### 字段配置

```dart
/// 表单字段配置（由 JSON Schema 解析而来）
class FormFieldConfig {
  final String name;
  final FormFieldType type;
  final String label;
  final String? hintText;
  final String? helperText;
  final dynamic initialValue;
  final bool required;
  final dynamic placeholder;

  // 类型特定选项
  final NumberOptions? numberOptions;
  final SelectOptions? selectOptions;
  final DateOptions? dateOptions;
  final FileOptions? fileOptions;
  final TextOptions? textOptions;

  // 验证规则列表
  final List<ValidationRule> validationRules;

  // 条件显示
  final String? dependsOn;
  final dynamic dependsOnValue;
  final dynamic visibilityCondition;

  // 布局
  final int flex;       // flex: 1 = 半宽, 2 = 全宽
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

/// 数字选项
class NumberOptions {
  final double? min;
  final double? max;
  final int? decimalPlaces;
  final String? prefix;  // 如 '₱'
  final String? suffix;  // 如 'kg'

  const NumberOptions({this.min, this.max, this.decimalPlaces, this.prefix, this.suffix});
}

/// 下拉选择选项
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

/// 日期选项
class DateOptions {
  final DateTime? minDate;
  final DateTime? maxDate;

  const DateOptions({this.minDate, this.maxDate});
}

/// 文件选项
class FileOptions {
  final List<String> allowedExtensions;
  final int maxFileSize;   // 字节
  final int maxFileCount;
  final bool multiple;

  const FileOptions({
    this.allowedExtensions = const ['jpg', 'jpeg', 'png'],
    this.maxFileSize = 10485760,
    this.maxFileCount = 1,
    this.multiple = false,
  });
}

/// 文本选项
class TextOptions {
  final int? maxLength;
  final int? minLength;
  final TextInputType? keyboardType;
  final bool obscureText;

  const TextOptions({this.maxLength, this.minLength, this.keyboardType, this.obscureText = false});
}

/// 验证规则
class ValidationRule {
  final String type;       // 'required', 'minLength', 'maxLength', 'pattern', 'min', 'max', 'email', etc.
  final dynamic value;
  final String message;
  final String? customValidatorId;

  const ValidationRule({
    required this.type,
    this.value,
    this.message = '无效值',
    this.customValidatorId,
  });
}
```

## JSON Schema 定义表单配置

表单配置以 JSON Schema 的形式存储在服务端，前端通过 API 获取后动态渲染。这使得表单可以在不发布新版本的情况下更新。

### JSON Schema 示例

```json
{
  "formId": "product_listing",
  "version": "1.0.0",
  "title": "发布商品",
  "sections": [
    {
      "name": "basic_info",
      "label": "基本信息",
      "fields": [
        {
          "name": "title",
          "type": "text",
          "label": "商品标题",
          "required": true,
          "textOptions": {
            "maxLength": 100,
            "minLength": 5
          },
          "validationRules": [
            { "type": "required", "message": "商品标题为必填项" },
            { "type": "minLength", "value": 5, "message": "标题至少需要 5 个字符" },
            { "type": "maxLength", "value": 100, "message": "标题不能超过 100 个字符" }
          ]
        },
        {
          "name": "description",
          "type": "textArea",
          "label": "商品描述",
          "textOptions": {
            "maxLength": 2000
          },
          "validationRules": [
            { "type": "maxLength", "value": 2000, "message": "描述不能超过 2000 个字符" }
          ]
        },
        {
          "name": "categoryId",
          "type": "select",
          "label": "商品分类",
          "required": true,
          "selectOptions": {
            "searchable": true,
            "options": [
              { "label": "电子产品", "value": "electronics" },
              { "label": "服装配饰", "value": "fashion" },
              { "label": "家居生活", "value": "home" },
              { "label": "美妆个护", "value": "beauty" },
              { "label": "食品饮料", "value": "food" },
              { "label": "运动户外", "value": "sports" },
              { "label": "其他", "value": "other" }
            ]
          },
          "validationRules": [
            { "type": "required", "message": "请选择商品分类" }
          ]
        }
      ]
    },
    {
      "name": "pricing",
      "label": "定价与库存",
      "fields": [
        {
          "name": "price",
          "type": "number",
          "label": "价格",
          "required": true,
          "numberOptions": {
            "min": 0,
            "decimalPlaces": 2,
            "prefix": "₱"
          },
          "validationRules": [
            { "type": "required", "message": "请输入价格" },
            { "type": "min", "value": 0, "message": "价格不能为负" }
          ]
        },
        {
          "name": "stock",
          "type": "number",
          "label": "库存数量",
          "required": true,
          "numberOptions": {
            "min": 0,
            "decimalPlaces": 0
          },
          "validationRules": [
            { "type": "required", "message": "请输入库存数量" },
            { "type": "min", "value": 0, "message": "库存不能为负" }
          ]
        },
        {
          "name": "hasDiscount",
          "type": "switch_toggle",
          "label": "开启促销",
          "initialValue": false
        },
        {
          "name": "discountPrice",
          "type": "number",
          "label": "促销价格",
          "dependsOn": "hasDiscount",
          "dependsOnValue": true,
          "numberOptions": {
            "min": 0,
            "decimalPlaces": 2,
            "prefix": "₱"
          },
          "validationRules": [
            { "type": "min", "value": 0, "message": "促销价格不能为负" }
          ]
        }
      ]
    },
    {
      "name": "media",
      "label": "商品图片",
      "fields": [
        {
          "name": "images",
          "type": "file",
          "label": "商品照片",
          "fileOptions": {
            "allowedExtensions": ["jpg", "jpeg", "png", "webp"],
            "maxFileSize": 5242880,
            "maxFileCount": 10,
            "multiple": true
          },
          "validationRules": [
            { "type": "required", "message": "至少需要一张商品图片" },
            { "type": "maxFileCount", "value": 10, "message": "最多 10 张图片" }
          ]
        }
      ]
    }
  ]
}
```

### Schema 解析器

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
                    message: r['message'] as String? ?? '无效值',
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

## 代码生成：从 Prisma Schema 到表单配置

代码生成器将 **Prisma Schema 模型**转换为 JSON 表单配置。这架起了后端数据模型与前端表单之间的桥梁。

### Prisma Schema 示例

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

### 代码生成器（Node.js 脚本）

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
  // ... 类型特定选项
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

    // 类型特定选项
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

  // 检测依赖关系：hasDiscount → discountPrice
  const discountPriceIdx = fields.findIndex(f => f.name === 'discountPrice');
  const hasDiscountIdx = fields.findIndex(f => f.name === 'hasDiscount');
  if (discountPriceIdx >= 0 && hasDiscountIdx >= 0) {
    fields[discountPriceIdx]['dependsOn'] = 'hasDiscount';
    fields[discountPriceIdx]['dependsOnValue'] = true;
  }

  return {
    formId: `${camelToKebab(model.name)}_form`,
    version: '1.0.0',
    title: `添加${model.name.replace(/([A-Z])/g, ' $1').trim()}`,
    sections: [
      {
        name: 'main',
        label: '基本信息',
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
    rules.push({ type: 'required', message: `${field.name} 为必填项` });
  }
  if (field.type === 'String' && field.name.includes('email')) {
    rules.push({ type: 'email', message: '邮箱格式不正确' });
  }
  if (field.type === 'Int' || field.type === 'Float' || field.type === 'Decimal') {
    if (field.name.includes('price') || field.name.includes('amount')) {
      rules.push({ type: 'min', value: 0, message: '值必须为正数' });
    }
  }
  return rules;
}

// 对所有模型执行生成
const schema = readFileSync('schema.prisma', 'utf8');
const models = parsePrismaSchema(schema);

const generatedForms = models.map(generateFormFromModel);
writeFileSync(
  'form-configs.generated.json',
  JSON.stringify(generatedForms, null, 2)
);
```

### 生成输出（Dart 常量）

```dart
// 此文件为自动生成。请勿手动编辑。
// 基于 Prisma Schema v1.2.0 生成

class ProductFormConfig {
  static const formSchema = FormSchema(
    formId: 'product_form',
    version: '1.0.0',
    title: '添加商品',
    sections: [
      FormSectionConfig(
        name: 'main',
        label: '基本信息',
        fields: [
          FormFieldConfig(
            name: 'title',
            type: FormFieldType.text,
            label: '标题',
            required: true,
            validationRules: [
              ValidationRule(type: 'required', message: 'title 为必填项'),
            ],
          ),
          FormFieldConfig(
            name: 'description',
            type: FormFieldType.textArea,
            label: '描述',
            required: false,
          ),
          FormFieldConfig(
            name: 'categoryId',
            type: FormFieldType.select,
            label: '分类 ID',
            required: true,
            validationRules: [
              ValidationRule(type: 'required', message: 'categoryId 为必填项'),
            ],
          ),
          FormFieldConfig(
            name: 'price',
            type: FormFieldType.number,
            label: '价格',
            required: true,
            numberOptions: NumberOptions(
              decimalPlaces: 2,
              prefix: '₱',
            ),
            validationRules: [
              ValidationRule(type: 'required', message: 'price 为必填项'),
              ValidationRule(type: 'min', value: 0, message: '值必须为正数'),
            ],
          ),
          FormFieldConfig(
            name: 'hasDiscount',
            type: FormFieldType.switch_toggle,
            label: '开启促销',
            initialValue: false,
          ),
          FormFieldConfig(
            name: 'discountPrice',
            type: FormFieldType.number,
            label: '促销价格',
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
            label: '图片',
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

## 动态表单渲染：FormFieldGenerator

[`FormFieldGenerator`] 接收 `FormFieldConfig` 并渲染对应的组件，同时连接到 `ReactiveFormController`。

```dart
class FormFieldGenerator extends StatelessWidget {
  final FormFieldConfig config;
  final ReactiveFormGroup formGroup;
  final Map<String, dynamic>? contextValues; // 用于可见性条件

  const FormFieldGenerator({
    super.key,
    required this.config,
    required this.formGroup,
    this.contextValues,
  });

  @override
  Widget build(BuildContext context) {
    // 检查可见性条件
    if (!_isVisible(context)) {
      return const SizedBox.shrink();
    }

    // 获取或创建控制器
    final controller = _getOrCreateController();

    return _buildField(context, controller);
  }

  bool _isVisible(BuildContext context) {
    if (config.dependsOn != null) {
      final dependsController = formGroup.controller(config.dependsOn!);
      if (dependsController != null) {
        return dependsController.value == config.dependsOnValue;
      }
      // 回退到上下文值
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
              hintText: config.hintText ?? '选择日期',
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
    // 使用 image_picker 或 file_picker 包集成文件选择
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
            // 显示已有文件
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
                // 添加按钮
                ActionChip(
                  avatar: const Icon(Icons.add),
                  label: Text('添加${config.fileOptions?.multiple ? '文件' : '文件'}'),
                  onPressed: () async {
                    // 触发文件选择器
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
              // 更新指定索引的 OTP 值
              final currentOtp = (controller.value as String?) ?? '';
              final otpChars = currentOtp.split('');
              otpChars[index] = v;
              controller.updateValue(otpChars.join());
              // 自动聚焦下一个
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

## 表单状态订阅与跨字段组合

响应式表单通过流组合器实现强大的**跨字段订阅模式**。

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
    // 创建当任一字段值变化时触发的流
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

// 使用：仅当表单有效时才启用提交按钮
CrossFieldSubscription(
  formGroup: formGroup,
  builder: (context, values, errors, isValid) {
    return ElevatedButton(
      onPressed: isValid ? _handleSubmit : null,
      child: const Text('提交'),
    );
  },
);
```

### 计算字段（总价 = 价格 × 数量）

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
    // 同时监听价格和数量以计算总价
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
            Text('总计：₱${total.toStringAsFixed(2)}'),
          ],
        );
      },
    );
  }
}
```

---

## 基于其他字段值的条件显示/隐藏

可见性系统使用 JSON Schema 中的 `dependsOn` / `dependsOnValue` 模式。`FormFieldGenerator` 在渲染前自动检查可见性。

### 响应式可见性构建器

对于更复杂的条件，使用专用组件在依赖字段变化时重新渲染：

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

// 使用：当开关打开时显示折扣字段
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

## 自动保存与恢复表单草稿

表单草稿自动保存到本地存储（使用 [`HydratedStateNotifier`](./hydrated-state-notifier-abstract-persistence.md) 模式），并在用户返回时恢复。

### 草稿管理器

```dart
class FormDraftManager {
  static const _draftPrefix = 'form_draft_';

  /// 保存表单值作为草稿
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

  /// 加载表单草稿
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

  /// 提交成功后清除草稿
  static Future<void> clearDraft(String formId) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('$_draftPrefix$formId');
  }
}
```

### 自动保存组件

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

    // 恢复值到控制器
    for (final entry in draft.entries) {
      final controller = widget.formGroup.controller(entry.key);
      if (controller != null) {
        controller.updateValue(entry.value);
      }
    }

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('已恢复草稿'),
          duration: Duration(seconds: 2),
        ),
      );
    }
  }

  void _subscribeToChanges() {
    // 订阅所有值流
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

## 实践：动态商品表单

以下是所有组件完整集成的示例——一个由 JSON Schema 驱动的商品发布表单，支持自动保存、条件字段和响应式验证。

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
        _submitError = '请修正以上错误';
      });
      return;
    }

    try {
      final payload = _formGroup.values;
      // 提交到 API
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
              // 渲染每个区块
              for (final section in _schema.sections) ...[
                // 区块标题
                Text(
                  section.label,
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w600,
                    color: theme.textColor,
                  ),
                ),
                const SizedBox(height: 16),

                // 区块字段
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

              // 提交错误
              if (_submitError != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 16),
                  child: Text(
                    _submitError!,
                    style: TextStyle(color: theme.errorColor),
                  ),
                ),

              // 提交按钮（响应式启用/禁用）
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
    if (config.flex == 2) return MediaQuery.of(context).size.width - 32; // 全宽
    return (MediaQuery.of(context).size.width - 48) / 2; // 半宽（两列）
  }
}
```

---

## 总结

`ReactiveForms` + JSON Schema 系统为 Flutter 提供了完整的动态服务端驱动表单解决方案：

| 组件 | 职责 | 关键特性 |
|-----------|---------------|-------------|
| `ReactiveFormController` | 响应式字段状态 | 值 / 状态 / 错误流 |
| `ReactiveFormGroup` | 多字段编排 | 组合验证、值映射 |
| `FormFieldConfig` | 字段定义 | 15+ 表单字段类型的类型系统 |
| `FormSchemaParser` | JSON 反序列化 | 解析服务端驱动的表单配置 |
| `FormFieldGenerator` | 动态组件渲染 | 将配置映射为组件，连接控制器 |
| `代码生成器` | Prisma → 表单配置 | 从后端模型自动生成表单配置 |
| `FormDraftManager` | 草稿持久化 | 防抖自动保存/恢复 |
| `CrossFieldSubscription` | 响应式组合 | 计算字段、条件可见性 |

### 关键要点

- **JSON Schema 作为单一事实来源**——表单可从后端下发，无需发版即可更新
- **从 Prisma Schema 代码生成**——消除重复的表单编码工作；后端字段变更自动传播
- **响应式流实现复杂交互**——条件可见性、计算字段、跨字段验证都变成声明式
- **防抖自动保存防止数据丢失**——2 秒防抖在响应速度和存储 I/O 之间取得平衡
- **15 种字段类型覆盖所有表单场景**——从简单文本到 OTP 输入再到文件上传
- **`dependsOn` 模式处理 90% 的条件字段**——简单的相等判断，无需复杂表达式解析

### 何时使用此模式

此响应式表单系统适用于以下场景：
- 应用有 10 种以上不同类型的表单（注册、商品、KYC、结算等）
- 表单需要从服务端更新而无需 App Store 部署
- 需要代码生成来保持前端表单与后端模型同步
- 复杂表单逻辑（条件字段、计算值）难以用命令式方式维护

### 相关文章

- [**F19: LuckyFormTheme + 验证器系统**](./lucky-form-theme-validator-system.md) — 为单个表单字段提供支持的主题系统和验证器链
- [**F5: HydratedStateNotifier 抽象持久化**](./hydrated-state-notifier-abstract-persistence.md) — 表单草稿自动保存使用的持久化模式
- [**F21: GlobalUploadService S3 + 压缩 + MIME 修正**](./global-upload-service-s3-compression-mime.md) — 用于 `FormFieldType.file` 的文件上传管道
