import { CssParser } from "./css.parser.js";
import { DefaultLocaleParser } from "./default-locale.parser.js";
import type { FileParser } from "./file-parser.js";
import { GlobalSettingsParser } from "./global-settings.parser.js";
import { JavaScriptParser } from "./javascript.parser.js";
import { JsonTemplateParser } from "./json-template.parser.js";
import { LiquidParser } from "./liquid.parser.js";

/**
 * Các bộ phân tích file, theo THỨ TỰ ƯU TIÊN của ThemeFileParser:
 *
 *   1. .liquid (kể cả .css.liquid)   -> LiquidParser
 *   2. .js, .mjs                     -> JavaScriptParser
 *   3. .css                          -> CssParser
 *   4. locale mặc định (.json)       -> DefaultLocaleParser
 *   5. config/settings_schema.json   -> GlobalSettingsParser
 *   6. mọi file .json còn lại        -> JsonTemplateParser
 *
 * Hai bộ 4 và 5 phải đứng trước bộ 6: cả ba đều nhận file .json.
 */
export function defaultParsers(): FileParser[] {
  return [
    new LiquidParser(),
    new JavaScriptParser(),
    new CssParser(),
    new DefaultLocaleParser(),
    new GlobalSettingsParser(),
    new JsonTemplateParser(),
  ];
}
