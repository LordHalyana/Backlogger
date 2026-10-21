import matter from 'gray-matter';
import {
  COMMENT_SCHEMA_VERSION,
  isCommentStoragePath,
  isLowercaseUuid,
  type CommentProblemReason,
} from '@backlogger/shared';

/**
 * The comment file format, schema v1 (spec #58, "Storage and Markdown
 * schema"). Backlogger writes the frontmatter itself, in a fixed key order,
 * so the bytes of a new comment are fully determined by its fields; the body
 * follows the closing delimiter exactly as submitted.
 */

export interface CommentFields {
  id: string;
  parent_id: string;
  created_at: string;
  updated_at: string;
}

export interface ParsedComment extends CommentFields {
  /** Every frontmatter key, including ones this version does not know. */
  frontmatter: Record<string, unknown>;
  body: string;
}

export type CommentParse =
  | { ok: true; comment: ParsedComment }
  | {
      ok: false;
      reason: Extract<CommentProblemReason, 'malformed' | 'unsupported_schema_version'>;
      message: string;
    };

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** The exact bytes of a new comment file. */
export function serializeComment(fields: CommentFields, body: string): string {
  return [
    '---',
    `schema_version: ${COMMENT_SCHEMA_VERSION}`,
    'kind: comment',
    `id: ${fields.id}`,
    `parent_id: ${fields.parent_id}`,
    `created_at: '${fields.created_at}'`,
    `updated_at: '${fields.updated_at}'`,
    '---',
    body,
  ].join('\n');
}

/**
 * Parse a comment file found at `relPath` (relative to `<dataDir>/projects/`,
 * `<project>/tickets/<task>/comments/<id>.md`). Its id must match the file
 * name and its parent the task directory, so a path names exactly one
 * comment.
 */
export function parseCommentFile(relPath: string, text: string): CommentParse {
  const parts = relPath.split('/');
  const fileName = parts[4] ?? '';
  if (!isCommentStoragePath(relPath) || parts.length !== 5 || !fileName.endsWith('.md')) {
    return malformed('not a <comment-id>.md file directly inside a comment directory');
  }
  const match = FRONTMATTER.exec(text);
  if (!match) return malformed('no frontmatter block');
  let data: Record<string, unknown>;
  try {
    // A header-only string, so gray-matter parses nothing of the body.
    data = { ...(matter(`---\n${match[1]}\n---\n`).data as Record<string, unknown>) };
  } catch (err) {
    return malformed(`frontmatter is not valid YAML: ${(err as Error).message}`);
  }
  if (data.schema_version !== COMMENT_SCHEMA_VERSION) {
    return data.schema_version === undefined
      ? malformed('schema_version is missing')
      : {
          ok: false,
          reason: 'unsupported_schema_version',
          message: `schema_version ${String(data.schema_version)} is not supported`,
        };
  }
  if (data.kind !== 'comment') return malformed('kind is not comment');
  const id = data.id;
  if (!isLowercaseUuid(id)) return malformed('id is not a lowercase UUID');
  if (`${id}.md` !== fileName) return malformed('id does not match the file name');
  const parentId = data.parent_id;
  if (!isLowercaseUuid(parentId)) {
    return malformed('parent_id is not a lowercase UUID');
  }
  if (parentId !== parts[2]) return malformed('parent_id does not match the task directory');
  const createdAt = timestamp(data.created_at);
  const updatedAt = timestamp(data.updated_at);
  if (!createdAt || !updatedAt)
    return malformed('created_at or updated_at is not an ISO timestamp');
  return {
    ok: true,
    comment: {
      id,
      parent_id: parentId,
      created_at: createdAt,
      updated_at: updatedAt,
      frontmatter: data,
      body: text.slice(match[0].length),
    },
  };
}

function timestamp(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  return typeof value === 'string' && ISO.test(value) ? value : null;
}

function malformed(message: string): CommentParse {
  return { ok: false, reason: 'malformed', message };
}
