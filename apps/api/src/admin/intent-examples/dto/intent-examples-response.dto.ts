export class IntentExampleSectionDto {
  section!: string;
  sentences!: string[];
}

export class IntentExampleGroupResponseDto {
  name!: string;
  examples!: string[];
  sections?: IntentExampleSectionDto[];
  requiredTags?: string[];
  hasAdminOverride!: boolean;
  updatedAt!: string | null;
  isAdminCreated?: boolean;
}

export class UpdateIntentExamplesResponseDto {
  domain!: string;
  count!: number;
}

export class TestClassificationResponseDto {
  intent!: string;
  labels!: { label: string; score: number }[];
  method!: 'embedding' | 'llm_fallback';
  rawTop5?: { domain: string; similarity: number }[];
}
