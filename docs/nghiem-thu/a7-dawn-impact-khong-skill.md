## a7-dawn-impact-khong-skill
Thư mục: C:/Users/DELL/themes/dawn
Câu hỏi: sửa card-product thì trang nào vỡ
MCP: plugin:figma:figma:connected, gitnexus:connected, themegraph:connected, claude.ai Claude Docs:connected
Skill themegraph được nạp: false
Thời gian: 15 giây, 3 lượt, chi phí quy đổi $0.192
Tool đã gọi (2):
  1. ToolSearch {"query":"select:mcp__themegraph__impact","max_results":5}
  2. mcp__themegraph__impact {"target":"snippets/card-product.liquid"}
Câu trả lời:
Sửa `snippets/card-product.liquid` ảnh hưởng **4 trên 12 loại trang**, qua 6 section (theo đồ thị ThemeGraph):

| Trang | Template | Section gọi `card-product` |
|---|---|---|
| **collection** | `templates/collection.json` | `sections/main-collection-product-grid.liquid` |
| **index** (trang chủ) | `templates/index.json` | `sections/featured-collection.liquid`, `sections/collage.liquid` |
| **product** | `templates/product.json` | `sections/main-product.liquid`, `sections/related-products.liquid` |
| **search** | `templates/search.json` | `sections/main-search.liquid` |

Bảng ghép section vào trang là theo cách Dawn thường bố trí, đồ thị chỉ xác nhận danh sách trang và danh sách section chứ không nêu từng cặp.

- **Có điều kiện:** mọi lời gọi đều nằm trong nhánh `if`/`case`, nên card chỉ hiện khi đúng điều kiện (ví dụ block trong collage là product, collection có sản phẩm, kết quả search là product).
- **Trang khác vẫn có thể dính:** `featured-collection` và `collage` có thể được thêm vào trang bất kỳ qua theme editor. Đồ thị chỉ tính theo các template JSON hiện có trong repo.

8 loại trang còn lại không nằm trong vùng ảnh hưởng.
