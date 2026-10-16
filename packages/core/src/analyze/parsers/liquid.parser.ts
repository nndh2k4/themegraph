import { NodeTypes, toLiquidAST, toTolerantLiquidAST, walk } from "@shopify/liquid-html-parser";
import type {
  ComplexLiquidExpression,
  LiquidExpression,
  LiquidFilter,
  LiquidHtmlNode,
  LiquidVariable,
  RenderMarkup,
} from "@shopify/liquid-html-parser";

import type {
  CallArgument,
  CallContext,
  Extraction,
  RawRef,
  RefKind,
  RefSource,
  ResourceSetting,
  SchemaInfo,
  SnippetCall,
  StaticValue,
  ThemeFile,
} from "../../models/index.js";
import { extractCssUrls } from "./css.parser.js";
import { extractElements } from "./custom-elements.parser.js";
import type { FileParser } from "./file-parser.js";
import { settingNodeId } from "./global-settings.parser.js";
import { extractImportMap, scriptRanges } from "./import-map.parser.js";
import { extractImports, extractModuleScriptImports } from "./js-imports.parser.js";
import { lineIndex } from "./line-index.js";
import { LiquidObjects } from "./liquid-objects.js";
import { LiquidValues } from "./liquid-values.js";
import { parseSchema, RESOURCE_SETTING_TYPES } from "./schema.parser.js";
import type { ParsedSchema } from "./schema.parser.js";
import { extractSectionLoads } from "./section-loads.parser.js";

/**
 * Các filter biến tên file thành đường dẫn hoặc nội dung của một file trong
 * thư mục assets/ của theme.
 *
 * Cố ý KHÔNG có shopify_asset_url và global_asset_url: hai filter đó trỏ tới
 * file dùng chung trên máy chủ Shopify, không phải file của theme.
 */
const ASSET_FILTERS = new Set(["asset_url", "asset_img_url", "inline_asset_content"]);

/**
 * Đọc markup của render/include mà parser không hiểu, theo cách lỏng của
 * Shopify: chuỗi trong nháy đầu tiên là tên snippet; tham số là mọi cặp
 * `ten: gia_tri` trong phần còn lại (giá trị là chuỗi trong nháy, số, hoặc
 * một tên biến có dấu chấm).
 *
 * Vì sao cần: tag Render của Shopify dùng regex không neo và quét
 * `key: value` trên toàn markup, nên `{% render 'a' | f: 1 %}` vẫn chạy được
 * dù parser chuẩn coi cả phần sau tên snippet là chuỗi thô.
 */
const LAX_SNIPPET = /^\s*(["'])([^"']+)\1/;
const LAX_ARG = /(\w[\w-]*)\s*:\s*("[^"]*"|'[^']*'|-?\d+(?:\.\d+)?|[A-Za-z_][\w.-]*)/g;

interface LaxRender {
  snippet: string;
  /** `value` là chữ gốc của giá trị. */
  args: { name: string; value: string }[];
}

function parseLaxRenderMarkup(markup: string): LaxRender | null {
  const head = LAX_SNIPPET.exec(markup);
  if (head === null || head[2] === undefined) return null;
  const rest = markup.slice(head[0].length);
  return { snippet: head[2], args: [...rest.matchAll(LAX_ARG)].map((m) => ({ name: m[1] ?? "", value: m[2] ?? "" })) };
}

/** Đọc một giá trị rời thành biểu thức bằng cách bọc nó trong {{ }}; không đọc được thì null. */
function parseExpression(source: string): ComplexLiquidExpression | null {
  try {
    const [output] = toLiquidAST(`{{ ${source} }}`).children;
    if (output?.type !== NodeTypes.LiquidVariableOutput || typeof output.markup === "string") return null;
    return output.markup.expression;
  } catch {
    return null;
  }
}

/** Filter tra một khoá dịch trong file locale; `translate` là tên đầy đủ của `t`. */
const TRANSLATION_FILTERS = new Set(["t", "translate"]);

/**
 * Filter định dạng ngày. Tham số `format: 'ten'` là một khoá dịch mà Shopify
 * tự tra: date_formats.ten trong file locale, không qua filter t nào.
 */
const DATE_FILTERS = new Set(["date", "time_tag"]);

/**
 * Các tag mà nội dung bên trong KHÔNG chắc được chạy:
 *   - if / unless / case: chỉ chạy khi điều kiện đúng
 *   - for / tablerow: chạy 0 lần nếu danh sách rỗng
 *
 * Các nhánh elsif / else / when không cần liệt kê: chúng luôn nằm bên trong
 * một trong các tag trên.
 *
 * capture, form, paginate KHÔNG có ở đây: nội dung của chúng luôn được chạy.
 */
const CONDITIONAL_TAGS = new Set(["if", "unless", "case", "for", "tablerow"]);

/**
 * Trích quan hệ thô từ một file Liquid. Là extractLiquid() chỉ lấy phần refs.
 */
export function extractLiquidRefs(file: ThemeFile, content: string, context?: CallContext): RawRef[] {
  return extractLiquid(file, content, context).refs;
}

/**
 * Phân tích một file Liquid: các quan hệ thô và dữ kiện của {% schema %}.
 *
 * Nhận nội dung file dưới dạng chuỗi thay vì tự đọc đĩa, giống extractJsonRefs.
 *
 * Quan hệ được trích: {% render %}, {% include %}, {% section %}, {% sections %},
 * {% content_for 'block' %}, các theme block nhắc trong {% schema %},
 * file asset đi qua filter asset_url / asset_img_url / inline_asset_content,
 * khoá dịch đi qua filter t và qua format: của filter date, và các lần đọc
 * setting (settings.x, section.settings.x, block.settings.x, kể cả qua tên
 * khác của các đối tượng đó). Trả kèm các lời gọi snippet và tham số của
 * chúng (xem SnippetCall).
 *
 * `context` là những gì các nơi gọi truyền vào khi file là một snippet (xem
 * CallContext); không có thì tham số của snippet là không biết.
 */
export function extractLiquid(file: ThemeFile, content: string, context?: CallContext): Extraction {
  // Chỉ file .liquid mới chứa mã Liquid. Asset (.css, .js) có thể chứa chuỗi
  // trông giống tag nhưng Shopify không chạy Liquid trong đó.
  if (file.ext !== "liquid") return { refs: [], schema: null, translationKeys: [], settings: [], elements: [], importMap: [], calls: [], resourceSettings: [], warnings: [] };

  // Lỗi của MỘT PHẦN file: file vẫn được phân tích, người dùng được báo.
  const warnings: string[] = [];

  let ast;
  try {
    // toLiquidAST chỉ phân tích phần Liquid và coi HTML là văn bản thường.
    // Chọn nó thay cho toLiquidHtmlAST vì các quan hệ cần trích đều nằm trong
    // tag Liquid; nhờ vậy một file có HTML viết sai (thẻ không đóng) vẫn đọc được.
    ast = toLiquidAST(content);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    try {
      // Shopify chấp nhận một số Liquid lệch mà parser chuẩn từ chối (ví dụ
      // {%- endif- %}, hay đóng tag sai thứ tự). Parser dễ dãi vẫn dựng được
      // cây từ đó, nên đọc quan hệ bằng nó và báo cho người dùng biết.
      ast = toTolerantLiquidAST(content);
      warnings.push(`Liquid không chuẩn, đã đọc bằng parser dễ dãi: ${reason}`);
    } catch {
      // Bọc lỗi để thông báo có tên file; giữ lỗi gốc trong `cause`.
      throw new Error(`Không phân tích được Liquid của "${file.path}": ${reason}`, {
        cause: error,
      });
    }
  }

  const refs: RawRef[] = [];

  // Dữ kiện của khối {% schema %}; vẫn là null nếu file không có khối nào.
  let schema: SchemaInfo | null = null;

  // Id node của các setting mà schema của file này khai.
  const settings: string[] = [];

  // Trong số đó, các setting có kiểu là một tài nguyên (xem ResourceSetting).
  const resourceSettings: ResourceSetting[] = [];

  // LƯỢT 1: ghi lại nút cha của từng nút.
  //
  // Cần lượt riêng vì walk() của parser gọi hàm cho nút CON trước, nút cha
  // sau, và chỉ đưa cha trực tiếp. Muốn biết một nút có nằm trong {% if %} ở
  // xa phía trên hay không thì phải có sẵn toàn bộ quan hệ cha-con để leo lên.
  const parentOf = new Map<LiquidHtmlNode, LiquidHtmlNode | undefined>();

  // Hai bộ tính dùng chung bảng nút cha, được điền xong ở lượt 1, trước lần
  // tính đầu tiên ở lượt 2:
  //   - values: giá trị của các tên ghép (xem liquid-values.ts)
  //   - objects: biến nào đang chứa section, block hay bộ setting nào, để
  //     section_st.title hay last_block.settings.x vẫn là lần đọc setting
  //     (xem liquid-objects.ts)
  const values = new LiquidValues(parentOf, content, context);
  const objects = new LiquidObjects(file.path, file.kind, context);

  walk(ast, (node, parent) => {
    parentOf.set(node, parent);

    if (node.type !== NodeTypes.LiquidTag || typeof node.markup === "string") return;

    if (node.name === "for" || node.name === "tablerow") {
      objects.addLoop(node.markup.variableName, node.markup.collection);
      return;
    }

    if (node.name === "assign") {
      values.addAssignment(node.markup.name, node.markup.value, node);
      objects.addAssignment(node.markup.name, node.markup.value);
      return;
    }

    if (node.name === "capture" && node.markup.name !== null) {
      values.addCapture(node.markup.name, node);
    }
  });

  /** Leo từ một nút lên tới gốc; trả true nếu gặp một tag có điều kiện. */
  const isInsideConditional = (node: LiquidHtmlNode): boolean => {
    let child = node;
    let current = parentOf.get(node);

    while (current !== undefined) {
      // Chỉ tính khi đi lên từ PHẦN THÂN của tag (children). Biểu thức điều
      // kiện của chính tag đó, ví dụ section.settings.x trong
      // {% if section.settings.x %}, luôn được tính toán nên không có điều kiện.
      if (
        current.type === NodeTypes.LiquidTag &&
        CONDITIONAL_TAGS.has(current.name) &&
        current.children?.includes(child) === true
      ) {
        return true;
      }
      child = current;
      current = parentOf.get(current);
    }
    return false;
  };

  // Số dòng của một vị trí ký tự. Dựng một lần cho cả file: ref nhiều thì tra
  // nhị phân, không đếm lại từ đầu file ở mỗi ref.
  const lineAt = lineIndex(content);

  // Vùng thân các thẻ <script> không có src, tính một lần: mỗi asset_url hỏi
  // xem mình in ra ở đâu (xem usageOfAsset).
  const ranges = scriptRanges(content);

  // Hàm con để mọi ref được tạo ở đúng một chỗ, cùng một khuôn.
  // Mặc định source là 'liquid' và conditional được tính từ vị trí của nút;
  // nhánh schema truyền giá trị riêng cho cả hai.
  const addRef = (
    kind: RefKind,
    to: string,
    node: LiquidHtmlNode,
    source: RefSource = "liquid",
    conditional: boolean = isInsideConditional(node),
  ): void => {
    refs.push({
      from: file.path,
      to,
      kind,
      source,
      conditional,
      line: lineAt(node.position.start),
    });
  };

  /**
   * Chỗ một {{ ... | asset_url }} được in ra quyết định nó có nạp file hay không:
   *
   * - trong <script type="importmap">: chỉ là ánh xạ specifier -> URL, trình
   *   duyệt chỉ tải file khi có mã import nó, và cạnh import đã có riêng
   * - trong <script> nội tuyến, hoặc đứng trước filter json: URL được đưa cho
   *   JavaScript, file chỉ được nạp nếu mã đó chạy tới và dùng nó
   * - còn lại (src, href, data-*, stylesheet_tag...): nạp thật, trả undefined
   *
   * json phải đứng SAU filter asset: `cfg | json | append: ... | asset_url`
   * không đưa URL cho JavaScript.
   */
  const usageOfAsset = (node: LiquidVariable, assetAt: number): RawRef["usage"] => {
    const at = node.position.start;
    const range = ranges.find((r) => at >= r.start && at < r.end);
    if (range?.kind === "importmap") return "map";
    if (range?.kind === "inline") return "url";
    return node.filters.slice(assetAt + 1).some((f) => f.name === "json") ? "url" : undefined;
  };

  /**
   * Ghi một ref cho mỗi giá trị mà tên ghép `expression | filters` có thể
   * có, đánh dấu computed. Không tính được thì không ghi gì.
   */
  const addComputedRefs = (
    kind: RefKind,
    expression: ComplexLiquidExpression,
    filters: readonly LiquidFilter[],
    node: LiquidHtmlNode,
    prefix = "",
  ): void => {
    const names = new Set<string>();
    for (const value of values.evaluate(expression, filters, node) ?? []) {
      if ((typeof value === "string" || typeof value === "number") && value !== "") names.add(String(value));
    }
    for (const name of names) {
      addRef(kind, prefix + name, node);
      const last = refs.at(-1);
      if (last !== undefined) last.computed = true;
    }
  };

  /**
   * Ghi lần đọc setting `<object>.<key>`. Khoá viết sẵn (settings.x) thành
   * một ref; khoá là biểu thức (settings[ten_bien]) thành một ref cho mỗi
   * giá trị tính được.
   */
  const addSettingRef = (
    object: string,
    key: LiquidExpression | undefined,
    node: LiquidHtmlNode,
    origins: readonly string[] = [file.path],
  ): void => {
    if (key === undefined) return;
    const before = refs.length;

    if (key.type === NodeTypes.String) addRef("setting", `${object}.${key.value}`, node);
    else addComputedRefs("setting", key, [], node, `${object}.`);

    // Đối tượng nhận từ nơi gọi (xem ObjectOrigin), hay section có sẵn của
    // một file không phải section (ANCESTOR_SECTIONS): ghi phạm vi tìm
    // setting. Setting toàn cục không thuộc file nào nên không cần.
    const own = origins.length === 1 && origins[0] === file.path;
    if (own || object === "settings") return;
    for (const ref of refs.slice(before)) ref.scope = [...origins];
  };

  /** Một tham số truyền vào snippet: biểu thức `expression` tính tại `node`. */
  const argumentOf = (name: string, expression: ComplexLiquidExpression, node: LiquidHtmlNode, each = false): CallArgument => {
    let passed = values.evaluate(expression, [], node);

    // {% render 'x' for list as item %}: snippet nhận TỪNG phần tử.
    if (each && passed !== undefined) {
      const items: StaticValue[] = [];
      for (const value of passed) {
        if (Array.isArray(value)) items.push(...value);
      }
      passed = items;
    }
    return { name, kinds: objects.originsOf(expression, each), values: passed ?? null };
  };

  /**
   * Mọi biến của nơi gọi tại `node`. {% include %} dùng chung biến với nơi
   * gọi, nên cả bộ này được truyền theo.
   */
  const callerVariables = (node: LiquidHtmlNode): Map<string, CallArgument> => {
    const args = new Map<string, CallArgument>();
    const names = new Set([...values.names(), ...objects.names(), ...(context?.kinds.keys() ?? []), ...(context?.values.keys() ?? [])]);
    for (const name of names) {
      const kinds = objects.originsOfVariable(name);
      args.set(name, { name, kinds, values: values.valuesOf(name, node) ?? null });
    }
    return args;
  };

  /** Chỉ giữ tham số mang thông tin; xếp theo tên để kết quả ổn định. */
  const callFrom = (snippet: string, args: Map<string, CallArgument>): SnippetCall => {
    const informative = [...args.values()].filter((arg) => arg.kinds.length > 0 || arg.values !== null);
    informative.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return { snippet, args: informative };
  };

  /** Các tham số của một lời gọi snippet. */
  const callOf = (node: LiquidHtmlNode, snippet: string, markup: RenderMarkup, include: boolean): SnippetCall => {
    const args = include ? callerVariables(node) : new Map<string, CallArgument>();

    for (const arg of markup.args) args.set(arg.name, argumentOf(arg.name, arg.value, node));

    if (markup.variable !== null) {
      const name = markup.alias?.value ?? snippet;
      args.set(name, argumentOf(name, markup.variable.name, node, markup.variable.kind === "for"));
    }

    return callFrom(snippet, args);
  };

  /** Lời gọi viết lỏng (xem parseLaxRenderMarkup): mỗi giá trị được đọc riêng như một biểu thức. */
  const laxCallOf = (node: LiquidHtmlNode, lax: LaxRender, include: boolean): SnippetCall => {
    const args = include ? callerVariables(node) : new Map<string, CallArgument>();

    for (const arg of lax.args) {
      const expression = parseExpression(arg.value);
      if (expression !== null) args.set(arg.name, argumentOf(arg.name, expression, node));
    }

    return callFrom(lax.snippet, args);
  };

  const calls: SnippetCall[] = [];

  // LƯỢT 2: tìm các nút là tham chiếu.
  //
  // walk() ghé qua mọi nút của cây, kể cả các câu lệnh bên trong {% liquid %}.
  // Nội dung của {% comment %} là văn bản thô, không thành nút, nên ví dụ
  // "cách dùng" viết trong chú thích tự động không bị tính.
  walk(ast, (node) => {
    // {% schema %} là "raw tag": parser không phân tích phần thân mà giữ
    // nguyên dạng chuỗi trong body.value. Phần thân đó là JSON.
    if (node.type === NodeTypes.LiquidRawTag && node.name === "schema") {
      let parsed: ParsedSchema;
      try {
        parsed = parseSchema(node.body.value);
      } catch (error) {
        // Chỉ phần schema hỏng: các quan hệ Liquid của file vẫn đáng giữ, nên
        // ghi cảnh báo thay vì ném lỗi làm mất cả file.
        const reason = error instanceof Error ? error.message : String(error);
        warnings.push(`Không đọc được JSON trong {% schema %}: ${reason}`);
        return;
      }

      // conditional = true: schema chỉ nói file này NHẬN ĐƯỢC các block đó.
      // Block có thật sự được render hay không tuỳ cấu hình trong JSON template.
      for (const blockType of parsed.blockTypes) {
        addRef("block", blockType, node, "schema", true);
      }

      schema = { presets: parsed.presets, acceptsThemeBlocks: parsed.acceptsThemeBlocks, localBlockTypes: parsed.localBlockTypes };

      // Setting ở tầng ngoài của schema thuộc về chính file: đọc bằng
      // block.settings nếu file là theme block, bằng section.settings nếu là
      // section. Setting của block cục bộ luôn được đọc bằng block.settings.
      const own = file.kind === "block" ? "block" : "section";
      for (const id of parsed.settings) settings.push(settingNodeId(file.path, own, id));
      for (const id of parsed.blockSettings) settings.push(settingNodeId(file.path, "block", id));
      for (const { id, type } of parsed.resourceSettings) {
        resourceSettings.push({ setting: settingNodeId(file.path, own, id), type });
      }
      return;
    }

    // LiquidVariable là một biểu thức kèm chuỗi filter, ví dụ
    //   'base.css' | asset_url | stylesheet_tag
    // Nó xuất hiện trong {{ ... }}, trong assign, trong echo... nên bắt ở mức
    // nút này thì không cần quan tâm nó nằm trong tag nào.
    if (node.type === NodeTypes.LiquidVariable) {
      // date: format: 'month_day_year' đọc khoá date_formats.month_day_year.
      // Shopify còn có sẵn vài định dạng không cần khoá, nên tên không có
      // trong locale thì bỏ (computed).
      for (const dateFilter of node.filters) {
        if (!DATE_FILTERS.has(dateFilter.name)) continue;
        for (const arg of dateFilter.args) {
          if (arg.type === NodeTypes.NamedArgument && arg.name === "format") {
            addComputedRefs("translation", arg.value, [], node, "date_formats.");
          }
        }
      }

      // Filter đầu tiên tra một file hay một khoá dịch; phần đứng trước nó là
      // cái tên.
      const at = node.filters.findIndex((filter) => ASSET_FILTERS.has(filter.name) || TRANSLATION_FILTERS.has(filter.name));
      const filter = node.filters[at];
      if (filter === undefined) return;

      const kind: RefKind = ASSET_FILTERS.has(filter.name) ? "asset" : "translation";

      // inline_asset_content in NỘI DUNG file chứ không in URL, nên chỗ in ra
      // không đổi ý nghĩa của nó.
      const usage = kind === "asset" && filter.name !== "inline_asset_content" ? usageOfAsset(node, at) : undefined;
      const before = refs.length;

      // Tên viết sẵn: 'base.css' | asset_url.
      if (at === 0 && node.expression.type === NodeTypes.String) {
        addRef(kind, node.expression.value, node);
      } else {
        // Tên ghép: 'icon-' | append: name | asset_url, hoặc slide_image |
        // asset_url với slide_image được assign ở chỗ khác. Chỉ ghi khi tính được.
        addComputedRefs(kind, node.expression, node.filters.slice(0, at), node);
      }

      if (usage !== undefined) for (const added of refs.slice(before)) added.usage = usage;
      return;
    }

    // VariableLookup là một biến kèm chuỗi truy cập phía sau, ví dụ
    // section.settings.title có name 'section' và lookups ['settings', 'title'].
    if (node.type === NodeTypes.VariableLookup) {
      // closest.product: setting kiểu product của section hay block gần nhất
      // bao quanh. Không có thì Shopify lấy sản phẩm của trang, nên tầng dựng
      // đồ thị bỏ những lần đọc không tìm được setting nào (computed).
      const [resource] = node.lookups;
      if (node.name === "closest" && resource?.type === NodeTypes.String && RESOURCE_SETTING_TYPES.has(resource.value)) {
        addRef("setting", `closest.${resource.value}`, node);
        const last = refs.at(-1);
        if (last !== undefined) last.computed = true;
        return;
      }

      // Một lần đọc setting cho mỗi cách hiểu biến gốc: settings.x,
      // section.settings.x, block.settings.x, hoặc qua một tên khác của các
      // đối tượng đó (xem liquid-objects.ts). Tên setting là chữ viết sẵn,
      // hoặc một biểu thức tính được (settings[setting_key]); biểu thức không
      // tính được, như section.settings[block.id], bị bỏ qua.
      for (const read of objects.settingReads(node)) addSettingRef(read.object, read.key, node, read.origins);
      return;
    }

    if (node.type !== NodeTypes.LiquidTag) return;

    if (node.name === "render" || node.name === "include") {
      // Khi parser không hiểu được phần sau tên tag, markup là chuỗi thô.
      // Shopify vẫn chạy được nhiều dạng như vậy, nên đọc theo cách của nó.
      if (typeof node.markup === "string") {
        const lax = parseLaxRenderMarkup(node.markup);
        if (lax === null) return;

        addRef(node.name, lax.snippet, node);

        const last = refs.at(-1);
        if (last !== undefined && lax.args.some((arg) => arg.name === "settings")) last.passesSettings = true;

        calls.push(laxCallOf(node, lax, node.name === "include"));
        return;
      }

      const snippet = node.markup.snippet;

      // Chỉ lấy khi tên snippet là chuỗi cố định. {% render block %} dùng
      // biến: tên chỉ có lúc chạy, không biết được khi đọc mã.
      if (snippet.type !== NodeTypes.String) return;

      addRef(node.name, snippet.value, node);

      // Đánh dấu lời gọi truyền tham số tên "settings" (xem RawRef.passesSettings).
      const last = refs.at(-1);
      if (last !== undefined && node.markup.args.some((arg) => arg.name === "settings")) {
        last.passesSettings = true;
      }

      calls.push(callOf(node, snippet.value, node.markup, node.name === "include"));
      return;
    }

    // {% layout 'ten' %} trong template Liquid: chọn layout/ten.liquid thay cho
    // layout mặc định. {% layout none %} và {% layout false %}: không dùng layout.
    if (node.name === "layout") {
      if (typeof node.markup === "string") return;

      if (node.markup.type === NodeTypes.String) {
        addRef("layout", node.markup.value, node);
        return;
      }

      // Parser đọc chữ `none` như tên một biến, còn `false` là một hằng.
      const isNone =
        node.markup.type === NodeTypes.VariableLookup && node.markup.name === "none";
      const isFalse =
        node.markup.type === NodeTypes.LiquidLiteral && node.markup.value === false;

      if (isNone || isFalse) addRef("no_layout", "", node);
      return;
    }

    // {% section 'ten' %}: gọi thẳng một section, thường thấy trong layout.
    if (node.name === "section") {
      if (typeof node.markup === "string") return;

      // Tên section trong tag này luôn là chuỗi; parser để nó ở markup.name.
      addRef("section", node.markup.name.value, node);
      return;
    }

    // {% sections 'ten-group' %}: gọi một section group, tức một file JSON
    // trong sections/ liệt kê nhiều section. Khác tag ở trên đúng một chữ "s"
    // nhưng trỏ tới loại file khác hẳn, nên dùng kind riêng.
    if (node.name === "sections") {
      // Với tag này parser để thẳng chuỗi tên vào markup, không bọc thêm lớp.
      if (typeof node.markup === "string") return;

      addRef("section_group", node.markup.value, node);
      return;
    }

    // {% content_for 'block', type: '_ten', id: '...' %}: chèn một theme block
    // cố định (static block), tức file blocks/_ten.liquid.
    if (node.name === "content_for") {
      if (typeof node.markup === "string") return;

      // Dạng số nhiều {% content_for 'blocks' %} render mọi block con mà
      // merchant đặt trong theme editor. Block nào được đặt thì ghi trong JSON
      // template, không đọc ra được từ mã Liquid, nên không sinh ref ở đây.
      if (node.markup.contentForType.value !== "block") return;

      // Tham số viết dạng tên: giá trị, thứ tự tuỳ ý; tìm tham số tên "type".
      const typeArg = node.markup.args.find((arg) => arg.name === "type");

      // Thiếu type, hoặc type là biến thì không biết block nào khi đọc mã.
      if (typeArg === undefined) return;
      if (typeArg.value.type !== NodeTypes.String) return;

      addRef("block", typeArg.value.value, node);
    }
  });

  // Import map in ra từ file này (xem import-map.parser.ts). Chỉ chạy thử
  // khi file có chữ đó.
  const importMap = content.includes("importmap") ? extractImportMap(ast, content, values) : [];

  return { refs, schema, translationKeys: [], settings, elements: [], importMap, calls, resourceSettings, warnings };
}

/**
 * File .liquid: mọi quan hệ trong mã Liquid (xem extractLiquid), cộng ba thứ
 * nằm trong phần HTML mà bộ phân tích Liquid không trích:
 *   - URL kiểu ?section_id=ten (section tải lúc chạy, xem extractSectionLoads)
 *   - import trong thẻ <script type="module"> (xem extractImports)
 *   - thẻ custom element (xem extractElements)
 *
 * File assets/*.js.liquid là JavaScript có chèn Liquid nên phần section tải
 * lúc chạy được ghi với nguồn "js", và import được tìm trong cả file.
 * File assets/*.css.liquid là CSS có chèn Liquid nên url() cũng được trích
 * (xem extractCssUrls).
 */
export class LiquidParser implements FileParser {
  supports(file: ThemeFile): boolean {
    return file.ext === "liquid";
  }

  parse(file: ThemeFile, content: string, context?: CallContext): Extraction {
    const extraction = extractLiquid(file, content, context);
    const isJavaScript = file.path.endsWith(".js.liquid");
    const source = isJavaScript ? "js" : "liquid";
    const imports = isJavaScript ? extractImports(file.path, content) : extractModuleScriptImports(file.path, content);

    const cssUrls = file.path.endsWith(".css.liquid") ? extractCssUrls(file.path, content) : [];

    return {
      ...extraction,
      refs: [...extraction.refs, ...extractSectionLoads(file.path, content, source), ...imports, ...cssUrls],
      elements: extractElements(content),
    };
  }
}
