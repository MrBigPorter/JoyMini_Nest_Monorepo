'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { useRequest } from 'ahooks';
import { Button, cn } from '@repo/ui';
import {
  Shield,
  Smartphone,
  History,
  Wallet,
  Ban,
  CheckCircle,
  MapPin,
  Copy,
} from 'lucide-react';
import { clientUserApi } from '@/api';
import { ClientUserDevice } from '@/type/types';
import { Badge } from '@repo/ui';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui';
import { useToastStore } from '@/store/useToastStore';

interface Props {
  userId: string;
  close: () => void;
  reload: () => void;
}

export const UserDetailModal: React.FC<Props> = ({ userId, reload, close }) => {
  const [remark, setRemark] = useState('');
  const addToast = useToastStore((state) => state.addToast);

  const { data, loading, refresh } = useRequest(() =>
    clientUserApi.getUserById(userId),
  );

  const { run: updateStatus, loading: statusLoading } = useRequest(
    clientUserApi.updateUser,
    {
      manual: true,
      onSuccess: () => {
        addToast('success', 'User account status updated');
        setRemark(''); // 清空备注
        refresh();
        reload();
        close();
      },
    },
  );

  const { run: toggleDeviceBan } = useRequest(
    async (device: ClientUserDevice) => {
      if (device.isBanned) {
        return clientUserApi.unbanDevice(device.deviceId);
      } else {
        return clientUserApi.banDevice({
          deviceId: device.deviceId,
          reason: 'Admin Manual Ban',
        });
      }
    },
    {
      manual: true,
      onSuccess: () => {
        addToast('success', 'Device restriction updated');
        refresh();
      },
    },
  );

  const handleAccountStatusToggle = () => {
    const isBanning = data?.status === 1;
    const targetStatus = isBanning ? 0 : 1;

    // 封号时强制输入备注
    if (isBanning && !remark.trim()) {
      addToast('error', 'Please enter a reason for freezing the account');
      return;
    }

    updateStatus(data!.id, {
      status: targetStatus,
      remark: remark.trim() || undefined,
    });
  };

  const copyToClipboard = (text: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    addToast('success', 'Copied to clipboard');
  };

  if (loading || !data)
    return (
      <div className="p-20 text-center animate-pulse text-gray-400 flex flex-col items-center gap-3">
        <div className="w-12 h-12 rounded-full border-4 border-slate-100 border-t-blue-500 animate-spin" />
        Loading profile...
      </div>
    );

  const isFrozen = data.status === 0;

  return (
    <div className="flex flex-col lg:flex-row h-[80vh] w-full overflow-hidden bg-white dark:bg-gray-950 rounded-b-xl shadow-2xl">
      {/* --- LEFT: Content Area --- */}
      <div className="flex-1 overflow-hidden flex flex-col p-8 bg-slate-50/40 dark:bg-black/20 border-r border-gray-200 dark:border-white/5">
        <Tabs defaultValue="overview" className="flex-1 flex flex-col">
          <TabsList className="flex items-center justify-start gap-1 w-fit mb-8 bg-slate-200/60 dark:bg-slate-800/60 backdrop-blur-md p-1 rounded-xl border border-slate-200/50 dark:border-slate-700">
            <TabsTrigger
              value="overview"
              className="flex items-center gap-2 px-5 py-2 rounded-lg transition-all data-[state=active]:bg-white data-[state=active]:shadow-md dark:data-[state=active]:bg-slate-700"
            >
              <Shield size={15} />
              <span className="text-sm font-semibold">Overview</span>
            </TabsTrigger>
            <TabsTrigger
              value="devices"
              className="flex items-center gap-2 px-5 py-2 rounded-lg transition-all data-[state=active]:bg-white data-[state=active]:shadow-md dark:data-[state=active]:bg-slate-700"
            >
              <Smartphone size={15} />
              <span className="text-sm font-semibold">Devices</span>
            </TabsTrigger>
            <TabsTrigger
              value="logs"
              className="flex items-center gap-2 px-5 py-2 rounded-lg transition-all data-[state=active]:bg-white data-[state=active]:shadow-md dark:data-[state=active]:bg-slate-700"
            >
              <History size={15} />
              <span className="text-sm font-semibold">Logs</span>
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto custom-scrollbar pr-4">
            <TabsContent
              value="overview"
              className="space-y-8 m-0 animate-in fade-in slide-in-from-bottom-2 duration-300"
            >
              <div className="grid grid-cols-2 gap-5">
                <StatCard
                  label="Cash Balance"
                  value={`$${data.wallet.realBalance}`}
                  icon={<Wallet className="text-emerald-500" size={24} />}
                />
                <StatCard
                  label="Coin Balance"
                  value={data.wallet.coinBalance}
                  icon={<Wallet className="text-amber-500" size={24} />}
                />
              </div>

              <div className="bg-white dark:bg-white/5 p-6 rounded-3xl border border-slate-100 dark:border-white/10 shadow-sm">
                <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-6">
                  Registration Identity
                </h4>
                <div className="grid grid-cols-2 gap-x-8 gap-y-8">
                  <DetailItem
                    label="Invite Code"
                    value={data.inviteCode}
                    copyable
                    onCopy={copyToClipboard}
                  />
                  <DetailItem
                    label="VIP Level"
                    value={`Level ${data.vipLevel}`}
                  />
                  <DetailItem
                    label="Phone Number"
                    value={data.phone}
                    copyable
                    onCopy={copyToClipboard}
                  />
                  <DetailItem
                    label="Joined Date"
                    value={new Date(data.createdAt).toLocaleString()}
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent
              value="devices"
              className="m-0 space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300"
            >
              {data.devices && data.devices.length > 0 ? (
                data.devices.map((device) => (
                  <div
                    key={device.id}
                    className={cn(
                      'flex items-center justify-between p-5 rounded-2xl border transition-all group',
                      device.isBanned
                        ? 'bg-red-50/50 border-red-100 dark:bg-red-900/10 dark:border-red-900/20'
                        : 'bg-white border-slate-100 dark:bg-slate-800/50 dark:border-slate-800 hover:shadow-md',
                    )}
                  >
                    <div className="flex items-center gap-5 overflow-hidden">
                      <div
                        className={cn(
                          'p-3.5 rounded-2xl shrink-0',
                          device.isBanned
                            ? 'bg-red-100 text-red-600 dark:bg-red-900/40'
                            : 'bg-blue-50 text-blue-600 dark:bg-blue-900/20',
                        )}
                      >
                        <Smartphone size={24} />
                      </div>
                      <div className="flex flex-col min-w-0">
                        <div className="text-[15px] font-bold flex items-center gap-2 mb-1">
                          {device.deviceModel || 'Unknown Model'}
                          {device.isBanned && (
                            <Badge
                              variant="warning"
                              className="h-4 text-[9px] px-1.5 uppercase font-black"
                            >
                              Banned
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono">
                          <span
                            className="truncate max-w-[200px]"
                            title={device.deviceId}
                          >
                            {device.deviceId}
                          </span>
                          <button
                            onClick={() => copyToClipboard(device.deviceId)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-blue-500"
                          >
                            <Copy size={12} />
                          </button>
                        </div>
                        {device.banReason && (
                          <div className="text-[10px] text-red-500 mt-1 italic opacity-80 font-medium">
                            Reason: {device.banReason}
                          </div>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={device.isBanned ? 'primary' : 'outline'}
                      className={cn(
                        'h-9 px-4 text-xs font-bold rounded-xl transition-all',
                        !device.isBanned &&
                          'text-red-500 border-red-100 hover:bg-red-50 hover:border-red-200',
                      )}
                      onClick={() => toggleDeviceBan(device)}
                    >
                      {device.isBanned ? 'Unban' : 'Ban Device'}
                    </Button>
                  </div>
                ))
              ) : (
                <EmptyState
                  icon={<Smartphone size={40} />}
                  title="No Registered Devices"
                  description="This user hasn't logged in with any physical devices yet."
                />
              )}
            </TabsContent>

            <TabsContent
              value="logs"
              className="m-0 animate-in fade-in slide-in-from-bottom-2 duration-300"
            >
              {data.loginLogs && data.loginLogs.length > 0 ? (
                <div className="overflow-x-auto border border-slate-100 dark:border-slate-800 rounded-2xl overflow-hidden bg-white dark:bg-slate-900 shadow-sm">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 font-bold uppercase tracking-widest">
                      <tr>
                        <th className="p-5">Time</th>
                        <th className="p-5 text-center">Location / IP</th>
                        <th className="p-5">Device Meta</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                      {data.loginLogs.map((log, i) => (
                        <tr
                          key={i}
                          className="hover:bg-blue-50/20 transition-colors"
                        >
                          <td className="p-5 text-slate-600 dark:text-slate-400 font-medium whitespace-nowrap">
                            {log.loginTime
                              ? new Date(log.loginTime).toLocaleString()
                              : '--'}
                          </td>
                          <td className="p-5 font-mono text-center">
                            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-100 dark:bg-slate-800 rounded-full text-slate-700 dark:text-slate-300">
                              <MapPin size={10} className="text-slate-400" />{' '}
                              {log.loginIp}
                            </div>
                          </td>
                          <td className="p-5 text-slate-500 max-w-[200px]">
                            <div
                              className="truncate font-medium"
                              title={log.loginDevice}
                            >
                              {log.loginDevice}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  icon={<History size={40} />}
                  title="No Logs Found"
                  description="The login history for this user is currently empty."
                />
              )}
            </TabsContent>
          </div>
        </Tabs>
      </div>

      {/* --- RIGHT: Sidebar --- */}
      <div className="w-full lg:w-96 flex flex-col h-full bg-white dark:bg-gray-900 z-10 shadow-[-10px_0_30px_rgba(0,0,0,0.02)]">
        <div className="p-10 flex-1 overflow-y-auto">
          <div className="flex flex-col items-center text-center mb-10">
            <div className="relative">
              <div
                className={cn(
                  'h-28 w-28 rounded-[2rem] border-[6px] border-white dark:border-gray-800 shadow-2xl overflow-hidden mb-6 transition-all duration-500 relative',
                  isFrozen ? 'grayscale opacity-70' : 'rotate-3 hover:rotate-0',
                )}
              >
                <Image
                  fill
                  src={data.avatar || '/default-avatar.png'}
                  className="object-cover"
                  alt="avatar"
                  sizes="112px"
                />
              </div>
              <div
                className={cn(
                  'absolute -bottom-2 -right-2 p-2 rounded-xl shadow-lg border-2 border-white text-white transition-colors',
                  isFrozen ? 'bg-red-500' : 'bg-blue-500',
                )}
              >
                {isFrozen ? <Ban size={16} /> : <Shield size={16} />}
              </div>
            </div>
            <h3 className="font-black text-2xl text-slate-900 dark:text-white tracking-tight">
              {data.nickname}
            </h3>
            <p className="text-[10px] text-slate-400 font-mono mt-2 bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-full uppercase tracking-widest border border-slate-200/50">
              ID: {data.id}
            </p>
          </div>

          <div className="space-y-4 text-center">
            <div className="p-6 bg-slate-50/50 dark:bg-slate-800/40 rounded-[2rem] border border-slate-100 dark:border-slate-800">
              <div className="text-[10px] text-slate-400 uppercase font-black tracking-widest mb-3">
                Account Security
              </div>
              <div className="flex flex-col gap-2">
                <Badge
                  variant={isFrozen ? 'warning' : 'success'}
                  className="w-full justify-center py-2 text-[10px] font-black uppercase tracking-widest rounded-xl"
                >
                  {isFrozen ? 'Account Frozen' : 'Account Active'}
                </Badge>
                <Badge
                  variant={data.kycStatus === 4 ? 'success' : 'warning'}
                  className="w-full justify-center py-2 text-[10px] font-black uppercase tracking-widest rounded-xl"
                >
                  {data.kycStatus === 4 ? 'KYC Verified' : 'KYC Pending'}
                </Badge>
              </div>
            </div>
          </div>
        </div>

        {/* 底部操作区 */}
        <div className="p-8 border-t border-slate-100 dark:border-slate-800 bg-slate-50/30">
          <textarea
            className="w-full h-24 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 text-xs mb-5 focus:ring-4 focus:ring-red-500/5 outline-none resize-none transition-all dark:bg-slate-800 placeholder:italic"
            placeholder="Type reason for freezing/unfreezing..."
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
          />
          <Button
            variant={isFrozen ? 'primary' : 'danger'}
            className="w-full py-7 font-black text-sm rounded-2xl shadow-xl shadow-red-500/10 active:scale-95 transition-all"
            isLoading={statusLoading}
            onClick={handleAccountStatusToggle}
          >
            {isFrozen ? (
              <>
                <CheckCircle size={20} className="mr-3" /> Restore Account
              </>
            ) : (
              <>
                <Ban size={20} className="mr-3" /> Freeze Account
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};

// --- 子组件: EmptyState ---
const EmptyState = ({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) => (
  <div className="flex flex-col items-center justify-center p-16 border-2 border-dashed border-slate-100 dark:border-slate-800 rounded-[2.5rem] text-center space-y-4 animate-in fade-in zoom-in-95">
    <div className="p-6 bg-slate-50 dark:bg-slate-900 rounded-3xl text-slate-300">
      {icon}
    </div>
    <div>
      <h5 className="font-bold text-slate-900 dark:text-slate-100">{title}</h5>
      <p className="text-xs text-slate-400 max-w-[200px] mx-auto mt-1">
        {description}
      </p>
    </div>
  </div>
);

// --- 子组件: StatCard ---
const StatCard = ({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) => (
  <div className="bg-white dark:bg-slate-900 p-5 rounded-[2rem] border border-slate-100 dark:border-slate-800 flex items-center justify-between shadow-sm group hover:border-blue-100 transition-colors">
    <div className="min-w-0">
      <div className="text-[10px] text-slate-400 font-black uppercase tracking-[0.15em] mb-1.5">
        {label}
      </div>
      <div className="text-xl font-mono font-black truncate text-slate-900 dark:text-white leading-none tracking-tighter">
        {value}
      </div>
    </div>
    <div className="bg-slate-50 dark:bg-black/40 p-3 rounded-2xl shrink-0 ml-3 group-hover:scale-110 transition-transform">
      {icon}
    </div>
  </div>
);

// --- 子组件: DetailItem ---
const DetailItem = ({
  label,
  value,
  copyable,
  onCopy,
}: {
  label: string;
  value: string;
  copyable?: boolean;
  onCopy?: (v: string) => void;
}) => (
  <div className="flex flex-col group/item">
    <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-2 flex items-center gap-2">
      {label}
      {copyable && (
        <button
          onClick={() => onCopy?.(value)}
          className="opacity-0 group-hover/item:opacity-100 transition-opacity hover:text-blue-500"
        >
          <Copy size={10} />
        </button>
      )}
    </div>
    <div className="text-[13px] font-bold text-slate-800 dark:text-slate-200 break-all bg-slate-50/50 dark:bg-white/5 p-2 rounded-lg border border-transparent group-hover/item:border-slate-100 transition-colors">
      {value || '---'}
    </div>
  </div>
);
