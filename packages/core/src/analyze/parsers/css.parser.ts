import type { Extraction, RawRef, ThemeFile } from "../../models/index.js";
import { emptyExtraction } from "./file-parser.js";
import type { FileParser } from "./file-parser.js";

/**
 * File nạp qua url() trong CSS: font của @font-face, ảnh nền. Mọi asset của
 * theme được phục vụ chung một thư mục, nên url('Font.woff2') viết trong
 * assets/base.css là assets/Font.woff2. URL tuyệt đối, '/...', '//...',
 * data: và #id không phải file của theme. Phần ?v= và #... bị bỏ.
 *
 * Tên tìm được đánh dấu computed: CSS hay chứa đường dẫn kiểu cũ không còn
 * file, và đó không phải tham chiếu hỏng mà công cụ cần báo.
 */
const CSS_URL = /url\(\s*(["']?)([^"')]+?)\1\s*\)/g;
const COMMENTS = /\/\*[\s\S]*?\*\//g;

export function extractCssUrls(from: string, content: string): RawRef[] {
  // Thay chú thích bằng khoảng trắng nhưng giữ xuống dòng, để số dòng không lệch.
  const code = content.replace(COMMENTS, (c) => c.replace(/[^\n]/g, " "));
  const refs: RawRef[] = [];
  let line = 1;
  let cursor = 0;

  for (const match of code.matchAll(CSS_URL)) {
    const raw = (match[2] ?? "").trim();
    // '{' là mã Liquid trong .css.liquid (url({{ 'a.png' | asset_url }})); filter
    // asset_url của Liquid đã lo phần đó, không phải tên file viết thẳng.
    if (raw === "" || raw.includes("{") || /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(raw)) continue;

    const name = raw.replace(/^\.\//, "").replace(/[?#].*$/, "");
    if (name === "" || name.includes("/")) continue;

    for (; cursor < match.index; cursor++) if (code.charCodeAt(cursor) === 10) line++;
    refs.push({ from, to: name, kind: "asset", source: "css", conditional: false, line, computed: true });
  }
  return refs;
}

/** File .css trong assets/. */
export class CssParser implements FileParser {
  supports(file: ThemeFile): boolean {
    return file.ext === "css";
  }

  parse(file: ThemeFile, content: string): Extraction {
    return { ...emptyExtraction(), refs: extractCssUrls(file.path, content) };
  }
}
