import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@api/common/redis/redis.service';

/**
 * SSE 限流服务 — 用 Redis 限制 SSE 连接数
 *
 * 三层限流：
 *   1. 用户级：每人只能有 1 个活跃连接
 *   2. 全局级：总共最多 200 个连接
 *   3. 令牌桶：限制连接频率，防止刷接口
 *
 * 为什么用 Redis 不用 Map？
 *   多台服务器都能访问 Redis，重启数据不丢。
 *   TTL 自动过期：用户浏览器崩溃了，70 秒后自动清除记录。
 */
@Injectable()
export class SseRateLimiterService {
  private readonly logger = new Logger(SseRateLimiterService.name);

  // Redis key 前缀（用冒号分隔，好管理）
  // 存到 Redis 里长这样：
  //   "sse:user:user123" → "active"     （用户连接标记）
  //   "sse:global:count" → 5            （总连接数）
  //   "sse:token:user123" → {t:3, l:...}（令牌数据）
  private readonly PREFIX_USER = 'sse:user:'; // 用户连接 key
  private readonly KEY_GLOBAL = 'sse:global:count'; // 全局计数器 key
  private readonly PREFIX_TOKEN = 'sse:token:'; // 令牌桶 key

  private readonly PREFIX_IP = 'sse:ip:'; // IP 连接 key
  private readonly PREFIX_DEVICE = 'sse:device:'; // 设备连接 key
  private readonly MAX_PER_IP = 5; // 每个 IP 最多 5 个连接
  private readonly MAX_PER_DEVICE = 3; // 每个设备最多 3 个连接

  // ── 限流参数（可以随便改） ──
  private readonly MAX_CONCURRENT = 200; // 最多同时 200 个连接
  private readonly USER_TTL = 70; // 用户连接 70 秒过期
  private readonly TOKEN_RATE = 1; // 令牌桶：每秒生成 1 个
  private readonly TOKEN_BURST = 6; // 令牌桶：最多存 6 个

  // ── 熔断器 ──
  private consecutiveFailures = 0; // 连续失败次数
  private circuitOpen = false; // 熔断器状态
  private lastFailureTime = 0; // 上次失败时间（毫秒）
  private readonly FAILURE_THRESHOLD = 3; // 连续失败 3 次就熔断
  private readonly CIRCUIT_TIMEOUT = 30_000; // 熔断 30 秒后尝试恢复

  constructor(private readonly redis: RedisService) {}

  /**
   * 用户连上来时调用 → 检查能不能连
   * 返回 { ok: true } 或 { ok: false, reason: '...' }
   */
  async tryAcquire(
    userId: string,
    ip?: string,
    deviceId?: string,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    // ── 第 1.5 层：IP 限流 ──
    // 每个 IP 最多 5 个并发连接
    if (ip) {
      const ipKey = `${this.PREFIX_IP}${ip}`;
      const ipCount = await this.redis.incr(ipKey);
      if (ipCount > this.MAX_PER_IP) {
        await this.redis.decr(ipKey);
        return { ok: false, reason: 'Too many connections from this IP' };
      }
      await this.redis.expire(ipKey, 600); // 10 分钟过期
    }

    // ── 第 1.75 层：设备限流 ──
    // 每个设备最多 3 个并发连接
    if (deviceId) {
      const deviceKey = `${this.PREFIX_DEVICE}${deviceId}`;
      const deviceCount = await this.redis.incr(deviceKey);
      if (deviceCount > this.MAX_PER_DEVICE) {
        await this.redis.decr(deviceKey);
        return { ok: false, reason: 'Too many connections from this device' };
      }
      await this.redis.expire(deviceKey, 600); // 10 分钟过期
    }

    // 熔断器：Redis 挂了时保守拒绝，不给 Redis 加压
    if (this.circuitOpen) {
      if (Date.now() - this.lastFailureTime < this.CIRCUIT_TIMEOUT) {
        // 熔断未到期 → 保守拒绝
        return { ok: false, reason: '系统繁忙，请稍后重试' };
      }
      // 熔断到期 → 尝试恢复
      this.circuitOpen = false;
    }

    // ── 第 1 层：每人最多 1 个连接 ──
    // setNx = Redis 命令 SET if Not eXists（不存在才写入）
    // 同一个 userId 写第二次 → 失败 → 说明已经有连接了
    const userKey = `${this.PREFIX_USER}${userId}`;
    const acquired = await this.redis.withTimeout(
      this.redis.setNx(userKey, 'active', this.USER_TTL),
      this.USER_TTL * 1000 + 1000,
    ); // 加 1 秒容错，防止 Redis 慢
    if (!acquired) {
      return { ok: false, reason: '您已有活跃的对话连接' };
    }

    try {
      // ── 第 2 层：全局最多 200 个连接 ──
      // incr = 给计数器加 1（原子操作，不怕两个人同时加）
      const current = await this.redis.withTimeout<number>(
        this.redis.incr(this.KEY_GLOBAL),
      );
      if (current > this.MAX_CONCURRENT) {
        // 超了 → 把刚刚加的减掉，删掉用户记录
        await this.redis.withTimeout(this.redis.decr(this.KEY_GLOBAL));
        await this.redis.withTimeout(this.redis.del(userKey));
        return { ok: false, reason: '服务器繁忙，请稍后重试' };
      }
      // 设 10 分钟过期，没人连了计数器自动归零
      await this.redis.withTimeout(this.redis.expire(this.KEY_GLOBAL, 600));

      // ── 第 3 层：令牌桶 ──
      // 防止一个用户疯狂开连接
      const tokenKey = `${this.PREFIX_TOKEN}${userId}`;
      const allowed = await this.checkTokenBucket(tokenKey);
      if (!allowed) {
        await this.redis.withTimeout(this.redis.decr(this.KEY_GLOBAL));
        await this.redis.withTimeout(this.redis.del(userKey));
        return {
          ok: false,
          reason: 'too many requests, please try again later',
        };
      }

      this.consecutiveFailures = 0; // 成功 → 重置失败计数
      this.circuitOpen = false; // 成功 → 熔断器关闭

      return { ok: true };
    } catch (err) {
      // Redis 出异常了 → 熔断器打开
      this.consecutiveFailures++;
      this.lastFailureTime = Date.now();
      if (this.consecutiveFailures >= this.FAILURE_THRESHOLD) {
        this.circuitOpen = true; // 达到失败阈值 → 打开熔断器
        this.logger.warn(
          `[tryAcquire] Redis error: ${err}. Circuit breaker opened, Redis connnect failed ${this.consecutiveFailures} times in a row.`,
        );
      }
      // 出异常了 → 把 Redis 里加的数据回滚
      await this.redis.withTimeout(this.redis.del(userKey)).catch(() => {});
      await this.redis
        .withTimeout(this.redis.decr(this.KEY_GLOBAL))
        .catch(() => {});
      this.logger.error(`[tryAcquire] ${err}`);
      return { ok: false, reason: 'system busy, please try again later' };
    }
  }

  /**
   * 用户断开连接时调用 → 清理 Redis 里的数据
   */
  async release(userId: string, ip?: string, deviceId?: string): Promise<void> {
    try {
      // 删用户记录 + 全局、IP、设备计数各减 1（防止计数漂移）
      const tasks = [
        this.redis.del(`${this.PREFIX_USER}${userId}`),
        this.redis.decr(this.KEY_GLOBAL).then((count) => {
          if (count <= 0) this.redis.del(this.KEY_GLOBAL); // 防止变负数
        }),
      ];
      if (ip) tasks.push(this.redis.decr(`${this.PREFIX_IP}${ip}`));
      if (deviceId)
        tasks.push(this.redis.decr(`${this.PREFIX_DEVICE}${deviceId}`));
      await Promise.all(tasks);
    } catch (err) {
      this.logger.error(`[release] ${err}`);
    }
  }

  /**
   * 心跳刷新 — 前端定期调用，延续 TTL
   * 防止连接还在但 Redis 过期了
   */
  async refreshHeartbeat(userId: string): Promise<void> {
    try {
      await this.redis.expire(`${this.PREFIX_USER}${userId}`, this.USER_TTL);
    } catch (err) {
      this.logger.warn(`[heartbeat] ${err}`);
    }
  }

  /**
   * 查看当前总连接数
   */
  async getActiveCount(): Promise<number> {
    try {
      const count = await this.redis.get(this.KEY_GLOBAL);
      return count ? parseInt(count, 10) : 0;
    } catch {
      return 0;
    }
  }

  // ════════════════════════════════════════
  //  令牌桶 — Lua 脚本
  // ════════════════════════════════════════
  //
  // 令牌桶比简单计数更平滑：
  //   简单计数: 每分钟 10 次 → 第 1 秒用完 → 剩下 59 秒干等
  //   令牌桶:   每秒生 1 个，桶存 6 个 → 突发 6 次后每秒只能 1 次
  //
  // Redis 里存的数据：
  //   key: "sse:token:user123"
  //   value: { t: 3, l: 1700000000 }
  //            ↑令牌数  ↑上次检查时间
  //
  // Lua 脚本的作用：保证"检查令牌 → 消费令牌"是原子操作
  // 不会出现两个人同时拿到最后一个令牌的情况
  private async checkTokenBucket(key: string): Promise<boolean> {
    try {
      // Lua 脚本参数说明：
      //   KEYS[1] = Redis key 名
      //   ARGV[1] = TOKEN_RATE（每秒生几个）
      //   ARGV[2] = TOKEN_BURST（桶容量）
      //   ARGV[3] = 当前时间（秒）
      const result = await this.redis.eval(
        `local k=KEYS[1]
         local r=tonumber(ARGV[1])  -- 每秒生几个
         local b=tonumber(ARGV[2])  -- 桶容量
         local n=tonumber(ARGV[3])  -- 当前时间(秒)
         local t=redis.call('hget',k,'t')  -- 读剩余令牌数
         local l=redis.call('hget',k,'l')  -- 读上次时间
         if not t then t=b;l=n else t=tonumber(t);l=tonumber(l) end
         local e=n-l  -- 上次到现在过了几秒
         t=math.min(b,t+e*r)  -- 新令牌数=min(桶容量,旧令牌+过去秒数)
         if t<1 then return 0 end  -- 不够1个,拒绝
         redis.call('hset',k,'t',t-1)  -- 拿走1个
         redis.call('hset',k,'l',n)    -- 记下时间
         redis.call('expire',k,10)     -- 10秒过期
         return 1`,
        // ═══ Lua 脚本结束 ═══
        [key],
        [
          this.TOKEN_RATE.toString(),
          this.TOKEN_BURST.toString(),
          Math.floor(Date.now() / 1000).toString(),
        ],
      );
      return result === 1;
    } catch {
      // Lua 执行失败 → 放行（降级：宁可放过，不能误杀）
      return true;
    }
  }
}
