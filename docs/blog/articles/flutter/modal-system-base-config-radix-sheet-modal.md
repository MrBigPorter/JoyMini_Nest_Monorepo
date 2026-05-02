# BaseModalConfig + RadixSheet + RadixModal — 统一弹窗体系架构

> **Article F10** | **Difficulty:** ⭐⭐⭐⭐ | **Source:** `joy_mini_app/lib/core/ui/modal/`

## 1. 为什么需要统一弹窗体系？

JoyMini 作为社交+电商应用，弹窗场景极其丰富：

| 弹窗类型 | 场景 | 频率 |
|----------|------|------|
| **Action Sheet** | 分享/删除/选择操作 | 高频 |
| **Modal Bottom Sheet** | 商品详情/地址选择 | 高频 |
| **Dialog** | 确认/提示/输入 | 中频 |
| **Fullscreen Modal** | KYC 认证/图片裁剪 | 低频 |
| **Popup** | 优惠券/签到奖励 | 中频 |

传统做法（每个页面各自实现）导致：

```
❌ 混乱的现状：
- Page A: showModalBottomSheet(useSafeArea: true, ...)
- Page B: showDialog(context, AlertDialog(...))  
- Page C: DraggableScrollableSheet(...)
- Page D: 自定义 AnimatedBuilder

问题：动画不一致、背景色不统一、关闭手势参数散落
```

**BaseModalConfig + RadixSheet + RadixModal** 的解法：

```
✅ 统一体系：
BaseModalConfig (抽象配置)
  ├── RadixSheet (底部弹窗) — 75% 场景
  ├── RadixModal (居中弹窗) — 20% 场景  
  └── RadixFullScreen (全屏) — 5% 场景
```

## 2. BaseModalConfig — 抽象配置层

```dart
abstract class BaseModalConfig {
  /// 弹窗唯一标识（用于防重复、日志）
  String get id;

  /// 弹窗标题
  String? get title => null;

  /// 弹窗高度类型
  ModalHeight get height => ModalHeight.auto;

  /// 是否可拖动关闭
  bool get dismissible => true;

  /// 点击遮罩是否关闭
  bool get tapToClose => true;

  /// 是否启用安全区域
  bool get useSafeArea => true;

  /// 圆角大小
  double get borderRadius => 16;

  /// 自定义背景色
  Color? get backgroundColor => null;

  /// 动画时长
  Duration get animationDuration => const Duration(milliseconds: 300);

  /// 动画曲线
  Curve get animationCurve => Curves.easeOutCubic;

  /// 构建弹窗内容
  Widget build(BuildContext context);
}

enum ModalHeight {
  /// 自适应内容高度
  auto,

  /// 屏幕高度 25%
  quarter,

  /// 屏幕高度 50%
  half,

  /// 屏幕高度 75%
  threeQuarter,

  /// 全屏
  full,
}
```

## 3. RadixSheet — 底部弹窗

### 3.1 核心实现

```dart
class RadixSheet extends StatefulWidget {
  final BaseModalConfig config;

  const RadixSheet({super.key, required this.config});

  /// 便捷显示方法
  static Future<T?> show<T>(BuildContext context, BaseModalConfig config) {
    return showModalBottomSheet<T>(
      context: context,
      isScrollControlled: true,
      useSafeArea: config.useSafeArea,
      backgroundColor: Colors.transparent,
      elevation: 0,
      builder: (_) => RadixSheet(config: config),
    );
  }

  @override
  State<RadixSheet> createState() => _RadixSheetState();
}

class _RadixSheetState extends State<RadixSheet>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<Offset> _slideAnimation;
  late final Animation<double> _fadeAnimation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: widget.config.animationDuration,
    );

    _slideAnimation = Tween<Offset>(
      begin: const Offset(0, 1),
      end: Offset.zero,
    ).animate(CurvedAnimation(
      parent: _controller,
      curve: widget.config.animationCurve,
    ));

    _fadeAnimation = Tween<double>(
      begin: 0,
      end: 1,
    ).animate(CurvedAnimation(
      parent: _controller,
      curve: widget.config.animationCurve,
    ));

    _controller.forward();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: widget.config.tapToClose
          ? () => Navigator.pop(context)
          : null,
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, child) {
          return FadeTransition(
            opacity: _fadeAnimation,
            child: SlideTransition(
              position: _slideAnimation,
              child: child,
            ),
          );
        },
        child: _buildSheetContent(context),
      ),
    );
  }

  Widget _buildSheetContent(BuildContext context) {
    final tokens = context.theme; // Design Tokens

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Spacer(),
        Container(
          decoration: BoxDecoration(
            color: widget.config.backgroundColor ?? tokens.surface,
            borderRadius: BorderRadius.vertical(
              top: Radius.circular(widget.config.borderRadius),
            ),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Drag Handle
              _buildDragHandle(),
              // Title
              if (widget.config.title != null) _buildTitle(),
              // Content
              Flexible(
                child: widget.config.build(context),
              ),
              // Bottom Safe Area
              if (widget.config.useSafeArea)
                SizedBox(height: MediaQuery.of(context).padding.bottom),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildDragHandle() {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Container(
        width: 40,
        height: 4,
        decoration: BoxDecoration(
          color: context.theme.colors.neutral.shade300,
          borderRadius: BorderRadius.circular(2),
        ),
      ),
    );
  }

  Widget _buildTitle() {
    return Padding(
      padding: EdgeInsets.fromLTRB(
        context.theme.spacing.lg,
        context.theme.spacing.sm,
        context.theme.spacing.lg,
        context.theme.spacing.md,
      ),
      child: Text(
        widget.config.title!,
        style: context.theme.typography.titleLarge.toTextStyle(
          context.theme.colors.neutral.shade900,
        ),
      ),
    );
  }
}
```

### 3.2 内置拖拽关闭

```dart
class _RadixSheetState extends State<RadixSheet>
    with SingleTickerProviderStateMixin {
  // ... (上面已有)

  /// 拖拽关闭手势
  Widget _buildDraggableContent() {
    return GestureDetector(
      onVerticalDragUpdate: (details) {
        if (details.primaryDelta! > 0) {
          // 下滑关闭
          _controller.value -= details.primaryDelta! / context.height;
        }
      },
      onVerticalDragEnd: (details) {
        if (_controller.value < 0.5) {
          // 关闭
          _controller.reverse().then((_) => Navigator.pop(context));
        } else {
          // 弹回
          _controller.forward();
        }
      },
      child: _buildSheetContent(context),
    );
  }
}
```

## 4. RadixModal — 居中弹窗

```dart
class RadixModal extends StatefulWidget {
  final BaseModalConfig config;

  const RadixModal({super.key, required this.config});

  static Future<T?> show<T>(BuildContext context, BaseModalConfig config) {
    return showDialog<T>(
      context: context,
      barrierDismissible: config.tapToClose,
      barrierColor: Colors.black54,
      builder: (_) => RadixModal(config: config),
    );
  }

  @override
  State<RadixModal> createState() => _RadixModalState();
}

class _RadixModalState extends State<RadixModal>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _scaleAnimation;
  late final Animation<double> _fadeAnimation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: widget.config.animationDuration,
    );

    _scaleAnimation = Tween<double>(begin: 0.85, end: 1.0).animate(
      CurvedAnimation(
        parent: _controller,
        curve: Curves.easeOutBack, // 弹性效果
      ),
    );

    _fadeAnimation = Tween<double>(begin: 0, end: 1).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeOut),
    );

    _controller.forward();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        return FadeTransition(
          opacity: _fadeAnimation,
          child: ScaleTransition(
            scale: _scaleAnimation,
            child: child,
          ),
        );
      },
      child: AlertDialog(
        backgroundColor: widget.config.backgroundColor ?? Colors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(widget.config.borderRadius),
        ),
        title: widget.config.title != null
            ? Text(widget.config.title!)
            : null,
        content: widget.config.build(context),
      ),
    );
  }
}
```

## 5. 预设配置示例

### 5.1 ConfirmationSheet

```dart
class ConfirmationSheetConfig extends BaseModalConfig {
  final String message;
  final String confirmText;
  final String cancelText;
  final VoidCallback? onConfirm;
  final Color? confirmColor;

  ConfirmationSheetConfig({
    required this.message,
    this.confirmText = 'Confirm',
    this.cancelText = 'Cancel',
    this.onConfirm,
    this.confirmColor,
  });

  @override
  String get id => 'confirmation_sheet';

  @override
  String? get title => null;

  @override
  Widget build(BuildContext context) {
    final tokens = context.theme;

    return Padding(
      padding: EdgeInsets.all(tokens.spacing.lg),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(message, style: tokens.typography.bodyMedium),
          const SizedBox(height: 24),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () => Navigator.pop(context),
                  child: Text(cancelText),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: confirmColor ?? tokens.colors.primary,
                  ),
                  onPressed: () {
                    Navigator.pop(context);
                    onConfirm?.call();
                  },
                  child: Text(confirmText),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

// 使用
ConfirmationSheetConfig(
  message: 'Are you sure you want to delete this item?',
  confirmText: 'Delete',
  cancelText: 'Keep',
  confirmColor: Colors.red,
  onConfirm: () => item.delete(),
).show(context);
```

### 5.2 ShareSheet

```dart
class ShareSheetConfig extends BaseModalConfig {
  final String title;
  final String url;
  final String? description;

  ShareSheetConfig({
    required this.title,
    required this.url,
    this.description,
  });

  @override
  String get id => 'share_sheet';

  @override
  String? get title => 'Share to';

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // 分享渠道网格
        GridView.count(
          crossAxisCount: 4,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          padding: EdgeInsets.all(context.theme.spacing.lg),
          children: [
            _ShareItem(icon: Icons.facebook, label: 'Facebook', onTap: _shareToFacebook),
            _ShareItem(icon: Icons.message, label: 'Messenger', onTap: _shareToMessenger),
            _ShareItem(icon: Icons.copy, label: 'Copy Link', onTap: _copyLink),
            _ShareItem(icon: Icons.more_horiz, label: 'More', onTap: _openSystemShare),
          ],
        ),
      ],
    );
  }
}
```

### 5.3 BottomActionSheet

```dart
class BottomActionSheetConfig extends BaseModalConfig {
  final List<ActionItem> actions;

  BottomActionSheetConfig({required this.actions});

  @override
  String get id => 'bottom_action_sheet';

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        ...actions.map((action) => ListTile(
          leading: Icon(action.icon),
          title: Text(action.label),
          onTap: () {
            Navigator.pop(context);
            action.onTap?.call();
          },
        )),
      ],
    );
  }
}

class ActionItem {
  final IconData icon;
  final String label;
  final VoidCallback? onTap;
  final Color? color;

  const ActionItem({
    required this.icon,
    required this.label,
    this.onTap,
    this.color,
  });
}
```

## 6. Modal 管理器

### 6.1 防重复与队列管理

```dart
class ModalManager {
  final Set<String> _activeModals = {};
  final Queue<BaseModalConfig> _queue = Queue();

  /// 显示弹窗（自动防重复 + 队列）
  Future<T?> show<T>(BuildContext context, BaseModalConfig config) async {
    // 防重复
    if (_activeModals.contains(config.id)) {
      Logger.warning('[Modal] Duplicate: ${config.id}');
      return null;
    }

    _activeModals.add(config.id);

    try {
      return await _showModal(context, config);
    } finally {
      _activeModals.remove(config.id);
      _processQueue(context);
    }
  }

  /// 延迟显示（等当前弹窗关闭后自动弹出）
  void enqueue(BaseModalConfig config) {
    _queue.add(config);
  }

  void _processQueue(BuildContext context) {
    if (_queue.isEmpty) return;
    final next = _queue.removeFirst();
    show(context, next);
  }

  Future<T?> _showModal<T>(BuildContext context, BaseModalConfig config) {
    return switch (config.height) {
      ModalHeight.full => RadixFullScreen.show<T>(context, config),
      _ => RadixSheet.show<T>(context, config), // 默认底部
    };
  }
}
```

### 6.2 全局访问

```dart
extension ModalExtension on BuildContext {
  /// 显示底部弹窗
  Future<T?> showSheet<T>(BaseModalConfig config) {
    return ModalManager().show<T>(this, config);
  }

  /// 显示居中弹窗
  Future<T?> showModal<T>(BaseModalConfig config) {
    return RadixModal.show<T>(this, config);
  }

  /// 显示确认弹窗
  Future<bool?> confirm({
    required String message,
    String confirmText = 'Confirm',
    String cancelText = 'Cancel',
  }) {
    return showSheet<bool>(ConfirmationSheetConfig(
      message: message,
      confirmText: confirmText,
      cancelText: cancelText,
    ));
  }
}
```

## 7. 对比总结

| 特性 | RadixSheet (底部) | RadixModal (居中) | RadixFullScreen (全屏) |
|------|-------------------|-------------------|----------------------|
| **显示方式** | `showModalBottomSheet` | `showDialog` | `Navigator.push` |
| **动画** | Slide Up + Fade | Scale + Fade (easeOutBack) | Slide Right |
| **拖动关闭** | ✅ 内置 | ❌ | ❌ |
| **适用场景** | 操作列表/表单/选择 | 确认/提示/输入 | KYC/图片编辑 |
| **使用占比** | ~75% | ~20% | ~5% |
| **高度模式** | auto/quarter/half/full | auto | full |

**核心设计原则**：
1. **配置驱动**：一个 `BaseModalConfig` 派生类定义完整弹窗行为
2. **动画一致**：所有弹窗使用相同的动效参数（duration + curve）
3. **拖拽关闭**：底部 Sheet 默认支持下滑手势关闭
4. **防重复**：ModalManager 确保同一 id 的弹窗不会重复显示
5. **队列**：支持弹窗排队，当前弹窗关闭后自动弹出下一个

---

**下一篇预告**: [F12 — Platform Adapter 条件导出] — 平台适配器与条件编译
