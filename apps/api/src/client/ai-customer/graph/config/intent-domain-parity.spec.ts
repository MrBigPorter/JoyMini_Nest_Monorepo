/**
 * 注册表一致性测试（M0 验收项）
 *
 * 锁住三份「标签清单」不再漂移：
 *   1. TS 种子（DB 空表时的兜底）
 *   2. INTENT_LABEL_CATEGORIES（分类/去重逻辑读的常量）
 *   3. AGENT_BASE_MAP（Agent 路由目标）
 *
 * 以及文档域种子必须落在合法枚举内、投放意图必须已注册。
 */
import { AGENT_BASE_MAP, AGENT_TAGS_FOR_INTENT } from './agent-tags';
import {
  INTENT_DOMAIN_SEEDS,
  IntentDomainSnapshot,
  buildIntentDomainPromptSection,
  deriveValidIntents,
} from './intent-domain-registry';
import {
  INTENT_LABEL_CATEGORIES,
  VALID_INTENTS,
} from '../agents/prompts/intent-label-categories';
import { buildIntentPrompt } from '../agents/prompts/intent-prompt-builder';
import { KNOWLEDGE_DOMAIN_SEEDS } from '@api/admin/rag/knowledge-domain.seeds';
import {
  KNOWLEDGE_DOMAIN_KEYS,
  normalizeKnowledgeDomain,
} from '@api/admin/rag/domain-normalization';

const snapshot: IntentDomainSnapshot[] = INTENT_DOMAIN_SEEDS.map((seed) => ({
  ...seed,
  enabled: true,
}));

describe('intent domain registry parity', () => {
  it('seed labels 与 INTENT_LABEL_CATEGORIES 完全一致', () => {
    expect(INTENT_DOMAIN_SEEDS.map((s) => s.label)).toEqual(
      INTENT_LABEL_CATEGORIES.map((c) => c.name),
    );
  });

  it('seed type 与 INTENT_LABEL_CATEGORIES 一致', () => {
    for (const [index, seed] of INTENT_DOMAIN_SEEDS.entries()) {
      expect(seed.type).toBe(INTENT_LABEL_CATEGORIES[index].type);
    }
  });

  it('每个非 transfer 域都能在 AGENT_BASE_MAP 找到落点', () => {
    const agentMap = AGENT_BASE_MAP as Record<string, { type: string }>;
    for (const seed of INTENT_DOMAIN_SEEDS) {
      if (seed.type === 'transfer') {
        expect(seed.agentTag).toBeNull();
        continue;
      }

      expect(seed.agentTag).toBe(seed.label);
      expect(agentMap[seed.label]).toBeDefined();
      expect(agentMap[seed.label].type).not.toBe('tool-only');
    }
  });

  it('所有需要分类的 Agent 都有对应业务域（rag/general 除外）', () => {
    const businessSeeds = INTENT_DOMAIN_SEEDS.filter(
      (seed) => seed.type === 'business' && seed.label !== 'rag',
    ).map((seed) => seed.label);

    expect(new Set(businessSeeds)).toEqual(new Set(AGENT_TAGS_FOR_INTENT));
  });

  it('允许列表与 VALID_INTENTS 一致', () => {
    expect(deriveValidIntents(snapshot)).toEqual(VALID_INTENTS);
  });

  it('LLM prompt 包含每个标签与描述，且不含未注册标签', () => {
    const section = buildIntentDomainPromptSection(snapshot);
    for (const seed of INTENT_DOMAIN_SEEDS) {
      expect(section).toContain(`- ${seed.label}: ${seed.description}`);
    }
  });

  it('buildIntentPrompt 有快照时使用动态标签章节', () => {
    const prompt = buildIntentPrompt({ domains: snapshot });
    expect(prompt).toContain(
      `- rag: ${INTENT_DOMAIN_SEEDS.find((s) => s.label === 'rag')!.description}`,
    );
    // 旧硬编码串不应再出现
    expect(prompt).not.toContain(
      'Supported labels: order, wallet, coupon, user, product',
    );
  });

  it('文档域种子与受控枚举一致，投放意图必须已注册', () => {
    expect(KNOWLEDGE_DOMAIN_SEEDS.map((s) => s.key).sort()).toEqual(
      [...KNOWLEDGE_DOMAIN_KEYS].sort(),
    );

    const registeredIntents = new Set(INTENT_DOMAIN_SEEDS.map((s) => s.label));
    for (const seed of KNOWLEDGE_DOMAIN_SEEDS) {
      expect(registeredIntents.has(seed.candidateTargetIntent)).toBe(true);
    }
  });

  it('别名归一结果只落在合法文档域内', () => {
    const allowed = new Set<string>(KNOWLEDGE_DOMAIN_KEYS);
    for (const raw of [
      'order',
      'lucky_draw',
      'luckyDraw',
      'kyc_verification',
      'general',
      '',
      null,
      undefined,
    ]) {
      expect(allowed.has(normalizeKnowledgeDomain(raw))).toBe(true);
    }

    expect(normalizeKnowledgeDomain('lucky_draw')).toBe('lucky-draw');
    expect(normalizeKnowledgeDomain('general')).toBe('common');
  });
});
