# 管理端写操作与数据流模式

> 设计依据：`openspec/changes/admin-frontend-closure/`（design D2/D3/D6，spec `admin/data-flow`）

## 一句话规则

- **非资金写操作**：`useMutation` + `onMutate` 乐观更新，失败回滚；
- **资金写操作**（提现审核、余额调整）：`useMutation` 但**不乐观**，提交中保持 loading，成功后才更新；
- 成功后两层失效：React Query 缓存 + Next Data Cache（Server Action `revalidateTag`）；
- 列表筛选与页码以 URL 为唯一来源。

## 可复制范例（非资金类，乐观更新）

```tsx
const queryClient = useQueryClient();
const queryKey = usersListQueryKey(queryInput); // 与 page.tsx 预取一致

const mutation = useMutation({
  mutationFn: (vars: { id: string; status: 0 | 1 }) =>
    clientUserApi.updateUser(vars.id, { status: vars.status }),

  onMutate: async (vars) => {
    await queryClient.cancelQueries({ queryKey });
    const previous = queryClient.getQueryData(queryKey);
    queryClient.setQueryData(queryKey, (old) =>
      old
        ? {
            ...old,
            data: old.data.map((u) =>
              u.id === vars.id ? { ...u, status: vars.status } : u,
            ),
          }
        : old,
    );
    return { previous, queryKey };
  },

  onError: (_err, _vars, ctx) => {
    if (ctx?.previous) queryClient.setQueryData(ctx.queryKey, ctx.previous);
    addToast('error', t('users_toastOperationFailed'));
  },

  onSuccess: async () => {
    await revalidateUsersList(); // Server Action: revalidateTag
    await refetch();             // 本地查询缓存
  },
});
```

## 资金类（保守，不做乐观）

```tsx
const auditMutation = useMutation({
  mutationFn: (status: WithdrawStatus) =>
    financeApi.withdrawalsAudit({ withdrawId, status, remark }),
  onSuccess: () => {
    void revalidateFinanceAfterWithdrawAudit();
    confirmAction();
  },
  onError: (error) => {
    const status = (error as { response?: { status?: number } }).response?.status;
    if (!status || status >= 500) {
      addToast('error', t('finance.withdrawAudit.auditFailed'));
    }
    // 4xx 由 HTTP 拦截器统一提示
  },
});
const loading = auditMutation.isPending;
```

关键点：**没有 `onMutate`**；失败时列表保持原样，弹窗不关闭。

## 缓存失效对照

| 页面 | Server Action | Tag |
|---|---|---|
| 用户 | `revalidateUsersList` | `users:list` + `dashboard:stats` |
| 订单 | `revalidateOrdersList` | `orders:list` + `dashboard:orders` |
| 财务 | `revalidateFinanceAfterWithdrawAudit` 等 | `finance*` + `dashboard:stats` |

只失效受影响的 tag；不要调用 `revalidatePath('/')` 之类的全站失效。

## 表格取数（SmartTable）

财务审核页使用统一查询模式：

```tsx
const withdrawalsQuery = {
  queryKey: (state) => withdrawalsListQueryKey(toWithdrawalsQueryInput(state)),
  queryFn: async (state) => {
    const res = await financeApi.getWithdrawals(
      buildWithdrawalsListParams(toWithdrawalsQueryInput(state)),
    );
    return { data: res.list, total: res.total };
  },
};

<SmartTable query={withdrawalsQuery} ... />
```

传了 `query` 后 SmartTable 内部不再调用 `fetchData`；首屏注水与翻页共用同一 queryKey。
未传 `query` 的页面仍走 `request`，行为不变。

## 翻页与 URL

翻页会通过 `onParamsChange` 把 `page/pageSize` 写回 URL；页面组件初始化时从
`initialFormParams` 恢复页码。刷新、前进后退、分享链接都能得到相同视图。

## 检查清单

- [ ] 非资金写操作有 `onMutate` / `onError` / `onSuccess` 三段
- [ ] 资金写操作没有 `onMutate`，失败不关弹窗、列表不变
- [ ] `onSuccess` 同时调用 Server Action 与本地 refetch
- [ ] 没有全站失效
- [ ] 请求失败时用户能看到提示
