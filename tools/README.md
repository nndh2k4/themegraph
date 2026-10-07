# tools/

Các script chạy tay dùng để kiểm chứng ThemeGraph. Chúng không thuộc sản phẩm,
không được build và không được CI chạy.

## mutate/ — phá tạm

`mutate.cjs` sửa từng chỗ trong mã nguồn theo một danh sách, chạy test, ghi lại
test có đỏ không, rồi trả mã nguồn về như cũ.

```sh
node tools/mutate/mutate.cjs tools/mutate/lists/tuan7-impact-via.json packages/core/tests/impact.test.ts packages/cli/tests/run.test.ts
```

- `lists/`: danh sách của tuần 7. Mỗi mục là `[file, tên, chuỗi cũ, chuỗi mới]`.
- `lists/cu/`: danh sách của các tuần trước, giữ làm hồ sơ. Một số mục trỏ tới
  file đã đổi chỗ (ví dụ `packages/cli/src/format.ts`, nay ở `packages/core`).
- `reports/`: kết quả của lần chạy gần nhất cho từng danh sách.

Kết quả tách năm loại: bị bắt, không biên dịch, LỌT, QUÁ GIỜ, không thấy chuỗi.
Quá giờ không được tính là bị bắt.

Đừng thêm vào danh sách những chỗ phá làm mã ghi ra ngoài thư mục tạm của
test (ví dụ bỏ việc đọc `THEMEGRAPH_HOME`, hoặc bỏ phần ghi đè tuỳ chọn của
lệnh `setup` trong test): khi đó test sẽ ghi vào thư mục home thật.

## accept/ — nghiệm thu với Claude Code

- `accept.cjs`: chạy `claude -p` với một câu hỏi trong thư mục theme, đọc luồng
  sự kiện để biết agent gọi tool nào, ghi tóm tắt ra `accept-out/`.
- `scan-js-sections.cjs`: với mỗi section mà `dead-code` báo không trang nào
  dùng, tìm dấu vết nó được JavaScript tải (Section Rendering API).

Tóm tắt các lượt đã chạy nằm ở `docs/nghiem-thu/` trên máy phát triển (thư mục `docs/` không được đưa vào repo). Bản ghi thô (`.jsonl`) không
để trong repo vì chứa thông tin về máy chạy.
