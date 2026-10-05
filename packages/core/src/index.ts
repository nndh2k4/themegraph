export { VERSION } from './version.js';

export * from './types.js';

// Tầng quét: thư mục theme -> danh sách file đã phân loại.
export { scanThemeDir } from './scanner.js';

// Tầng parse: một file + nội dung -> danh sách quan hệ thô.
export { extractRefs } from './extract.js';
export { extractJsonRefs } from './extract-json.js';
export { extractLiquidRefs } from './extract-liquid.js';

// Resolver: quan hệ thô -> file thật trong theme.
export { resolveRef } from './resolver.js';

// Đồ thị: danh sách file + quan hệ thô -> node và cạnh.
export { buildGraph } from './graph.js';

// Lưu trữ: đồ thị -> <theme>/.themegraph/graph.db.
export { graphDbPath, saveGraph, SCHEMA_VERSION } from './store.js';
export type { SaveGraphOptions } from './store.js';

// Điểm nối của lõi: thư mục theme -> graph.db + thống kê.
export { analyze } from './analyze.js';
export type { AnalyzeError, AnalyzeResult, AnalyzeStats } from './analyze.js';

// Đọc đồ thị: mở graph.db của một theme và tìm node theo tên người dùng gõ.
export { findThemeRoot, GraphNotReadyError, openGraph } from './open.js';
export type { GraphHandle, GraphMeta, GraphNotReadyReason } from './open.js';
export { findNode, NodeNotFoundError } from './find-node.js';
export type { FindNodeOptions } from './find-node.js';

// Duyệt đồ thị bằng truy vấn đệ quy; nền của impact và renderFlow.
export { traverse } from './traverse.js';
export type { Direction, Reached } from './traverse.js';

// Truy vấn: sửa file này thì những gì bị ảnh hưởng.
export { impact } from './impact.js';
export type { ImpactResult } from './impact.js';

// Truy vấn: trang này render những file nào.
export { renderFlow } from './render-flow.js';
export type { FlowNode, RenderFlowResult } from './render-flow.js';

// Truy vấn: file này là gì, ai gọi nó, nó gọi ai.
export { context } from './context.js';
export type { BrokenRef, ContextLink, ContextResult } from './context.js';
