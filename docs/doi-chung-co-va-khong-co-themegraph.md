# Đối chứng: agent có và không có ThemeGraph

Ngày chạy: 05/10/2026. Câu hỏi cần trả lời: ThemeGraph có làm agent trả lời
tốt hơn so với việc agent tự grep trong theme hay không.

## Kết luận ngắn

- **Về tốc độ và chi phí: có.** Với cùng năm câu hỏi, agent có ThemeGraph mất
  85 giây và 21 lời gọi tool; không có thì 209 giây và 41 lời gọi.
- **Về độ đúng: không rõ ràng nghiêng về bên nào.** Agent tự grep trả lời
  đúng bốn câu và đúng một phần ở câu 2 (đúng hướng nhưng không liệt kê được
  trang). Agent có ThemeGraph đúng ba câu, thiếu ở một câu, và sai ở một câu
  vì một lỗi của chính ThemeGraph (đã sửa sau phép đối chứng này).
- **Điểm ThemeGraph làm tốt hơn:** liệt kê đủ và chính xác các trang bị ảnh
  hưởng khi quan hệ đi qua layout (17 trên 19 trang ở câu 2), thứ agent tự
  grep chỉ tả được bằng lời.
- **Điểm ThemeGraph kém hơn:** không thấy section được JavaScript tải qua
  Section Rendering API; agent tự grep tìm ra chúng ở hai câu.

Mỗi ô chỉ có một lượt chạy, nên các con số dưới đây cho biết chiều hướng chứ
chưa đủ để nói về độ lệch. Đợt 2 ở cuối tài liệu lặp lại ba câu, mỗi câu ba
lần, với thang chấm viết trước; kết luận của đợt đó thay cho mục này ở những
chỗ hai bên khác nhau.

## Cách chạy

Như phần nghiệm thu ([nghiem-thu-mcp.md](nghiem-thu-mcp.md)): `claude -p` trong
thư mục theme, mỗi lượt một phiên mới, câu hỏi không nhắc tới tool nào.

- **Nhánh "có":** MCP server và skill `themegraph` được cài bằng `themegraph setup`.
- **Nhánh "không":** `themegraph setup --remove` trước khi chạy; kiểm lại bằng
  `claude mcp get themegraph` (không còn server). Agent chỉ có các tool sẵn có.

Bốn câu hỏi chạy trên Purity (3811 node, theme mà mô hình chưa từng thấy), một
câu trên Dawn. Đáp án đối chiếu lấy từ lệnh `themegraph`, và ở chỗ hai bên
lệch nhau thì kiểm bằng tay trong mã của theme.

Ba điều kiện giống nhau ở cả hai nhánh, cần biết khi đọc số:

- Purity có sẵn file `AGENTS.md` 50 KB mô tả theme; agent đọc được nó.
- Máy có MCP server `gitnexus`. Ở nhánh "không", agent mở đầu ba trên năm lượt
  bằng việc thử skill của gitnexus rồi bỏ, mất một lời gọi mỗi lượt.
- Bash được phép chạy; ở câu 4 agent nhánh "không" tự viết một script Python.

## Kết quả

| # | Câu hỏi | Có ThemeGraph | Không có |
| --- | --- | --- | --- |
| 1 | Purity: sửa `snippets/pagination.liquid` thì ảnh hưởng những trang nào? | 15 s, 4 lời gọi. Đúng: 5 trang | 25 s, 7 lời gọi. Đúng: 5 trang, thêm chi tiết về JavaScript |
| 2 | Purity: sửa `snippets/buy-buttons.liquid` thì ảnh hưởng những trang nào? | 18 s, 3 lời gọi. Đủ 17 trang, nêu rõ đường qua quickview trong layout | 40 s, 14 lời gọi. Đúng hướng nhưng không liệt kê được các trang; tìm thêm được trang cart qua JavaScript |
| 3 | Purity: trang cart render những section nào? | 17 s, 6 lời gọi. **Thiếu** 7 section của `overlay-group` | 21 s, 9 lời gọi. Đủ, thêm 2 section tải bằng AJAX |
| 4 | Purity: trong `blocks/` có block nào không còn được dùng? | 22 s, 5 lời gọi. **Sai**: 7 block (đúng là 33) | 100 s, 6 lời gọi. Đúng: 33 block |
| 5 | Dawn: sửa card-product thì trang nào vỡ? | 13 s, 3 lời gọi. Đúng: 4 trang, ghép đúng section | 23 s, 5 lời gọi. Đúng: 4 trang, thêm chi tiết về CSS và JavaScript |
| | **Tổng** | **85 s, 21 lời gọi, quy đổi 1,21 USD** | **209 s, 41 lời gọi, quy đổi 1,59 USD** |

## Từng câu

**Câu 1 (pagination).** Hai bên cho cùng 5 trang và cùng 5 section kèm số
dòng. Đây là loại câu hỏi mà grep đủ sức: snippet được gọi trực tiếp từ 5
section, mỗi section nằm trong đúng một nhóm template.

**Câu 2 (buy-buttons).** Chỗ khác biệt rõ nhất. Snippet này nằm trong block
`_buy-buttons`, block đó nằm trong section `product-quickview`, section đó nằm
trong `overlay-group.json`, và layout nạp group đó ở mọi trang. Agent có
ThemeGraph nêu đủ 17 trang và chỉ ra hai trang không dính là hai trang dùng
layout khác. Agent tự grep cũng lần ra quickview trong layout, nhưng kết luận
"các trang có product card", không phải danh sách trang.

Ngược lại, agent tự grep tìm ra `assets/cart-page.js` tải section
`main-cart-edit` (nơi gọi `buy-buttons`) bằng `section_id=`. ThemeGraph không
phân tích JavaScript nên ghi section này là "không trang nào dùng". Agent có
ThemeGraph đã đoán đúng khả năng đó nhờ nhãn này và lời dặn trong skill, nhưng
không kiểm chứng.

**Câu 3 (section của trang cart).** Agent có ThemeGraph gọi `render_flow` với
`max_depth: 2`, thấy layout có "40 file con chưa mở" nhưng không mở tiếp, rồi
grep trong `layout/theme.liquid` và bỏ sót `overlay-group`. Câu trả lời thiếu 7
section. Đồ thị có đủ thông tin (lệnh `themegraph render-flow cart` liệt kê cả
16 section); thứ làm hỏng câu trả lời là giới hạn độ sâu mặc định cộng với việc
agent không hỏi tiếp.

**Câu 4 (block chết).** ThemeGraph trả lời sai, và đây là lỗi của ThemeGraph
chứ không phải của agent. `dead-code` coi mọi block công khai là "merchant
thêm được" hễ theme có bất kỳ file nào khai `"type": "@theme"`. Ở Purity, file
duy nhất như vậy là `blocks/_slide.liquid`, một block riêng tư không ai gọi.
Vì thế 26 block chết bị bỏ sót. Agent tự grep lập luận đúng điều này và ra 33.

Lỗi đã được sửa (commit `8152ce2`): block công khai chỉ được coi là dùng được
khi file nhận `@theme` đang được dùng. Sau khi sửa, `themegraph dead-code`
trên Purity báo 33 block chắc chắn chết, trùng từng tên với danh sách của agent
tự grep. Chạy lại câu 4 ở nhánh "có" với bản đã sửa: 31 giây, đúng 33 block.

Hệ quả cho số liệu cũ: mọi chỗ từng ghi Purity có "7 block chết" (ghi chú
phạm vi, báo cáo tiến độ) là kết quả của lỗi này; con số đúng là 33. Dawn
không có thư mục `blocks/` nên không bị ảnh hưởng.

**Câu 5 (card-product trên Dawn).** Hai bên đúng. Nhánh "có" lần này ghép đúng
section vào trang và nói rõ `collage` không nằm trong template nào; ở lượt
nghiệm thu trước nó ghép sai chỗ này (đã sửa bằng commit `49d053f`, xem dưới).

## Hai sửa đổi sinh ra từ nghiệm thu và đối chứng

1. **`impact` ghi mỗi trang đi qua file nào** (`49d053f`). Trước đó nó trả hai
   danh sách rời, agent tự ghép và ghép sai một cặp. Giờ mỗi trang có phần
   "qua ...", và file dùng target nhưng không nằm trên trang nào được gắn nhãn
   `[không trang nào dùng]`.
2. **`dead-code` xét file nhận `@theme` có đang được dùng hay không**
   (`8152ce2`), như mô tả ở câu 4.

## Điều rút ra

- Một agent mạnh, có grep, trả lời đúng phần lớn các câu hỏi cấu trúc trên
  theme cỡ Purity. (Đợt 2 cho thấy câu này cần nói hẹp lại: với câu hỏi mà
  quan hệ đi qua layout, agent tự grep sót trang ở cả ba lần chạy.)
- ThemeGraph rút thời gian và số lời gọi xuống còn khoảng một nửa, và cho
  danh sách đầy đủ ở những chỗ agent tự grep chỉ ước lượng (câu 2).
- Câu trả lời của agent có ThemeGraph tin vào đồ thị. Khi đồ thị sai (câu 4)
  hoặc bị cắt (câu 3), agent sai theo, dù đã grep kiểm lại ở câu 4. Vì vậy độ
  đúng của đồ thị quan trọng hơn khi có agent dùng nó: lỗi của công cụ trở
  thành lỗi của câu trả lời.
- Phép đối chứng với một agent không dùng công cụ là cách kiểm ThemeGraph tốt:
  nó tìm ra một lỗi mà 692 test và việc phá tạm không tìm ra, vì các test đó
  kiểm mã có làm đúng quy tắc hay không, chứ không kiểm quy tắc có đúng với
  Shopify hay không.

## Chưa làm

- Mỗi ô một lượt. Muốn nói chắc về thời gian và độ đúng thì cần lặp lại mỗi
  câu vài lần.
- Chưa có câu hỏi nào yêu cầu agent **sửa** mã rồi kiểm tra hậu quả, tức tình
  huống mà skill hướng tới.
- Câu 3 gợi ý nên xem lại độ sâu mặc định của `render_flow` (hiện là 3), hoặc
  cách đầu ra nhắc agent mở tiếp. Chưa thay đổi gì.
- Section tải qua Section Rendering API vẫn nằm ngoài đồ thị. Tìm
  `section_id=` và `sections=` trong `assets/*.js` có thể bắt được phần lớn;
  việc này thuộc phạm vi "phân tích JavaScript" mà đề cương đã loại.

## Đợt 2: lặp lại có thang chấm (06/10/2026)

Đợt 1 có ba điểm yếu: mỗi ô một lượt, người chấm là người viết công cụ, và
nhánh "không có" bị nhiễu vì máy còn MCP server và skill khác. Đợt này sửa cả
ba, và chạy trên bản ThemeGraph đã có ba thay đổi sinh ra từ đợt 1 (`impact`
ghi đường đi, `render_flow` liệt kê đủ section, cạnh `LOADS_SECTION` cho
section do JavaScript tải).

### Cách chạy

`tools/accept/run-compare.cjs`, câu hỏi và đáp án ở `tools/accept/questions.json`.

- Cả hai nhánh chạy với `--strict-mcp-config` và `--disable-slash-commands`:
  không MCP server nào khác, không skill nào (kể cả skill của ThemeGraph).
  Nhánh "có" chỉ có thêm MCP server `themegraph`.
- Đáp án của mỗi câu được viết trước khi chạy, lấy từ đầu ra CLI của chính
  ThemeGraph. Vì vậy thang chấm nghiêng về nhánh "có": nếu đồ thị sai thì
  đáp án sai theo và nhánh "có" vẫn được điểm tối đa. Chỉ đáp án của câu block
  chết được một script độc lập xác nhận (`tools/accept/check-blocks.cjs`); hai
  câu kia mới được dò tay một phần. Máy chấm bằng cách tìm từng mục của đáp án trong câu trả lời. "Điểm
  cộng" là mục đúng nằm ngoài đáp án (section do JavaScript tải).
- Model: `claude-opus-5-5` ở mọi lượt được tính.

### Kết quả

| Câu hỏi (Purity) | Nhánh | Điểm, ba lần | Thời gian | Lời gọi tool |
| --- | --- | --- | --- | --- |
| Sửa `buy-buttons` ảnh hưởng trang nào (thang 11) | có | 11, 11, 11 | 16–18 s | 2, 2, 2 |
| | không | 4, 7, 7 | 25–35 s | 10, 6, 13 |
| Trang cart render section nào (thang 13) | có | 13, 13, 13 | 19–33 s | 5, 7, 5 |
| | không | 13, 13, 13 | 22–26 s | 8, 11, 13 |
| Block nào trong `blocks/` không còn dùng (thang 33) | có | 33 (một lần) | 34 s | 4 |
| | không | không có lượt hợp lệ | | |

Một lượt thử trước đợt này (câu trang cart, cùng cách chạy, trên bản chưa có
`LOADS_SECTION`) cho 13/13 ở nhánh "có" và 6/13 ở nhánh "không": lần đó agent
tự grep bỏ sót cả bảy section của `overlay-group`. Ba lần trong đợt chính thì
nó tìm đủ. Độ đúng của nhánh "không" dao động giữa các lần chạy; của nhánh
"có" thì không.

### Phần bị hỏng của đợt này

Câu block chết chỉ có một lượt hợp lệ. Sau lượt đó tài khoản mất quyền dùng
`claude-opus-5-5` (API trả 403), năm lượt kế thất bại ngay. Khi chạy lại, lệnh
`claude` lặng lẽ dùng `claude-haiku-4-5`; bốn lượt đó không được tính vào
bảng vì khác model. Ghi lại để tham khảo, không dùng để so sánh:

| Nhánh (Haiku 4.5) | Điểm | Thời gian | Lời gọi tool |
| --- | --- | --- | --- |
| có | 33, 33 | 18 s, 17 s | 2, 2 |
| không | 5 trên 33; lần hai liệt kê 19 block, trong đó có block đang dùng | 398 s, 111 s | 131, 24 |

Công cụ giờ ghim model bằng `--model` và ghi model vào từng bản tóm tắt, để
việc này không lặp lại mà không ai biết.

### Điều đợt 2 cho thấy

- Với câu hỏi mà quan hệ đi qua layout (`buy-buttons`), ThemeGraph cho câu trả
  lời đủ ở cả ba lần; agent tự grep sót từ 4 đến 7 trên 11 loại trang ở cả ba
  lần. Đây là chỗ đợt 1 mới chỉ mô tả bằng lời.
- Với câu hỏi mà grep làm được (trang cart), hai nhánh ngang nhau về độ đúng
  và thời gian. ThemeGraph chỉ giảm số lời gọi.
- Sau khi có `LOADS_SECTION`, nhánh "có" cũng nêu được hai section do
  JavaScript tải ở trang cart, thứ ở đợt 1 chỉ nhánh "không" tìm ra.
- Chín lượt mỗi nhánh vẫn là ít, và cả ba câu đều trên một theme.

### Chưa làm trong đợt 2

- Hai lượt còn thiếu của câu block chết ở nhánh "có" và cả ba lượt ở nhánh
  "không", vì lý do nêu trên.
- Kịch bản agent sửa file rồi hỏi lại (để quyết định server có nên tự cập
  nhật đồ thị cũ hay không).
