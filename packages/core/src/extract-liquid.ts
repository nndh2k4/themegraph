import { NodeTypes, toLiquidAST, walk } from "@shopify/liquid-html-parser";

import type { RawRef, RefKind, ThemeFile } from "./types.js";

/**
 * Đổi một vị trí ký tự (offset) trong chuỗi thành số dòng, đếm từ 1.
 *
 * Parser chỉ cho vị trí ký tự của mỗi nút; số dòng phải tự tính bằng cách
 * đếm ký tự xuống dòng đứng trước vị trí đó.
 */
function lineAt(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) {
    if (content.charCodeAt(i) === 10) line++; // 10 là mã của '\n'
  }
  return line;
}

/**
 * Trích quan hệ thô từ một file Liquid.
 *
 * Nhận nội dung file dưới dạng chuỗi thay vì tự đọc đĩa, giống extractJsonRefs.
 *
 * Hiện trích: {% render %} và {% include %}.
 */
export function extractLiquidRefs(file: ThemeFile, content: string): RawRef[] {
  // Chỉ file .liquid mới chứa mã Liquid. Asset (.css, .js) có thể chứa chuỗi
  // trông giống tag nhưng Shopify không chạy Liquid trong đó.
  if (file.ext !== "liquid") return [];

  let ast;
  try {
    // toLiquidAST chỉ phân tích phần Liquid và coi HTML là văn bản thường.
    // Chọn nó thay cho toLiquidHtmlAST vì các quan hệ cần trích đều nằm trong
    // tag Liquid; nhờ vậy một file có HTML viết sai (thẻ không đóng) vẫn đọc được.
    ast = toLiquidAST(content);
  } catch (error) {
    // Bọc lỗi để thông báo có tên file; giữ lỗi gốc trong `cause`.
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Không phân tích được Liquid của "${file.path}": ${reason}`, {
      cause: error,
    });
  }

  const refs: RawRef[] = [];

  // Hàm con để mọi ref được tạo ở đúng một chỗ, cùng một khuôn.
  const addRef = (kind: RefKind, to: string, offset: number): void => {
    refs.push({
      from: file.path,
      to,
      kind,
      source: "liquid",
      // Chưa xét ngữ cảnh if / for; sẽ tính khi có ngăn xếp nút cha.
      conditional: false,
      line: lineAt(content, offset),
    });
  };

  // walk() ghé qua mọi nút của cây, kể cả các câu lệnh bên trong {% liquid %}.
  // Nội dung của {% comment %} là văn bản thô, không thành nút, nên ví dụ
  // "cách dùng" viết trong chú thích tự động không bị tính.
  walk(ast, (node) => {
    if (node.type !== NodeTypes.LiquidTag) return;

    if (node.name === "render" || node.name === "include") {
      // Khi parser không hiểu được phần sau tên tag, markup là chuỗi thô.
      if (typeof node.markup === "string") return;

      const snippet = node.markup.snippet;

      // Chỉ lấy khi tên snippet là chuỗi cố định. {% render block %} dùng
      // biến: tên chỉ có lúc chạy, không biết được khi đọc mã.
      if (snippet.type !== NodeTypes.String) return;

      addRef(node.name, snippet.value, node.position.start);
    }
  });

  return refs;
}
