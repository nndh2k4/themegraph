# Đối chiếu tay 10 trường hợp trên Dawn

Tài liệu này ghi lại lần kiểm chứng bốn truy vấn lõi của ThemeGraph trên theme Dawn 16.0.0 (357 node, 521 cạnh). Mỗi trường hợp được dò lại trong mã nguồn bằng `grep`, một cách làm không dùng tới ThemeGraph, rồi so với kết quả của lệnh.

Kết quả: cả 10 trường hợp khớp. Hai lần `grep` cho ra nhiều hơn công cụ, và cả hai lần phần dư là ví dụ cách dùng viết trong `{% comment %}`, thứ không phải lời gọi thật.

## Cách làm

- Đứng trong thư mục theme, chạy `themegraph analyze` một lần.
- Với mỗi trường hợp: chạy `grep` trước và ghi kết quả, sau đó mới chạy lệnh của ThemeGraph.
- Hai kết quả khác nhau thì mở file ra đọc để biết bên nào đúng.

## Kết quả

| # | Truy vấn | Câu hỏi | Dò bằng `grep` | ThemeGraph | Khớp |
| --- | --- | --- | --- | --- | --- |
| 1 | `context` | Ai gọi `snippets/price.liquid`? | 4 file, cộng chính nó ở dòng 13 | 4 file | Có (xem ghi chú 1) |
| 2 | `context` | Ai dùng `assets/component-card.css`? | 11 file | 11 file, cùng danh sách | Có |
| 3 | `impact` | Sửa `snippets/quick-order-product-row.liquid` ảnh hưởng gì? | Không file nào khác nhắc tới tên này | Không file hay trang nào | Có |
| 4 | `context` | `templates/cart.json` dùng section nào? | `main-cart-items`, `main-cart-footer` (và hai block cục bộ `buttons`, `subtotal`) | Hai section đó, cộng layout mặc định | Có (xem ghi chú 2) |
| 5 | `render-flow` | Trang `gift_card` kéo theo file nào? | `{% layout none %}`, `template-giftcard.css`, `icon-success.svg` | Template và đúng hai asset đó, không có layout | Có (xem ghi chú 3) |
| 6 | `context` | `snippets/card-product.liquid` được gọi ở dòng nào? | 7 lời gọi trong 6 section, cộng chính nó ở dòng 21 | 7 lời gọi, cùng file và cùng số dòng | Có (xem ghi chú 1) |
| 7 | `context` | `sections/header.liquid` gọi snippet nào? | 8 lời gọi tới 7 snippet | 8 lời gọi tới 7 snippet, cùng số dòng | Có (xem ghi chú 4) |
| 8 | `analyze` | Theme có tham chiếu hỏng nào? | `icon-error` và `icon-3d-model` được gọi thiếu đuôi `.svg`; file thật có đuôi | 3 tham chiếu hỏng ở đúng ba dòng đó | Có |
| 9 | `dead-code` | File nào chắc chắn không dùng? | `quick-order-product-row` chỉ xuất hiện trong chính file của nó, kể cả khi tìm trong JavaScript | 1 file mức chắc chắn, chính là file đó | Có |
| 10 | `dead-code` | `sections/cart-drawer.liquid` có phải mã chết không? | Không template hay `{% section %}` nào gọi, nhưng `assets/cart.js` tải nó qua `?section_id=cart-drawer` | Mức "cần xem lại", không phải "chắc chắn" | Có |

## Ghi chú

1. **Ví dụ trong chú thích.** `price.liquid` và `card-product.liquid` đều mở đầu bằng một khối `{% comment %}` hướng dẫn cách dùng, trong đó có dòng `{% render 'price' %}`. `grep` đếm cả dòng này. ThemeGraph đọc cây cú pháp nên bỏ qua nội dung chú thích, và đó là kết quả đúng.
2. **Block cục bộ.** `buttons` và `subtotal` là block khai ngay trong `{% schema %}` của section, không phải file trong `blocks/`. ThemeGraph ghi chúng với trạng thái `local_block` và không tạo cạnh.
3. **Asset của Shopify.** `gift_card.liquid` còn gọi ba file qua `shopify_asset_url`. Đó là file dùng chung trên máy chủ Shopify, không thuộc theme, nên không có trong đồ thị.
4. **Lời gọi trong `{% liquid %}`.** Lần dò đầu chỉ tìm mẫu `{% render '...' %}` và ra 4 snippet. Bốn lời gọi còn lại nằm trong khối `{% liquid %}`, nơi mỗi lệnh viết trên một dòng không có `{% %}`. Dò lại bằng mẫu `render '` thì ra đủ 8 lời gọi. Ở trường hợp này công cụ đúng ngay từ đầu còn lần dò tay đầu tiên thì thiếu.

## Kiểm chứng tự động

Mười trường hợp trên chỉ là mẫu. Lệnh `themegraph verify` đối chiếu toàn bộ đồ thị: với mọi node, theo cả hai chiều, nó so kết quả của truy vấn đệ quy SQL (`WITH RECURSIVE`) với một phép duyệt theo chiều rộng viết bằng JavaScript.

| | Dawn | Purity |
| --- | --- | --- |
| Node / cạnh | 357 / 521 | 539 / 1614 |
| Phép duyệt đã đối chiếu | 714 | 1078 |
| Cặp (phép duyệt, node) đã so | 7022 | 19922 |
| Sai khác | 0 | 0 |
| Độ sâu lớn nhất | 6 | 7 |
| Node nằm trên vòng | 0 | 6 |

Phép kiểm chứng này chỉ xác nhận hai cách duyệt cho cùng kết quả trên cùng một bảng cạnh. Nó không phát hiện được cạnh bị trích sai hoặc bị sót ở tầng parse; việc đó thuộc về bộ test của tầng parse và phần đối chiếu tay ở trên.

## Giới hạn đã biết

- **Tên ghép lúc chạy.** `{{ 'icon-' | append: name | asset_url }}` không sinh cạnh, vì tên file chỉ có khi chạy. Đây là lý do 47 asset của Dawn nằm ở mức "cần xem lại".
- **JavaScript và CSS.** Nội dung của file trong `assets/` không được phân tích. Section được tải qua Section Rendering API (trường hợp 10) vì thế không có cạnh trỏ vào.
- **Mức "chắc chắn" hiếm gặp ở `impact`.** Phần lớn lời gọi trong theme nằm trong `{% if %}` hoặc `{% for %}`, nên phần lớn quan hệ mang nhãn "có điều kiện".

## Sau vòng hai của đồ thị

Các số liệu ở trên đo khi đồ thị chỉ có file và loại trang. Vòng hai thêm khoá dịch và setting làm node, nên đồ thị lớn hơn nhiều; bốn truy vấn về file cho cùng kết quả như trước, vì `render-flow` chỉ đi theo cạnh nối file với file.

| | Dawn | Purity |
| --- | --- | --- |
| Node / cạnh | 1299 / 1830 | 3811 / 5444 |
| Khoá dịch (được dùng / tổng) | 261 / 371 | 533 / 536 |
| Setting (được đọc / tổng) | 571 / 571 | 2555 / 2736 |
| Khoá dịch được gọi mà không tồn tại | 0 | 0 |
| Setting được đọc mà không tồn tại | 4 | 90 |
| `verify`: cặp đã so / sai khác | 26374 / 0 | 138110 / 0 |

Bốn lần đọc setting hỏng của Dawn đã được dò lại bằng `grep` và đều là thật:

- `settings.media_padding` ở `layout/theme.liquid:139` và `layout/password.liquid:81`: `config/settings_schema.json` không có setting này.
- `settings.color_background` ở `templates/gift_card.liquid:10`: cũng không có.
- `section.settings.product_show_vendor` ở `sections/main-search.liquid:274`: schema của section khai `show_vendor`, không khai `product_show_vendor`.

Với Purity, 90 lần đọc hỏng mới được soi theo nhóm, chưa dò từng dòng. Các ca đã mở ra xem (`section_st.banner_image` trong `image-with-text-overlay`, `settings.rtl` trong `header`) đều là đọc một setting mà schema không khai.

## Đối chiếu quy tắc về theme block trên Purity (06/10/2026)

Mười trường hợp đối chiếu tay ở đầu tài liệu đều làm trên Dawn, mà Dawn không có thư mục `blocks/`. Vì vậy mọi quy tắc về theme block chưa từng được kiểm với một theme thật, và một quy tắc sai (`@theme`, xem [doi-chung-co-va-khong-co-themegraph.md](doi-chung-co-va-khong-co-themegraph.md)) đã lọt qua bộ test. Phần này bù chỗ đó.

### Quy tắc, so với tài liệu Shopify

| Quy tắc ThemeGraph dùng | Tài liệu Shopify (shopify.dev, mục Theme blocks) | Khớp |
| --- | --- | --- |
| `{"type": "@theme"}` cho phép thêm mọi theme block công khai | "To accept all theme blocks in a section by adding a generic entry of type `@theme`" | có |
| Block tên bắt đầu bằng `_` không được `@theme` mở cửa, phải được nêu đích danh | "All underscore prefixed blocks would be excluded from appearing in the block picker"; "will need to explicitly add the block by base filename" | có |
| `{% content_for "block", type: "...", id: "..." %}` là một lời gọi, không cần khai trong schema | "If a section or block contains static blocks but does not explicitly include them in the presets, the static blocks will always get added"; ví dụ dùng block riêng tư | có |
| Block phải có preset mới thêm được từ editor | Tài liệu chỉ mô tả preset dùng để làm gì, không nói là bắt buộc | chưa rõ; ThemeGraph không dùng quy tắc này |

### Đối chiếu độc lập trên cả 141 block

`tools/accept/check-blocks.cjs` tự đọc file của theme bằng regex và `JSON.parse`, không dùng mã nào của ThemeGraph, rồi so tập file tham chiếu tới từng block với các cạnh trong `graph.db`.

| | Purity |
| --- | --- |
| Tham chiếu script tìm được | 378 trong schema, 5 lời gọi tĩnh, 298 trong JSON template và section group, 176 trong preset |
| Block có tập file tham chiếu trùng với đồ thị | 120 trên 141 |
| Quan hệ script thấy mà đồ thị không có | 0 |
| Quan hệ đồ thị có mà script không tính | 35, tất cả là block chỉ xuất hiện trong `presets` của section |
| File nhận `@theme` | 1: `blocks/_slide.liquid` |
| Block không được tham chiếu ở đâu | 27 (cộng 6 block chỉ được block chết gọi là 33, trùng với `dead-code`) |

Đồ thị không sót quan hệ nào. 35 quan hệ dư có cùng một nguồn gốc: preset của một section có block lồng nhau (ví dụ một group chứa `button`), và đồ thị nối thẳng section với block con thay vì chỉ nối group với nó. Quan hệ đó có thật khi preset được dùng, và section vốn đã đi tới block ấy qua group, nên kết quả về trang không đổi; thứ bị lệch là block hiện ra gần section hơn một tầng và section xuất hiện trong danh sách "được gọi bởi" của block. Chưa sửa.

### Giới hạn mới ghi nhận

- Thư mục `listings/` (các bộ template của từng preset của theme; Purity có 11 file) không được quét. Trên Purity điều này chưa làm sai kết quả nào: không block hay section nào chỉ được dùng trong `listings/`.
- Section được JavaScript tải qua Section Rendering API không có cạnh nào. `tools/accept/scan-js-sections.cjs` tìm dấu vết đó cho các section mà `dead-code` xếp vào mức cần xem lại: 8 trên 8 ở Dawn, 9 trên 12 ở Purity.
