# Spec Delta

## MODIFIED Requirements

### Requirement: 管理端页面必须如实呈现失败、禁用与未知

页面 SHALL 区分「加载中」「已禁用（无权限或开关关闭）」「请求失败」「无数据」四种状态；空值与未知 SHALL 显示为「未知」或「未检查」。外部运行的覆盖率与跨运行抖动 SHALL 按服务端口径呈现，不得另算；历史运行缺少这些字段时 MUST 显示「未记录」，MUST NOT 显示 0 或「暂无」。MUST NOT 把 403 吞成成功或 `undefined`，MUST NOT 用 0 或「暂无」代替未知，MUST NOT 把前端推断当作后端事实。

#### Scenario: 无权限访问

- **WHEN** 当前角色无权访问某写操作或评测开关关闭
- **THEN** 页面 MUST 显示禁用态与原因，MUST NOT 渲染写入口或成功提示

#### Scenario: 指标未知

- **WHEN** 后端未返回某指标或请求失败
- **THEN** 页面 MUST 显示「未知」或「未检查」，MUST NOT 显示 0

#### Scenario: 前端推断

- **WHEN** 页面根据现有字段推断出某结论
- **THEN** 该结论 MUST 标注「推断」，MUST NOT 与后端事实同等呈现

#### Scenario: 历史运行缺少覆盖率

- **WHEN** 某次运行未记录覆盖率或判定翻转率
- **THEN** 页面 MUST 显示「未记录」，MUST NOT 显示 0、MUST NOT 用其他字段推算

#### Scenario: 两次运行不可比

- **WHEN** 差异接口返回不可比原因
- **THEN** 页面 MUST 展示原因，MUST NOT 渲染差异数字
