import React from 'react';
import {
  LayoutDashboard,
  ShoppingBag,
  Ticket,
  CreditCard,
  Users,
  Package,
  Bell,
  Shield,
  FileText,
  PieChart,
  Headphones,
  UserCheck,
  MapPin,
  LayoutGrid,
  Image,
  Tag,
  UsersRound,
  Wallet,
  KeyRound,
  Zap,
  MessageSquare,
  Megaphone,
  LogIn,
  SlidersHorizontal,
  Sparkles,
  Activity,
  BrainCircuit,
  ListChecks,
  Gauge,
  ServerCog,
  Workflow,
  Coins,
  Brain,
  ClipboardCheck,
  ShieldAlert,
  Headset,
  BarChart3,
  Braces,
  GitBranch,
} from 'lucide-react';

export type RouteGroup =
  | 'Overview'
  | 'Users'
  | 'Catalog'
  | 'Commerce'
  | 'Marketing'
  | 'Customer Service'
  | 'AI Operations · 今日'
  | 'AI Operations · 业务'
  | 'AI Operations · 工程'
  | 'Analytics'
  | 'System';

export interface RouteConfig {
  path: string;
  name: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  group: RouteGroup;
  hidden?: boolean;
  /** 这些角色看不到该路由；未加载角色时按隐藏处理，避免闪烁。 */
  hiddenForRoles?: readonly string[];
}

/**
 * 工程组的后端读接口当前只允许 SUPER_ADMIN / ADMIN（VIEWER、EDITOR 调用会 403）。
 * 导航可见性必须与接口一致：整组对这两个角色隐藏，而不是逐页猜测。
 * 若后续开放某个工程页，先给对应接口加角色 + 测试，再把该角色从这里移除。
 */
const ENGINEERING_HIDDEN_ROLES = ['VIEWER', 'EDITOR'] as const;

export const routes: RouteConfig[] = [
  // Overview
  { path: '/', name: 'dashboard', icon: LayoutDashboard, group: 'Overview' },

  // Users
  { path: '/users', name: 'users', icon: Users, group: 'Users' },
  { path: '/kyc', name: 'kyc', icon: UserCheck, group: 'Users' },
  { path: '/address', name: 'address', icon: MapPin, group: 'Users' },

  // Catalog
  { path: '/products', name: 'products', icon: ShoppingBag, group: 'Catalog' },
  { path: '/categories', name: 'categories', icon: Tag, group: 'Catalog' },
  { path: '/banners', name: 'banners', icon: Image, group: 'Catalog' },
  {
    path: '/act-sections',
    name: 'actSection',
    icon: LayoutGrid,
    group: 'Catalog',
  },

  // Commerce
  {
    path: '/orders',
    name: 'orderManagement',
    icon: Package,
    group: 'Commerce',
  },
  {
    path: '/groups',
    name: 'groupManagement',
    icon: UsersRound,
    group: 'Commerce',
  },

  // Marketing
  { path: '/marketing', name: 'marketing', icon: Ticket, group: 'Marketing' },
  { path: '/ads', name: 'adManagement', icon: Megaphone, group: 'Marketing' },
  {
    path: '/flash-sale',
    name: 'flashSaleMgmt',
    icon: Zap,
    group: 'Marketing',
  },
  {
    path: '/lucky-draw',
    name: 'luckyDrawMgmt',
    icon: Sparkles,
    group: 'Marketing',
  },
  {
    path: '/notifications',
    name: 'pushManagement',
    icon: Bell,
    group: 'Marketing',
  },

  // Customer Service
  {
    path: '/knowledge',
    name: 'knowledgeBase',
    icon: FileText,
    group: 'Customer Service',
  },
  {
    path: '/ai-prompt',
    name: 'aiPrompt',
    icon: Sparkles,
    group: 'Customer Service',
  },
  {
    path: '/intent-examples',
    name: 'intentExamples',
    icon: BrainCircuit,
    group: 'Customer Service',
  },
  {
    path: '/knowledge/candidates',
    name: 'kbCandidates',
    icon: ClipboardCheck,
    group: 'Customer Service',
  },
  {
    path: '/customer-service',
    name: 'im',
    icon: MessageSquare,
    group: 'Customer Service',
  },
  {
    path: '/support-channels',
    name: 'supportChannelMgmt',
    icon: Headphones,
    group: 'Customer Service',
  },

  {
    path: '/ai-feedback',
    name: 'aiFeedback',
    icon: ListChecks,
    group: 'Customer Service',
    hidden: true,
  },

  // AI Operations
  {
    path: '/ai-ops',
    name: 'aiOpsOverview',
    hiddenForRoles: ['EDITOR'],
    icon: Gauge,
    group: 'AI Operations · 今日',
  },
  {
    path: '/ai-ops/quality',
    name: 'aiOpsQuality',
    hiddenForRoles: ['EDITOR'],
    icon: ClipboardCheck,
    group: 'AI Operations · 业务',
  },
  {
    path: '/ai-ops/support',
    name: 'aiOpsSupport',
    hiddenForRoles: ['EDITOR'],
    icon: Headset,
    group: 'AI Operations · 业务',
  },
  {
    path: '/ai-ops/insights',
    name: 'aiOpsInsights',
    hiddenForRoles: ['EDITOR'],
    icon: BarChart3,
    group: 'AI Operations · 业务',
  },
  {
    path: '/ai-ops/runtime',
    name: 'aiOpsRuntime',
    icon: ServerCog,
    group: 'AI Operations · 工程',
    hiddenForRoles: ENGINEERING_HIDDEN_ROLES,
  },
  {
    path: '/ai-ops/flows',
    name: 'aiOpsFlows',
    icon: Workflow,
    group: 'AI Operations · 工程',
    hiddenForRoles: ENGINEERING_HIDDEN_ROLES,
  },
  {
    path: '/ai-ops/usage',
    name: 'aiOpsUsage',
    icon: Coins,
    group: 'AI Operations · 工程',
    hiddenForRoles: ENGINEERING_HIDDEN_ROLES,
  },
  {
    path: '/ai-ops/memory',
    name: 'aiOpsMemory',
    icon: Brain,
    group: 'AI Operations · 工程',
    hiddenForRoles: ENGINEERING_HIDDEN_ROLES,
  },
  {
    path: '/ai-ops/security',
    name: 'aiOpsSecurity',
    icon: ShieldAlert,
    group: 'AI Operations · 工程',
    hiddenForRoles: ENGINEERING_HIDDEN_ROLES,
  },
  {
    path: '/ai-ops/context',
    name: 'aiOpsContext',
    icon: Braces,
    group: 'AI Operations · 工程',
    hiddenForRoles: ENGINEERING_HIDDEN_ROLES,
  },
  {
    path: '/ai-ops/traces',
    name: 'aiOpsTraces',
    icon: GitBranch,
    group: 'AI Operations · 工程',
    hiddenForRoles: ENGINEERING_HIDDEN_ROLES,
  },
  {
    path: '/ai-ops/analysis',
    name: 'aiOpsAnalysis',
    icon: BarChart3,
    group: 'AI Operations · 工程',
    hiddenForRoles: ENGINEERING_HIDDEN_ROLES,
  },
  {
    path: '/ai-ops/reports',
    name: 'aiOpsReports',
    icon: ClipboardCheck,
    group: 'AI Operations · 工程',
    hiddenForRoles: ENGINEERING_HIDDEN_ROLES,
  },
  {
    path: '/ai-ops/annotations',
    name: 'aiOpsAnnotations',
    icon: ListChecks,
    group: 'AI Operations · 工程',
    hiddenForRoles: ENGINEERING_HIDDEN_ROLES,
  },

  // Analytics
  {
    path: '/analytics',
    name: 'analyticsMgmt',
    icon: PieChart,
    group: 'Analytics',
  },
  {
    path: '/operation-logs',
    name: 'operationLogMgmt',
    icon: FileText,
    group: 'Analytics',
  },
  {
    path: '/login-logs',
    name: 'loginLogMgmt',
    icon: LogIn,
    group: 'Analytics',
  },

  // System
  {
    path: '/monitor',
    name: 'monitor',
    icon: Activity,
    group: 'System',
  },
  { path: '/finance', name: 'finance', icon: Wallet, group: 'System' },
  {
    path: '/payment-channels',
    name: 'paymentChannels',
    icon: CreditCard,
    group: 'System',
  },
  { path: '/admin-users', name: 'admin', icon: Shield, group: 'System' },
  { path: '/roles', name: 'roles', icon: KeyRound, group: 'System' },
  {
    path: '/settings',
    name: 'settings',
    icon: SlidersHorizontal,
    group: 'System',
  },

  // Hidden (for metadata matching only)
  {
    path: '/finance/detail',
    name: 'finance_page',
    icon: Wallet,
    group: 'System',
    hidden: true,
  },
];

/**
 * 按角色过滤导航。
 *
 * - `hidden` 永远不显示；
 * - 角色未知（尚未拉取 /me）时，隐藏 `hiddenForRoles` 路由，避免先闪一下再消失；
 * - 角色比较统一大写，兼容历史上的小写 role。
 */
export function getVisibleRoutes(role?: string | null): RouteConfig[] {
  const current = String(role ?? '').toUpperCase();
  return routes.filter((route) => {
    if (route.hidden) return false;
    if (!route.hiddenForRoles?.length) return true;
    if (!current) return false;
    return !route.hiddenForRoles.includes(current);
  });
}
