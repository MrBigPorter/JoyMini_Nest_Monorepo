import { cleanResult } from './clean-result';

describe('cleanResult', () => {
  describe('disclaimer filtering', () => {
    it('filters "this is outside my scope" line', () => {
      expect(cleanResult('Data\nThis is outside my scope')).toBe('Data');
    });

    it('filters "outside my scope" (variation)', () => {
      expect(cleanResult('Info\nOutside my scope')).toBe('Info');
    });

    it('filters "not my field" line', () => {
      expect(cleanResult('Result\nThat is not my field').trim()).toBe('Result');
    });

    it('filters "not my responsibility" line', () => {
      expect(cleanResult('Output\nThis is not my responsibility').trim()).toBe('Output');
    });

    it('filters "not my area" line', () => {
      expect(cleanResult('Data\nThis is not my area').trim()).toBe('Data');
    });

    it('filters "cannot help with that" line', () => {
      expect(cleanResult('Info\nI cannot help with that').trim()).toBe('Info');
    });

    it('filters "please contact another team" line', () => {
      expect(
        cleanResult('Result\nPlease contact another team for assistance').trim(),
      ).toBe('Result');
    });

    it('filters "please contact the relevant department" line', () => {
      expect(
        cleanResult('Output\nPlease contact the relevant department').trim(),
      ).toBe('Output');
    });

    it('filters "i only handle" line', () => {
      expect(cleanResult('Data\nI only handle wallet topics').trim()).toBe('Data');
    });

    it('filters "i handle" line', () => {
      expect(cleanResult('Info\nI handle only orders').trim()).toBe('Info');
    });

    it('handles multiple disclaimer lines', () => {
      const input = `Balance: ₱100
This is outside my scope
Not my responsibility
Transactions: 5`;
      expect(cleanResult(input)).toBe('Balance: ₱100\nTransactions: 5');
    });
  });

  describe('normal content passthrough', () => {
    it('preserves normal data lines', () => {
      expect(cleanResult('Balance: ₱100\nTransactions: 5')).toBe(
        'Balance: ₱100\nTransactions: 5',
      );
    });

    it('preserves lines with similar but safe text', () => {
      const input = 'Please handle my withdrawal request';
      expect(cleanResult(input)).toBe('Please handle my withdrawal request');
    });

    it('preserves multi-line output unchanged', () => {
      const input = `You have 2 coupons:
1. Welcome Bonus — 50% off, valid until 2025-12-31
2. Free Shipping — Free, valid until 2025-11-30`;
      expect(cleanResult(input)).toBe(input);
    });
  });

  describe('edge cases', () => {
    it('returns empty string for all-disclaimer input', () => {
      expect(cleanResult('Outside my scope\nNot my field')).toBe('');
    });

    it('trims whitespace from result', () => {
      expect(cleanResult('  Data line  \n  Outside my scope  ')).toBe('Data line');
    });

    it('handles empty input', () => {
      expect(cleanResult('')).toBe('');
    });

    it('handles single line without disclaimers', () => {
      expect(cleanResult('Just a normal line')).toBe('Just a normal line');
    });

    it('handles text with newlines only', () => {
      expect(cleanResult('\n\n\n')).toBe('');
    });
  });
});
