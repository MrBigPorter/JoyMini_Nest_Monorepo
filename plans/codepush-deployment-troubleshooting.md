# CodePush 自建服务部署指南 & 问题记录

## 完整部署流程

### 前置条件
- 服务器已安装 Docker 和 Docker Compose
- 域名 `codepush.joyminis.com` 已解析到服务器 IP
- SSL 证书已配置（与主站共用证书）
- 已创建 Docker 网络 `app`（`docker network create app`）

### 第 1 步：上传配置文件
将 [`compose.codepush.yml`](/compose.codepush.yml) 上传到服务器的 `/opt/lucky/` 目录。

### 第 2 步：启动服务
```bash
cd /opt/lucky
docker compose -f compose.codepush.yml up -d
```

等待约 2 分钟，确认所有容器 healthy：
```bash
docker ps --format "table {{.Names}}\t{{.Status}}"
# 应看到：
# lucky-codepush-prod    Up ... (healthy)
# lucky-codepush-mysql   Up ... (healthy)
# lucky-codepush-redis   Up ... (healthy)
```

### 第 3 步：将 Nginx 接入共享网络
如果 Nginx 容器（`lucky-nginx-prod`）不在 `app` 网络，连接它：
```bash
docker network connect app lucky-nginx-prod
docker exec lucky-nginx-prod nginx -s reload
```

### 第 4 步：创建管理员账号
```bash
docker exec -it lucky-codepush-prod sh -c 'node -e "
var s = require(\"/usr/local/lib/node_modules/code-push-server/core/utils/security\");
var models = require(\"/usr/local/lib/node_modules/code-push-server/models\");
models.Users.create({
  email: \"admin@example.com\",
  username: \"your-username\",
  password: s.passwordHashSync(\"your-password\"),
  identical: s.randToken(9)
}).then(function(u) {
  console.log(\"Admin created: id=\" + u.id + \", email=\" + u.email);
}).catch(function(e) {
  console.log(\"Error:\", e.message || e);
});
"'
```

### 第 5 步：验证
```bash
curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "account=admin@example.com&password=your-password"
# 应返回包含 "accessToken" 的 JSON
```

### 第 6 步：浏览器访问
打开 `https://codepush.joyminis.com`，用刚才创建的账号登录。

### 日常管理
- **启动**: `docker compose -f compose.codepush.yml up -d`
- **停止**: `docker compose -f compose.codepush.yml down`
- **完全重启（清数据）**: `docker compose -f compose.codepush.yml down -v && docker compose -f compose.codepush.yml up -d`
- **查看日志**: `docker compose -f compose.codepush.yml logs -f`

---

## 部署问题记录

### 1. `compose.codepush.yml` 配置问题

#### 1.1 MySQL 5.7 → 8.0 升级
- **问题**: 原配置使用 MySQL 5.7（已 EOL），且有兼容性问题
- **解决**: 升级到 `mysql:8.0`，但需添加 `command: --default-authentication-plugin=mysql_native_password`

#### 1.2 MySQL 8.0 认证协议不兼容
- **问题**: 旧版 Sequelize v4.44.4 的 mysql2 驱动不支持 MySQL 8.0 默认的 `caching_sha2_password`
- **症状**: `ER_NOT_SUPPORTED_AUTH_MODE` 错误
- **解决**: 在 MySQL 服务添加 `command: --default-authentication-plugin=mysql_native_password`

#### 1.3 code-push-server 不支持 MySQL 密码
- **问题**: `code-push-server-db init` CLI 无 `--password` 参数，服务运行时也以 `(using password: NO)` 连接
- **解决**: 使用 `MYSQL_ALLOW_EMPTY_ROOT_PASSWORD: "yes"`（容器仅在内部 Docker 网络暴露，安全）

#### 1.4 Redis 4.0 版本过旧
- **问题**: 原配置使用 Redis 4.0，功能和安全不完善
- **解决**: 升级到 `redis:7-alpine`

#### 1.5 缺少 Healthcheck
- **问题**: 所有服务缺少健康检查
- **解决**: 为 MySQL、Redis、code-push-server 均添加 healthcheck，并配置 `depends_on` 的 `condition: service_healthy`

#### 1.6 node:18-alpine 无 openssl
- **问题**: `node:18-alpine` 镜像不含 `openssl` 二进制
- **症状**: `openssl: not found`
- **解决**: 使用 Node.js crypto 模块生成 TOKEN_SECRET：
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('base64').replace(/[^A-Za-z0-9]/g,'').slice(0,63))"
  ```

#### 1.7 MySQL 就绪等待逻辑 Bug
- **问题**: 原始 for 循环中 `done && exit 1` 因 `break` 返回 0 而总是执行
- **解决**: 使用 flag 变量方案：
  ```bash
  mysql_ready=false
  for i in $(seq 1 30); do
    if [ connection test succeeds ]; then
      mysql_ready=true
      break
    fi
    sleep 2
  done
  if [ "$mysql_ready" = false ]; then exit 1; fi
  ```

### 2. VPS 部署问题

#### 2.1 502 Bad Gateway - Nginx 不在共享网络
- **问题**: 访问 `https://codepush.joyminis.com` 返回 502
- **原因**: `lucky-nginx-prod` 容器未连接到 `app` 网络
- **解决**: 
  ```bash
  docker network connect app lucky-nginx-prod
  docker exec lucky-nginx-prod nginx -s reload
  ```
- **持久化修复**: 在 `compose.prod.yml` 的 nginx 服务中添加 `networks: [app]`

#### 2.2 MySQL 5.7 旧数据卷不兼容
- **问题**: 升级 MySQL 5.7 → 8.0 后，旧数据卷中的系统表导致 Duplicate entry 错误
- **解决**: 清理旧卷重新初始化
  ```bash
  docker compose -f compose.codepush.yml down -v
  docker compose -f compose.codepush.yml up -d
  ```

### 3. 管理员账号问题

#### 3.1 SQL INSERT 操作导致 bcrypt hash 损坏
- **问题**: 通过 shell 执行 SQL INSERT 时，bcrypt hash 中的 `$` 符号被 bash 解释为变量
- **症状**: 用户行创建成功，但密码验证失败（"您输入的邮箱或密码有误"）
- **解决**: 使用 Node.js 在容器内部调用 code-push-server 的 `security.passwordHashSync()` 方法

#### 3.2 修改管理员账号
- **解决**: 使用 Node.js 在容器内更新用户记录：
  ```bash
  docker exec -it lucky-codepush-prod sh -c 'node -e "
  var s = require(\"/usr/local/lib/node_modules/code-push-server/core/utils/security\");
  var models = require(\"/usr/local/lib/node_modules/code-push-server/models\");
  models.Users.update(
    {
      username: \"新用户名\",
      password: s.passwordHashSync(\"新密码\")
    },
    { where: { email: \"admin@example.com\" } }
  ).then(function(r) {
    console.log(\"Updated:\", r[0] > 0 ? \"OK\" : \"User not found\");
  }).catch(function(e) {
    console.log(\"Error:\", e.message);
  });
  "'
  ```

### 4. 最终架构

```
用户 → DNS → Nginx (lucky-nginx-prod, 443/80)
                ↓  (网络: app)
         code-push-server (lucky-codepush-prod, port 3000)
                ↓                    ↓
         MySQL (lucky-codepush-mysql)   Redis (lucky-codepush-redis)
```

- 所有服务在同一 Docker 网络 `app` 中
- Nginx 反向代理到 `http://codepush:3000`，使用 `resolver 127.0.0.11` 动态 DNS 解析
