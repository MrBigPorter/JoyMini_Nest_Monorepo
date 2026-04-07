'use client';

import { useTranslations } from 'next-intl';
import {
  Heart,
  Code2,
  Globe,
  Users,
  Github,
  Twitter,
  Mail,
} from 'lucide-react';
import Link from 'next/link';

const teamMembers = [
  {
    name: 'Porter',
    role: '全栈开发',
    avatar: 'https://picsum.photos/id/237/100/100',
    github: 'https://github.com/MrBigPorter',
  },
];

const techStack = [
  { name: 'Next.js 15', icon: '⚡' },
  { name: 'React 19', icon: '⚛️' },
  { name: 'TypeScript', icon: '📘' },
  { name: 'Tailwind CSS', icon: '🎨' },
  { name: 'NestJS', icon: '🏠' },
  { name: 'Prisma', icon: '🗄️' },
  { name: 'PostgreSQL', icon: '🐘' },
  { name: 'Redis', icon: '🔴' },
  { name: 'Docker', icon: '🐳' },
];

export default function AboutPage() {
  const t = useTranslations();

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 md:py-12">
      {/* 页面标题 */}
      <header className="mb-12 text-center">
        <div className="flex items-center justify-center gap-3 mb-4">
          <Heart className="w-10 h-10 text-primary" />
          <h1 className="text-3xl md:text-4xl font-bold">{t('about.title')}</h1>
        </div>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
          {t('about.subtitle')}
        </p>
      </header>

      {/* 项目介绍 */}
      <section className="mb-16">
        <div className="p-8 rounded-2xl border border-border bg-card">
          <h2 className="text-2xl font-semibold mb-6">
            {t('about.visionTitle')}
          </h2>
          {t('about.visionDescription')
            .split('\n\n')
            .map((paragraph: string, index: number) => (
              <p
                key={index}
                className="text-lg text-muted-foreground leading-relaxed mb-4"
              >
                {paragraph}
              </p>
            ))}
        </div>
      </section>

      {/* 技术栈 */}
      <section className="mb-16">
        <h2 className="text-2xl font-semibold mb-6 flex items-center gap-3">
          <Code2 className="w-6 h-6 text-primary" />
          {t('about.techStackTitle')}
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {techStack.map((tech) => (
            <div
              key={tech.name}
              className="p-4 rounded-xl border border-border bg-card text-center hover:border-primary/50 hover:bg-accent/50 transition-all"
            >
              <div className="text-2xl mb-2">{tech.icon}</div>
              <div className="font-medium">{tech.name}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 团队成员 */}
      <section className="mb-16">
        <h2 className="text-2xl font-semibold mb-6 flex items-center gap-3">
          <Users className="w-6 h-6 text-primary" />
          {t('about.teamTitle')}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {teamMembers.map((member) => (
            <div
              key={member.name}
              className="p-6 rounded-xl border border-border bg-card text-center"
            >
              <img
                src={member.avatar}
                alt={member.name}
                className="w-20 h-20 rounded-full mx-auto mb-4 border-2 border-border"
              />
              <h3 className="text-xl font-semibold mb-1">{member.name}</h3>
              <p className="text-muted-foreground mb-4">{member.role}</p>
              <div className="flex justify-center gap-3">
                <Link
                  href={member.github}
                  target="_blank"
                  className="p-2 rounded-full hover:bg-accent hover:text-primary transition-colors"
                >
                  <Github className="w-5 h-5" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 联系我们 */}
      <section className="mb-16">
        <h2 className="text-2xl font-semibold mb-6 flex items-center gap-3">
          <Globe className="w-6 h-6 text-primary" />
          {t('about.contactTitle')}
        </h2>
        <div className="flex flex-wrap gap-4 justify-center">
          <Link
            href="https://github.com/MrBigPorter/lucky_nest_monorepo"
            target="_blank"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-border bg-card hover:border-primary/50 hover:bg-accent/50 transition-all"
          >
            <Github className="w-5 h-5" />
            {t('about.github')}
          </Link>
          <Link
            href="mailto:contact@luckynest.dev"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-border bg-card hover:border-primary/50 hover:bg-accent/50 transition-all"
          >
            <Mail className="w-5 h-5" />
            {t('about.email')}
          </Link>
        </div>
      </section>

      {/* 底部版权 */}
      <div className="text-center py-8 border-t border-border text-muted-foreground">
        <p>© 2026 Lucky Nest. All rights reserved.</p>
        <p className="mt-2 text-sm">Made with ❤️ in China</p>
      </div>
    </div>
  );
}
