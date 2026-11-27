import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { EvalPageQueryDto } from './eval-run.dto';

async function errorsOf(payload: unknown) {
  return validate(plainToInstance(EvalPageQueryDto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

function flatten(errors: any[]): string[] {
  return errors.flatMap((error) => Object.keys(error.constraints ?? {}));
}

describe('运行结果分页参数', () => {
  it('空参数走默认值', async () => {
    expect(await errorsOf({})).toEqual([]);
  });

  it('200 通过、201 与 10000 拒绝', async () => {
    expect(await errorsOf({ page: 1, pageSize: 200 })).toEqual([]);
    expect(flatten(await errorsOf({ pageSize: 201 }))).toContain('max');
    expect(flatten(await errorsOf({ pageSize: 10000 }))).toContain('max');
  });

  it('页大小 0 与非法页码拒绝', async () => {
    expect(flatten(await errorsOf({ pageSize: 0 }))).toContain('min');
    expect(flatten(await errorsOf({ page: 0 }))).toContain('min');
    expect(flatten(await errorsOf({ page: 'abc' }))).toContain('isInt');
  });
});
