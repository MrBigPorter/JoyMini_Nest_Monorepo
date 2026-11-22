import { extractFinalContent } from './agent-runner';

const ai = (content: string, toolCalls: any[] = []) => ({
  type: 'ai',
  content,
  tool_calls: toolCalls,
});
const tool = (content: string) => ({ type: 'tool', content });

describe('extractFinalContent', () => {
  it('跳过工具结果，返回最后一条有内容的 AI 文本', () => {
    expect(extractFinalContent([ai('hello'), tool('{"ok":true}')])).toBe('hello');
  });

  it('最后一条 AI 没有文本（只带 tool_calls）时，向前找', () => {
    expect(
      extractFinalContent([
        ai('hello'),
        ai('', [{ name: 'updateFlowData' }]),
        tool('{"ok":true}'),
      ]),
    ).toBe('hello');
  });

  it('没有 AI 文本时返回空串，绝不返回工具 JSON', () => {
    expect(extractFinalContent([tool('{"ok":true}')])).toBe('');
  });

  it('非字符串 content 不会把对象 JSON 当回复', () => {
    expect(
      extractFinalContent([
        { type: 'ai', content: [{ type: 'text', text: 'hi' }] },
      ]),
    ).toBe('hi');
  });
});
