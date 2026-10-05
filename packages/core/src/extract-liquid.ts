import { NodeTypes, toLiquidAST, walk } from "@shopify/liquid-html-parser";
import type { LiquidHtmlNode } from "@shopify/liquid-html-parser";

import { parseSchema } from "./extract-schema.js";
import type { ParsedSchema } from "./extract-schema.js";
import { settingNodeId } from "./extract-settings.js";
import type { Extraction, RawRef, RefKind, RefSource, SchemaInfo, ThemeFile } from "./types.js";

/**
 * Các filter biến tên file thành đường dẫn hoặc nội dung của một file trong
 * thư mục assets/ của theme.
 *
 * Cố ý KHÔNG có shopify_asset_url và global_asset_url: hai filter đó trỏ tới
 * file dùng chung trên máy chủ Shopify, không phải file của theme.
 */
const ASSET_FILTERS = new Set(["asset_url", "asset_img_url", "inline_asset_content"]);

/** Filter tra một khoá dịch trong file locale; `translate` là tên đầy đủ của `t`. */
const TRANSLATION_FILTERS = new Set(["t", "translate"]);

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
 * Trích quan hệ thô từ một file Liquid. Là extractLiquid() chỉ lấy phần refs.
 */
export function extractLiquidRefs(file: ThemeFile, content: string): RawRef[] {
  return extractLiquid(file, content).refs;
}

/**
 * Phân tích một file Liquid: các quan hệ thô và dữ kiện của {% schema %}.
 *
 * Nhận nội dung file dưới dạng chuỗi thay vì tự đọc đĩa, giống extractJsonRefs.
 *
 * Quan hệ được trích: {% render %}, {% include %}, {% section %}, {% sections %},
 * {% content_for 'block' %}, các theme block nhắc trong {% schema %},
 * file asset đi qua filter asset_url / asset_img_url / inline_asset_content,
 * khoá dịch đi qua filter t, và các lần đọc setting (settings.x,
 * section.settings.x, block.settings.x).
 */
export function extractLiquid(file: ThemeFile, content: string): Extraction {
  // Chỉ file .liquid mới chứa mã Liquid. Asset (.css, .js) có thể chứa chuỗi
  // trông giống tag nhưng Shopify không chạy Liquid trong đó.
  if (file.ext !== "liquid") return { refs: [], schema: null, translationKeys: [], settings: [] };

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

  // Dữ kiện của khối {% schema %}; vẫn là null nếu file không có khối nào.
  let schema: SchemaInfo | null = null;

  // Id node của các setting mà schema của file này khai.
  const settings: string[] = [];

  // LƯỢT 1: ghi lại nút cha của từng nút.
  //
  // Cần lượt riêng vì walk() của parser gọi hàm cho nút CON trước, nút cha
  // sau, và chỉ đưa cha trực tiếp. Muốn biết một nút có nằm trong {% if %} ở
  // xa phía trên hay không thì phải có sẵn toàn bộ quan hệ cha-con để leo lên.
  const parentOf = new Map<LiquidHtmlNode, LiquidHtmlNode | undefined>();

  // Các tên biến đang đóng vai "block". Ngoài chính chữ block còn có biến lặp
  // của {% for item in section.blocks %}: item.settings.x cũng là đọc setting
  // của block. Gom ở lượt này để lượt 2 dùng được dù vòng for nằm phía sau.
  const blockNames = new Set(["block"]);

  // Các lệnh {% assign ten = <một biến> %} không có filter, ghi lại để xét ở
  // dưới: { tên biến mới, biến nguồn, chuỗi truy cập của biến nguồn }.
  const plainAssigns: { name: string; source: string; lookups: string[] }[] = [];

  walk(ast, (node, parent) => {
    parentOf.set(node, parent);

    if (node.type !== NodeTypes.LiquidTag || typeof node.markup === "string") return;

    if (node.name === "for") {
      const { collection, variableName } = node.markup;
      const first = collection.type === NodeTypes.VariableLookup ? collection.lookups[0] : undefined;

      if (
        collection.type === NodeTypes.VariableLookup &&
        collection.name === "section" &&
        first?.type === NodeTypes.String &&
        first.value === "blocks"
      ) {
        blockNames.add(variableName);
      }
      return;
    }

    if (node.name === "assign") {
      const { expression, filters } = node.markup.value;

      // Có filter thì giá trị đã bị biến đổi, không còn là chính đối tượng đó.
      if (filters.length > 0 || expression.type !== NodeTypes.VariableLookup || expression.name === null) return;

      const lookups: string[] = [];
      for (const lookup of expression.lookups) {
        if (lookup.type !== NodeTypes.String) return;
        lookups.push(lookup.value);
      }

      plainAssigns.push({ name: node.markup.name, source: expression.name, lookups });
    }
  });

  // Tên tắt của các đối tượng chứa setting. Nhiều theme viết
  //   {% assign section_st = section.settings %}
  // một lần ở đầu file rồi đọc section_st.title ở mọi chỗ. Bảng này ghi tên
  // tắt nào ứng với cách viết đầy đủ nào, để section_st.title được hiểu là
  // section.settings.title. Tên tắt có hiệu lực trong cả file.
  const settingAliases = new Map<string, string>();

  for (const assign of plainAssigns) {
    const [first, ...rest] = assign.lookups;

    if (assign.source === "settings" && first === undefined) {
      settingAliases.set(assign.name, "settings");
    } else if (first === "settings" && rest.length === 0) {
      if (assign.source === "section") settingAliases.set(assign.name, "section.settings");
      else if (blockNames.has(assign.source)) settingAliases.set(assign.name, "block.settings");
    }
  }

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
      line: lineAt(content, node.position.start),
    });
  };

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
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Không đọc được JSON trong {% schema %} của "${file.path}": ${reason}`,
          { cause: error },
        );
      }

      // conditional = true: schema chỉ nói file này NHẬN ĐƯỢC các block đó.
      // Block có thật sự được render hay không tuỳ cấu hình trong JSON template.
      for (const blockType of parsed.blockTypes) {
        addRef("block", blockType, node, "schema", true);
      }

      schema = { presets: parsed.presets, acceptsThemeBlocks: parsed.acceptsThemeBlocks };

      // Setting ở tầng ngoài của schema thuộc về chính file: đọc bằng
      // block.settings nếu file là theme block, bằng section.settings nếu là
      // section. Setting của block cục bộ luôn được đọc bằng block.settings.
      const own = file.kind === "block" ? "block" : "section";
      for (const id of parsed.settings) settings.push(settingNodeId(file.path, own, id));
      for (const id of parsed.blockSettings) settings.push(settingNodeId(file.path, "block", id));
      return;
    }

    // LiquidVariable là một biểu thức kèm chuỗi filter, ví dụ
    //   'base.css' | asset_url | stylesheet_tag
    // Nó xuất hiện trong {{ ... }}, trong assign, trong echo... nên bắt ở mức
    // nút này thì không cần quan tâm nó nằm trong tag nào.
    if (node.type === NodeTypes.LiquidVariable) {
      // Chỉ xét filter ĐẦU TIÊN: nếu trước asset_url hay t còn filter khác
      // (append, replace...) thì tên thật là kết quả tính toán, không phải
      // chuỗi gốc.
      const firstFilter = node.filters[0];
      if (firstFilter === undefined) return;

      // Tên file hay khoá dịch phải là chuỗi viết sẵn; là biến thì không biết
      // được khi đọc mã.
      if (node.expression.type !== NodeTypes.String) return;

      if (ASSET_FILTERS.has(firstFilter.name)) {
        addRef("asset", node.expression.value, node);
      } else if (TRANSLATION_FILTERS.has(firstFilter.name)) {
        addRef("translation", node.expression.value, node);
      }
      return;
    }

    // VariableLookup là một biến kèm chuỗi truy cập phía sau, ví dụ
    // section.settings.title có name 'section' và lookups ['settings', 'title'].
    if (node.type === NodeTypes.VariableLookup) {
      const [first, second] = node.lookups;

      // Chỉ lấy khi tên setting là chữ viết sẵn. section.settings[ten_bien]
      // chỉ biết được lúc chạy.
      if (first?.type !== NodeTypes.String) return;

      // settings.x: setting toàn cục của theme.
      if (node.name === "settings") {
        addRef("setting", `settings.${first.value}`, node);
        return;
      }

      // section_st.x, khi section_st là tên tắt của section.settings.
      const alias = node.name === null ? undefined : settingAliases.get(node.name);
      if (alias !== undefined) {
        addRef("setting", `${alias}.${first.value}`, node);
        return;
      }

      if (first.value !== "settings" || second?.type !== NodeTypes.String) return;

      if (node.name === "section") {
        addRef("setting", `section.settings.${second.value}`, node);
      } else if (node.name !== null && blockNames.has(node.name)) {
        // Biến lặp trên section.blocks được ghi lại như block.settings.x.
        addRef("setting", `block.settings.${second.value}`, node);
      }
      return;
    }

    if (node.type !== NodeTypes.LiquidTag) return;

    if (node.name === "render" || node.name === "include") {
      // Khi parser không hiểu được phần sau tên tag, markup là chuỗi thô.
      if (typeof node.markup === "string") return;

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

  return { refs, schema, translationKeys: [], settings };
}
