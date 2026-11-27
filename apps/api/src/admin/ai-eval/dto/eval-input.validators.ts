import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

/** 评测输入的硬上限；spec `评测用例输入必须限长且查重` 是唯一来源。 */
export const EVAL_CASE_LIMITS = {
  question: 2000,
  answer: 8000,
  tags: 20,
  tagLength: 32,
  mustMention: 20,
  mustMentionLength: 500,
  expectationBytes: 8192,
  caseBatch: 100,
  resultBatch: 500,
} as const;

/** 运行结果分页：默认 50，上限 200；超限返回 400 而不是静默截断。 */
export const EVAL_RUN_RESULTS_LIMITS = {
  defaultPageSize: 50,
  maxPageSize: 200,
} as const;

function serializedBytes(value: unknown): number {
  if (typeof value === 'string') return Buffer.byteLength(value);
  // mustMention 有自己的条数/长度上限；8KB 只约束其余判分条件，
  // 否则「20 条×500 字符」与「整包 8KB」互相矛盾。
  const { mustMention: _ignored, ...rest } = value as Record<string, unknown>;
  return Buffer.byteLength(JSON.stringify(rest));
}

/**
 * 判分条件可以是字符串或对象，`@MaxLength` 只能校验字符串。
 * 这里按「序列化后的字节数」统一校验，和落库/判官读取的量一致。
 */
export function IsEvalExpectation(options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isEvalExpectation',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown) {
          if (value === undefined || value === null) return true;
          if (
            typeof value !== 'string' &&
            (typeof value !== 'object' || Array.isArray(value))
          ) {
            return false;
          }
          if (serializedBytes(value) > EVAL_CASE_LIMITS.expectationBytes) {
            return false;
          }
          if (typeof value !== 'object') return true;
          const mustMention = (value as Record<string, unknown>).mustMention;
          if (mustMention === undefined) return true;
          if (!Array.isArray(mustMention)) return false;
          if (mustMention.length > EVAL_CASE_LIMITS.mustMention) return false;
          return mustMention.every(
            (item) =>
              typeof item === 'string' &&
              item.length <= EVAL_CASE_LIMITS.mustMentionLength,
          );
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must serialize to <= ${EVAL_CASE_LIMITS.expectationBytes} bytes and keep mustMention at <= ${EVAL_CASE_LIMITS.mustMention} items of <= ${EVAL_CASE_LIMITS.mustMentionLength} chars`;
        },
      },
    });
  };
}
