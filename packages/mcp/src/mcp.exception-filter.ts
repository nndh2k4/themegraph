import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Chạy phần thân của một tool, gói các dòng chữ thành kết quả, và đổi mọi lỗi
 * thành kết quả có isError (giống exception filter của NestJS).
 *
 * Lỗi của lõi (theme chưa analyze, không có node tên đó kèm gợi ý, không chọn
 * được theme) đã được viết cho người đọc và nói luôn cách chữa, nên agent chỉ
 * cần đọc thông báo là tự sửa được lời gọi. Ném lỗi ra ngoài thì client chỉ
 * thấy một lỗi giao thức chung chung.
 */
export class McpExceptionFilter {
  async run(body: () => Promise<string[]> | string[]): Promise<CallToolResult> {
    try {
      return { content: [{ type: "text", text: (await body()).join("\n") }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: `Lỗi: ${error instanceof Error ? error.message : String(error)}` }] };
    }
  }
}
