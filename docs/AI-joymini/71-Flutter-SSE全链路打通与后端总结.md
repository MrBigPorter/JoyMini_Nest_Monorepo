# Flutter SSE 全链路打通 + 后端总结

> 日期: 2026-07-15
> 关联: 后端 #70   Flutter #64 #65 #66 #67

---

## 一、Flutter SSE 实现

### 架构

```text
AI 聊天页面 → AiChatState (Riverpod)
                → SSE Client (平台自适应)
                    → api.joyminis.com/ai/customer/chat/stream/:streamId
                        → Nginx proxy_pass
                            → NestJS SSE Controller
                                → LangGraph orchestrator
```

### 平台自适应 SSE 客户端

**入口** (`lib/core/services/ai/sse_client.dart`):
```dart
// 原生平台 → dart:io HttpClient
// Web 平台 → Dio
export 'sse_client_dio.dart'
    if (dart.library.io) 'sse_client_io.dart';
```

| 文件 | 用途 |
|------|------|
| `sse_client_io.dart` | iOS/Android/macOS — dart:io HttpClient |
| `sse_client_dio.dart` | Web — Dio（浏览器不支持 dart:io） |
| `sse_client_web.dart` | Web 备用实现 |
| `sse_client_v2.dart` | SSE v2 企业级实现 |
| `sse_types.dart` | SSE 数据类型定义 |

### AI 聊天状态

**`AiChatState`** (`lib/core/store/ai_chat/ai_chat_state.dart`):
```dart
class AiChatState {
  final List<ChatUiModel> messages;        // 消息列表
  final bool isReceiving;                   // 是否正在接收 SSE 流
  final String currentStreamContent;        // 打字机效果累积内容
  final String currentAiMessageId;          // 当前 AI 消息 ID
  final String sessionId;                   // 会话 ID（LangGraph 上下文）
  final String statusText;                  // 状态文本
  final String? error;                      // 错误信息
  final bool isStreamComplete;              // 流是否完成
}
```

**`AiChatViewModel`** (`lib/core/store/ai_chat/ai_chat_view_model.dart`):
- 管理 SSE 连接生命周期
- 驱动打字机效果（逐字更新 `currentStreamContent`）
- sessionId 持久化（维持 LangGraph 多轮对话上下文）

---

## 二、后端改动总结（#70）

### 改动清单

| # | 改动 | 文件 | 说明 |
|---|------|------|------|
| 1 | **本地 Infinity bge-m3** | `infinity.provider.ts` | embedding 本地部署，替代 Jina AI |
| 2 | **双 provider 共存** | `ai.module.ts`, `ai.service.ts` | Infinity(embedding) + Jina(reranker) |
| 3 | **docker + nginx** | `compose.prod.yml`, `10-api.conf` | Infinity 容器 + /infinity/ 转发 |
| 4 | **MIN_SCORE 0.65→0.5** | `orchestrator.node.ts` | 对齐 IntentClassifier 阈值 |
| 5 | **拆 BM25+vector 融合** | `intent-classifier.ts` | 各自独立加入，不混分 |
| 6 | **多意图 LLM 判断** | `orchestrator.node.ts` | 替代 SCORE_GAP，LLM 反问/全执行 |

### 架构图

```text
[Flutter App]
    ↓ SSE (平台自适应)
[Nginx] api.joyminis.com
    ↓ /api/ → backend:3000
    ↓ /infinity/ → joymini-infinity:7997 (bge-m3)
[NestJS Backend]
    ├─ AiService.generateEmbedding() → Infinity(bge-m3) ✅
    ├─ AiService.rerank()             → Jina AI 线上 API ✅
    ├─ IntentClassifier               → BM25 + vector 独立
    ├─ Orchestrator                   → LLM 反问/全执行
    └─ LangGraph (ReAct Agents)
```

### 关键配置

**服务器**:
- Infinity 容器: `michaelf34/infinity:latest` + `BAAI/bge-m3`
- 内存: ~1.35 GiB
- 端口: 不暴露，走 nginx 内部转发

**Nginx 路由**:
```nginx
location ^~ /infinity/ {
    set $infinity_upstream http://joymini-infinity:7997;
    rewrite ^/infinity/(.*) /$1 break;
    proxy_pass $infinity_upstream;
}
```

**.env 环境变量**:
```env
# Infinity (本地 embedding)
INFINITY_EMBEDDING_BASE_URL=http://joymini-infinity:7997    # Docker 内部
INFINITY_EMBEDDING_MODEL=BAAI/bge-m3

# Jina AI (线上 reranker)
JINA_API_KEY=jina_xxx
```

---

## 三、本地开发

### 后端 dev

```bash
# 1. 本地启动 dev API（自动热重载）
make dev-api

# 2. .env.dev 配置（连服务器 Infinity）
INFINITY_EMBEDDING_BASE_URL=https://api.joyminis.com/infinity
INFINITY_EMBEDDING_MODEL=BAAI/bge-m3
```

### Flutter dev

```dart
// SSE 客户端自动选择平台实现
// 原生: dart:io HttpClient
// Web:  Dio
```

### 部署

```bash
# 后端部署（本地构建 → 传输 → 启动）
./deploy/deploy.sh --backend
```

---

## 四、状态与待办

### ✅ 已完成

| 模块 | 状态 |
|------|------|
| NestJS SSE 流式接口 | ✅ 后端 `features/SSE-streaming` |
| Flutter SSE 客户端（平台自适应） | ✅ `sse_client.dart` |
| Flutter AiChatState | ✅ `ai_chat_state.dart` |
| Flutter AiChatViewModel | ✅ `ai_chat_view_model.dart` |
| Infinity bge-m3 本地部署 | ✅ `compose.prod.yml` |
| BM25+vector 拆开 + 多意图 LLM | ✅ `orchestrator.node.ts` |
| MIN_SCORE 0.65→0.5 | ✅ `orchestrator.node.ts` |
| 文档 | ✅ `70`, `71` |

### ⏳ 待办

| 任务 | 优先级 |
|------|--------|
| PostgreSQL Checkpointer (#18) | 🟡 中 |
| LLM 缓存 (#31) | 🟢 低 |
| Flutter AI 聊天页面 UI | 🟡 中 |
