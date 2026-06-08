import { useQuery } from '@tanstack/react-query';
import { queryKeys } from './query-keys.js';

export interface GraphNode {
  id: string;
  kind: 'document' | 'broken';
  title: string;
  type?: string;
  status?: string;
  tags?: string[];
  inDegree: number;
  outDegree: number;
}

export interface GraphEdge {
  sourceId: string;
  targetId: string;
  display: string;
}

export interface GraphPayload {
  nodes: GraphNode[];
  edges: GraphEdge[];
  generatedAt: string;
}

async function fetchGraph(projectId: string): Promise<GraphPayload> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/graph`);
  if (!res.ok) throw new Error(`Graph fetch failed: ${res.status}`);
  return res.json() as Promise<GraphPayload>;
}

export function useGraph(projectId: string | null) {
  return useQuery({
    queryKey: queryKeys.graph(projectId ?? '__none__'),
    queryFn: () => fetchGraph(projectId!),
    enabled: projectId !== null,
    staleTime: 10_000,
    gcTime: 30_000,
  });
}
