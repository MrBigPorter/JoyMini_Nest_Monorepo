# Spec Delta

## Purpose

规定知识文档正文写入的版本化契约，使每次内容变化都能被识别、回滚与比对，而纯元数据操作不会伪装成语料变化。

## ADDED Requirements

### Requirement: 正文每次写入必须刷新内容哈希

系统 SHALL 在每条正文写入路径（上传、内容更新、管理端编辑）同步写入 `contentHash = sha256(规范化后正文)`；MUST NOT 只在生成候选或首次入库时写入。

#### Scenario: 上传新文档

- **WHEN** 运营上传或替换一份文档正文
- **THEN** 该文档的 `contentHash` 等于本次正文的 sha256

#### Scenario: 更新正文

- **WHEN** 运营通过内容更新接口修改正文
- **THEN** `contentHash` 随新正文刷新，旧值不再残留

#### Scenario: 只改元数据

- **WHEN** 运营只修改名称、关键词或分类
- **THEN** `contentHash` 保持不变

### Requirement: 文档业务键创建后不可变

系统 SHALL 在文档创建后拒绝修改 `docId` 与 `locale`；请求 MUST 返回可读错误并说明业务键不可变。

#### Scenario: 尝试改 docId

- **WHEN** 调用方提交不同的 `docId`
- **THEN** 请求被拒绝，已有文档与用例映射不受影响

#### Scenario: 尝试改 locale

- **WHEN** 调用方提交不同的 `locale`
- **THEN** 请求被拒绝，并提示用新文档承载另一种语言

### Requirement: 正文更新必须保留旧版本

系统 SHALL 以追加新版本的方式更新正文，并在保留期内保留旧版本分块；MUST NOT 先删除旧分块再重建。回滚 SHALL 能在保留期内恢复上一激活版本。

#### Scenario: 更新后可回滚

- **WHEN** 正文更新完成且尚未超过保留期
- **THEN** 上一版本的分块仍可读取，可执行回滚

#### Scenario: 更新不销毁回滚窗口

- **WHEN** 运营通过内容更新接口修改正文
- **THEN** 旧版本分块保留至保留期结束，不因更新被立即删除

### Requirement: 元数据编辑不得产生新内容版本

系统 SHALL 将名称、关键词、分类等元数据编辑与正文版本分离；只改元数据 MUST NOT 递增正文版本、重建分块或改变语料指纹。

#### Scenario: 编辑关键词

- **WHEN** 运营只修改文档关键词
- **THEN** 正文版本与语料指纹均保持不变

#### Scenario: 编辑名称

- **WHEN** 运营只修改文档名称
- **THEN** 不触发重新切片或重新嵌入
