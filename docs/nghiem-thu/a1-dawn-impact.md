## a1-dawn-impact
Thư mục: C:/Users/DELL/themes/dawn
Câu hỏi: sửa card-product thì trang nào vỡ
MCP: plugin:figma:figma:connected, gitnexus:pending, themegraph:connected, claude.ai Claude Docs:connected
Skill themegraph được nạp: true
Thời gian: 17 giây, 5 lượt, chi phí quy đổi $0.235
Tool đã gọi (3):
  1. Skill {"skill":"themegraph"}
  2. ToolSearch {"query":"select:mcp__themegraph__impact","max_results":5}
  3. mcp__themegraph__impact {"target":"snippets/card-product.liquid"}
Câu trả lời:
Sửa `snippets/card-product.liquid` ảnh hưởng 4 trên 12 loại trang, qua 6 section gọi nó trực tiếp:

| Trang | Qua section |
| --- | --- |
| `collection` | `main-collection-product-grid` |
| `search` | `main-search` |
| `product` | `main-product`, `related-products` |
| `index` | `featured-collection`, `collage` |

Tất cả đều ở mức "có điều kiện": card chỉ hiện khi nhánh `if` hoặc block tương ứng được dùng (ví dụ collection có sản phẩm, search có kết quả). Không trang nào chắc chắn bị ảnh hưởng trong mọi trường hợp, nhưng thực tế nên kiểm tra lại cả 4 trang sau khi sửa.

Hai điểm đồ thị không thấy được:

- **Section thêm từ theme editor:** `featured-collection` và `collage` có thể được merchant thêm vào trang khác (page, blog, cart…), khi đó các trang ấy cũng bị ảnh hưởng. Kết quả trên chỉ tính theo các file JSON template hiện có trong repo.
- **JavaScript:** các file trong `assets/` không được phân tích, nên nếu có script nào phụ thuộc vào markup hoặc class của card thì bạn cần grep riêng.
