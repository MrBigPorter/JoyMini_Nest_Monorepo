/**
 * 评测运行队列。
 *
 * 评测从「请求线程里 fire-and-forget」改成 BullMQ 作业：
 *   - 进程重启后未完成的 run 仍在 Redis，可被 worker 继续消费；
 *   - 同一 run 用 run.id 作 jobId，重复投递只会保留一个 job；
 *   - 失败由 executeRun 落 FAILED + summary.error，不走无意义的重试。
 *
 * 尚未实现（后续任务）：token/成本预算与 usage 记账；本任务只做作业化与取消。
 */
export const AI_EVAL_QUEUE = 'ai-eval';

/** 评测 run 作业名；jobId 使用 run id，保证同一 run 只入队一次。 */
export const AI_EVAL_RUN_JOB = 'run-eval';

export interface AiEvalJobData {
  runId: string;
}
