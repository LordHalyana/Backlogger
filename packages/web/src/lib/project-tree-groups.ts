import type { DocumentSummary } from '@backlogger/shared';
import { folderFromDocumentPath, isArchivedFolder } from '@backlogger/shared';

export interface ProjectTreeGroups {
  grouped: Map<string, DocumentSummary[]>;
  rootDocs: DocumentSummary[];
  activeFolders: string[];
  archivedFolders: string[];
}

export function buildProjectTreeGroups(
  projectId: string,
  documents: readonly DocumentSummary[] | undefined,
  folders: readonly string[] | undefined,
): ProjectTreeGroups {
  const grouped = new Map<string, DocumentSummary[]>();
  for (const doc of documents ?? []) {
    const folder = folderFromDocumentPath(projectId, doc.path);
    const bucket = grouped.get(folder) ?? [];
    bucket.push(doc);
    grouped.set(folder, bucket);
  }

  const folderSet = new Set<string>(grouped.keys());
  for (const folder of folders ?? []) folderSet.add(folder);
  folderSet.delete('');

  const activeFolders: string[] = [];
  const archivedFolders: string[] = [];
  for (const folder of [...folderSet].sort()) {
    if (isArchivedFolder(folder)) archivedFolders.push(folder);
    else activeFolders.push(folder);
  }

  return {
    grouped,
    rootDocs: grouped.get('') ?? [],
    activeFolders,
    archivedFolders,
  };
}

/** True if any ancestor folder, but not the folder itself, is collapsed. */
export function isAncestorCollapsed(
  folder: string,
  collapsed: ReadonlySet<string>,
): boolean {
  const parts = folder.split('/');
  for (let i = 1; i < parts.length; i++) {
    if (collapsed.has(parts.slice(0, i).join('/'))) return true;
  }
  return false;
}
