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
} from 'lucide-react';

export type RouteGroup =
  | 'Overview'
  | 'Users'
  | 'Catalog'
  | 'Commerce'
  | 'Marketing'
  | 'Customer Service'
  | 'AI Operations'
  | 'Analytics'
  | 'System';

export interface RouteConfig {
  path: string;
  name: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  group: RouteGroup;
  hidden?: boolean;
}

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
    hidden: process.env.NEXT_PUBLIC_AI_FEEDBACK_UI_ENABLED !== 'true',
  },

  // AI Operations
  {
    path: '/ai-ops',
    name: 'aiOpsOverview',
    icon: Gauge,
    group: 'AI Operations',
  },
  {
    path: '/ai-ops/runtime',
    name: 'aiOpsRuntime',
    icon: ServerCog,
    group: 'AI Operations',
  },
  {
    path: '/ai-ops/flows',
    name: 'aiOpsFlows',
    icon: Workflow,
    group: 'AI Operations',
  },
  {
    path: '/ai-ops/usage',
    name: 'aiOpsUsage',
    icon: Coins,
    group: 'AI Operations',
  },
  {
    path: '/ai-ops/memory',
    name: 'aiOpsMemory',
    icon: Brain,
    group: 'AI Operations',
  },

  {
    path: '/ai-ops/quality',
    name: 'aiOpsQuality',
    icon: ClipboardCheck,
    group: 'AI Operations',
  },
  {
    path: '/ai-ops/security',
    name: 'aiOpsSecurity',
    icon: ShieldAlert,
    group: 'AI Operations',
  },
  {
    path: '/ai-ops/support',
    name: 'aiOpsSupport',
    icon: Headset,
    group: 'AI Operations',
  },
  {
    path: '/ai-ops/insights',
    name: 'aiOpsInsights',
    icon: BarChart3,
    group: 'AI Operations',
  },

  {
    path: '/ai-ops/context',
    name: 'aiOpsContext',
    icon: Braces,
    group: 'AI Operations',
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
