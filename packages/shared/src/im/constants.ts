/** 会话类型（与 Prisma enum ConversationType 对齐） */
export const CONVERSATION_TYPE = {
  GROUP: "GROUP",
  DIRECT: "DIRECT",
  SUPPORT: "SUPPORT",
  BUSINESS: "BUSINESS",
} as const;

export type ConversationType =
  (typeof CONVERSATION_TYPE)[keyof typeof CONVERSATION_TYPE];

export enum ConversationStatus {
  NORMAL = 1,
  ARCHIVED = 2,
  MUTED = 3,
}

export enum ChatMemberRole {
  OWNER = "OWNER",
  ADMIN = "ADMIN",
  MEMBER = "MEMBER",
}

/** 消息类型（与 ChatMessage.type 对齐） */
export const MESSAGE_TYPE = {
  TEXT: 0,
  IMAGE: 1,
  AUDIO: 2,
  VIDEO: 3,
  RECALLED: 4,
  //  新增：文件类型
  FILE: 5,
  //  新增：位置类型
  LOCATION: 6,

  SYSTEM: 99,
} as const;

export type MessageType = (typeof MESSAGE_TYPE)[keyof typeof MESSAGE_TYPE];

/** 系统消息约定：senderId 为 null */
export const SYSTEM_SENDER_ID = null as null;

/** Conversation.lastMsgType 的默认值 */
export const DEFAULT_LAST_MSG_TYPE: MessageType = MESSAGE_TYPE.TEXT;

/** Conversation.lastMsgSeqId / ChatMember.lastReadSeqId 的默认值 */
export const DEFAULT_SEQ_ID = 0;

/** 未读数计算（约定公式） */
export const getUnreadCount = (args: {
  lastMsgSeqId: number;
  lastReadSeqId: number;
}) => Math.max(0, args.lastMsgSeqId - args.lastReadSeqId);

/** 关键字段名（写查询/排序/索引用，减少 magic string） */
export const IM_FIELDS = {
  Conversation: {
    id: "id",
    type: "type",
    businessId: "businessId",
    lastMsgContent: "lastMsgContent",
    lastMsgType: "lastMsgType",
    lastMsgTime: "lastMsgTime",
    lastMsgSeqId: "lastMsgSeqId",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  },
  ChatMessage: {
    id: "id",
    conversationId: "conversationId",
    senderId: "senderId",
    type: "type",
    content: "content",
    meta: "meta",
    seqId: "seqId",
    clientTempId: "clientTempId",
    isRecalled: "isRecalled",
    createdAt: "createdAt",
  },
  ChatMember: {
    id: "id",
    conversationId: "conversationId",
    userId: "userId",
    lastReadSeqId: "lastReadSeqId",
    joinedAt: "joinedAt",
  },
} as const;

/** 索引/约束名（用于文档 & 迁移沟通；Prisma 不一定显式命名，但业务层可以统一口径） */
export const IM_CONSTRAINTS = {
  Conversation: {
    businessIdUnique: "Conversation_businessId_unique",
  },
  ChatMessage: {
    conversationIdSeqIdIndex: "ChatMessage_conversationId_seqId_index",
  },
  ChatMember: {
    conversationIdUserIdUnique: "ChatMember_conversationId_userId_unique",
  },
} as const;

/** meta Json 推荐字段（方便前端类型收敛） */
export type MessageMeta = {
  // === 通用/图片/视频 ===
  w?: number; // 宽
  h?: number; // 高
  duration?: number; // 时长 (语音/视频)
  blurHash?: string; //  补全：模糊占位符
  thumb?: string; //  补全：缩略图/封面

  // ===  新增：文件消息字段 ===
  fileName?: string; // 文件名
  fileSize?: number; // 文件大小 (字节)
  fileExt?: string; // 文件后缀 (e.g. pdf)

  // ===  新增：位置消息字段 ===
  latitude?: number; // 纬度
  longitude?: number; // 经度
  address?: string; // 详细地址

  // === 前端辅助 ===
  localAssetId?: string; // 本地资产引用 (用于乐观 UI)
};

/**
 * Socket 事件定义
 * 配合前端 Unified Dispatch 架构
 */
export const SocketEvents = {
  // ==========================================
  //  核心：统一分发事件名 (Backend emit -> Client on)
  // ==========================================
  DISPATCH: "dispatch",

  // ==========================================
  //  业务类型 (Payload Type Values)
  // 这些值对应前端 payload['type']
  // ==========================================

  // --- 聊天业务 ---
  CHAT_MESSAGE: "chat_message",
  CONVERSATION_READ: "conversation_read",
  MESSAGE_RECALLED: "message_recalled",
  CONVERSATION_UPDATED: "conversation_updated", // 头像/群名变更
  CONVERSATION_ADDED: "conversation_added", // 会话新增（如被拉入新群）
  MEMBER_KICKED: "member_kicked", // 成员被踢出群聊
  MEMBER_MUTED: "member_muted", // 成员被禁言/解禁
  OWNER_TRANSFERRED: "owner_transferred", // 群主转让
  MEMBER_ROLE_UPDATED: "member_role_updated", // 成员角色变更（如管理员权限变动）
  MEMBER_JOINED: "member_joined", // 成员加入群聊
  MEMBER_LEFT: "member_left", // 成员离开群聊
  GROUP_DISBANDED: "group_disbanded", // 群聊解散
  GROUP_INFO_UPDATED: "group_info_updated", // 群信息更新（如公告、全员禁言等）
  // 1. 管理员收到：有新的入群申请
  GROUP_APPLY_NEW: "group_apply_new",
  // 2. 申请人收到：申请处理结果
  GROUP_APPLY_RESULT: "group_apply_result",
  // 3. 管理员同步：申请已被其他管理员处理
  GROUP_REQUEST_HANDLED: "group_request_handled",
  TYPING: "typing",

  // --- 拼团/钱包/群组业务 ---
  GROUP_SUCCESS: "group_success",
  GROUP_FAILED: "group_failed",
  GROUP_UPDATE: "group_update", // 通用群组变动（如人员进出）
  LUCKY_DRAW_TICKET_ISSUED: "lucky_draw_ticket_issued",
  WALLET_CHANGE: "wallet_change", // 余额变动通知

  // --- 好友/联系人业务 ---
  CONTACT_APPLY: "contact_apply",
  CONTACT_ACCEPT: "contact_accept",

  // --- 系统通知 ---
  ERROR: "error",
  FORCE_LOGOUT: "force_logout", // 强制下线

  // ==========================================
  //  客户端上行事件 (Client emit -> Backend on)
  // 这些是后端 Gateway @SubscribeMessage 监听的事件
  // ==========================================
  JOIN_CHAT: "join_chat",
  LEAVE_CHAT: "leave_chat",
  JOIN_LOBBY: "join_lobby",
  LEAVE_LOBBY: "leave_lobby",
  SEND_MESSAGE: "send_message",
} as const;

/**
FULL_SYNC: 列表全部重新拉取
INFO_SYNC: 只拉取群基本信息
MEMBER_SYNC: 只拉取成员列表
*/
// @lucky/shared/constants.ts

export const SocketSyncTypes = {
  // --- 拉取类 ---
  FULL_SYNC: "full_sync", // 全量拉取 (详情+成员)
  MEMBER_SYNC: "member_sync", // 仅拉取成员列表
  INFO_SYNC: "info_sync", // 仅拉取群基本信息

  // --- 推送类 ---
  PATCH: "patch", // 增量更新 (直接用 Payload 数据)
  REMOVE: "remove", // 移除 (删除会话/成员)
} as const;

export type SocketSyncTypes =
  (typeof SocketSyncTypes)[keyof typeof SocketSyncTypes];

// 状态: 0=待处理, 1=已同意, 2=已拒绝
export const FRIEND_REQUEST_STATUS = {
  PENDING: 0,
  ACCEPTED: 1,
  REJECTED: 2,
} as const;

// 状态: 1=已成为好友, 2=已拉黑
export const FRIEND_SHIP_STATUS = {
  FRIENDS: 1,
  BLOCKED: 2,
} as const;

export type FriendRequestStatus =
  (typeof FRIEND_REQUEST_STATUS)[keyof typeof FRIEND_REQUEST_STATUS];

export type FriendShipStatus =
  (typeof FRIEND_SHIP_STATUS)[keyof typeof FRIEND_SHIP_STATUS];

// 用户关系状态：0=陌生人, 1=好友, 2=已发送好友请求
export const RELATIONSHIP_STATUS = {
  STRANGER: 0,
  FRIEND: 1,
  SENT: 2,
};

/**
 * 入群申请单状态
 */
export enum GroupJoinRequestStatus {
  PENDING = 0, // 待处理
  ACCEPTED = 1, // 已通过 (已自动加群)
  REJECTED = 2, // 已拒绝
}

export enum CallMediaType {
  AUDIO = "audio",
  VIDEO = "video",
}

export enum CallEndReason {
  HANGUP = "hangup", // 正常挂断
  CANCEL = "cancel", // 主叫取消
  DECLINE = "decline", // 被叫拒绝
  BUSY = "busy", // 忙线
  TIMEOUT = "timeout", // 无人接听超时
  ERROR = "error", // 连接错误
  MISSED = "missed", // 未接听（被叫未接听或响铃超时）
  REJECTED = "rejected", // 已拒绝（被叫明确拒绝）
}
