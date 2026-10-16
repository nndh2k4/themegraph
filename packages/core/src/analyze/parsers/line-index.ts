/**
 * Đổi vị trí ký tự thành số dòng (đếm từ 1). Dựng danh sách vị trí đầu dòng
 * một lần cho mỗi nội dung rồi tra nhị phân, thay cho việc đếm lại từ đầu
 * file ở mỗi lần hỏi (file vài trăm KB có hàng nghìn ref).
 */
export function lineIndex(content: string): (offset: number) => number {
  const starts = [0];
  for (let i = 0; i < content.length; i++) if (content.charCodeAt(i) === 10) starts.push(i + 1);

  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if ((starts[middle] ?? 0) <= offset) low = middle;
      else high = middle - 1;
    }
    return low + 1;
  };
}
