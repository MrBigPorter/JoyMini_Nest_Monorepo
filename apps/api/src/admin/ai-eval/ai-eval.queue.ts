/**
 * 评测运行队列。
 *
 * 评测从「请求线程里 fire-and-forget」改成 BullMQ 作业：
 *   - 进程重启后未完成的 run 仍在 Redis，可被 worker 继续消费；
 *   - 同一 run 用 run.id 作 jobId，重复投递只会保留一个 job；
 *   - 失败由 executeRun 落 FAILED + summary.error，不走无意义的重试。
 *
 * 预算与 usage 账本在 executeRun 内完成：估算账本（字符数）保留历史语义，
 * 真实账本由 testChat/judge 的用量采集器按角色汇总，两者一起写入
 * run.summary.usage（详见 ai-eval-dataset.service.ts）。
 */
export const AI_EVAL_QUEUE = 'ai-eval';

/** 评测 run 作业名；jobId 使用 run id，保证同一 run 只入队一次。 */
export const AI_EVAL_RUN_JOB = 'run-eval';

export interface AiEvalJobData {
  runId: string;
}
