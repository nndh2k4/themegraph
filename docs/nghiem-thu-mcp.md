# Nghiệm thu tuần 7: MCP server và tích hợp AI agent

Ngày chạy: 05/10/2026. Máy Windows 11, Node 24.18, Claude Code 2.1.289,
ThemeGraph ở commit `90e0aa7` (nhánh `feat/mcp`).

## Tiêu chí của đề cương

> Mở Claude Code trong thư mục theme, hỏi "sửa card-product thì trang nào vỡ",
> agent gọi `impact` và trả lời đúng, không cần gợi ý thủ công.

**Kết quả: đạt.** Agent gọi `impact` của ThemeGraph với
`snippets/card-product.liquid` và nêu đúng 4 trên 12 loại trang (collection,
index, product, search), trùng với đầu ra của `themegraph impact`.

## Cách chạy

1. `themegraph setup` trên máy thật: đăng ký MCP server ở mức người dùng và cài
   skill. `claude mcp get themegraph` báo `✔ Connected`.
2. Mỗi câu hỏi chạy bằng `claude -p "<câu hỏi>" --output-format stream-json
   --verbose --allowedTools mcp__themegraph`, đứng trong thư mục theme. Mỗi lượt
   là một phiên mới, không có lịch sử.
3. Luồng sự kiện cho biết agent gọi những tool nào, theo thứ tự nào. Câu trả lời
   được so với đầu ra của lệnh `themegraph` tương ứng.

Hai điều cần biết khi đọc kết quả:

- `--allowedTools mcp__themegraph` chỉ cấp **quyền** gọi tool (ở chế độ `-p`
  không có ai bấm "cho phép"). Câu hỏi không nhắc tới tool nào, và các tool đọc
  file có sẵn (Read, Grep, Glob) vẫn dùng được, nên agent thật sự phải chọn.
- Máy chạy nghiệm thu có sẵn MCP server `gitnexus`, cũng có tool tên `impact`
  và `context`. Không lượt nào agent gọi nhầm sang đó.

## Tám lượt

| # | Theme | Câu hỏi | Skill | Tool agent gọi | Thời gian | Đúng? |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Dawn | sửa card-product thì trang nào vỡ | có | `impact` | 17 s | Danh sách trang đúng; một chi tiết phụ sai (xem dưới) |
| 2 | Dawn | trang cart của theme này gồm những file nào? | có | `render_flow` (tự đặt `max_depth: 6`) | 18 s | Đúng: 90 file, các file riêng của cart khớp CLI |
| 3 | Dawn | snippets/price.liquid được gọi từ đâu và nó dùng những khoá dịch nào? | có | `context` | 14 s | Đúng hoàn toàn: 4 file gọi kèm số dòng, 6 khoá dịch |
| 4 | Dawn | theme này có file nào thừa, xoá được không? | có | `dead_code` hai lần, rồi 9 lần Grep/Glob | 37 s | Gọi đúng tool, rồi tự grep kiểm lại nhóm "cần xem lại" |
| 5 | Dawn | theme này có những file nào liên quan tới facet? | có | Chỉ Glob và Grep | 18 s | **Không gọi `search`** |
| 6 | Purity | sửa block button thì ảnh hưởng những trang nào? | có | `search`, rồi `impact` hai lần | 18 s | Đúng: 17/19 trang cho `button.liquid`, 3/19 cho `button_block.liquid` |
| 7 | Dawn | sửa card-product thì trang nào vỡ | **không** | `impact` | 15 s | Như lượt 1 |
| 8 | Dawn | trang cart của theme này gồm những file nào? | **không** | `render_flow` | 16 s | Như lượt 2 |

Ở các lượt có skill, agent gọi `Skill themegraph` trước rồi mới gọi tool.

## Những gì không như mong đợi

**Lượt 5: agent không dùng `search`.** Với câu hỏi "file nào liên quan tới
facet", agent dùng Glob `**/*facet*` rồi Grep. Kết quả vẫn đúng, và rộng hơn
`search` vì Grep còn tìm trong nội dung file. Đây là hành vi hợp lý: tìm theo
tên là việc công cụ có sẵn đã làm tốt. `search` có ích ở lượt 6, nơi agent
dùng nó để đổi "block button" thành hai id trước khi gọi `impact`.

**Lượt 1 và 7: agent ghép sai một section vào một trang.** Cả hai câu trả lời
viết rằng trang `index` dùng card qua `featured-collection` và `collage`. Theo
đồ thị, `sections/collage.liquid` không được trang nào dùng (nó có gọi
`card-product`, nhưng không template nào chứa nó). Đầu ra của `impact` liệt kê
trang và file bị ảnh hưởng thành hai danh sách riêng, không nói trang nào đi
qua file nào, nên agent tự ghép theo hiểu biết của nó về Dawn. Ở lượt 7 agent
tự ghi chú điều này ("đồ thị chỉ xác nhận danh sách trang và danh sách section
chứ không nêu từng cặp"); ở lượt 1 thì không. Danh sách trang, tức câu trả lời
cho câu hỏi của đề cương, đúng ở cả hai lượt.

Cách chữa nếu làm tiếp: cho `impact` ghi với mỗi trang một đường đi ngắn nhất
tới file đang hỏi. Chưa làm trong tuần 7.

## Skill có tác dụng gì

Hai lượt không có skill (7 và 8) gọi đúng tool như hai lượt có skill (1 và 2),
nhanh hơn vài giây và ít hơn hai lượt hội thoại. Trên hai câu hỏi này, mô tả
của tool và lời dặn của server lúc bắt tay đã đủ để agent chọn đúng.

Khác biệt nằm ở nội dung câu trả lời: các lượt có skill nêu thêm giới hạn của
đồ thị (JavaScript trong `assets/` không được phân tích, section có thể được
merchant thêm vào trang khác), và ở lượt 4 agent không tự xoá gì mà grep kiểm
lại nhóm "cần xem lại" đúng như skill dặn. Hai lượt là quá ít để kết luận về
tỉ lệ; phép so này chỉ cho thấy skill không phải điều kiện để agent gọi tool.

## Số đo của server

Gọi qua stdio trên lệnh đã build, tham số mặc định:

| Tool | Dawn (1299 node) | Purity (3811 node) |
| --- | --- | --- |
| `impact` | 1,1 KB, 49 ms | 4,6 KB, 119 ms |
| `context` | 5,1 KB, 52 ms | 5,0 KB, 108 ms |
| `render_flow` (trang product) | 4,0 KB, 46 ms | 7,0 KB, 113 ms |
| `search` | 0,3 KB, 39 ms | 1,5 KB, 98 ms |
| `dead_code` | 4,9 KB, 46 ms | 5,0 KB, 114 ms |

Thời gian đã gồm việc so hash mọi file để phát hiện đồ thị cũ. Để so sánh:
JSON đầy đủ của `render-flow product` trên Purity dài 292 KB.

## Chưa kiểm được

- **Cursor thật.** Máy không cài Cursor. Phần ghi `~/.cursor/mcp.json` của
  `setup` chỉ được kiểm trên thư mục home giả (test tự động) và một lần chạy
  tay với thư mục home nháp.
- **Claude Code cài qua npm trên Windows** (lệnh là `claude.cmd`). Máy dùng bản
  `claude.exe`. Nhánh mã chạy qua shell được kiểm bằng một file `claude.cmd`
  giả: tham số có dấu cách và dấu ngoặc tới nơi nguyên vẹn.
- **Chế độ hội thoại.** Mọi lượt đều chạy bằng `claude -p`. Trong cửa sổ hội
  thoại, lần đầu gọi tool người dùng phải bấm cho phép.
