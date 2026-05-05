# 评论管理页面 Bug 修复计划

## 问题 1：Approve/Reject 评论返回 404

**根因**：HTTP 方法不匹配。

- 前端 [`api/index.ts:325-330`](../apps/admin-blog/src/api/index.ts:325-330) 使用 `http.post()`（POST 方法）
- 后端 [`comment.controller.ts:76,83`](../apps/api/src/blog/comment/comment.controller.ts:76) 使用 `@Patch(':id/approve')` 和 `@Patch(':id/reject')`（PATCH 方法）

**修复**：将 [`api/index.ts:326,330`](../apps/admin-blog/src/api/index.ts:326) 的 `http.post` 改为 `http.patch`。

```diff
   approveComment: async (id: string) => {
-    return await http.post<any>(`/v1/admin/blog/comments/${id}/approve`);
+    return await http.patch<any>(`/v1/admin/blog/comments/${id}/approve`);
   },
   rejectComment: async (id: string) => {
-    return await http.post<any>(`/v1/admin/blog/comments/${id}/reject`);
+    return await http.patch<any>(`/v1/admin/blog/comments/${id}/reject`);
   },
```

## 问题 2：删除评论弹窗中 i18n key 显示为原文

**根因**：评论页面 [`comments/page.tsx:43-46`](../apps/admin-blog/src/app/(dashboard)/blog/comments/page.tsx:43-46) 自定义 `t` 函数给所有 key 加了 `blog_comments_` 前缀，但以下 3 个 key 在所有 6 个 locale 文件中均缺失：

| 代码用法 | 实际 key | 状态 |
|---------|---------|------|
| `t('cancel')` | `blog_comments_cancel` | ❌ 缺失 |
| `t('deleteConfirmText')` | `blog_comments_deleteConfirmText` | ❌ 缺失 |
| `t('actionCannotBeUndone')` | `blog_comments_actionCannotBeUndone` | ❌ 缺失 |

**修复**：在以下 6 个 locale 文件中各添加 3 个缺失条目：

### en.json
```json
"blog_comments_cancel": "Cancel",
"blog_comments_deleteConfirmText": "Are you sure you want to delete this comment?",
"blog_comments_actionCannotBeUndone": "This action cannot be undone."
```

### zh.json
```json
"blog_comments_cancel": "取消",
"blog_comments_deleteConfirmText": "确定要删除此评论吗？",
"blog_comments_actionCannotBeUndone": "此操作不可撤销。"
```

### ja.json
```json
"blog_comments_cancel": "キャンセル",
"blog_comments_deleteConfirmText": "このコメントを削除してもよろしいですか？",
"blog_comments_actionCannotBeUndone": "この操作は元に戻せません。"
```

### ko.json
```json
"blog_comments_cancel": "취소",
"blog_comments_deleteConfirmText": "이 댓글을 삭제하시겠습니까？",
"blog_comments_actionCannotBeUndone": "이 작업은 되돌릴 수 없습니다."
```

### fr.json
```json
"blog_comments_cancel": "Annuler",
"blog_comments_deleteConfirmText": "Êtes-vous sûr de vouloir supprimer ce commentaire ?",
"blog_comments_actionCannotBeUndone": "Cette action est irréversible."
```

### de.json
```json
"blog_comments_cancel": "Abbrechen",
"blog_comments_deleteConfirmText": "Sind Sie sicher, dass Sie diesen Kommentar löschen möchten?",
"blog_comments_actionCannotBeUndone": "Diese Aktion kann nicht rückgängig gemacht werden."
```

## 执行顺序

1. 修改 [`api/index.ts`](../apps/admin-blog/src/api/index.ts) — 将 `http.post` 改为 `http.patch`（2 行）
2. 修改 6 个 locale JSON 文件，各加 3 个翻译条目（18 行新增）
3. 验证：lint + 类型检查
