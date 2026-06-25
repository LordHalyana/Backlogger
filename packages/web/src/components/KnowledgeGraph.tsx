import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import type { DocumentType } from '@backlogger/shared';
import { useGraph, type GraphEdge, type GraphNode, type GraphPayload } from '../lib/graph.js';
import { StatusMessage } from './StatusMessage.js';
import { DOCUMENT_TYPE_COLORS, DOCUMENT_TYPE_LABELS, GRAPH_COLORS } from '../lib/display.js';
import { Icon } from './Icon.js';

interface Props {
  projectId: string;
  onOpenDocument: (projectId: string, documentId: string) => void;
  onClose: () => void;
}

interface ForceGraphLink {
  source: string;
  target: string;
  display: string;
}

interface ForceGraphData {
  nodes: GraphNode[];
  links: ForceGraphLink[];
}

function toGraphNode(value: unknown): GraphNode {
  return value as GraphNode;
}

/** Force-graph rewrites link source/target into node objects after layout. */
function linkEndId(end: unknown): string {
  return typeof end === 'object' && end !== null
    ? (end as { id: string }).id
    : (end as string);
}

function toForceGraphData(data: ForceGraphData): never {
  return data as never;
}

function nodeColour(node: GraphNode): string {
  if (node.kind === 'broken') return GRAPH_COLORS.brokenNode;
  if (node.inDegree === 0 && node.outDegree === 0) return GRAPH_COLORS.orphanNode;
  return (node.type ? DOCUMENT_TYPE_COLORS[node.type as DocumentType] : undefined) ?? GRAPH_COLORS.defaultNode;
}

// Scale node size by in-degree (min 3, max 14)
function nodeVal(node: GraphNode): number {
  return Math.max(3, Math.min(14, 3 + node.inDegree * 2));
}

function buildVisibleGraphData(data: GraphPayload | undefined, query: string): ForceGraphData {
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

  return {
    nodes: visibleNodes,
    links: data.edges
      .filter((edge) => edgeVisible(edge, visibleIds))
      .map((edge) => ({
        source: edge.sourceId,
        target: edge.targetId,
        display: edge.display,
      })),
  };
}

function edgeVisible(edge: GraphEdge, visibleIds: ReadonlySet<string>): boolean {
  return visibleIds.has(edge.sourceId) && visibleIds.has(edge.targetId);
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

  const filteredData = useMemo(() => buildVisibleGraphData(data, query), [data, query]);

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

  const linkColorFn = useCallback(
    (link: unknown) => {
      if (highlightNodeIds.size === 0) return GRAPH_COLORS.link;
      const l = link as { source: unknown; target: unknown };
      return highlightNodeIds.has(linkEndId(l.source)) &&
        highlightNodeIds.has(linkEndId(l.target))
        ? GRAPH_COLORS.link
        : GRAPH_COLORS.linkDim;
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
        {query.trim() && data && (
          <span className="graph-overlay__count" aria-live="polite">
            {filteredData.nodes.length} / {data.nodes.length}
          </span>
        )}
        <button
          type="button"
          className="graph-overlay__close"
          onClick={onClose}
          aria-label="Close graph"
          title="Close graph"
        >
          <Icon name="close" />
        </button>
      </div>

      <div className="graph-overlay__canvas" ref={containerRef}>
        {isLoading && (
          <StatusMessage kind="loading" className="graph-overlay__state">
            Loading graph…
          </StatusMessage>
        )}
        {isError && (
          <StatusMessage kind="error" className="graph-overlay__state">
            Failed to load graph.
          </StatusMessage>
        )}
        {data && filteredData.nodes.length === 0 && (
          <StatusMessage kind="empty" className="graph-overlay__state">
            {data.nodes.length === 0
              ? 'No documents to graph yet.'
              : `No nodes match "${query.trim()}".`}
          </StatusMessage>
        )}
        {data && filteredData.nodes.length > 0 && (
          <ForceGraph2D
            graphData={toForceGraphData(filteredData)}
            width={dimensions.width}
            height={dimensions.height}
            backgroundColor={GRAPH_COLORS.canvasBackground}
            nodeId="id"
            nodeLabel={(n) => toGraphNode(n).title}
            nodeVal={(n) => nodeVal(toGraphNode(n))}
            nodeColor={(n) => nodeColorFn(toGraphNode(n))}
            linkSource="source"
            linkTarget="target"
            linkColor={(l) => linkColorFn(l)}
            linkDirectionalArrowLength={4}
            linkDirectionalArrowRelPos={1}
            onNodeClick={(n) => handleNodeClick(toGraphNode(n))}
            onNodeHover={(n) => handleNodeHover(n ? toGraphNode(n) : null)}
          />
        )}
      </div>

      <div className="graph-overlay__legend">
        {Object.entries(DOCUMENT_TYPE_COLORS).map(([type, colour]) => (
          <span key={type} className="graph-overlay__legend-item">
            <span
              className="graph-overlay__legend-dot"
              style={{ background: colour }}
            />
            {DOCUMENT_TYPE_LABELS[type as DocumentType]}
          </span>
        ))}
        <span className="graph-overlay__legend-item">
          <span
            className="graph-overlay__legend-dot"
            style={{ background: GRAPH_COLORS.orphanNode }}
          />
          orphan
        </span>
        <span className="graph-overlay__legend-item">
          <span
            className="graph-overlay__legend-dot graph-overlay__legend-dot--broken"
            style={{ background: GRAPH_COLORS.brokenNode }}
          />
          broken link
        </span>
      </div>
    </div>
  );
}
