'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  MessageSquare,
  Heart,
  Reply,
  MoreHorizontal,
  ChevronDown,
  ChevronUp,
  LogIn
} from 'lucide-react';
import { Link } from '@/navigation';

// Mock 评论数据
const mockComments = [
  {
    id: 1,
    author: {
      name: 'Porter',
      avatar: 'https://picsum.photos/id/237/48/48',
    },
    content: '非常棒的文章！解释得很清楚，学到了很多新知识。',
    createdAt: '2026-04-05 14:30',
    likes: 12,
    isLiked: false,
    replies: [
      {
        id: 11,
        author: {
          name: 'Alice',
          avatar: 'https://picsum.photos/id/238/48/48',
        },
        content: '同意，这是我见过最清晰的讲解了',
        createdAt: '2026-04-05 15:10',
        likes: 5,
        isLiked: true,
        replies: [],
      },
    ],
  },
  {
    id: 2,
    author: {
      name: 'Bob',
      avatar: 'https://picsum.photos/id/239/48/48',
    },
    content: '请问在生产环境中使用有什么需要特别注意的地方吗？',
    createdAt: '2026-04-04 09:15',
    likes: 8,
    isLiked: false,
    replies: [],
  },
  {
    id: 3,
    author: {
      name: 'Charlie',
      avatar: 'https://picsum.photos/id/240/48/48',
    },
    content: '感谢分享！已经收藏了，准备在项目中实践一下。',
    createdAt: '2026-04-03 18:45',
    likes: 15,
    isLiked: true,
    replies: [],
  },
];

interface CommentProps {
  comment: typeof mockComments[0];
  depth?: number;
}

function Comment({ comment, depth = 0 }: CommentProps) {
  const t = useTranslations();
  const [showReplies, setShowReplies] = useState(true);
  const [isLiked, setIsLiked] = useState(comment.isLiked);
  const [likeCount, setLikeCount] = useState(comment.likes);
  const [showReplyInput, setShowReplyInput] = useState(false);

  const handleLike = () => {
    setIsLiked(!isLiked);
    setLikeCount(isLiked ? likeCount - 1 : likeCount + 1);
  };

  return (
    <div className={`${depth > 0 ? 'ml-10 border-l-2 border-border pl-4' : ''}`}>
      <div className="flex gap-4 py-4">
        <img
          src={comment.author.avatar}
          alt={comment.author.name}
          className="w-10 h-10 rounded-full flex-shrink-0"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <span className="font-semibold">{comment.author.name}</span>
              <span className="text-sm text-muted-foreground ml-3">{comment.createdAt}</span>
            </div>
            <button className="text-muted-foreground hover:text-foreground">
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </div>

          <p className="mt-2 text-foreground leading-relaxed">
            {comment.content}
          </p>

          <div className="flex items-center gap-4 mt-3">
            <button
              onClick={handleLike}
              className={`flex items-center gap-1.5 text-sm transition-colors ${
                isLiked ? 'text-red-500' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Heart className={`w-4 h-4 ${isLiked ? 'fill-current' : ''}`} />
              <span>{likeCount}</span>
            </button>

            <button
              onClick={() => setShowReplyInput(!showReplyInput)}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <Reply className="w-4 h-4" />
              <span>{t('comment.reply')}</span>
            </button>
          </div>

          {showReplyInput && (
            <div className="mt-4">
              <textarea
                placeholder={t('comment.writeReply')}
                className="w-full p-3 rounded-xl border border-border bg-background resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                rows={2}
              />
              <div className="flex justify-end gap-2 mt-2">
                <button
                  onClick={() => setShowReplyInput(false)}
                  className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:bg-accent transition-colors"
                >
                  {t('common.cancel')}
                </button>
                <button className="px-4 py-2 rounded-lg text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                  {t('comment.submit')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {comment.replies.length > 0 && (
        <div className="mt-2">
          <button
            onClick={() => setShowReplies(!showReplies)}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2"
          >
            {showReplies ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            <span>{t('comment.repliesCount', { count: comment.replies.length })}</span>
          </button>

          {showReplies && (
            <div className="space-y-1">
              {comment.replies.map((reply) => (
                <Comment key={reply.id} comment={reply} depth={depth + 1} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function CommentList() {
  const t = useTranslations();

  return (
    <section className="mt-16">
      <header className="flex items-center gap-3 mb-8">
        <MessageSquare className="w-6 h-6 text-primary" />
        <h2 className="text-2xl font-bold">
          {t('comment.title')}
        </h2>
        <span className="text-muted-foreground">({mockComments.length})</span>
      </header>

      {/* 评论输入框 */}
      <div className="mb-8">
        <div className="p-6 rounded-xl border border-border bg-muted/30 text-center">
          <p className="text-muted-foreground mb-4">{t('comment.loginRequired')}</p>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
          >
            <LogIn className="w-4 h-4" />
            {t('auth.login.button')}
          </Link>
        </div>
      </div>

      {/* 评论列表 */}
      <div className="divide-y divide-border">
        {mockComments.map((comment) => (
          <Comment key={comment.id} comment={comment} />
        ))}
      </div>
    </section>
  );
}