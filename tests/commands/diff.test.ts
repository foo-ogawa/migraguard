import { describe, it, expect } from 'vitest';
import chalk from 'chalk';
import { formatSchemaDiff } from '../../src/commands/diff.js';

describe('commands/diff', () => {
  it('module exports commandDiff', async () => {
    const mod = await import('../../src/commands/diff.js');
    expect(typeof mod.commandDiff).toBe('function');
  });

  describe('formatSchemaDiff', () => {
    it('shows only the inserted lines when lines are added in the middle', () => {
      const saved = [
        'ALTER TABLE ONLY public.meal_nutrient_summaries',
        '    ADD CONSTRAINT meal_nutrient_summaries_pkey PRIMARY KEY (id);',
        'ALTER TABLE ONLY public.reminder_dismissals',
        '    ADD CONSTRAINT reminder_dismissals_pkey PRIMARY KEY (id);',
        '',
      ].join('\n');
      const current = [
        'ALTER TABLE ONLY public.health_records',
        '    ADD CONSTRAINT health_records_user_metric_date_unique UNIQUE (user_id, metric_type, recorded_date);',
        'ALTER TABLE ONLY public.meal_nutrient_summaries',
        '    ADD CONSTRAINT meal_nutrient_summaries_pkey PRIMARY KEY (id);',
        'ALTER TABLE ONLY public.reminder_dismissals',
        '    ADD CONSTRAINT reminder_dismissals_pkey PRIMARY KEY (id);',
        '',
      ].join('\n');

      const result = formatSchemaDiff(saved, current);
      const plain = chalk.level;
      chalk.level = 0;
      const plainResult = formatSchemaDiff(saved, current);
      chalk.level = plain;

      const lines = plainResult.split('\n');
      expect(lines).toHaveLength(2);
      expect(lines[0]).toBe('+ ALTER TABLE ONLY public.health_records');
      expect(lines[1]).toBe(
        '+     ADD CONSTRAINT health_records_user_metric_date_unique UNIQUE (user_id, metric_type, recorded_date);',
      );
    });

    it('shows removed lines when lines are deleted', () => {
      const saved = [
        'CREATE TABLE users (id SERIAL);',
        'CREATE TABLE orders (id SERIAL);',
        'CREATE TABLE products (id SERIAL);',
        '',
      ].join('\n');
      const current = [
        'CREATE TABLE users (id SERIAL);',
        'CREATE TABLE products (id SERIAL);',
        '',
      ].join('\n');

      const plain = chalk.level;
      chalk.level = 0;
      const result = formatSchemaDiff(saved, current);
      chalk.level = plain;

      const lines = result.split('\n');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toBe('- CREATE TABLE orders (id SERIAL);');
    });

    it('shows both removed and added for a modified line', () => {
      const saved = [
        'CREATE TABLE users (id SERIAL);',
        '',
      ].join('\n');
      const current = [
        'CREATE TABLE users (id BIGSERIAL);',
        '',
      ].join('\n');

      const plain = chalk.level;
      chalk.level = 0;
      const result = formatSchemaDiff(saved, current);
      chalk.level = plain;

      const lines = result.split('\n');
      expect(lines).toContainEqual('- CREATE TABLE users (id SERIAL);');
      expect(lines).toContainEqual('+ CREATE TABLE users (id BIGSERIAL);');
    });

    it('returns empty string for identical inputs', () => {
      const schema = 'CREATE TABLE users (id SERIAL);\n';
      const result = formatSchemaDiff(schema, schema);
      expect(result).toBe('');
    });
  });
});
