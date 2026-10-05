import { NodeTypes, toLiquidAST, walk } from "@shopify/liquid-html-parser";
import type { LiquidHtmlNode } from "@shopify/liquid-html-parser";

import { collectSchemaBlockTypes } from "./extract-schema.js";
import type { RawRef, RefKind, RefSource, ThemeFile } from "./types.js";

/**
 * Các filter biến tên file thành đường dẫn hoặc nội dung của một file trong
 * thư mục assets/ của theme.
 *
 * Cố ý KHÔNG có shopify_asset_url và global_asset_url: hai filter đó trỏ tới
 * file dùng chung trên máy chủ Shopify, không phải file của theme.
 */
const ASSET_FILTERS = new Set(["asset_url", "asset_img_url", "inline_asset_content"]);

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
 * Trích quan hệ thô từ một file Liquid.
 *
 * Nhận nội dung file dưới dạng chuỗi thay vì tự đọc đĩa, giống extractJsonRefs.
 *
 * Hiện trích: {% render %}, {% include %}, {% section %}, {% sections %},
 * {% content_for 'block' %}, các theme block nhắc trong {% schema %},
 * và file asset đi qua filter asset_url / asset_img_url / inline_asset_content.
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

  // LƯỢT 1: ghi lại nút cha của từng nút.
  //
  // Cần lượt riêng vì walk() của parser gọi hàm cho nút CON trước, nút cha
  // sau, và chỉ đưa cha trực tiếp. Muốn biết một nút có nằm trong {% if %} ở
  // xa phía trên hay không thì phải có sẵn toàn bộ quan hệ cha-con để leo lên.
  const parentOf = new Map<LiquidHtmlNode, LiquidHtmlNode | undefined>();
  walk(ast, (node, parent) => {
    parentOf.set(node, parent);
  });

  /** Leo từ một nút lên tới gốc; trả true nếu gặp một tag có điều kiện. */
  const isInsideConditional = (node: LiquidHtmlNode): boolean => {
    let current = parentOf.get(node);
    while (current !== undefined) {
      if (current.type === NodeTypes.LiquidTag && CONDITIONAL_TAGS.has(current.name)) {
        return true;
      }
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
      let blockTypes: string[];
      try {
        blockTypes = collectSchemaBlockTypes(node.body.value);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Không đọc được JSON trong {% schema %} của "${file.path}": ${reason}`,
          { cause: error },
        );
      }

      // conditional = true: schema chỉ nói file này NHẬN ĐƯỢC các block đó.
      // Block có thật sự được render hay không tuỳ cấu hình trong JSON template.
      for (const blockType of blockTypes) {
        addRef("block", blockType, node, "schema", true);
      }
      return;
    }

    // LiquidVariable là một biểu thức kèm chuỗi filter, ví dụ
    //   'base.css' | asset_url | stylesheet_tag
    // Nó xuất hiện trong {{ ... }}, trong assign, trong echo... nên bắt ở mức
    // nút này thì không cần quan tâm nó nằm trong tag nào.
    if (node.type === NodeTypes.LiquidVariable) {
      // Chỉ xét filter ĐẦU TIÊN: nếu trước asset_url còn filter khác (append,
      // replace...) thì tên file thật là kết quả tính toán, không phải chuỗi gốc.
      const firstFilter = node.filters[0];
      if (firstFilter === undefined || !ASSET_FILTERS.has(firstFilter.name)) return;

      // Tên file phải là chuỗi viết sẵn; là biến thì không biết khi đọc mã.
      if (node.expression.type !== NodeTypes.String) return;

      addRef("asset", node.expression.value, node);
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

  return refs;
}
