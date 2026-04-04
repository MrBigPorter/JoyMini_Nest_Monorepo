'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { statsApi } from '@/api';
import { Card } from '@/components/UIComponents';
import type { StatsTrend } from '@/type/types';

const DAYS_OPTIONS = [7, 14, 30] as const;
type DaysOption = (typeof DAYS_OPTIONS)[number];

function DaysToggle({
  value,
  onChange,
}: {
  value: DaysOption;
  onChange: (d: DaysOption) => void;
}) {
  return (
    <div className="flex gap-1">
      {DAYS_OPTIONS.map((d) => (
        <button
          key={d}
          onClick={() => onChange(d)}
          className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
            value === d
              ? 'bg-primary-500 text-white'
              : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10'
          }`}
        >
          {d}d
        </button>
      ))}
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="h-56 rounded-xl bg-gray-100 dark:bg-white/5 animate-pulse" />
  );
}

function OrderTrendChart({ data }: { data: StatsTrend['orders'] }) {
  const chartData = data.map((d) => ({
    date: d.date.slice(5), // "MM-DD"
    orders: d.count,
    revenue: parseFloat(d.revenue),
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart
        data={chartData}
        margin={{ top: 4, right: 8, left: -10, bottom: 0 }}
      >
        <defs>
          <linearGradient id="colorOrders" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid
          strokeDasharray="3 3"
          className="stroke-gray-100 dark:stroke-white/10"
        />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{
            borderRadius: 8,
            border: 'none',
            boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
          }}
        />
        <Legend iconType="circle" iconSize={8} />
        <Area
          type="monotone"
          dataKey="orders"
          stroke="#6366f1"
          strokeWidth={2}
          fill="url(#colorOrders)"
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function UserTrendChart({ data }: { data: StatsTrend['users'] }) {
  const chartData = data.map((d) => ({
    date: d.date.slice(5),
    users: d.count,
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart
        data={chartData}
        margin={{ top: 4, right: 8, left: -10, bottom: 0 }}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          className="stroke-gray-100 dark:stroke-white/10"
        />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{
            borderRadius: 8,
            border: 'none',
            boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
          }}
        />
        <Bar
          dataKey="users"
          fill="#10b981"
          radius={[4, 4, 0, 0]}
          maxBarSize={24}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function AnalyticsTrendSection() {
  const [days, setDays] = useState<DaysOption>(30);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['stats-trend', days],
    queryFn: () => statsApi.getTrend(days),
    staleTime: 5 * 60 * 1000, // 5 分钟缓存
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* Orders trend */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-gray-800 dark:text-white">
              Order Trend
            </h3>
            <p className="text-xs text-gray-400">Daily order count</p>
          </div>
          <DaysToggle value={days} onChange={setDays} />
        </div>
        {isLoading ? (
          <ChartSkeleton />
        ) : isError || !data ? (
          <div className="h-56 flex items-center justify-center text-gray-400 text-sm">
            Failed to load data
          </div>
        ) : data.orders.length === 0 ? (
          <div className="h-56 flex items-center justify-center text-gray-400 text-sm">
            No order data in this period
          </div>
        ) : (
          <OrderTrendChart data={data.orders} />
        )}
      </Card>

      {/* Users trend */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-gray-800 dark:text-white">
              User Registration
            </h3>
            <p className="text-xs text-gray-400">Daily new user count</p>
          </div>
          <DaysToggle value={days} onChange={setDays} />
        </div>
        {isLoading ? (
          <ChartSkeleton />
        ) : isError || !data ? (
          <div className="h-56 flex items-center justify-center text-gray-400 text-sm">
            Failed to load data
          </div>
        ) : data.users.length === 0 ? (
          <div className="h-56 flex items-center justify-center text-gray-400 text-sm">
            No user data in this period
          </div>
        ) : (
          <UserTrendChart data={data.users} />
        )}
      </Card>
    </div>
  );
}
