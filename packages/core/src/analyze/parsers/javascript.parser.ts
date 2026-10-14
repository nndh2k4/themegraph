import type { Extraction, ThemeFile } from "../../models/index.js";
import { extractElements } from "./custom-elements.parser.js";
import { emptyExtraction } from "./file-parser.js";
import type { FileParser } from "./file-parser.js";
import { extractImports } from "./js-imports.parser.js";
import { extractSectionLoads } from "./section-loads.parser.js";

/**
 * File .js trong assets/: các section nó tải qua Section Rendering API, các
 * module nó import, và các custom element nó định nghĩa hoặc dùng. Mã
 * JavaScript không được phân tích cú pháp; chỉ tìm các mẫu chữ quen thuộc.
 */
export class JavaScriptParser implements FileParser {
  supports(file: ThemeFile): boolean {
    return file.ext === "js";
  }

  parse(file: ThemeFile, content: string): Extraction {
    return {
      ...emptyExtraction(),
      refs: [...extractSectionLoads(file.path, content, "js"), ...extractImports(file.path, content)],
      elements: extractElements(content),
    };
  }
}
