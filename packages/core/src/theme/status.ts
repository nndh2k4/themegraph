import { readFile } from "node:fs/promises";
import path from "node:path";

import { READ_EXTENSIONS } from "../analyze/analyze.service.js";
import { hashContent } from "../common/hash.js";
import { legacyStore } from "../legacy.js";
import { scanThemeDir } from "../infrastructure/fs/fs-theme-file.repository.js";
import type { NodeKind } from "../models/index.js";

/** Ba loại node không ứng với file nào trên đĩa. */
const NON_FILE_KINDS: readonly NodeKind[] = ["page_type", "translation_key", "setting"];

/** Tình trạng đồ thị của một theme so với các file hiện có trên đĩa. */
export interface StatusResult {
  themeRoot: string;
  dbPath: string;
  analyzedAt: string; // thời điểm phân tích, dạng ISO 8601
  toolVersion: string; // phiên bản ThemeGraph đã ghi ra đồ thị
  nodes: number;
  edges: number;
  // true khi theme đã đổi từ lần phân tích, tức ít nhất một trong ba danh
  // sách dưới đây không rỗng. Khi đó kết quả truy vấn có thể không còn đúng.
  stale: boolean;
  modified: string[]; // file có trong đồ thị mà nội dung đã khác lúc phân tích
  added: string[]; // file có trên đĩa nhưng chưa có trong đồ thị
  removed: string[]; // file có trong đồ thị nhưng không còn trên đĩa
}

/**
 * So đồ thị đã ghi của một theme với các file đang có trên đĩa.
 *
 * "Đã bị sửa" được xác định bằng NỘI DUNG: hash của file hiện có trên đĩa
 * được so với hash analyze đã ghi vào graph.db. Thời điểm sửa của file không
 * được dùng tới, vì nó đổi cả khi nội dung không đổi (git checkout, trình
 * soạn thảo lưu lại file) và có thể không đổi khi nội dung đổi (file được
 * chép đè kèm thời điểm cũ).
 *
 * Chỉ file .liquid, .json và .js mới được xét là "đã sửa": đó là những file
 * mà analyze đọc nội dung. Sửa một ảnh hay một file css không làm đồ thị đổi.
 *
 * Ném GraphNotReadyError nếu theme chưa có đồ thị dùng được.
 */
export async function themeStatus(themeRoot: string): Promise<StatusResult> {
  const graph = legacyStore.open(themeRoot);

  let inGraph: Set<string>;
  let hashOf: Map<string, string>;
  let counts: { nodes: number; edges: number };
  try {
    // Node file là mọi node trừ ba loại không ứng với file nào trên đĩa.
    inGraph = new Set(
      graph
        .allNodes()
        .filter((node) => !NON_FILE_KINDS.includes(node.kind))
        .map((node) => node.id),
    );
    hashOf = new Map(graph.fileHashes().map((entry) => [entry.file, entry.hash]));
    counts = {
      nodes: graph.countNodes(),
      edges: Object.values(graph.counts().edgesByType).reduce((total, n) => total + n, 0),
    };
  } finally {
    // Đóng trước khi làm việc với đĩa: không cần giữ database trong lúc đó.
    graph.close();
  }

  const { files } = await scanThemeDir(graph.themeRoot);
  const onDisk = new Set(files.map((file) => file.path));

  const modified: string[] = [];
  for (const file of files) {
    if (!inGraph.has(file.path)) continue;
    if (!READ_EXTENSIONS.has(file.ext)) continue;

    // File không có hash là file lần phân tích không đọc được; không biết nội
    // dung cũ của nó nên coi là đã đổi.
    const content = await readFile(path.join(graph.themeRoot, file.path), "utf8");
    if (hashOf.get(file.path) !== hashContent(content)) modified.push(file.path);
  }

  // scanThemeDir đã xếp `files` theo tên, nên modified và added cũng đã xếp.
  const added = files.map((file) => file.path).filter((filePath) => !inGraph.has(filePath));
  const removed = [...inGraph].filter((filePath) => !onDisk.has(filePath)).sort();

  return {
    themeRoot: graph.themeRoot,
    dbPath: legacyStore.dbPath(graph.themeRoot),
    analyzedAt: graph.meta.analyzedAt,
    toolVersion: graph.meta.toolVersion,
    nodes: counts.nodes,
    edges: counts.edges,
    stale: modified.length + added.length + removed.length > 0,
    modified,
    added,
    removed,
  };
}
