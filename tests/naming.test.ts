import { describe, it, expect } from 'vitest';
import {
  parseFileName,
  generateFileName,
  generateTimestamp,
  nextSerialNumber,
  isSerialFormat,
  compareSortKeys,
} from '../src/naming.js';
import type { NamingConfig } from '../src/config.js';
import type { ParsedFileName } from '../src/naming.js';

const DEFAULT_NAMING: NamingConfig = {
  pattern: '{timestamp}__{description}.sql',
  timestamp: 'YYYYMMDD_HHMMSS',
  prefix: '',
  sortKey: 'timestamp',
};

describe('naming', () => {
  describe('generateTimestamp', () => {
    it('formats YYYYMMDD_HHMMSS using local timezone', () => {
      const d = new Date(2026, 2, 1, 12, 0, 0); // Mar 1 2026 12:00:00 local
      expect(generateTimestamp('YYYYMMDD_HHMMSS', d)).toBe('20260301_120000');
    });

    it('pads single-digit months and days', () => {
      const d = new Date(2026, 0, 5, 9, 3, 7); // Jan 5 2026 09:03:07 local
      expect(generateTimestamp('YYYYMMDD_HHMMSS', d)).toBe('20260105_090307');
    });
  });

  describe('isSerialFormat', () => {
    it('detects serial formats', () => {
      expect(isSerialFormat('NNNN')).toBe(true);
      expect(isSerialFormat('NNNNNN')).toBe(true);
    });

    it('rejects non-serial formats', () => {
      expect(isSerialFormat('YYYYMMDD_HHMMSS')).toBe(false);
      expect(isSerialFormat('NNN_X')).toBe(false);
    });
  });

  describe('nextSerialNumber', () => {
    it('returns 0001 when no existing files', () => {
      expect(nextSerialNumber('NNNN', [])).toBe('0001');
    });

    it('increments from the highest existing number', () => {
      const existing: ParsedFileName[] = [
        { fullName: 'a.sql', prefix: '', timestamp: '0001', description: 'a', sortKey: '0001' },
        { fullName: 'b.sql', prefix: '', timestamp: '0003', description: 'b', sortKey: '0003' },
        { fullName: 'c.sql', prefix: '', timestamp: '0002', description: 'c', sortKey: '0002' },
      ];
      expect(nextSerialNumber('NNNN', existing)).toBe('0004');
    });

    it('respects the width of the format', () => {
      expect(nextSerialNumber('NNNNNN', [])).toBe('000001');
      const existing: ParsedFileName[] = [
        { fullName: 'a.sql', prefix: '', timestamp: '000099', description: 'a', sortKey: '000099' },
      ];
      expect(nextSerialNumber('NNNNNN', existing)).toBe('000100');
    });
  });

  describe('generateFileName', () => {
    it('generates default pattern with local time', () => {
      const d = new Date(2026, 2, 1, 12, 0, 0); // local
      const name = generateFileName('create_users_table', DEFAULT_NAMING, { now: d });
      expect(name).toBe('20260301_120000__create_users_table.sql');
    });

    it('generates with prefix pattern', () => {
      const naming: NamingConfig = {
        pattern: '{prefix}_{timestamp}__{description}.sql',
        timestamp: 'YYYYMMDD_HHMMSS',
        prefix: 'auth',
        sortKey: 'timestamp',
      };
      const d = new Date(2026, 2, 1, 12, 0, 0);
      const name = generateFileName('add_users_table', naming, { now: d });
      expect(name).toBe('auth_20260301_120000__add_users_table.sql');
    });

    it('handles empty prefix in prefix pattern gracefully', () => {
      const naming: NamingConfig = {
        pattern: '{prefix}_{timestamp}__{description}.sql',
        timestamp: 'YYYYMMDD_HHMMSS',
        prefix: '',
        sortKey: 'timestamp',
      };
      const d = new Date(2026, 2, 1, 12, 0, 0);
      const name = generateFileName('create_table', naming, { now: d });
      expect(name).toBe('20260301_120000__create_table.sql');
    });

    it('generates serial-based filename', () => {
      const naming: NamingConfig = {
        pattern: '{prefix}_{timestamp}__{description}.sql',
        timestamp: 'NNNN',
        prefix: 'billing',
        sortKey: 'timestamp',
      };
      const name = generateFileName('create_invoices', naming, { existingParsed: [] });
      expect(name).toBe('billing_0001__create_invoices.sql');
    });

    it('generates serial-based filename incrementing from existing', () => {
      const naming: NamingConfig = {
        pattern: '{timestamp}__{description}.sql',
        timestamp: 'NNNN',
        prefix: '',
        sortKey: 'timestamp',
      };
      const existing: ParsedFileName[] = [
        { fullName: '0001__a.sql', prefix: '', timestamp: '0001', description: 'a', sortKey: '0001' },
        { fullName: '0002__b.sql', prefix: '', timestamp: '0002', description: 'b', sortKey: '0002' },
      ];
      const name = generateFileName('new_table', naming, { existingParsed: existing });
      expect(name).toBe('0003__new_table.sql');
    });
  });

  describe('parseFileName', () => {
    it('parses default pattern', () => {
      const result = parseFileName('20260301_120000__create_users_table.sql', DEFAULT_NAMING);
      expect(result).toBeDefined();
      expect(result!.timestamp).toBe('20260301_120000');
      expect(result!.description).toBe('create_users_table');
      expect(result!.sortKey).toBe('20260301_120000');
      expect(result!.fullName).toBe('20260301_120000__create_users_table.sql');
    });

    it('parses prefix pattern', () => {
      const naming: NamingConfig = {
        pattern: '{prefix}_{timestamp}__{description}.sql',
        timestamp: 'YYYYMMDD_HHMMSS',
        prefix: 'auth',
        sortKey: 'timestamp',
      };
      const result = parseFileName('auth_20260301_120000__add_users_table.sql', naming);
      expect(result).toBeDefined();
      expect(result!.timestamp).toBe('20260301_120000');
      expect(result!.description).toBe('add_users_table');
      expect(result!.prefix).toBe('auth');
    });

    it('parses serial-based filename', () => {
      const naming: NamingConfig = {
        pattern: '{timestamp}__{description}.sql',
        timestamp: 'NNNN',
        prefix: '',
        sortKey: 'timestamp',
      };
      const result = parseFileName('0003__create_orders.sql', naming);
      expect(result).toBeDefined();
      expect(result!.timestamp).toBe('0003');
      expect(result!.description).toBe('create_orders');
    });

    it('returns undefined for non-matching file name', () => {
      expect(parseFileName('invalid.sql', DEFAULT_NAMING)).toBeUndefined();
      expect(parseFileName('README.md', DEFAULT_NAMING)).toBeUndefined();
    });

    it('returns undefined for file with invalid timestamp format', () => {
      expect(parseFileName('2026__create_users.sql', DEFAULT_NAMING)).toBeUndefined();
    });
  });

  describe('compareSortKeys', () => {
    it('compares timestamps correctly', () => {
      expect(compareSortKeys('20260301_120000', '20260302_093000')).toBeLessThan(0);
      expect(compareSortKeys('20260302_093000', '20260301_120000')).toBeGreaterThan(0);
      expect(compareSortKeys('20260301_120000', '20260301_120000')).toBe(0);
    });
  });

  describe('roundtrip: generate then parse', () => {
    it('generates and parses back consistently', () => {
      const d = new Date(2026, 5, 15, 8, 30, 45); // local time
      const name = generateFileName('add_email_index', DEFAULT_NAMING, { now: d });
      const parsed = parseFileName(name, DEFAULT_NAMING);
      expect(parsed).toBeDefined();
      expect(parsed!.description).toBe('add_email_index');
      expect(parsed!.timestamp).toBe('20260615_083045');
    });

    it('roundtrips with prefix', () => {
      const naming: NamingConfig = {
        pattern: '{prefix}_{timestamp}__{description}.sql',
        timestamp: 'YYYYMMDD_HHMMSS',
        prefix: 'billing',
        sortKey: 'timestamp',
      };
      const d = new Date(2026, 3, 10, 14, 20, 0);
      const name = generateFileName('create_invoices', naming, { now: d });
      const parsed = parseFileName(name, naming);
      expect(parsed).toBeDefined();
      expect(parsed!.description).toBe('create_invoices');
    });

    it('roundtrips with serial numbering', () => {
      const naming: NamingConfig = {
        pattern: '{timestamp}__{description}.sql',
        timestamp: 'NNNN',
        prefix: '',
        sortKey: 'timestamp',
      };
      const existing: ParsedFileName[] = [
        { fullName: '0001__a.sql', prefix: '', timestamp: '0001', description: 'a', sortKey: '0001' },
      ];
      const name = generateFileName('new_table', naming, { existingParsed: existing });
      const parsed = parseFileName(name, naming);
      expect(parsed).toBeDefined();
      expect(parsed!.timestamp).toBe('0002');
      expect(parsed!.description).toBe('new_table');
    });
  });
});
