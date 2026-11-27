import {
  classifyCaseDiff,
  hadFailureBefore,
  outcomeFromAnswerVerdict,
  outcomeFromVerdict,
  type CaseOutcome,
} from './case-history.util';

describe('case-history util', () => {
  describe('判定归一', () => {
    it('外部 answer_accuracy：只有 correct/incorrect 可比较', () => {
      expect(outcomeFromAnswerVerdict('correct')).toBe('pass');
      expect(outcomeFromAnswerVerdict('incorrect')).toBe('fail');
      expect(outcomeFromAnswerVerdict('judge_error')).toBe('undecided');
      expect(outcomeFromAnswerVerdict(null)).toBe('undecided');
      expect(outcomeFromAnswerVerdict(undefined)).toBe('undecided');
    });

    it('内部 verdict3：solved 通过，partial/unsolved 失败', () => {
      expect(outcomeFromVerdict('solved')).toBe('pass');
      expect(outcomeFromVerdict('partial')).toBe('fail');
      expect(outcomeFromVerdict('unsolved')).toBe('fail');
      expect(outcomeFromVerdict(null)).toBe('undecided');
    });
  });

  describe('两次运行的四类描述性差异', () => {
    it('基线通过、当前失败且此前从未失败：新增失败', () => {
      expect(
        classifyCaseDiff({
          baseline: 'pass',
          current: 'fail',
          hadEarlierFailure: false,
        }),
      ).toBe('newFailure');
    });

    it('基线通过、当前失败且此前失败过：回退', () => {
      expect(
        classifyCaseDiff({
          baseline: 'pass',
          current: 'fail',
          hadEarlierFailure: true,
        }),
      ).toBe('regressed');
    });

    it('基线失败、当前通过：修复', () => {
      expect(
        classifyCaseDiff({
          baseline: 'fail',
          current: 'pass',
          hadEarlierFailure: true,
        }),
      ).toBe('fixed');
      expect(
        classifyCaseDiff({
          baseline: 'fail',
          current: 'pass',
          hadEarlierFailure: false,
        }),
      ).toBe('fixed');
    });

    it('两次都失败：仍失败', () => {
      expect(
        classifyCaseDiff({
          baseline: 'fail',
          current: 'fail',
          hadEarlierFailure: true,
        }),
      ).toBe('stillFailing');
    });

    it('两次都通过不属于四分类', () => {
      expect(
        classifyCaseDiff({
          baseline: 'pass',
          current: 'pass',
          hadEarlierFailure: false,
        }),
      ).toBeNull();
    });

    it('任一端未判出结论就不分类，避免把判官故障记成回归', () => {
      const undecided: CaseOutcome = 'undecided';
      expect(
        classifyCaseDiff({
          baseline: undecided,
          current: 'fail',
          hadEarlierFailure: false,
        }),
      ).toBeNull();
      expect(
        classifyCaseDiff({
          baseline: 'pass',
          current: undecided,
          hadEarlierFailure: false,
        }),
      ).toBeNull();
    });
  });

  describe('历史判定', () => {
    it('只看当前点之前是否出现过失败', () => {
      const points: Array<{ outcome: CaseOutcome }> = [
        { outcome: 'fail' },
        { outcome: 'pass' },
        { outcome: 'fail' },
      ];

      expect(hadFailureBefore(points, 0)).toBe(false);
      expect(hadFailureBefore(points, 1)).toBe(true);
      expect(hadFailureBefore(points, 2)).toBe(true);
    });

    it('未判出结论的点不算失败', () => {
      expect(
        hadFailureBefore([{ outcome: 'undecided' }, { outcome: 'pass' }], 1),
      ).toBe(false);
    });
  });
});
