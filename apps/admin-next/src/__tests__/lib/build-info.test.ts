import { describe, expect, it } from 'vitest';
import { buildBuildInfoViewModel } from '@/lib/build-info';

describe('buildBuildInfoViewModel', () => {
  it('returns null when both deployedAt and gitSha are missing', () => {
    expect(buildBuildInfoViewModel()).toBeNull();
  });

  it('formats ISO timestamps into compact UTC text', () => {
    expect(
      buildBuildInfoViewModel(
        '2026-03-21T08:09:10Z',
        'abcdef1234567890abcdef1234567890abcdef12',
      ),
    ).toEqual({
      label: '2026-03-21 08:09 UTC',
      shortSha: 'abcdef1',
      fullSha: 'abcdef1234567890abcdef1234567890abcdef12',
      tooltip:
        '2026-03-21 08:09 UTC · commit abcdef1234567890abcdef1234567890abcdef12',
    });
  });

  it('maps local-dev markers to a readable local label', () => {
    expect(buildBuildInfoViewModel('local-dev', 'local-dev')).toEqual({
      label: 'Local build',
      shortSha: null,
      fullSha: null,
      tooltip: 'Local build',
    });
  });

  it('keeps the raw deployedAt value when it is not parseable as a date', () => {
    expect(buildBuildInfoViewModel('preview-build', '1234567890')).toEqual({
      label: 'preview-build',
      shortSha: '1234567',
      fullSha: '1234567890',
      tooltip: 'preview-build · commit 1234567890',
    });
  });
});
