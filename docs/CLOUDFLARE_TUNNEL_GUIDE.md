# Cloudflare Tunnel 实战指南

## 目录

1. [安装 cloudflared](#1-安装-cloudflared)
2. [临时测试（最快）](#2-临时测试最快)
3. [永久域名配置](#3-永久域名配置)
4. [故障排除](#4-故障排除)
5. [常见问题](#5-常见问题)

---

## 1. 安装 cloudflared

### macOS

```bash
brew install cloudflare/cloudflare/cloudflared
```

### Linux

```bash
# Ubuntu/Debian
wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared-linux-amd64.deb

# 其他系统：https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
```

### 验证安装

```bash
cloudflared --version
```

---

## 2. 临时测试（最快）

### 场景：只想让手机访问本地开发环境

#### 步骤1：启动本地服务

```bash
cd apps/frontend-blog
yarn dev
# 服务运行在 http://localhost:3002
```

#### 步骤2：启动临时隧道

```bash
# 新开一个终端
cloudflared tunnel --url http://localhost:3002
```

#### 步骤3：获取临时域名

命令输出类似：

```
2026-04-22T04:00:00Z INF | Your quick Tunnel is available at https://abc123.trycloudflare.com
```

#### 步骤4：手机访问

- 在手机浏览器打开：`https://abc123.trycloudflare.com`
- 所有人都能访问这个域名
- 自动HTTPS，无需配置

#### 停止临时隧道

```bash
# 按 Ctrl+C 停止
```

---

## 3. 永久域名配置

### 场景：使用固定域名（如 dev.joyminis.com）

#### 3.1 解决证书冲突（如果遇到）

```bash
# 如果 cloudflared tunnel login 报错证书冲突
mv ~/.cloudflared/cert.pem ~/.cloudflared/cert.pem.backup
```

#### 3.2 登录授权

```bash
cloudflared tunnel login
# 会打开浏览器，选择 joyminis.com 并授权
```

#### 3.3 检查现有隧道

```bash
# 列出所有隧道
cloudflared tunnel list

# 检查具体隧道
cloudflared tunnel info lucky-nest-monorepo
```

#### 3.4 启动隧道

```bash
# 停止现有进程
pkill cloudflared

# 用项目配置启动
cloudflared tunnel --config cloudflared.yml run lucky-nest-monorepo &
```

#### 3.5 验证连接

```bash
# 等待5秒
sleep 5

# 检查隧道状态
cloudflared tunnel info lucky-nest-monorepo
# 应该显示有活跃连接
```

#### 3.6 测试域名

```bash
# 测试前端博客
curl -s -o /dev/null -w "%{http_code}\n" https://dev.joyminis.com
# 应该返回 307

# 测试其他服务
curl -I https://dev.admin.joyminis.com
curl -I https://dev.api.joyminis.com
curl -I https://dev.liveness.joyminis.com
```

---

## 4. 故障排除

### 问题1：Tunnel没有活动连接

```bash
# 症状：cloudflared tunnel info 显示 "does not have any active connection"

# 解决方法：
pkill cloudflared
sleep 3
cloudflared tunnel --config cloudflared.yml run lucky-nest-monorepo &
sleep 10
cloudflared tunnel info lucky-nest-monorepo
```

### 问题2：本地服务没运行

```bash
# 症状：隧道启动但访问返回错误

# 检查本地服务
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3002
# 应该返回 307

# 如果没运行，启动服务：
cd apps/frontend-blog
yarn dev
```

### 问题3：DNS没有传播

```bash
# 症状：电脑能访问，手机访问不了

# 检查DNS解析
dig dev.joyminis.com +short
# 应该显示 Cloudflare IP：172.67.162.197 和 104.21.15.141

# 临时解决方案：用临时域名
cloudflared tunnel --url http://localhost:3002
```

### 问题4：端口被占用

```bash
# 症状：启动服务失败

# 检查端口占用
lsof -i :3002

# 停止占用进程
kill -9 <PID>

# 或者换端口（修改 cloudflared.yml 和 package.json）
```

---

## 5. 常见问题

### Q1：为什么要用Cloudflare Tunnel？

- **手机测试**：iPhone可以直接访问开发中的网站
- **无需公网IP**：不用配置路由器端口转发
- **自动HTTPS**：不用自己搞SSL证书
- **免费**：Cloudflare免费套餐够用

### Q2：临时域名和永久域名有什么区别？

| 特性     | 临时域名              | 永久域名           |
| -------- | --------------------- | ------------------ |
| 配置难度 | 简单                  | 中等               |
| 域名     | `*.trycloudflare.com` | `dev.joyminis.com` |
| 有效期   | 临时                  | 永久               |
| 需要登录 | 否                    | 是                 |
| DNS配置  | 自动                  | 需要配置           |

### Q3：隧道启动后，修改代码需要重启吗？

**不需要**：

- 修改前端代码：Next.js热重载自动生效
- 修改隧道配置：需要重启隧道
- 修改本地服务端口：需要更新配置并重启

### Q4：如何查看隧道日志？

```bash
# 查看实时日志
cloudflared tunnel --config cloudflared.yml run lucky-nest-monorepo

# 或者查看系统日志
journalctl -u cloudflared -f
```

### Q5：多个服务如何配置？

查看 `cloudflared.yml`：

```yaml
ingress:
  - hostname: dev.joyminis.com # 前端博客
    service: http://localhost:3002

  - hostname: dev.admin.joyminis.com # 管理后台
    service: http://localhost:3001

  - hostname: dev.api.joyminis.com # API服务
    service: http://localhost:3002

  - hostname: dev.liveness.joyminis.com # 健康检查
    service: http://localhost:3003
```

### Q6：如何停止所有隧道？

```bash
# 停止所有cloudflared进程
pkill cloudflared

# 验证是否停止
ps aux | grep cloudflared | grep -v grep
```

---

## 配置文件说明

### cloudflared.yml

```yaml
tunnel: 99013629-f033-4fd0-9bef-640142a1d950 # 隧道ID
credentials-file: ~/.cloudflared/99013629-f033-4fd0-9bef-640142a1d950.json

ingress:
  - hostname: dev.joyminis.com
    service: http://localhost:3002
  # ... 其他服务配置
```

### 获取隧道ID

```bash
# 创建新隧道
cloudflared tunnel create my-tunnel-name
# 输出中的 Tunnel ID 就是需要的ID

# 或者查看现有隧道
cloudflared tunnel list
```

---

## 快速参考命令

### 日常使用

```bash
# 启动开发服务 + 隧道
cd apps/frontend-blog
yarn dev:app

# 只启动隧道
cloudflared tunnel --config cloudflared.yml run lucky-nest-monorepo &

# 检查状态
cloudflared tunnel info lucky-nest-monorepo

# 测试访问
curl -I https://dev.joyminis.com
```

### 调试命令

```bash
# 查看隧道列表
cloudflared tunnel list

# 查看隧道详细信息
cloudflared tunnel info <tunnel-name>

# 查看连接状态
cloudflared tunnel connections list <tunnel-name>

# 删除隧道（谨慎使用）
cloudflared tunnel delete <tunnel-name>
```

---

## 注意事项

1. **本地服务必须运行**：隧道只是代理，本地开发服务必须已经启动
2. **防火墙设置**：确保本地端口（3002）没有被防火墙阻挡
3. **网络环境**：某些公司网络可能屏蔽Cloudflare服务
4. **证书更新**：Cloudflare证书自动更新，一般无需手动干预
5. **多设备登录**：同一账号可以在多台设备登录，隧道会负载均衡

---

## 更新日志

- **2026-04-22**：重写文档，专注于具体步骤和实际问题解决
- **2025-12-15**：初始版本，包含基本配置

---

## 获取帮助

1. **Cloudflare官方文档**：https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/
2. **项目README**：`apps/frontend-blog/README.md` 包含Capacitor集成说明
3. **命令行帮助**：`cloudflared --help` 或 `cloudflared tunnel --help`
