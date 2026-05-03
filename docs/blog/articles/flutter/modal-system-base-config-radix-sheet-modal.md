---
title: "BaseModalConfig + RadixSheet + RadixModal: Unified Modal Architecture"
description: "A unified modal system architecture using BaseModalConfig abstract class, RadixSheet bottom sheet, RadixModal centered dialog, and RadixFullScreen with deduplication and queue management."
slug: modal-system-base-config-radix-sheet-modal
tags: [flutter, ui, modal, architecture]
---

# BaseModalConfig + RadixSheet + RadixModal: Unified Modal Architecture

## 1. Why a Unified Modal System?

JoyMini, as a social + e-commerce application, has extremely rich modal scenarios:

| Modal Type | Scenario | Frequency |
|-----------|----------|-----------|
| **Action Sheet** | Share/Delete/Selection actions | High |
| **Modal Bottom Sheet** | Product details/Address selection | High |
| **Dialog** | Confirmation/Prompt/Input | Medium |
| **Fullscreen Modal** | KYC verification/Image cropping | Low |
| **Popup** | Coupon/Check-in reward | Medium |

The traditional approach (each page implements its own) leads to:

```
❌ Chaotic Status Quo:
- Page A: showModalBottomSheet(useSafeArea: true, ...)
- Page B: showDialog(context, AlertDialog(...))  
- Page C: DraggableScrollableSheet(...)
- Page D: Custom AnimatedBuilder

Problems: Inconsistent animations, non-uniform background colors, scattered dismiss gesture parameters
```

**BaseModalConfig + RadixSheet + RadixModal** solution:

```
✅ Unified System:
BaseModalConfig (Abstract Configuration)
  ├── RadixSheet (Bottom Sheet) — 75% of scenarios
  ├── RadixModal (Centered Modal) — 20% of scenarios  
  └── RadixFullScreen (Full Screen) — 5% of scenarios
```

## 2. BaseModalConfig — Abstract Configuration Layer

```dart
abstract class BaseModalConfig {
  /// Unique modal identifier (for deduplication, logging)
  String get id;

  /// Modal title
  String? get title => null;

  /// Modal height type
  ModalHeight get height => ModalHeight.auto;

  /// Whether dismissible by dragging
  bool get dismissible => true;

  /// Whether tapping the overlay closes the modal
  bool get tapToClose => true;

  /// Whether to enable safe area
  bool get useSafeArea => true;

  /// Border radius
  double get borderRadius => 16;

  /// Custom background color
  Color? get backgroundColor => null;

  /// Animation duration
  Duration get animationDuration => const Duration(milliseconds: 300);

  /// Animation curve
  Curve get animationCurve => Curves.easeOutCubic;

  /// Build modal content
  Widget build(BuildContext context);
}

enum ModalHeight {
  /// Adaptive content height
  auto,

  /// 25% of screen height
  quarter,

  /// 50% of screen height
  half,

  /// 75% of screen height
  threeQuarter,

  /// Full screen
  full,
}
```

## 3. RadixSheet — Bottom Sheet

### 3.1 Core Implementation

```dart
class RadixSheet extends StatefulWidget {
  final BaseModalConfig config;

  const RadixSheet({super.key, required this.config});

  /// Convenience display method
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

### 3.2 Built-in Drag-to-Dismiss

```dart
class _RadixSheetState extends State<RadixSheet>
    with SingleTickerProviderStateMixin {
  // ... (as above)

  /// Drag-to-dismiss gesture
  Widget _buildDraggableContent() {
    return GestureDetector(
      onVerticalDragUpdate: (details) {
        if (details.primaryDelta! > 0) {
          // Swipe down to dismiss
          _controller.value -= details.primaryDelta! / context.height;
        }
      },
      onVerticalDragEnd: (details) {
        if (_controller.value < 0.5) {
          // Close
          _controller.reverse().then((_) => Navigator.pop(context));
        } else {
          // Snap back
          _controller.forward();
        }
      },
      child: _buildSheetContent(context),
    );
  }
}
```

## 4. RadixModal — Centered Modal

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
        curve: Curves.easeOutBack, // Spring effect
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

## 5. Preset Configuration Examples

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

// Usage
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
        // Share channel grid
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

## 6. Modal Manager

### 6.1 Deduplication and Queue Management

```dart
class ModalManager {
  final Set<String> _activeModals = {};
  final Queue<BaseModalConfig> _queue = Queue();

  /// Show modal (automatic deduplication + queue)
  Future<T?> show<T>(BuildContext context, BaseModalConfig config) async {
    // Deduplication
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

  /// Delayed display (auto-shows after current modal closes)
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
      _ => RadixSheet.show<T>(context, config), // Default: bottom sheet
    };
  }
}
```

### 6.2 Global Access

```dart
extension ModalExtension on BuildContext {
  /// Show bottom sheet
  Future<T?> showSheet<T>(BaseModalConfig config) {
    return ModalManager().show<T>(this, config);
  }

  /// Show centered modal
  Future<T?> showModal<T>(BaseModalConfig config) {
    return RadixModal.show<T>(this, config);
  }

  /// Show confirmation dialog
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

## 7. Comparison Summary

| Feature | RadixSheet (Bottom) | RadixModal (Centered) | RadixFullScreen (Full) |
|---------|--------------------|----------------------|----------------------|
| **Display Method** | `showModalBottomSheet` | `showDialog` | `Navigator.push` |
| **Animation** | Slide Up + Fade | Scale + Fade (easeOutBack) | Slide Right |
| **Drag to Dismiss** | ✅ Built-in | ❌ | ❌ |
| **Use Cases** | Action lists/Forms/Selection | Confirmation/Prompt/Input | KYC/Image editing |
| **Usage Share** | ~75% | ~20% | ~5% |
| **Height Mode** | auto/quarter/half/full | auto | full |

**Core Design Principles**:
1. **Configuration-Driven**: A single `BaseModalConfig` derived class defines the complete modal behavior
2. **Consistent Animation**: All modals use the same animation parameters (duration + curve)
3. **Drag to Dismiss**: Bottom Sheet supports swipe-down gesture to close by default
4. **Deduplication**: ModalManager ensures the same id modal is not displayed repeatedly
5. **Queue**: Supports modal queuing, automatically showing the next modal after the current one closes
