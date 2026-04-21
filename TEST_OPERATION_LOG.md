# Test Operation Log

## 已有记录（Operation Log）

### 后端 Service 单测

**文件**: `apps/api/src/admin/operation-log/operation-log.service.spec.ts`

**覆盖场景**:

- 基本分页查询
- 按管理员ID过滤
- 按操作类型过滤
- 忽略 `ALL` 操作类型
- 关键词搜索（描述、目标ID、用户名）
- 日期范围过滤
- 分页计算
- 多重过滤组合

## Phase 6 单元测试补全（2026-03-18）

### Admin 前端 — LoginLogList

**文件**: `apps/admin-next/src/__tests__/views/LoginLogList.test.tsx`

**本次总结**:

- 空态渲染：无数据时显示 `No login logs found`
- 列表渲染：校验用户、IP、状态、设备等关键字段展示
- 筛选交互：输入 `User ID / IP / Status` 后点击 `Search`，断言请求参数更新
- 刷新交互：点击刷新按钮触发 `useRequest.run`

**执行命令**:

```bash
cd /Volumes/MySSD/work/dev/lucky_nest_monorepo
yarn workspace @lucky/admin-next test src/__tests__/views/LoginLogList.test.tsx
```

**结果**:

- `4/4` tests passed
