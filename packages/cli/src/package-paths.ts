import { fileURLToPath } from "node:url";

/**
 * Các đường dẫn tính từ vị trí của chính file này trong gói.
 *
 * File này PHẢI nằm ngay trong src/ (sau khi build là dist/), cạnh cli.js:
 * dist/ của tsc giữ cây thư mục, còn gói phát hành gộp mọi file vào một thư
 * mục phẳng, và chỉ ở vị trí này hai cách đó mới cho cùng đường dẫn.
 */
export interface PackagePaths {
  /** File chạy của lệnh `themegraph`, để đăng ký làm MCP server. */
  cliPath: string;
  /** Skill cho AI agent, nằm cạnh dist/ (và cạnh src/ khi chạy từ mã nguồn). */
  skillSource: string;
  /**
   * Nơi có thể có bản build của giao diện web, theo thứ tự ưu tiên: trong gói
   * phát hành, rồi packages/web/dist/ khi chạy trong repo (xem resolveWebRoot).
   */
  webRoots: string[];
}

export function packagePaths(): PackagePaths {
  const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
  return {
    cliPath: here("./cli.js"),
    skillSource: here("../skills/themegraph/SKILL.md"),
    webRoots: [here("../web"), here("../../web/dist")],
  };
}
