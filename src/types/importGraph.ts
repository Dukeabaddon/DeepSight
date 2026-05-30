/** Doc 03 Layer 3 — import tree / call-graph stub artifacts */

export type ImportEdgeKind = 'import' | 'export-from' | 'require';

export type ImportGraphEdge = {
  from: string;
  to: string;
  kind: ImportEdgeKind;
};

export type ImportGraphResult = {
  parser: 'regex-stub';
  nodeCount: number;
  edgeCount: number;
  externalCount: number;
  truncated: boolean;
  entryPoints: string[];
  /** Sample edges returned in MCP JSON (full graph in artifactPath) */
  sampleEdges: ImportGraphEdge[];
  artifactPath: string;
};

export type CallGraphStub = {
  parser: 'import-tree-stub';
  nodeCount: number;
  edgeCount: number;
  /** Up to N file chains from route/entry files following imports (doc 03 illustration) */
  sampleChains: string[][];
  note: string;
};
