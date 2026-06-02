import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { useGraph, type GraphNode } from '../lib/graph.js';

interface Props {
  projectId: string;
  onOpenDocument: (projectId: string, documentId: string) => void;
  onClose: () => void;
}

// Colour by document type
const TYPE_COLOURS: Record<string, string> = {
  idea: '#a78bfa',
  note: '#60a5fa',
  decision: '#f59e0b',
  design: '#34d399',
  finding: '#f87171',
};
const BROKEN_COLOUR = '#ef4444';
const ORPHAN_COLOUR = '#94a3b8';
const DEFAULT_COLOUR = '#64748b';

function nodeColour(node: GraphNode): string {
  if (node.kind === 'broken') return BROKEN_COLOUR;
  if (node.inDegree === 0 && node.outDegree === 0) return ORPHAN_COLOUR;
  return TYPE_COLOURS[node.type ?? ''] ?? DEFAULT_COLOUR;
}

// Scale node size by in-degree (min 3, max 14)
function nodeVal(node: GraphNode): number {
  return Math.max(3, Math.min(14, 3 + node.inDegree * 2));
}

export function KnowledgeGraph({ projectId, onOpenDocument, onClose }: Props) {
  const { data, isLoading, isError } = useGraph(projectId);
  const [query, setQuery] = useState('');
  const [highlightNodeIds, setHighlightNodeIds] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // Measure container on mount/resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () =>
      setDimensions({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Esc to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Build adjacency map for hover highlighting
  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>();
    if (!data) return map;
    for (const edge of data.edges) {
      if (!map.has(edge.sourceId)) map.set(edge.sourceId, new Set());
      if (!map.has(edge.targetId)) map.set(edge.targetId, new Set());
      map.get(edge.sourceId)!.add(edge.targetId);
      map.get(edge.targetId)!.add(edge.sourceId);
    }
    return map;
  }, [data]);

  // Filter nodes & edges by search query
  const filteredData = useMemo(() => {
    if (!data) return { nodes: [], links: [] };
    const q = query.trim().toLowerCase();

    const visibleNodes = q
      ? data.nodes.filter(
          (n) =>
            n.title.toLowerCase().includes(q) ||
            n.tags?.some((t) => t.toLowerCase().includes(q)),
        )
      : data.nodes;

    const visibleIds = new Set(visibleNodes.map((n) => n.id));

    const visibleEdges = data.edges.filter(
      (e) => visibleIds.has(e.sourceId) && visibleIds.has(e.targetId),
    );

    return {
      nodes: visibleNodes,
      links: visibleEdges.map((e) => ({
        source: e.sourceId,
        target: e.targetId,
        display: e.display,
      })),
    };
  }, [data, query]);

  const handleNodeHover = useCallback(
    (node: GraphNode | null) => {
      if (!node) {
        setHighlightNodeIds(new Set());
        return;
      }
      const neighbours = adjacency.get(node.id) ?? new Set();
      setHighlightNodeIds(new Set([node.id, ...neighbours]));
    },
    [adjacency],
  );

  const handleNodeClick = useCallback(
    (node: GraphNode) => {
      if (node.kind === 'document') {
        onOpenDocument(projectId, node.id);
        onClose();
      }
    },
    [projectId, onOpenDocument, onClose],
  );

  const nodeColorFn = useCallback(
    (node: GraphNode) => {
      const base = nodeColour(node);
      if (highlightNodeIds.size === 0) return base;
      return highlightNodeIds.has(node.id) ? base : `${base}40`;
    },
    [highlightNodeIds],
  );

  return (
    <div className="graph-overlay" role="dialog" aria-label="Knowledge graph">
      <div className="graph-overlay__header">
        <span className="graph-overlay__title">Knowledge Graph</span>
        <input
          type="search"
          className="graph-overlay__filter"
          placeholder="Filter nodes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Filter graph nodes"
        />
        <button
          className="graph-overlay__close"
          onClick={onClose}
          aria-label="Close graph"
        >
          ✕
        </button>
      </div>

      <div className="graph-overlay__canvas" ref={containerRef}>
        {isLoading && <div className="graph-overlay__state">Loading graph…</div>}
        {isError && (
          <div className="graph-overlay__state graph-overlay__state--error">
            Failed to load graph.
          </div>
        )}
        {data && (
          <ForceGraph2D
            graphData={filteredData as never}
            width={dimensions.width}
            height={dimensions.height}
            backgroundColor="var(--bg-body, #0f172a)"
            nodeId="id"
            nodeLabel={(n) => (n as unknown as GraphNode).title}
            nodeVal={(n) => nodeVal(n as unknown as GraphNode)}
            nodeColor={(n) => nodeColorFn(n as unknown as GraphNode)}
            linkSource="source"
            linkTarget="target"
            linkColor={() => 'rgba(148,163,184,0.4)'}
            linkDirectionalArrowLength={4}
            linkDirectionalArrowRelPos={1}
            onNodeClick={(n) => handleNodeClick(n as unknown as GraphNode)}
            onNodeHover={(n) => handleNodeHover(n as unknown as GraphNode | null)}
          />
        )}
      </div>

      <div className="graph-overlay__legend">
        {Object.entries(TYPE_COLOURS).map(([type, colour]) => (
          <span key={type} className="graph-overlay__legend-item">
            <span
              className="graph-overlay__legend-dot"
              style={{ background: colour }}
            />
            {type}
          </span>
        ))}
        <span className="graph-overlay__legend-item">
          <span
            className="graph-overlay__legend-dot"
            style={{ background: ORPHAN_COLOUR }}
          />
          orphan
        </span>
        <span className="graph-overlay__legend-item">
          <span
            className="graph-overlay__legend-dot graph-overlay__legend-dot--broken"
            style={{ background: BROKEN_COLOUR }}
          />
          broken link
        </span>
      </div>
    </div>
  );
}
