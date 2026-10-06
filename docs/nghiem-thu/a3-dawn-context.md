## a3-dawn-context
Thư mục: C:/Users/DELL/themes/dawn
Câu hỏi: snippets/price.liquid được gọi từ đâu và nó dùng những khoá dịch nào?
MCP: plugin:figma:figma:connected, gitnexus:connected, themegraph:connected, claude.ai Claude Docs:connected
Skill themegraph được nạp: true
Thời gian: 14 giây, 5 lượt, chi phí quy đổi $0.214
Tool đã gọi (3):
  1. Skill {"skill":"themegraph"}
  2. ToolSearch {"query":"select:mcp__themegraph__context","max_results":5}
  3. mcp__themegraph__context {"target":"snippets/price.liquid"}
Câu trả lời:
`snippets/price.liquid` được gọi từ 4 file và dùng 6 khoá dịch (theo đồ thị ThemeGraph của theme dawn).

## Được gọi từ đâu

| File gọi | Dòng |
| --- | --- |
| `sections/featured-product.liquid` | 121 |
| `sections/main-product.liquid` | 111 |
| `sections/predictive-search.liquid` | 163 |
| `snippets/card-product.liquid` | 209, 517, 532, 621 |

Tất cả các lời gọi đều nằm trong nhánh điều kiện (`if`/`case` hoặc block mà merchant có thể không thêm). Qua các file này, snippet xuất hiện trên 4 loại trang: `product`, `collection`, `index` và `search`.

## Khoá dịch

| Khoá | Dòng trong `price.liquid` |
| --- | --- |
| `products.product.price.regular_price` | 66, 79, 87, 95 |
| `products.product.price.sale_price` | 106 |
| `products.product.price.from_price_html` | 39 |
| `products.product.volume_pricing.price_range` | 82 |
| `products.product.on_sale` | 117 |
| `products.product.sold_out` | 121 |

Cả 6 khoá đều nằm trong nhánh điều kiện.

Đồ thị chỉ thấy tên viết sẵn trong mã, nên lời gọi bằng tên biến hoặc từ JavaScript trong `assets/` sẽ không hiện ở đây.
