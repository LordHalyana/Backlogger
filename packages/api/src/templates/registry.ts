import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import {
  TemplateFrontmatterSchema,
  type Template,
  type TemplateSummary,
} from '@backlogger/shared';
import { NotFoundError } from '../errors.js';

/**
 * In-memory registry of built-in document templates.
 *
 * Templates are plain Markdown files under `packages/api/templates/`. They are
 * parsed once at startup; the loader exposes summary list + by-id lookup.
 */
export class TemplateRegistry {
  private readonly byId = new Map<string, Template>();

  list(): TemplateSummary[] {
    return [...this.byId.values()]
      .map(({ id, name, type, source }) => ({ id, name, type, source }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): Template | undefined {
    return this.byId.get(id);
  }

  /** Get-or-throw: 404 when missing. */
  getOrThrow(id: string): Template {
    const t = this.byId.get(id);
    if (!t) throw new NotFoundError('TEMPLATE_NOT_FOUND', `Template not found: ${id}`);
    return t;
  }

  /** Replace the in-memory set; called by the loader. */
  setAll(templates: Template[]): void {
    this.byId.clear();
    for (const t of templates) this.byId.set(t.id, t);
  }
}

export interface LoadTemplatesResult {
  loaded: Template[];
  skipped: Array<{ file: string; reason: string }>;
}

/**
 * Scan `dir` for `*.md` template files and parse each one. Files whose
 * frontmatter doesn't match `TemplateFrontmatterSchema` are skipped and
 * reported, not thrown.
 */
export async function loadTemplatesFromDir(
  dir: string,
  opts: { source?: Template['source'] } = {},
): Promise<LoadTemplatesResult> {
  const source = opts.source ?? 'builtin';
  const out: LoadTemplatesResult = { loaded: [], skipped: [] };
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const full = path.join(dir, entry.name);
    try {
      const raw = await fs.readFile(full, 'utf8');
      const parsed = matter(raw);
      const fm = TemplateFrontmatterSchema.safeParse(parsed.data);
      if (!fm.success) {
        out.skipped.push({ file: entry.name, reason: 'invalid frontmatter' });
        continue;
      }
      out.loaded.push({
        id: fm.data.template_id,
        name: fm.data.template_name,
        type: fm.data.type,
        source,
        body: parsed.content,
      });
    } catch (err) {
      out.skipped.push({ file: entry.name, reason: (err as Error).message });
    }
  }
  return out;
}

/** Default (built-in) templates dir resolved relative to the compiled source file. */
export function defaultTemplatesDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates');
}

/** User templates dir: `<dataDir>/templates/`. Created if missing at app start. */
export function userTemplatesDir(dataDir: string): string {
  return path.join(dataDir, 'templates');
}

/**
 * Load built-in and user templates, merging them so user templates win on id
 * collision (with a console warning). Returns the merged result.
 */
export async function loadAllTemplates(
  builtinDir: string,
  userDir: string,
): Promise<LoadTemplatesResult> {
  const [builtin, user] = await Promise.all([
    loadTemplatesFromDir(builtinDir, { source: 'builtin' }),
    loadTemplatesFromDir(userDir, { source: 'user' }),
  ]);
  const merged = new Map<string, Template>();
  for (const t of builtin.loaded) merged.set(t.id, t);
  for (const t of user.loaded) {
    if (merged.has(t.id)) {
      // eslint-disable-next-line no-console
      console.warn(`[backlogger] user template '${t.id}' overrides built-in`);
    }
    merged.set(t.id, t);
  }
  return {
    loaded: [...merged.values()],
    skipped: [...builtin.skipped, ...user.skipped],
  };
}

/**
 * Substitute `{{title}}`, `{{project}}`, and `{{date}}` (YYYY-MM-DD, local time).
 * Unknown `{{...}}` placeholders are left untouched.
 */
export function applyPlaceholders(
  body: string,
  ctx: { title: string; project: string; date?: Date },
): string {
  const d = ctx.date ?? new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;
  const replacements: Record<string, string> = {
    title: ctx.title,
    project: ctx.project,
    date: dateStr,
  };
  return body.replace(/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi, (m, key: string) =>
    Object.prototype.hasOwnProperty.call(replacements, key) ? replacements[key]! : m,
  );
}
