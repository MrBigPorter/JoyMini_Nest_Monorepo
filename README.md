# Lucky Nest Monorepo

这是 Lucky Nest 的生产仓库（Yarn Workspace + Turborepo）。

## 新人先读这 3 份

- 部署快启（Cloudflare Admin + VPS API）：`read/DEPLOY_QUICKSTART_CN.md`
- 发布与回滚手册（运维细节）：`RUNBOOK.md`
- 架构总览（全景理解）：`ARCHITECTURE_CN.md`

## 当前生产形态

- `admin.joyminis.com`：Cloudflare Workers 托管 `apps/admin-next`
- `api.joyminis.com`：VPS Docker 运行 Nest API（Nginx API-only）
- WebSocket：`wss://api.joyminis.com/socket.io/`

## 本地常用命令

```bash
yarn dev
yarn build
yarn docker:up
yarn docker:down
```

## 部署相关命令

```bash
yarn deploy:backend
yarn switch:admin:dns
yarn switch:admin:dns:execute
yarn rollback:admin:dns
yarn rollback:admin:dns:execute
```

```bash
epomix（原名 ai-digest）是一个专门为大模型准备代码的工具。它会自动遍历你所有的代码，生成一个项目的文件目录树，然后把所有前端、后端、脚本的核心源码合并成一个 repomix-output.txt 文件。
npx repomix --ignore "**/.next/**,**/.open-next/**,**/node_modules/**,**/dist/**,**/.git/**,**/*.log,**/certs/**"
```
