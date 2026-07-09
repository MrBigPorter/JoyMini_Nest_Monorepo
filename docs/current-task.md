# Current Task — ✅ 全屏 Diff 重写: Inline 高亮 + 点击编辑

**目标**: 全屏 Review 页面重写，解决"diff 看不到"问题 + 支持点击 diff 段编辑  
**参考文档**: `docs/AI-joymini/62-Enterprise-Parse-Quality-Dual-Source-Architecture.md`  
**Last Update**: 2026-07-09

---

## ✅ 完成内容

### 新增文件
| 文件 | 说明 |
|------|------|
| `apps/admin-next/src/components/knowledge/DiffReviewFull.tsx` | **580 行**全新全屏 diff review 组件，替代旧的 `QualityReviewPanelFull` |

### 修改文件
| 文件 | 改动 |
|------|------|
| `apps/admin-next/src/app/(dashboard)/knowledge/documents/[id]/review/page.tsx` | 删除旧的 `QualityReviewPanelFull`，使用 `DiffReviewFull` |
| `apps/api/src/admin/rag/rag-quality.service.ts` | `detectNumberErrors()` 智能对齐算法，减少日期格式误报 |
| `apps/admin-next/src/type/types.ts` | `NumberError.severity` 类型扩展为 `'critical' \| 'minor'` |

### DiffReviewFull 功能列表

1. **Inline diff 高亮** — 右侧内容区直接显示 diff 差异颜色标记
   - 🔴 红色背景 = critical 差异（可能含数字错误）
   - 🟡 黄色背景 = minor 差异（格式、空白）
   - 🟢 绿色背景 = ignore 差异（纯空白变化）
   - 文本自身也带颜色和下划线/删除线标记

2. **点击 diff 段编辑** — 点击任意 colored 段打开内联编辑器
   - 只编辑被点击的 diff 段，不干扰其他内容
   - 编辑后自动重组全文
   - Confirm/Cancel 按钮

3. **同步滚动** — 左右两栏自动同步滚动位置

4. **Diff 鸟瞰图** — 左侧窄条显示 diff 密度分布
   - 红/黄/绿/灰 像素条对应 diff 段
   - 点击跳转到对应位置

5. **数字错位智能检测**（后端）
   - 检测连续错位模式（offset drift）
   - 年份/月份格式差异自动降级为 minor
   - 真正的内容数字（金额、百分比）保持 critical

6. **Number Errors 面板**（底部折叠）
   - 列出所有数字错位
   - 每个可单独 Fix

7. **"Only diffs" 过滤开关** — 只显示有差异的段

8. **Save Changes 按钮** — 保存整篇修改后内容 → PATCH API → 触发重新切片+向量化

### 验收状态
- [x] Backend + Frontend 编译通过（`tsc --noEmit` 零错误）
- [x] 右侧内容区 inline 显示 diff 差异颜色标记
- [x] 点击 colored diff 段打开内联编辑器
- [x] 左右栏同步滚动
- [x] 左侧鸟瞰图显示 diff 分布
- [x] 数字检测智能对齐，日期格式不再造成大量误报
- [x] "Only diffs" 过滤开关
- [x] Save Changes 按钮

### 未完成（后续）
- [ ] 数字错位的完整上下文对齐（current 算法还是基于位置漂移检测，可以进一步用 NLP）
- [ ] P3: 多模态深度检查（GPT-4o/Gemini Vision）
- [ ] Golden dataset 回归测试
