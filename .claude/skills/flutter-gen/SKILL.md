---
name: flutter-gen
description: Generate Flutter components, pages, and providers following JoyMini project patterns — Riverpod state management, go_router, flutter_screenutil, custom button system
user-invocable: true
---

# flutter-gen — Flutter Component/Page Generator

You are a Flutter expert specializing in the JoyMini project patterns. Generate production-ready Flutter code following the project's established conventions.

## Source of Truth

Flutter project at `/Users/porter/Developer/JoyMini_Flutter_App/`. Before generating:
- Read `CLAUDE.md` in the Flutter project root
- Read 2-3 existing files in the target area to match exact style
- If AI/chat-related: read `docs/AI-joymini/67-AI-Chat-ChatPage-Integration-Plan.md`

## Generator Templates

### Template 1: New Page (Riverpod + GoRouter)
```
lib/ui/{feature}/{page_name}_page.dart          # Main page widget
lib/ui/{feature}/providers/{name}_provider.dart   # Riverpod provider
lib/core/store/{feature}/{name}_state.dart        # State class
```

```dart
// {page_name}_page.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';

class {FeatureName}Page extends ConsumerStatefulWidget {
  const {FeatureName}Page({super.key});
  @override
  ConsumerState<{FeatureName}Page> createState() => _{FeatureName}PageState();
}

class _{FeatureName}PageState extends ConsumerState<{FeatureName}Page> {
  @override
  Widget build(BuildContext context) {
    // Use TokensX(context) for theme colors
    // Use ScreenUtil for sizing: SizedBox(height: 16.h)
    // SafeArea / Scaffold as appropriate
  }
}
```

```dart
// {feature}_provider.dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';
part '{feature}_provider.g.dart';

@Riverpod(keepAlive: true) // for singletons
class {FeatureName} extends _${FeatureName} {
  @override
  FutureOr<{StateType}> build() async { /* init from DB or API */ }
}
```

> **Note**: `_${FeatureName}` is the riverpod_generator convention — the `$` prefix refers to the annotated class name. You MUST run `build_runner` after adding this code:
> ```bash
> cd /Users/porter/Developer/JoyMini_Flutter_App && dart run build_runner build --delete-conflicting-outputs
> ```

### Template 2: Chat Bubble Component
File at `lib/ui/chat/components/bubbles/{name}_msg_bubble.dart`:
```dart
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import '../../../models/chat_ui_model.dart';

class {Name}MsgBubble extends StatelessWidget {
  final ChatUiModel message;
  const {Name}MsgBubble({super.key, required this.message});

  @override
  Widget build(BuildContext context) {
    // Use message.isMe for alignment
    // Use flutter_screenutil for all sizes
    // Follow existing bubble patterns
  }
}
```
Then register in `chat_bubble.dart`: add import + case in `_buildContentFactory()` switch.

### Template 3: Route Registration
In `app/routes/app_router.dart`:
1. Import page as deferred library
2. Add GoRoute entry
3. For AI chat: redirect from `/ai/chat` to `/chat/room/ai_chat`

### Template 4: State Class
```dart
class {Name}State {
  final List<{ItemType}> items;
  final bool isLoading;
  final String? error;
  const {Name}State({
    this.items = const [],
    this.isLoading = false,
    this.error,
  });
  factory {Name}State.initial() => const {Name}State();
  
  {Name}State copyWith({
    List<{ItemType}>? items,
    bool? isLoading,
    String? error,
    bool clearError = false,
  }) {
    return {Name}State(
      items: items ?? this.items,
      isLoading: isLoading ?? this.isLoading,
      error: clearError ? null : (error ?? this.error),
    );
  }
}
```

### Template 5: ViewModel
```dart
class {Name}ViewModel extends StateNotifier<{Name}State> {
  final {RepoType} repository;
  {Name}ViewModel(this.repository) : super({Name}State.initial());
  Future<void> init() async { }
  Future<void> send(String msg) async { }
  void dispose() { /* cleanup */ }
}
```

## Typecheck
```bash
cd /Users/porter/Developer/JoyMini_Flutter_App && dart analyze lib/ui/{feature}/
```
Fix all issues. If using `@Riverpod()` annotation, ensure `.g.dart` files are generated:
```bash
cd /Users/porter/Developer/JoyMini_Flutter_App && dart run build_runner build --delete-conflicting-outputs
```

## Conventions Recap
- `flutter_screenutil`: always `.h`, `.w`, `.sp` — never raw doubles
- Buttons: 7-variant system from `lib/ui/button/`
- Theme: `TokensX` extension on `BuildContext`
- Part files for complex pages: `_logic.dart`, `_widgets.dart`
- Riverpod: `@Riverpod(keepAlive: true)` for singletons, `.autoDispose` for page-scoped
- GoRouter: `ShellRoute` for bottom tabs, deferred loading for most pages
