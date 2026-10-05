import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  context,
  deadCode,
  formatContext,
  formatDeadCode,
  formatImpact,
  formatList,
  formatRenderFlow,
  formatSearch,
  formatThemeNote,
  impact,
  listThemes,
  NODE_KINDS,
  openGraph,
  renderFlow,
  search,
  selectTheme,
  themeStatus,
  VERSION,
} from "@themegraph/core";
import type { GraphHandle } from "@themegraph/core";
import { z } from "zod";

/**
 * MCP server của ThemeGraph.
 *
 * Lớp này cố ý mỏng, như lớp CLI: mỗi tool đọc tham số, gọi MỘT hàm truy vấn
 * của lõi, rồi gửi lại đúng những dòng chữ mà lệnh `themegraph` tương ứng in
 * ra. Không tool nào tự truy vấn graph.db hay tự tính gì.
 *
 * Server chỉ đọc. Nó không bao giờ chạy analyze: khi đồ thị đã cũ, câu trả
 * lời kèm một dòng cảnh báo và việc phân tích lại là của người dùng.
 */

/**
 * Giới hạn mặc định của đầu ra. Client cắt đầu ra của tool ở vài chục nghìn
 * token, và JSON đầy đủ của một trang trên theme lớn dài gần 300 KB; các con
 * số dưới đây giữ mọi câu trả lời mặc định dưới khoảng 20 KB (đo trên Purity,
 * 3811 node). Agent tăng được từng giới hạn qua tham số khi cần xem thêm.
 */
export const DEFAULT_LIST_LIMIT = 50; // số dòng của mỗi danh sách
export const DEFAULT_SEARCH_RESULTS = 20; // số kết quả của search
export const DEFAULT_FLOW_DEPTH = 3; // số tầng của cây render_flow
export const DEFAULT_FLOW_LINES = 150; // số dòng của cây render_flow

/**
 * Lời dặn gửi cho client lúc bắt tay; client đưa nó vào ngữ cảnh của agent.
 * Viết ngắn: đây là thứ agent luôn mang theo, kể cả khi không dùng tới theme.
 */
export const INSTRUCTIONS = `ThemeGraph trả lời câu hỏi về CẤU TRÚC của một Shopify theme (Liquid) từ một đồ thị đã dựng sẵn: file nào render file nào, trang nào dùng file nào.

Dùng các tool này thay cho việc grep "render '...'" qua nhiều file, vì đồ thị đã đi hết các tầng trung gian (snippet -> section -> template -> loại trang):
- Trước khi sửa hoặc xoá một snippet, section, block, layout hay asset: gọi impact để biết trang nào bị ảnh hưởng.
- Cần biết một trang (product, collection, cart...) gồm những file nào: gọi render_flow.
- Cần biết ai gọi một file, nó gọi ai, nó đọc setting và khoá dịch nào: gọi context.
- Chưa biết đường dẫn chính xác của file: gọi search.
- Dọn dẹp theme: gọi dead_code.

Tên file là đường dẫn tính từ gốc theme, ví dụ snippets/card-product.liquid; tên trang là product, collection, index... Quan hệ ghi "[có điều kiện]" chỉ xảy ra trong một nhánh if/case hoặc ở một template thay thế.
Nếu câu trả lời báo đồ thị đã cũ, kết quả có thể thiếu các thay đổi gần đây; chạy "themegraph analyze" trong thư mục theme để cập nhật.`;

export interface ServerOptions {
  /**
   * Thư mục coi là "đang đứng" khi tool không được nêu theme. Mặc định là thư
   * mục làm việc của tiến trình, tức thư mục dự án mà client mở server.
   */
  cwd?: string;
}

/** Tham số `theme` mà mọi tool truy vấn cùng nhận. */
const themeParam = z
  .string()
  .optional()
  .describe(
    "Tên hoặc đường dẫn của theme cần hỏi (xem list_themes). Bỏ trống: theme chứa thư mục đang làm việc, hoặc theme duy nhất đã phân tích.",
  );

/** Tham số `limit` của các tool trả danh sách. */
const limitParam = (fallback: number, what: string) =>
  z.number().int().min(1).max(2000).optional().describe(`Số dòng tối đa của ${what}. Mặc định ${fallback}.`);

/** Gói các dòng chữ thành kết quả của một tool. */
function text(lines: readonly string[]): CallToolResult {
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

/**
 * Chạy phần thân của một tool và đổi mọi lỗi thành kết quả có isError.
 *
 * Lỗi của lõi (theme chưa analyze, không có node tên đó kèm gợi ý, không chọn
 * được theme) đã được viết cho người đọc và nói luôn cách chữa, nên agent chỉ
 * cần đọc thông báo là tự sửa được lời gọi. Ném lỗi ra ngoài thì client chỉ
 * thấy một lỗi giao thức chung chung.
 */
async function answer(body: () => Promise<string[]> | string[]): Promise<CallToolResult> {
  try {
    return text(await body());
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: `Lỗi: ${error instanceof Error ? error.message : String(error)}` }] };
  }
}

/** Tạo MCP server với sáu tool. Chưa nối với đường truyền nào. */
export function createServer(options: ServerOptions = {}): McpServer {
  const cwd = options.cwd ?? process.cwd();

  const server = new McpServer({ name: "themegraph", version: VERSION }, { instructions: INSTRUCTIONS });

  /**
   * Chọn theme, mở đồ thị, chạy một truy vấn, rồi luôn đóng đồ thị lại.
   *
   * Câu trả lời mở đầu bằng tên theme đã chọn (agent cần biết mình vừa hỏi
   * theme nào khi máy có nhiều theme) và dòng cảnh báo nếu đồ thị đã cũ.
   */
  async function onTheme(theme: string | undefined, query: (graph: GraphHandle) => string[]): Promise<string[]> {
    const themeRoot = selectTheme(theme, cwd);

    const graph = openGraph(themeRoot);
    let lines: string[];
    try {
      lines = query(graph);
    } finally {
      graph.close();
    }

    // Agent thường hỏi ngay sau khi vừa sửa file, tức đúng lúc đồ thị dễ cũ
    // nhất. Phép so này đọc lại hash của mọi file, mất dưới nửa giây.
    const status = await themeStatus(themeRoot);

    return [...formatThemeNote(status), "", ...lines];
  }

  // Mọi tool đều chỉ đọc và chỉ nhìn vào dữ liệu trên máy.
  const annotations = { readOnlyHint: true, openWorldHint: false } as const;

  server.registerTool(
    "list_themes",
    {
      title: "Các Shopify theme đã phân tích",
      description:
        "Liệt kê các Shopify theme đã được ThemeGraph phân tích trên máy này: tên, đường dẫn, số node và cạnh, thời điểm phân tích. Gọi khi cần biết có những theme nào, hoặc khi một tool khác báo phải chọn theme.",
      inputSchema: {},
      annotations,
    },
    () => answer(() => formatList(listThemes())),
  );

  server.registerTool(
    "search",
    {
      title: "Tìm file trong Shopify theme theo tên",
      description:
        'Tìm node trong đồ thị của một Shopify theme theo tên: file Liquid/JSON/asset, loại trang, khoá dịch, setting. Gọi khi chưa biết đường dẫn chính xác (ví dụ chỉ biết "card product"), rồi dùng id trả về cho impact, context hoặc render_flow. Không tìm trong NỘI DUNG file; việc đó dùng grep.',
      inputSchema: {
        query: z
          .string()
          .default("")
          .describe(
            'Một hoặc nhiều từ, không phân biệt hoa thường; mọi từ phải có trong đường dẫn, ví dụ "card product". Để trống cùng với kind để liệt kê cả một loại.',
          ),
        kind: z
          .enum(NODE_KINDS)
          .optional()
          .describe("Chỉ lấy một loại node, ví dụ snippet, section, template, page_type, setting, translation_key."),
        limit: limitParam(DEFAULT_SEARCH_RESULTS, "kết quả"),
        theme: themeParam,
      },
      annotations,
    },
    ({ query, kind, limit, theme }) =>
      answer(() =>
        onTheme(theme, (graph) =>
          formatSearch(
            search(graph, query, { kinds: kind === undefined ? [] : [kind], limit: limit ?? DEFAULT_SEARCH_RESULTS }),
          ),
        ),
      ),
  );

  server.registerTool(
    "impact",
    {
      title: "Sửa một file của Shopify theme thì ảnh hưởng gì",
      description:
        'Shopify theme (Liquid): sửa hoặc xoá một file thì những file nào và những loại trang nào (product, collection, cart...) bị ảnh hưởng. Đi ngược mọi lời gọi render / section / block / layout / asset, qua mọi tầng trung gian, lên tới trang. GỌI TRƯỚC KHI SỬA một snippet, section, block, layout hay asset, và khi được hỏi kiểu "sửa X thì trang nào vỡ", "X được dùng ở những trang nào".',
      inputSchema: {
        target: z
          .string()
          .min(1)
          .describe(
            "File cần hỏi: đường dẫn tính từ gốc theme (snippets/card-product.liquid), hoặc chỉ tên file (card-product) nếu trong theme không có tên trùng.",
          ),
        limit: limitParam(DEFAULT_LIST_LIMIT, "danh sách file bị ảnh hưởng (danh sách trang luôn đầy đủ)"),
        theme: themeParam,
      },
      annotations,
    },
    ({ target, limit, theme }) =>
      answer(() =>
        onTheme(theme, (graph) => formatImpact(impact(graph, target), { limit: limit ?? DEFAULT_LIST_LIMIT })),
      ),
  );

  server.registerTool(
    "context",
    {
      title: "Một file của Shopify theme: ai gọi nó, nó gọi ai",
      description:
        "Shopify theme (Liquid): mọi thứ ở ngay quanh một file. Ai gọi nó (kèm số dòng của lời gọi), nó gọi những file nào, đọc những setting nào (và setting đó khai ở section nào), dùng những khoá dịch nào, có tham chiếu hỏng nào, và thuộc những loại trang nào. Gọi trước khi đọc hay sửa một file để biết nó nằm ở đâu trong theme. Cũng nhận id của một setting hoặc khoá dịch (t:general.cart.title) để biết file nào dùng nó.",
      inputSchema: {
        target: z
          .string()
          .min(1)
          .describe(
            "File cần hỏi: đường dẫn tính từ gốc theme (sections/header.liquid), hoặc chỉ tên file nếu không trùng; hoặc id của một trang, setting, khoá dịch.",
          ),
        limit: limitParam(DEFAULT_LIST_LIMIT, "mỗi danh sách"),
        theme: themeParam,
      },
      annotations,
    },
    ({ target, limit, theme }) =>
      answer(() =>
        onTheme(theme, (graph) => formatContext(context(graph, target), { limit: limit ?? DEFAULT_LIST_LIMIT })),
      ),
  );

  server.registerTool(
    "render_flow",
    {
      title: "Một trang của Shopify theme render những file nào",
      description:
        'Shopify theme (Liquid): cây các file mà một loại trang kéo theo: template, layout, section, block, snippet, asset, lồng nhau đúng như thứ tự gọi. Gọi khi được hỏi "trang product gồm những gì", "file nào tham gia render trang cart", hoặc để tìm chỗ sửa một thứ hiện trên một trang. Cũng nhận một file làm gốc để xem riêng phần cây bên dưới nó.',
      inputSchema: {
        page: z
          .string()
          .min(1)
          .describe(
            "Tên loại trang (product, collection, index, cart, customers/login...), hoặc đường dẫn một file để lấy cây con của nó.",
          ),
        max_depth: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe(
            `Số tầng của cây, tính từ gốc. Mặc định ${DEFAULT_FLOW_DEPTH}. Node bị cắt ghi số file con chưa mở; hỏi tiếp bằng chính node đó làm gốc.`,
          ),
        limit: limitParam(DEFAULT_FLOW_LINES, "cây"),
        theme: themeParam,
      },
      annotations,
    },
    ({ page, max_depth, limit, theme }) =>
      answer(() =>
        onTheme(theme, (graph) =>
          formatRenderFlow(renderFlow(graph, page, { maxDepth: max_depth ?? DEFAULT_FLOW_DEPTH }), {
            limit: limit ?? DEFAULT_FLOW_LINES,
          }),
        ),
      ),
  );

  server.registerTool(
    "dead_code",
    {
      title: "File không còn được dùng trong Shopify theme",
      description:
        'Shopify theme (Liquid): những file không loại trang nào dùng tới, chia hai mức: "chắc chắn không dùng" và "cần xem lại" (kèm lý do); cùng các khoá dịch và setting không file nào gọi. Gọi khi dọn dẹp theme hoặc được hỏi "file nào thừa", "xoá được gì".',
      inputSchema: {
        limit: limitParam(DEFAULT_LIST_LIMIT, "mỗi danh sách"),
        theme: themeParam,
      },
      annotations,
    },
    ({ limit, theme }) =>
      answer(() => onTheme(theme, (graph) => formatDeadCode(deadCode(graph), { limit: limit ?? DEFAULT_LIST_LIMIT }))),
  );

  return server;
}
