import { describe, expect, it } from 'vitest';
import { formatRelativeTime, formatUptime } from './display.js';

describe('formatUptime', () => {
  it('formats seconds, minutes, hours, and days compactly', () => {
    expect(formatUptime(0)).toBe('0s');
    expect(formatUptime(45)).toBe('45s');
    expect(formatUptime(90)).toBe('1m');
    expect(formatUptime(3600)).toBe('1h');
    expect(formatUptime(3600 + 20 * 60)).toBe('1h 20m');
    expect(formatUptime(6 * 86400 + 22 * 3600)).toBe('6d 22h');
    expect(formatUptime(598812)).toBe('6d 22h');
  });

  it('clamps negative input to zero', () => {
    expect(formatUptime(-5)).toBe('0s');
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-06-25T21:40:00.000Z');

  it('returns "just now" for very recent times', () => {
    expect(formatRelativeTime('2026-06-25T21:39:30.000Z', now)).toBe('just now');
  });

  it('returns minutes ago within the hour', () => {
    expect(formatRelativeTime('2026-06-25T21:25:00.000Z', now)).toBe('15m ago');
  });

  it('returns an empty string for an unparseable date', () => {
    expect(formatRelativeTime('not-a-date', now)).toBe('');
  });
});
