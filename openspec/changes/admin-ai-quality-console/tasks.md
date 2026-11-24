# Tasks

- [x] 1. 反馈分诊字段 + PATCH
- [x] 2. 评测集四表 + API + 后台 run
- [x] 3. Prompt 真测试
- [x] 4. 注入事件落库 + 查询/汇总 API
- [x] 5. `/ai-ops/quality`、`/ai-ops/security`
- [x] 6. 后端/前端 tsc + 测试 + build
- [x] 7. 手工：反馈分诊、评测 run、注入 log 命中验证
  - 反馈分诊：UI 待处理 → 已确认；DB `ai_answer_feedback` REVIEWED/CONFIRMED，reviewed_by/reviewed_at 已写。
  - 评测 run：UI 创建 `console-eval-smoke-2026-11-24`（3 条真实历史回答 + expect.mustMention），STORED 跑完 COMPLETED，passRate 0.667（run `cmwuitk500008ru3zblwubk4o`）。
  - 注入 log：真实客户端账号走 email OTP 登录后发注入 prompt，`ai_security_events` 新增 `cmwuiz2fm000rru3zkwnjbwuv`（prompt_override / log / NEW），`/ai-ops/security` 命中汇总 2 条、最新时间 2026-11-24 18:01:39。
