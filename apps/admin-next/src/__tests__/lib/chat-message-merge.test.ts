import { describe, expect, it } from 'vitest';
import { mergeChatMessages } from '@/lib/chat-message-merge';

describe('mergeChatMessages', () => {
  it('保留已加载的更早消息，并追加新消息', () => {
    const previous = [
      { id: 'm1', seqId: 1, content: '旧问题' },
      { id: 'm2', seqId: 2, content: '旧回答' },
    ];
    const incoming = [
      { id: 'm2', seqId: 2, content: '旧回答' },
      { id: 'm3', seqId: 3, content: '新消息' },
    ];

    expect(mergeChatMessages(previous, incoming)).toEqual([
      { id: 'm1', seqId: 1, content: '旧问题' },
      { id: 'm2', seqId: 2, content: '旧回答' },
      { id: 'm3', seqId: 3, content: '新消息' },
    ]);
  });

  it('同 id 用新内容覆盖（撤回/编辑）', () => {
    const previous = [{ id: 'm1', seqId: 1, content: '原文' }];
    const incoming = [{ id: 'm1', seqId: 1, content: '已撤回' }];

    expect(mergeChatMessages(previous, incoming)[0].content).toBe('已撤回');
  });
});
