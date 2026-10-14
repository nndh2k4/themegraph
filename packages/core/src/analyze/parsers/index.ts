import { DefaultLocaleParser } from "./default-locale.parser.js";
import type { FileParser } from "./file-parser.js";
import { GlobalSettingsParser } from "./global-settings.parser.js";
import { JavaScriptParser } from "./javascript.parser.js";
import { JsonTemplateParser } from "./json-template.parser.js";
import { LiquidParser } from "./liquid.parser.js";

/**
 * Các bộ phân tích file, theo THỨ TỰ ƯU TIÊN của ThemeFileParser:
 *
 *   1. .liquid                       -> LiquidParser
 *   2. .js                           -> JavaScriptParser
 *   3. locale mặc định (.json)       -> DefaultLocaleParser
 *   4. config/settings_schema.json   -> GlobalSettingsParser
 *   5. mọi file .json còn lại        -> JsonTemplateParser
 *
 * Hai bộ 3 và 4 phải đứng trước bộ 5: cả ba đều nhận file .json.
 */
export function defaultParsers(): FileParser[] {
  return [new LiquidParser(), new JavaScriptParser(), new DefaultLocaleParser(), new GlobalSettingsParser(), new JsonTemplateParser()];
}
