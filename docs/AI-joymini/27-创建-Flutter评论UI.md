# 27. 创建 Flutter 评论 UI

> **系列**: JoyMini 电商评论 + AI 审核功能
> **前置步骤**: [26. 创建 Admin 评论审核面板](26-创建-Admin评论审核面板.md)
> **下一步**: [28. 实现评论分析与统计](28-实现-评论分析与统计.md)
> **对应代码**: `/Users/porter/Developer/JoyMini_Flutter_App`（独立仓库）

---

## 🎯 本步骤目标

1. 在产品详情页添加评论展示区（星级 + 列表 + 排序）
2. 创建评论提交表单（星级选择 + 文字 + 图片上传）
3. 实现"有帮助"按钮交互

完成本步骤后，用户可以在 Flutter 客户端查看和提交产品评论。

---

## 📖 开发背景

### 承上：上一步做了什么？

[26-创建-Admin评论审核面板.md](26-创建-Admin评论审核面板.md) 完成了：
- Admin 后端 API（列表/审核/回复）
- Admin 前端 React 组件（列表 + 审核弹窗 + 回复编辑）

### 这一步要解决的问题

管理后台可以管理评论了，但用户在手机上还看不到评论、不能写评论。
需要实现 Flutter 端的评论 UI。

### 设计决策

| 决策点 | 选项 | 选择 | 原因 |
|--------|------|------|------|
| 评论列表位置 | 独立页面 / 产品详情页内 | **详情页内嵌 + 独立页面** | 详情页展示前几条，"查看全部"跳转独立页面 |
| 排序方式 | 仅最新 / 多种 | **最有帮助 > 最新 > 最高评分** | 高质量评论优先展示 |
| 图片上传 | 相册 / 相机 / 两者 | **相册（最多5张）** | 评论场景以相册为主 |
| 状态反馈 | Toast / 内联 | **Toast + 状态文字** | 提交后显示"审核中"，通过后更新 |

---

## ⚙️ 前置条件

- [x] Step 26 已完成（Admin 面板）
- [x] Flutter 项目路径：`/Users/porter/Developer/JoyMini_Flutter_App`
- [x] API 端点已就绪（`/client/product-reviews` 系列）

---

## 📝 实现步骤

### Step 1: 评论列表组件

**文件**: `lib/widgets/product/review_list_widget.dart`

```dart
class ReviewListWidget extends StatefulWidget {
  final String productId;
  final bool showHeader; // 在详情页内嵌时显示标题行
}

// 组件结构:
// ⭐ 4.5 (128 reviews)              ← 标题行（showHeader=true）
// ┌─────────────────────────────────┐
// │ 👤 John D.  ⭐⭐⭐⭐⭐  2 days ago│
// │ 非常好的产品，朋友推荐来买的     │
// │ [img1] [img2]                    │
// │ 👍 Helpful (12)   Reply: 感谢...│
// ├─────────────────────────────────┤
// │ 👤 Jane S.  ⭐⭐⭐⭐    5 days ago│
// │ 产品不错，物流也快              │
// │ 👍 Helpful (8)                   │
// └─────────────────────────────────┘
// [  View All 128 Reviews →  ]       ← showHeader=true
// [  Write a Review  ]               ← 按钮
```

**状态管理**：
- 使用现有 API 客户端调用 `GET /client/product-reviews/:productId`
- 支持分页加载（滑到底部加载更多）
- 支持排序切换：Most Helpful | Newest | Highest Rated

---

### Step 2: 评论提交表单

**文件**: `lib/widgets/product/review_form_widget.dart`

```dart
class ReviewFormWidget extends StatefulWidget {
  final String productId;
  final String? orderId; // 可选，从订单页面跳转时传入
}

// 表单结构:
// ┌─ Write a Review ─────────────────┐
// │                                  │
// │  Tap to rate:                    │
// │  [☆] [☆] [☆] [☆] [☆]          │
// │                                  │
// │  Your review:                    │
// │  ┌──────────────────────────┐    │
// │  │ Share your experience... │    │
// │  └──────────────────────────┘    │
// │                                  │
// │  Add photos (optional):          │
// │  [✚ Add] [img1] [img2]          │
// │                                  │
// │  [     Submit Review      ]      │
// └──────────────────────────────────┘
```

**交互逻辑**：
1. 星级选择：点击星形图标，1-5 星
2. 文字输入：最少 10 个字符，显示字数统计
3. 图片上传：从相册选择（最多 5 张），可预览和删除
4. 提交按钮：调用 `POST /client/product-reviews`
5. 提交后 Toast "评论已提交，等待审核"
6. 如果传了 `orderId`，提交后自动填充

---

### Step 3: 集成到产品详情页

**在哪里改**：产品详情页 (ProductDetailScreen)

```dart
// 在详情页底部添加评论区域
Scaffold(
  body: CustomScrollView(
    slivers: [
      // ... 现有产品信息 ...
      SliverToBoxAdapter(
        child: ReviewListWidget(
          productId: productId,
          showHeader: true, // 显示 "4.5 ⭐ (128 reviews)" 标题
        ),
      ),
    ],
  ),
  // 底部固定按钮
  bottomNavigationBar: SafeArea(
    child: Padding(
      padding: EdgeInsets.all(16),
      child: ElevatedButton(
        onPressed: () => _showReviewForm(context),
        child: Text('Write a Review'),
      ),
    ),
  ),
);
```

---

### Step 4: 有帮助按钮功能

在评论列表的每条评论底部添加：

```dart
Row(
  children: [
    IconButton(
      icon: Icon(Icons.thumb_up_outlined),
      onPressed: () => markHelpful(review.id),
    ),
    Text('${review.helpfulCount}'),
    Spacer(),
    if (review.replyContent != null)
      Text('Merchant reply', style: TextStyle(color: Colors.grey)),
  ],
)
```

调用 `POST /client/product-reviews/:id/helpful`，成功后更新本地计数。

---

## ✅ 验收方式

### 手动验证（在模拟器或真机上）

1. 打开产品详情页 → 看到评论区域（或"暂无评论"占位）
2. 点击 "Write a Review" → 打开评论表单
3. 选择 5 星 → 输入内容 → 提交 → 看到 "评论已提交，等待审核" 提示
4. 回到产品详情页 → 如果评论已通过 AI 审核 → 显示在列表中
5. 点击 "Helpful" 按钮 → 计数 +1
6. 切换到 "Newest" 排序 → 评论按最新排序

---

## 🔜 下一步预告

下一步：[28. 实现评论分析与统计](28-实现-评论分析与统计.md)

Flutter UI 已就绪，用户可以评论了。下一步将实现：
- 产品平均评分 + 评论数缓存到 Treasure 表
- Admin 评论统计面板
- AI 审核质量监控
