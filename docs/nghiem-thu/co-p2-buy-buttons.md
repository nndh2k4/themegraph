## co-p2-buy-buttons
Thư mục: D:/code/New folder (2)/phase-2-purity-shopify-theme-store
Câu hỏi: sửa snippets/buy-buttons.liquid thì ảnh hưởng những trang nào?
MCP: plugin:figma:figma:connected, gitnexus:connected, themegraph:connected, claude.ai Claude Docs:connected
Skill themegraph được nạp: true
Thời gian: 18 giây, 5 lượt, chi phí quy đổi $0.237
Tool đã gọi (3):
  1. Skill {"skill":"themegraph"}
  2. ToolSearch {"query":"select:mcp__themegraph__impact","max_results":5}
  3. mcp__themegraph__impact {"target":"snippets/buy-buttons.liquid"}
Câu trả lời:
Sửa `snippets/buy-buttons.liquid` ảnh hưởng **17 trên 19 loại trang** (42 file), nhưng tất cả đều ở dạng có điều kiện, không trang nào luôn luôn render snippet này.

**Ảnh hưởng trực tiếp (cách 3 tầng)**

| Trang | Đường đi |
| --- | --- |
| `product` | `blocks/_buy-buttons.liquid` → `sections/main-product.liquid` → 6 template product (`product`, `1-column`, `2-columns`, `stack`, `thumb-bottom`, `thumb-left`) |
| `index` | `sections/shopable-video.liquid` → `templates/index.json` |

**Ảnh hưởng gián tiếp qua quickview (cách 5 tầng)**

Đường đi: `blocks/_buy-buttons.liquid` → `sections/product-quickview.liquid` → `sections/overlay-group.json` → `layout/theme.liquid`. Vì nằm trong layout nên mọi trang dùng `theme.liquid` đều dính khi mở quickview:

- `collection` (4 template), `search`, `list-collections`
- `cart`, `blog`, `article`, `404`
- `page` (10 template: about, contact, faqs, quizz, outfit-builder, …)
- 7 trang `customers/*` (account, login, register, order, addresses, activate_account, reset_password)

**Hai section cần để ý thêm**

Đồ thị ghi hai section này "không trang nào dùng", nhưng chúng vẫn gọi snippet:

- **`sections/main-cart-edit.liquid`**: gọi trực tiếp `buy-buttons`. Tôi chưa kiểm tra, nhưng nhiều khả năng nó được tải qua Section Rendering API từ JavaScript (sửa item trong giỏ), thứ mà đồ thị không thấy.
- **`sections/featured-product.liquid`**: không có trong template nào hiện tại, nhưng merchant có thể thêm vào từ theme editor.

**Nên kiểm tra lại sau khi sửa**

1. Trang product, ít nhất 1–2 template thay thế ngoài bản mặc định.
2. Shopable video trên trang chủ.
3. Quickview, mở từ trang collection hoặc search là đủ đại diện cho nhóm gián tiếp.
4. Luồng sửa item trong giỏ hàng (`main-cart-edit`).
