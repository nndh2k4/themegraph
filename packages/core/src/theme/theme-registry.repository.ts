import type { RegistryEntry } from "../models/index.js";

/**
 * Sổ đăng ký toàn cục: những theme nào đã được phân tích trên máy này, nằm ở
 * đâu. Chỉ là chỉ mục, dựng lại được bằng cách analyze lại.
 */
export interface ThemeRegistryRepository {
  /** Nơi sổ được lưu, để báo cho người dùng khi không ghi được. */
  readonly location: string;
  /**
   * Mọi mục của sổ, xếp theo tên rồi theo đường dẫn. Không bao giờ ném lỗi:
   * sổ chưa có hoặc hỏng thì là sổ rỗng.
   */
  list(): RegistryEntry[];
  /** Ghi một theme vào sổ; theme đã có (cùng đường dẫn) thì mục cũ được thay. */
  register(entry: RegistryEntry): void;
  /** Gỡ một theme khỏi sổ. Trả true nếu có mục bị gỡ. */
  unregister(themeRoot: string): boolean;
}
