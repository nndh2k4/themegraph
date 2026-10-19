import type {
  EdgeType,
  FileElement,
  FileError,
  FileHash,
  FileSchema,
  GraphEdge,
  GraphNode,
  NodeKind,
  ResolvedRef,
} from "../models/index.js";

/**
 * Cổng đọc đồ thị của MỘT theme: mọi service truy vấn chỉ biết interface này,
 * không biết đồ thị nằm trong SQLite hay ở đâu khác.
 *
 * Mỗi hàm ứng với một câu hỏi mà một service cần hỏi, đặt tên theo câu hỏi đó
 * chứ không theo tên bảng. Thứ tự kết quả là một phần của hợp đồng: hàm nào ghi
 * "xếp theo" thì bản hiện thực phải trả đúng thứ tự đó.
 *
 * Interface chỉ có hàm đọc. Đồ thị được ghi một lần, bởi GraphStore.save().
 */
export interface GraphRepository {
  readonly themeRoot: string; // đường dẫn tuyệt đối của theme
  readonly meta: GraphMeta;
  /** Nhả đồ thị. Người mở phải gọi khi xong, nếu không file dữ liệu bị giữ. */
  close(): void;

  // ---- Node --------------------------------------------------------------

  /** Node có đúng id này, hoặc null. */
  getNode(id: string): GraphNode | null;
  /** Mọi node, xếp theo id. */
  allNodes(): GraphNode[];
  /** Các node thuộc một trong các loại này, xếp theo id. */
  nodesOfKinds(kinds: readonly NodeKind[]): GraphNode[];
  /**
   * Các node có id chứa `text` (so nguyên văn, không có ký tự đại diện), xếp
   * theo id. `ignoreCase`: so với id đã đổi về chữ thường; `text` phải được
   * người gọi đổi về chữ thường trước.
   */
  findNodes(text: string, options: { ignoreCase: boolean; limit?: number }): GraphNode[];
  /** Các node thuộc loại này mà không cạnh nào trỏ tới, xếp theo id. */
  nodesWithoutIncomingEdges(kind: NodeKind): GraphNode[];
  /** Số node, của một loại hoặc của cả đồ thị. */
  countNodes(kind?: NodeKind): number;

  // ---- Cạnh --------------------------------------------------------------

  /** Mọi cạnh, xếp theo (from, to, type). */
  allEdges(): GraphEdge[];
  /** Các cạnh đi ra từ node này, kèm loại của node đích; xếp theo (to, type). */
  edgesFrom(id: string): NeighborEdge[];
  /** Các cạnh đi vào node này, kèm loại của node nguồn; xếp theo (from, type). */
  edgesTo(id: string): NeighborEdge[];
  /**
   * Các node được nhiều node KHÁC nhau trỏ tới nhất, qua các loại cạnh nêu
   * trong `edgeTypes`; không tính cạnh tự trỏ về mình. Nhiều nơi gọi nhất
   * trước, bằng nhau thì theo id.
   */
  mostReferenced(options: {
    edgeTypes: readonly EdgeType[];
    excludeKinds: readonly NodeKind[];
    limit: number;
  }): ReferenceCount[];

  // ---- Duyệt -------------------------------------------------------------

  /**
   * Mọi node tới được từ `startId` theo một chiều, KỂ CẢ node xuất phát (độ
   * sâu 0), xếp theo độ sâu rồi theo id. Mỗi node mang độ sâu nhỏ nhất và mức
   * chắc chắn (xem Reached). `edgeTypes` giới hạn loại cạnh; không nêu là mọi
   * loại. Không có node `startId` thì trả mảng rỗng.
   */
  reach(startId: string, direction: Direction, edgeTypes?: readonly EdgeType[]): Reached[];
  /** Tập node tới được khi đi XUÔI qua mọi cạnh từ bất kỳ node nào trong `startIds`, kể cả chính chúng. */
  reachableFrom(startIds: readonly string[]): Set<string>;

  // ---- Tham chiếu ----------------------------------------------------------

  /** Các số dòng (khác 0) mà file `from` gọi tới `target`, không trùng, tăng dần. */
  refLines(from: string, target: string): number[];
  /** Các tham chiếu hỏng nằm trong file này, xếp theo (dòng, tên). */
  missingRefsFrom(id: string): ResolvedRef[];

  // ---- Dữ kiện khác ---------------------------------------------------------

  schemas(): FileSchema[];
  /** Mọi dòng của bảng custom element, xếp theo (tên, vai trò, file). */
  elements(): FileElement[];
  /** Mọi cặp (file định nghĩa một thẻ, file KHÁC dùng thẻ đó), xếp theo (definer, name, user). */
  elementPairs(): ElementPair[];
  fileHashes(): FileHash[];
  /**
   * File không phân tích được trọn vẹn lúc analyze (hỏng hẳn, hoặc chỉ một
   * phần như {% schema %} sai JSON), xếp theo (file, message). Quan hệ của chúng
   * có thể thiếu, nên dead-code hạ mức khi một trong số đó có thể gọi file
   * khác (xem DeadCodeService.findUnused).
   */
  fileErrors(): FileError[];
  /** Số node theo loại, số cạnh theo loại, số tham chiếu theo trạng thái; mỗi bảng xếp theo tên khoá. */
  counts(): GraphCounts;
  /** Những gì phép tự kiểm tra của nơi lưu trữ báo ra; rỗng là nguyên vẹn. */
  checkIntegrity(): IntegrityReport;
}

/** Thông tin về lần phân tích đã ghi ra đồ thị. */
export interface GraphMeta {
  schemaVersion: number;
  toolVersion: string;
  analyzedAt: string; // thời điểm phân tích, dạng ISO 8601
}

/**
 * Chiều duyệt đồ thị.
 *
 * - forward:  đi theo chiều mũi tên, "node này dẫn tới những gì"
 * - backward: đi ngược chiều mũi tên, "những gì dẫn tới node này"
 */
export type Direction = "forward" | "backward";

/** Một node tới được từ node xuất phát. */
export interface Reached {
  id: string;
  kind: NodeKind;
  // Số cạnh ít nhất phải đi qua để tới node này từ node xuất phát.
  depth: number;
  // true khi có ít nhất một đường đi mà MỌI cạnh trên đó đều không điều kiện,
  // tức quan hệ này luôn xảy ra. false nghĩa là mọi đường đi đều vướng một
  // {% if %}, một vòng lặp, một template thay thế... nên chỉ CÓ THỂ xảy ra.
  certain: boolean;
}

/** Một cạnh kèm loại của node ở đầu bên kia, so với node đang hỏi. */
export interface NeighborEdge extends GraphEdge {
  neighborKind: NodeKind;
}

/** Một node kèm số node khác nhau trỏ tới nó. */
export interface ReferenceCount {
  node: GraphNode;
  callers: number;
}

/** Một file định nghĩa thẻ `name`, và một file khác viết thẻ đó. */
export interface ElementPair {
  definer: string;
  name: string;
  user: string;
}

export interface GraphCounts {
  nodesByKind: Record<string, number>;
  edgesByType: Record<string, number>;
  refsByStatus: Record<string, number>;
}

export interface IntegrityReport {
  // Lỗi của chính file dữ liệu (trang hỏng, index hỏng...).
  problems: string[];
  // Dòng trỏ tới một dòng không tồn tại: `table` trỏ sang `parent`.
  brokenLinks: { table: string; parent: string }[];
}
