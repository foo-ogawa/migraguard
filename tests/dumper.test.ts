import { describe, it, expect } from 'vitest';
import { normalizeSchema } from '../src/dumper.js';

describe('dumper', () => {
  describe('normalizeSchema', () => {
    it('removes comment lines', () => {
      const raw = `-- PostgreSQL database dump
-- Dumped from database version 16.0
CREATE TABLE users (id SERIAL);
`;
      const result = normalizeSchema(raw);
      expect(result).not.toContain('-- PostgreSQL');
      expect(result).toContain('CREATE TABLE users');
    });

    it('removes SET statements', () => {
      const raw = `SET statement_timeout = 0;
SET lock_timeout = 0;
CREATE TABLE users (id SERIAL);
`;
      const result = normalizeSchema(raw);
      expect(result).not.toContain('SET statement_timeout');
      expect(result).toContain('CREATE TABLE users');
    });

    it('removes SELECT pg_catalog lines', () => {
      const raw = `SELECT pg_catalog.set_config('search_path', '', false);
CREATE TABLE users (id SERIAL);
`;
      const result = normalizeSchema(raw);
      expect(result).not.toContain('SELECT pg_catalog');
      expect(result).toContain('CREATE TABLE users');
    });

    it('removes COMMENT ON EXTENSION lines', () => {
      const raw = `COMMENT ON EXTENSION plpgsql IS 'PL/pgSQL procedural language';
CREATE TABLE users (id SERIAL);
`;
      const result = normalizeSchema(raw);
      expect(result).not.toContain('COMMENT ON EXTENSION');
    });

    it('collapses consecutive blank lines', () => {
      const raw = `CREATE TABLE users (id SERIAL);


CREATE TABLE orders (id SERIAL);
`;
      const result = normalizeSchema(raw);
      // Should not contain two consecutive blank lines
      expect(result).not.toContain('\n\n\n');
    });

    it('trims leading and trailing blank lines', () => {
      const raw = `

CREATE TABLE users (id SERIAL);

`;
      const result = normalizeSchema(raw);
      expect(result).toBe('CREATE TABLE users (id SERIAL);\n');
    });

    it('handles empty input', () => {
      const result = normalizeSchema('');
      expect(result).toBe('\n');
    });

    it('preserves CREATE and ALTER statements', () => {
      const raw = `-- comment
SET client_encoding = 'UTF8';
CREATE TABLE users (
    id serial NOT NULL,
    email varchar(256)
);
ALTER TABLE ONLY users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
`;
      const result = normalizeSchema(raw);
      expect(result).toContain('CREATE TABLE users');
      expect(result).toContain('ALTER TABLE ONLY users');
    });
  });
});
