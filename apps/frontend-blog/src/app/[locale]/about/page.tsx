import { getTranslations } from 'next-intl/server';
import { getEnabledLocales, type Locale } from '@/lib/i18n/config';
import {
  Heart,
  Code2,
  Github,
  Mail,
  Rocket,
  Shield,
  Zap,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';

export const revalidate = 3600;
export const dynamic = 'force-static';

// generate static params for all locales
export async function generateStaticParams() {
  return getEnabledLocales().map((locale: Locale) => ({ locale }));
}

const teamMembers = [
  {
    name: 'Porter',
    roleKey: 'teamRoleFullStack',
    avatar:
      'https://img.joyminis.com/Gemini_Generated_Image_l8u1b7l8u1b7l8u1.png',
    github: 'https://github.com/MrBigPorter',
    skills: ['TypeScript', 'React', 'Node.js', 'Flutter', 'DevOps'],
  },
];

const techStackGroups = [
  {
    category: 'frontend',
    titleKey: 'techCategoryFrontend',
    descriptionKey: 'techCategoryFrontendDesc',
    items: [
      { name: 'Next.js 15', icon: '⚡', descriptionKey: 'techNextjs' },
      { name: 'React 19', icon: '⚛️', descriptionKey: 'techReact' },
      { name: 'TypeScript', icon: '📘', descriptionKey: 'techTypescript' },
      { name: 'Tailwind CSS', icon: '🎨', descriptionKey: 'techTailwind' },
    ],
  },
  {
    category: 'mobile',
    titleKey: 'techCategoryMobile',
    descriptionKey: 'techCategoryMobileDesc',
    items: [
      { name: 'Flutter', icon: '📱', descriptionKey: 'techFlutter' },
      { name: 'Shorebird', icon: '🔄', descriptionKey: 'techShorebird' },
      { name: 'Capacitor', icon: '🔋', descriptionKey: 'techCapacitor' },
      { name: 'sembast', icon: '💾', descriptionKey: 'techSembast' },
    ],
  },
  {
    category: 'backend',
    titleKey: 'techCategoryBackend',
    descriptionKey: 'techCategoryBackendDesc',
    items: [
      { name: 'NestJS', icon: '🏠', descriptionKey: 'techNestjs' },
      { name: 'Prisma', icon: '🗄️', descriptionKey: 'techPrisma' },
      { name: 'PostgreSQL', icon: '🐘', descriptionKey: 'techPostgresql' },
      { name: 'Redis', icon: '🔴', descriptionKey: 'techRedis' },
      { name: 'SQLite', icon: '💿', descriptionKey: 'techSqlite' },
      { name: 'BullMQ', icon: '📨', descriptionKey: 'techBullmq' },
    ],
  },
  {
    category: 'ai',
    titleKey: 'techCategoryAi',
    descriptionKey: 'techCategoryAiDesc',
    items: [
      {
        name: 'AWS Rekognition',
        icon: '🤖',
        descriptionKey: 'techAwsRekognition',
      },
      { name: 'Google Vertex AI', icon: '🧠', descriptionKey: 'techVertexAi' },
      { name: 'AI Agent', icon: '🤝', descriptionKey: 'techAiAgent' },
    ],
  },
  {
    category: 'devops',
    titleKey: 'techCategoryDevops',
    descriptionKey: 'techCategoryDevopsDesc',
    items: [
      { name: 'Docker', icon: '🐳', descriptionKey: 'techDocker' },
      {
        name: 'GitHub Actions',
        icon: '⚙️',
        descriptionKey: 'techGithubActions',
      },
      {
        name: 'Cloudflare Workers',
        icon: '☁️',
        descriptionKey: 'techCloudflare',
      },
      { name: 'Vite', icon: '⚡', descriptionKey: 'techVite' },
    ],
  },
  {
    category: 'monitoring',
    titleKey: 'techCategoryMonitoring',
    descriptionKey: 'techCategoryMonitoringDesc',
    items: [
      { name: 'Sentry', icon: '🚨', descriptionKey: 'techSentry' },
      { name: 'Playwright', icon: '🎭', descriptionKey: 'techPlaywright' },
      { name: 'Jest/Vitest', icon: '🧪', descriptionKey: 'techJestVitest' },
    ],
  },
  {
    category: 'communication',
    titleKey: 'techCategoryCommunication',
    descriptionKey: 'techCategoryCommunicationDesc',
    items: [
      { name: 'WebSocket', icon: '💬', descriptionKey: 'techWebsocket' },
      { name: 'Socket.IO', icon: '🔌', descriptionKey: 'techSocketIo' },
      { name: 'FCM', icon: '📲', descriptionKey: 'techFcm' },
      { nameKey: 'techOauth', icon: '🔑', descriptionKey: 'techOauth' },
    ],
  },
  {
    category: 'design',
    titleKey: 'techCategoryDesign',
    descriptionKey: 'techCategoryDesignDesc',
    items: [
      { name: 'Figma', icon: '🎨', descriptionKey: 'techFigma' },
      { name: 'Figma Token', icon: '🎯', descriptionKey: 'techFigmaToken' },
      { nameKey: 'techSeo', icon: '🔍', descriptionKey: 'techSeo' },
    ],
  },
  {
    category: 'i18n',
    titleKey: 'techCategoryI18n',
    descriptionKey: 'techCategoryI18nDesc',
    items: [{ name: 'next-intl', icon: '🌐', descriptionKey: 'techNextIntl' }],
  },
];

const coreValues = [
  {
    icon: <Rocket className="w-8 h-8" />,
    key: 'Innovation',
  },
  {
    icon: <Shield className="w-8 h-8" />,
    key: 'Security',
  },
  {
    icon: <Zap className="w-8 h-8" />,
    key: 'Performance',
  },
  {
    icon: <Sparkles className="w-8 h-8" />,
    key: 'UserExperience',
  },
];

export default async function AboutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: routeLocale } = await params;

  // 关键修复：SSR环境直接使用URL路径中的语言
  const locale = routeLocale;
  const t = await getTranslations({ locale });

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/10 to-secondary/10" />
        <div className="relative max-w-6xl mx-auto px-4 py-16 md:py-24">
          <div className="text-center">
            <div className="inline-flex items-center justify-center p-3 rounded-2xl bg-primary/10 mb-6">
              <Heart className="w-10 h-10 text-primary" />
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-6">
              {t('about.title')}
            </h1>
            <p className="text-xl md:text-2xl text-muted-foreground max-w-3xl mx-auto leading-relaxed">
              {t('about.subtitle')}
            </p>
          </div>
        </div>
      </section>

      {/* Founder Profile - Centered Design */}
      <section className="py-16 md:py-24">
        <div className="max-w-5xl mx-auto px-4">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-3 mb-4">
              <div className="p-3 rounded-xl bg-primary/10">
                <Sparkles className="w-6 h-6 text-primary" />
              </div>
              <h2 className="text-3xl font-bold">{t('about.founderTitle')}</h2>
            </div>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              {t('about.founderDescription')}
            </p>
          </div>

          <div className="relative">
            {/* Background decoration */}
            <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-secondary/5 rounded-3xl blur-3xl opacity-50" />

            {/* Main profile card */}
            <div className="relative bg-card border border-border/50 rounded-2xl p-8 md:p-12 shadow-xl">
              <div className="grid lg:grid-cols-5 gap-8 items-center">
                {/* Avatar section */}
                <div className="lg:col-span-2 flex flex-col items-center">
                  <div className="relative w-64 h-64">
                    <div className="absolute inset-0 bg-gradient-to-r from-primary/20 to-secondary/20 rounded-full blur-xl opacity-50" />
                    <img
                      src={teamMembers[0].avatar}
                      alt={teamMembers[0].name}
                      className="relative w-full h-full rounded-full border-4 border-background object-cover shadow-2xl z-10"
                    />
                    {/* Status indicator */}
                    <div className="absolute bottom-4 right-4 w-6 h-6 bg-green-500 rounded-full border-2 border-background z-20" />
                  </div>

                  {/* Quick stats */}
                  <div className="mt-8 grid grid-cols-3 gap-4 w-full max-w-xs">
                    <div className="text-center p-3 rounded-lg bg-muted/50">
                      <div className="text-2xl font-bold text-primary">10+</div>
                      <div className="text-xs text-muted-foreground">
                        {t('about.founderStatYears')}
                      </div>
                    </div>
                    <div className="text-center p-3 rounded-lg bg-muted/50">
                      <div className="text-2xl font-bold text-primary">50+</div>
                      <div className="text-xs text-muted-foreground">
                        {t('about.founderStatProjects')}
                      </div>
                    </div>
                    <div className="text-center p-3 rounded-lg bg-muted/50">
                      <div className="text-2xl font-bold text-primary">4</div>
                      <div className="text-xs text-muted-foreground">
                        {t('about.founderStatStacks')}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Info section */}
                <div className="lg:col-span-3 space-y-6">
                  <div>
                    <h3 className="text-4xl font-bold mb-2">
                      {teamMembers[0].name}
                    </h3>
                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary font-medium">
                      <Rocket className="w-4 h-4" />
                      {t(`about.${teamMembers[0].roleKey}`)}
                    </div>
                  </div>

                  <p className="text-lg text-muted-foreground leading-relaxed">
                    {t('about.founderBio')}
                  </p>

                  {/* Expertise */}
                  <div>
                    <h4 className="font-semibold mb-3">
                      {t('about.founderExpertise')}
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {teamMembers[0].skills.map((skill, index) => (
                        <span
                          key={index}
                          className="px-4 py-2 rounded-full bg-gradient-to-r from-primary/10 to-secondary/10 border border-primary/20 text-primary font-medium hover:from-primary/20 hover:to-secondary/20 hover:border-primary/30 transition-all"
                        >
                          {skill}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Contact & Social */}
                  <div className="pt-6 border-t border-border/50">
                    <h4 className="font-semibold mb-4">
                      {t('about.founderConnect')}
                    </h4>
                    <div className="flex flex-wrap gap-4">
                      <Link
                        href={teamMembers[0].github}
                        target="_blank"
                        className="inline-flex items-center gap-3 px-6 py-3 rounded-xl bg-gradient-to-r from-primary/10 to-secondary/10 border border-primary/20 text-primary hover:from-primary/20 hover:to-secondary/20 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/10 transition-all duration-300"
                      >
                        <Github className="w-5 h-5" />
                        <span className="font-medium">{t('about.github')}</span>
                      </Link>
                      <Link
                        href="mailto:mrsuperporter@gmail.com"
                        className="inline-flex items-center gap-3 px-6 py-3 rounded-xl bg-gradient-to-r from-primary/10 to-secondary/10 border border-primary/20 text-primary hover:from-primary/20 hover:to-secondary/20 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/10 transition-all duration-300"
                      >
                        <Mail className="w-5 h-5" />
                        <span className="font-medium">{t('about.email')}</span>
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Vision Section */}
      <section className="py-16 md:py-24">
        <div className="max-w-6xl mx-auto px-4">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-3 mb-6">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Rocket className="w-6 h-6 text-primary" />
                </div>
                <h2 className="text-3xl font-bold">{t('about.visionTitle')}</h2>
              </div>
              <div className="space-y-4 text-lg text-muted-foreground leading-relaxed">
                {t('about.visionDescription')
                  .split('\n\n')
                  .map((paragraph: string, index: number) => (
                    <p key={index}>{paragraph}</p>
                  ))}
              </div>
            </div>
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-primary/20 to-secondary/20 rounded-3xl blur-3xl opacity-50" />
              <div className="relative p-8 rounded-2xl border border-border/50 bg-card/50 backdrop-blur-sm">
                <h3 className="text-2xl font-semibold mb-6">
                  {t('about.coreValuesTitle')}
                </h3>
                <div className="grid sm:grid-cols-2 gap-4">
                  {coreValues.map((value, index) => (
                    <div
                      key={index}
                      className="p-4 rounded-xl border border-border bg-background hover:border-primary/30 transition-all"
                    >
                      <div className="flex items-center gap-3 mb-3">
                        <div className="text-primary">{value.icon}</div>
                        <h4 className="font-semibold">
                          {t(`about.coreValue${value.key}Title`)}
                        </h4>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {t(`about.coreValue${value.key}Desc`)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Tech Stack Section */}
      <section className="py-16 md:py-24 bg-muted/30">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-3 mb-4">
              <Code2 className="w-8 h-8 text-primary" />
              <h2 className="text-3xl font-bold">
                {t('about.techStackTitle')}
              </h2>
            </div>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              {t('about.techStackDescription')}
            </p>
          </div>
          <div className="space-y-12">
            {techStackGroups.map((group) => (
              <div key={group.category} className="space-y-6">
                <div className="text-center">
                  <h3 className="text-2xl font-bold mb-2">
                    {t(`about.${group.titleKey}`)}
                  </h3>
                  <p className="text-muted-foreground max-w-2xl mx-auto">
                    {t(`about.${group.descriptionKey}`)}
                  </p>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {group.items.map((tech) => (
                    <div
                      key={tech.name || tech.descriptionKey}
                      className="group p-6 rounded-xl border border-border bg-card hover:border-primary/50 hover:bg-accent/50 transition-all duration-300"
                    >
                      <div className="text-3xl mb-3">{tech.icon}</div>
                      <h3 className="font-semibold mb-2">
                        {tech.name || t(`about.${tech.nameKey}`)}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {t(`about.${tech.descriptionKey}`)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t border-border">
        <div className="max-w-6xl mx-auto px-4 text-center">
          <div className="mb-6">
            <div className="inline-flex items-center gap-2 text-2xl font-bold mb-2">
              <img
                src="/logo.png"
                alt="Tarsier Labs"
                className="w-6 h-6 object-contain"
                width={24}
                height={24}
              />
              Tarsier Labs
            </div>
            <p className="text-muted-foreground">{t('about.madeWithLove')}</p>
          </div>
          <p className="text-sm text-muted-foreground">
            {t('about.copyright')}
          </p>
        </div>
      </footer>
    </div>
  );
}
