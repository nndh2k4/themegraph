import type { GraphScope, GraphScopeFactory, ThemeService } from "@themegraph/core";
import type { ThemeNoteView } from "@themegraph/views";

/**
 * Chọn theme, mở đồ thị, chạy một truy vấn, rồi luôn đóng đồ thị lại. Mọi tool
 * hỏi về MỘT theme đi qua đây.
 *
 * Câu trả lời mở đầu bằng tên theme đã chọn (agent cần biết mình vừa hỏi theme
 * nào khi máy có nhiều theme) và dòng cảnh báo nếu đồ thị đã cũ.
 */
export class ThemeRunner {
  constructor(
    private readonly themes: ThemeService,
    private readonly graphs: GraphScopeFactory,
    private readonly note: ThemeNoteView,
    private readonly cwd: string,
  ) {}

  async run(theme: string | undefined, query: (scope: GraphScope) => string[]): Promise<string[]> {
    const themeRoot = this.themes.select(theme, this.cwd);
    const lines = this.graphs.use(themeRoot, query);

    // Agent thường hỏi ngay sau khi vừa sửa file, tức đúng lúc đồ thị dễ cũ
    // nhất. Phép so này đọc lại và tính hash mọi file analyze đọc, nên tốn
    // thời gian tỉ lệ với cỡ theme; đổi lại câu trả lời không âm thầm dựa trên
    // đồ thị cũ.
    const status = await this.themes.status(themeRoot);

    return [...this.note.render(status), "", ...lines];
  }
}
