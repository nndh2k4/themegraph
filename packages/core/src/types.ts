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
