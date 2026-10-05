export type FileKind =
  | "layout"
  | "template"
  | "section"
  | "section_group"
  | "block"
  | "snippet"
  | "asset"
  | "locale"
  | "locale_schema"
  | "config";

export interface ThemeFile {
  path: string; // Đường dẫn tương đối của file trong theme (ví dụ: sections/header.liquid, assets/style.css...)
  kind: FileKind; 
  ext: string; // Phần mở rộng của file (ví dụ: .liquid, .json, .js, .css...)
}

export interface ScanResult {
  files: ThemeFile[];
  skipped: string[]; // Chứa đường dẫn những file cố ý không quét (ví dụ: readme.md, translation.yml...)
}

/**
 * Dạng quan hệ mà một tham chiếu thô biểu diễn.
 *
 * - render / include: gọi một snippet bằng {% render %} hoặc {% include %}
 * - section: gọi một section, từ {% section %} hoặc từ "type" trong JSON template
 * - section_group: gọi một section group bằng {% sections %}
 * - block: gọi một theme block, từ {% content_for 'block' %}, từ JSON template
 *   hoặc từ {% schema %}
 * - asset: tham chiếu một file trong assets/ qua filter asset_url
 * - layout: template JSON chỉ định layout bao ngoài qua khoá "layout"
 */
export type RefKind =
  | "render"
  | "include"
  | "section"
  | "section_group"
  | "block"
  | "asset"
  | "layout";

/**
 * Nơi quan hệ được khai báo.
 *
 * - liquid: một tag hoặc filter trong mã Liquid
 * - json: file JSON (template, section group)
 * - schema: khối {% schema %} của section hoặc block
 */
export type RefSource = "liquid" | "json" | "schema";

/**
 * Một tham chiếu THÔ từ file này tới một thứ khác trong theme.
 *
 * "Thô" nghĩa là `to` vẫn là cái tên viết trong mã nguồn (ví dụ 'card-product'),
 * chưa được đổi thành đường dẫn thật (snippets/card-product.liquid). Việc đổi đó
 * là của resolver, không phải của tầng parse.
 */
export interface RawRef {
  from: string; // path của file chứa lời gọi, cùng định dạng với ThemeFile.path
  to: string; // tên thô, chưa phân giải (ví dụ: card-product, header-group, base.css)
  kind: RefKind;
  source: RefSource;
  conditional: boolean; // true nếu lời gọi nằm trong if / unless / case / for
  line: number; // dòng mở tag, đếm từ 1; ref lấy từ file JSON thì là 0
}
