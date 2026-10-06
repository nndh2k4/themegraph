## co-d1-card-product
Thư mục: C:/Users/DELL/themes/dawn
Câu hỏi: sửa card-product thì trang nào vỡ
MCP: plugin:figma:figma:connected, gitnexus:connected, themegraph:connected, claude.ai Claude Docs:connected
Skill themegraph được nạp: true
Thời gian: 13 giây, 5 lượt, chi phí quy đổi $0.207
Tool đã gọi (3):
  1. Skill {"skill":"themegraph"}
  2. ToolSearch {"query":"select:mcp__themegraph__impact","max_results":5}
  3. mcp__themegraph__impact {"target":"snippets/card-product.liquid"}
Câu trả lời:
Sửa `snippets/card-product.liquid` ảnh hưởng **4 trên 12 loại trang**, tất cả đều ở mức "có điều kiện" (chỉ vỡ khi nhánh `if`/block tương ứng thực sự render card):

| Trang | Đi qua section |
| --- | --- |
| `collection` | `sections/main-collection-product-grid.liquid` |
| `index` (trang chủ) | `sections/featured-collection.liquid` |
| `product` | `sections/main-product.liquid` và `sections/related-products.liquid` |
| `search` | `sections/main-search.liquid` |

Không có trang nào thuộc nhóm "luôn bị ảnh hưởng": ví dụ collection rỗng hoặc search không ra sản phẩm thì card không được render.

`sections/collage.liquid` cũng gọi `card-product`, nhưng hiện không nằm trong template nào. Nó chỉ bị ảnh hưởng nếu merchant thêm section này vào một trang trong theme editor; khi đó trang ấy cũng cần kiểm tra.

Đồ thị chỉ thấy lời gọi viết sẵn tên trong Liquid, không phân tích JavaScript trong `assets/`.
