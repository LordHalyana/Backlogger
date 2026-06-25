import { describe, expect, it } from 'vitest';
import {
  emptySidecarIndex,
  SidecarEntrySchema,
  SidecarIndexSchema,
  SIDECAR_VERSION,
} from './sidecar.js';

describe('SidecarIndexSchema', () => {
  it('defaults version and entries on an empty object', () => {
    const idx = SidecarIndexSchema.parse({});
    expect(idx.version).toBe(SIDECAR_VERSION);
    expect(idx.entries).toEqual({});
  });

  it('emptySidecarIndex matches the parsed empty shape', () => {
    expect(emptySidecarIndex()).toEqual(SidecarIndexSchema.parse({}));
  });

  it('parses an index keyed by project-relative path', () => {
    const idx = SidecarIndexSchema.parse({
      version: 1,
      entries: {
        'guide/getting-started.md': {
          id: '5f8c5b7b-7d9e-4b4d-a017-d3ab3e1d9d31',
          type: 'note',
          status: 'active',
          tags: ['api'],
          created_at: '2026-06-26T00:00:00.000Z',
          updated_at: '2026-06-26T00:00:00.000Z',
        },
      },
    });
    expect(idx.entries['guide/getting-started.md']?.status).toBe('active');
  });
});

describe('SidecarEntrySchema', () => {
  const base = {
    id: '5f8c5b7b-7d9e-4b4d-a017-d3ab3e1d9d31',
    type: 'note',
    created_at: '2026-06-26T00:00:00.000Z',
    updated_at: '2026-06-26T00:00:00.000Z',
  };

  it('applies status and tags defaults', () => {
    const entry = SidecarEntrySchema.parse(base);
    expect(entry.status).toBe('draft');
    expect(entry.tags).toEqual([]);
  });

  it('rejects an unknown document type', () => {
    expect(SidecarEntrySchema.safeParse({ ...base, type: 'nope' }).success).toBe(false);
  });

  it('rejects a non-uuid id', () => {
    expect(SidecarEntrySchema.safeParse({ ...base, id: 'not-a-uuid' }).success).toBe(false);
  });
});
