## co-p1-pagination
Thư mục: D:/code/New folder (2)/phase-2-purity-shopify-theme-store
Câu hỏi: sửa snippets/pagination.liquid thì ảnh hưởng những trang nào?
MCP: plugin:figma:figma:connected, gitnexus:connected, themegraph:connected, claude.ai Claude Docs:connected
Skill themegraph được nạp: true
Thời gian: 15 giây, 6 lượt, chi phí quy đổi $0.231
Tool đã gọi (4):
  1. Skill {"skill":"themegraph"}
  2. ToolSearch {"query":"select:mcp__themegraph__impact,mcp__themegraph__context","max_results":5}
  3. mcp__themegraph__impact {"target":"snippets/pagination.liquid"}
  4. mcp__themegraph__context {"target":"snippets/pagination.liquid"}
Câu trả lời:
Sửa `snippets/pagination.liquid` ảnh hưởng **5 trên 19 loại trang**, qua 5 section gọi trực tiếp và 8 template.

| Trang | Section gọi snippet | Template |
| --- | --- | --- |
| `collection` | `sections/main-collection-product-grid.liquid:1017` | `collection.json`, `collection.collection-layout-2.json`, `collection.drawer-filter.json`, `collection.paren_collection-2.json` |
| `search` | `sections/main-search.liquid:956` | `search.json` |
| `blog` | `sections/main-blog.liquid:255` | `blog.json` |
| `article` | `sections/main-article.liquid:504` | `article.json` |
| `list-collections` | `sections/main-list-collections.liquid:79` | `list-collections.json` |

Cả 5 trang đều ở dạng **có điều kiện**: lời gọi `render 'pagination'` nằm trong một nhánh `if`/`case` (tôi chưa mở các section để xem điều kiện cụ thể), nên không phải lúc nào phân trang cũng hiện ra.

Vài điểm cần lưu ý khi sửa:

- **Trang collection có 4 template**, nên cần kiểm tra cả 3 template thay thế chứ không chỉ `collection.json`.
- **Snippet kéo theo `assets/pagination.js`** (dòng 1) và render `snippets/loader.liquid` (dòng 109, có điều kiện). Nếu đổi cấu trúc HTML hay class thì JS có thể vỡ; đồ thị không phân tích nội dung file JS nên cần tự đối chiếu.
- **Snippet dùng 6 khoá dịch** `general.pagination.*`: `label`, `previous`, `next`, `page`, `result`, `load_more`.

Các trang còn lại (product, cart, index, customers/...) không dùng snippet này.
