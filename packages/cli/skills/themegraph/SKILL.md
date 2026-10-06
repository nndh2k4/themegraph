---
name: themegraph
description: Dùng khi làm việc trong một Shopify theme (thư mục có sections/, snippets/, templates/, layout/ và file .liquid) và cần biết quan hệ giữa các file - sửa hoặc xoá một snippet/section/block/asset thì trang nào bị ảnh hưởng, một trang (product, collection, cart...) render những file nào, ai gọi một file, section.settings trong một snippet là của section nào, file nào không còn được dùng. Dùng TRƯỚC KHI sửa, đổi tên hoặc xoá file Liquid.
---

# ThemeGraph

ThemeGraph đã dựng sẵn một đồ thị của theme: file nào render file nào, trang nào dùng file nào, file nào đọc setting và khoá dịch nào. Các tool MCP `themegraph` trả lời từ đồ thị đó trong một lần gọi, và đã đi hết các tầng trung gian (snippet → snippet → section → template → loại trang). Tự grep `render 'x'` chỉ thấy một tầng và dễ sót lời gọi qua `{% section %}`, JSON template, section group và `{% content_for %}`.

## Câu hỏi nào thì gọi tool nào

| Người dùng hỏi / việc sắp làm | Tool |
| --- | --- |
| "Sửa X thì trang nào vỡ?", "X dùng ở đâu?"; sắp sửa, đổi tên, xoá một file | `impact` |
| "Trang product gồm những file nào?", "sửa chỗ này trên trang cart thì sửa file nào?" | `render_flow` |
| "File này làm gì, ai gọi nó?", "`section.settings.x` ở snippet này là của section nào?", sắp đọc một file lạ | `context` |
| Chỉ biết một phần tên file ("cái card sản phẩm") | `search` rồi dùng id trả về |
| "File nào thừa?", "xoá được gì?" | `dead_code` |
| Tool báo phải chọn theme, hoặc cần biết máy có những theme nào | `list_themes` |

Nếu máy có MCP server khác cũng có tool tên `impact` hay `context` (ví dụ công cụ phân tích mã JavaScript/TypeScript), thì với file `.liquid` và file JSON của theme luôn dùng tool của `themegraph`.

## Cách gọi

- Tên file là đường dẫn tính từ gốc theme: `snippets/card-product.liquid`. Chỉ tên file (`card-product`) cũng được nếu theme không có file trùng tên; nếu trùng, tool trả về danh sách để chọn.
- Tên trang là tên template: `product`, `collection`, `index`, `cart`, `customers/login`.
- Không cần tham số `theme` khi đang làm việc trong thư mục theme.
- `render_flow` luôn mở đầu bằng số file theo loại và danh sách đầy đủ section của trang; cây bên dưới mặc định dừng ở tầng 3. Node ghi "(n file con chưa mở)": gọi lại `render_flow` với chính node đó làm gốc, hoặc tăng `max_depth`.
- Danh sách bị cắt có dòng "... và n ... nữa": tăng `limit` nếu thật sự cần phần còn lại.

## Cách đọc kết quả

- **`[có điều kiện]`**: quan hệ chỉ xảy ra trong một nhánh `if`/`case`/`unless`, qua một block mà merchant có thể không thêm, hoặc ở một template thay thế (`product.alt.json`). Trang ghi `[có điều kiện]` vẫn có thể vỡ; khi báo cho người dùng hãy tách hai nhóm "luôn bị ảnh hưởng" và "bị ảnh hưởng trong một số trường hợp".
- **`dead_code` có hai mức.** "Chắc chắn không dùng" nghĩa là đồ thị không thấy cách dùng nào; trước khi xoá vẫn grep tên file một lượt (kể cả trong `assets/*.js`) và để người dùng xác nhận, vì đồ thị là kết quả phân tích tĩnh và có thể sai. "Cần xem lại" thì KHÔNG tự xoá: section có thể được tải qua Section Rendering API, asset có thể được gọi bằng tên ghép lúc chạy; nêu lý do cho người dùng quyết định. Danh sách khoá dịch và setting "không thấy dùng" cũng ở mức cần xem lại.
- **Mục "Có nơi dùng thẻ nhưng không trang nào nạp file" là lỗi của theme, không phải file thừa.** File JavaScript ở đó định nghĩa một custom element (`customElements.define`) mà một file đang dùng viết thẻ ra, nhưng không thẻ `<script>` nào nạp nó. KHÔNG xoá; báo cho người dùng và đề xuất thêm thẻ `<script>` vào file viết thẻ.
- **`[không trang nào dùng]`** trong `impact`: theo đồ thị, file đó không nằm trên trang nào. Section mang nhãn này vẫn có thể được merchant thêm từ theme editor hoặc được JavaScript tải; nếu là section, grep tên nó trong `assets/` trước khi kết luận.
- **"Tham chiếu hỏng"** trong `context`: file gọi tới một snippet, asset, khoá dịch hoặc setting không tồn tại. Đây thường là lỗi thật, nên báo cho người dùng.
- **Dòng "ĐỒ THỊ ĐÃ CŨ"** ở đầu câu trả lời: có file đã đổi sau lần phân tích gần nhất (thường là do chính bạn vừa sửa). Kết quả chưa tính các thay đổi đó. Chạy `themegraph analyze` trong thư mục theme (vài giây) rồi gọi lại tool nếu câu trả lời phụ thuộc vào file vừa đổi.
- **Lỗi "chưa được phân tích"**: chạy `themegraph analyze` trong thư mục theme.

## Giới hạn cần biết

- Đồ thị chỉ thấy tên viết sẵn trong mã. Lời gọi có tên là biến (`{% render snippet_name %}`, `section.settings[key]`, khoá dịch ghép chuỗi) không sinh quan hệ, nên một file "không ai gọi" vẫn có thể được gọi theo cách đó. Trước khi xoá, grep thêm tên file.
- JavaScript trong `assets/` không được phân tích cú pháp. Đồ thị chỉ nhận ra một việc: file `.js` (hoặc một URL trong Liquid) tải riêng một section qua Section Rendering API với tên viết sẵn, ví dụ `?section_id=cart-drawer`; quan hệ đó hiện là `LOADS_SECTION`, luôn `[có điều kiện]`. Tên là biến (`section_id=${id}`), và mọi thứ khác JavaScript làm, thì đồ thị không biết.
- ThemeGraph không đọc nội dung file. Tìm chữ trong file thì dùng grep; cần biết file làm gì thì đọc file.

## Quy trình khi sửa một file Liquid

1. `impact` trên file sắp sửa. Nói cho người dùng biết những trang nào bị ảnh hưởng, nhất là khi nhiều hơn họ nghĩ.
2. `context` nếu cần biết ai truyền tham số vào file, hoặc setting nó đọc khai ở đâu.
3. Sửa file.
4. Khi báo kết quả, nêu các trang cần kiểm tra lại, lấy từ bước 1.
