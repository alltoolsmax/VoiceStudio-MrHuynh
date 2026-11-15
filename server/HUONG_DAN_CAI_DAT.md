# Cài máy chủ kích hoạt Voice Studio - Mr.Huỳnh lên hosting

Máy chủ này nhận đơn mua gói từ app, nhận webhook SePay khi khách chuyển khoản,
tự cấp key và báo Telegram cho bạn. Toàn bộ chỉ là vài file PHP, không cần tạo database.

## 0. Chuẩn bị

- File `active.mrhuynh.net-voice_studio2.zip` (gửi kèm hướng dẫn này).
- File `vsmh-private-key.txt` (khóa bí mật đã gửi trước đây).
- API Key của webhook SePay (chuỗi bạn đã nhập trên SePay).
- Token bot Telegram và Chat ID của bạn (xem mục 6 nếu chưa biết Chat ID).

## 1. Upload và giải nén

1. Vào cPanel → **Trình quản lý tệp (File Manager)**.
2. Mở **thư mục gốc của tài khoản** (`/home/<tên tài khoản>/`): nơi bạn thấy cả hai thư mục
   `active_private` và `active.mrhuynh.net`.
3. Bấm **Tải lên (Upload)**, chọn file `active.mrhuynh.net-voice_studio2.zip`.
4. Quay lại thư mục gốc, bấm chuột phải vào file zip → **Giải nén (Extract)** → giải nén ngay tại đó.

Sau khi giải nén, bạn sẽ có:

```
/home/<tài khoản>/
├── active_private/
│   └── voice_studio2/                 ← MỚI (cấu hình + dữ liệu, không truy cập được từ web)
│       ├── config.sample.php
│       ├── lib.php
│       └── .htaccess
└── active.mrhuynh.net/
    ├── voice_studio2_api.php          ← MỚI
    ├── voice_studio2_webhook.php      ← MỚI
    ├── voice_studio2_admin.php        ← MỚI
    ├── voice_studio2_check.php        ← MỚI (xóa sau khi cài xong)
    ├── voice_studio2_bootstrap.php    ← MỚI
    └── downloads/
        └── index.php                  ← MỚI: trang tải cho khách, tự hiện bản mới nhất
```

Các file của máy chủ Voice AI hiện có **không bị đụng tới** vì tên khác hoàn toàn.
Xóa file zip sau khi giải nén.

## 2. Điền cấu hình

1. Vào `active_private/voice_studio2/`, đổi tên `config.sample.php` thành **`config.php`**.
2. Bấm chuột phải → **Sửa (Edit)**, điền các mục có ghi `<<< ĐIỀN`:
   - `private_key`: dán nội dung file `vsmh-private-key.txt` (64 ký tự).
   - `sepay_api_key`: API Key webhook SePay.
   - `telegram_bot_token` và `telegram_chat_id`.
   - `admin_password`: mật khẩu trang quản trị (ít nhất 10 ký tự).
3. Tài khoản BIDV 9624788159 - HUYNH XUYEN SON, tiền tố `ACT` và giá 4 gói đã được điền sẵn.
   Muốn đổi giá sau này, chỉ cần sửa mục `plans` trong file này: app tự lấy giá mới.
4. Lưu lại.

## 3. Kiểm tra

Mở **https://active.mrhuynh.net/voice_studio2_check.php**. Mọi dòng phải có dấu ✔.
Khi tất cả đã đạt, **xóa file `voice_studio2_check.php`** khỏi `active.mrhuynh.net`.

## 4. Cấu hình webhook trên SePay

Trong webhook bạn đã tạo trên my.sepay.vn, kiểm tra:

| Mục | Giá trị |
|---|---|
| URL | `https://active.mrhuynh.net/voice_studio2_webhook.php` |
| Loại giao dịch | Tiền vào |
| Tài khoản | BIDV 9624788159 |
| Xác thực | API Key: đúng chuỗi đã điền vào `sepay_api_key` |
| Kiểu dữ liệu | JSON |
| Thử lại khi lỗi | Bật |

## 5. Thử một giao dịch thật (2.000đ)

1. Trong `config.php`, đặt `'test_plan_enabled' => true,` rồi lưu.
2. Mở Voice Studio trên máy của bạn → **Cài đặt → Hỗ trợ → Mua / gia hạn bản quyền**
   (hoặc màn hình kích hoạt). Sẽ thấy thêm gói **"Thử thanh toán" 2.000đ**.
3. Chọn gói đó, quét QR, chuyển khoản.
4. Trong vài giây: app báo "Thanh toán thành công" và tự kích hoạt (gói 1 tháng),
   Telegram báo 🆕 đơn mới và ✅ đã thanh toán.
5. Đặt lại `'test_plan_enabled' => false,` và lưu.

## 6. Lấy Chat ID Telegram

1. Mở Telegram, nhắn bất kỳ tin nào cho bot của bạn (ví dụ "hi").
2. Mở trình duyệt: `https://api.telegram.org/bot<TOKEN>/getUpdates` (thay `<TOKEN>` bằng token bot).
3. Tìm đoạn `"chat":{"id":123456789` → số đó là Chat ID.
   (Muốn nhận báo trong một nhóm: thêm bot vào nhóm, nhắn trong nhóm, Chat ID của nhóm là số âm.)

Trong trang quản trị có nút **"Thử Telegram"** để kiểm tra.

## 7. Trang quản trị

**https://active.mrhuynh.net/voice_studio2_admin.php**, đăng nhập bằng `admin_password`.

- Doanh thu hôm nay / tháng này / tổng.
- Danh sách đơn: tìm theo mã đơn, mã máy hoặc tên khách; bấm vào key để sao chép.
- **Cấp key tay** ngay trên web (chọn gói; để trống ngày bắt đầu thì tự cộng dồn theo các đơn đã có).
- Đơn **thiếu tiền / lỗi**: nút "Cấp key cho đơn này" sau khi bạn đã kiểm tra.
- **Giao dịch cần xem**: tiền vào không khớp đơn nào, chuyển thiếu, chuyển trùng.

- **Phát hành & cập nhật**: xem bản mới nhất đang có trong `downloads/`, và bật
  **bắt buộc cập nhật** (nhập phiên bản tối thiểu, ví dụ `1.0.1`, kèm lời nhắn). Khách dùng bản
  thấp hơn sẽ thấy màn hình "Cần cập nhật để tiếp tục" cho đến khi cài bản mới. Để trống = tắt.
  Khi khách mất mạng, app không bị chặn.

Cách phát hành bản mới: xem `HUONG_DAN_BUILD_VA_CAP_NHAT.md` trong thư mục mã nguồn.

App cấp key trên Windows (VSMH-KeyGen.exe) vẫn dùng song song được: key từ hai nơi
có cùng chuẩn, app Voice Studio đều nhận.

## Thông báo Telegram bạn sẽ nhận

| Biểu tượng | Ý nghĩa |
|---|---|
| 🆕 | Khách vừa tạo đơn (chưa trả tiền). Tắt bằng `'telegram_notify_new_order' => false`. |
| ✅ | Đã nhận đủ tiền, đã cấp key và app khách đã tự kích hoạt. |
| ⚠️ | Chuyển thiếu tiền / tiền vào không khớp đơn / chuyển thêm cho đơn đã trả / webhook sai xác thực. |
| 🛑 | Lỗi máy chủ khi cấp key (thường do `config.php`), cần cấp tay. |

Nếu tài khoản BIDV này cũng nhận tiền của **Voice AI**, thêm tiền tố mã đơn của Voice AI vào
`ignore_prefixes` (ví dụ `['VAI']`) để không bị báo ⚠️ nhầm.

## Xử lý sự cố

**Telegram báo "Webhook sai xác thực … Không thấy header Authorization"**: một số hosting
chặn header này. Mở `active.mrhuynh.net/.htaccess` (bật "Hiện tệp ẩn" nếu không thấy), **thêm vào
đầu file** (giữ nguyên nội dung cũ của Voice AI):

```
CGIPassAuth On
RewriteEngine On
RewriteCond %{HTTP:Authorization} .
RewriteRule .* - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization}]
```

**Báo "API Key không khớp"**: chuỗi trên SePay và `sepay_api_key` khác nhau (thừa dấu cách?).

**App báo "Không kết nối được máy chủ kích hoạt"**: mở
`https://active.mrhuynh.net/voice_studio2_api.php?action=plans`, phải thấy bảng giá dạng JSON.

**Khách chuyển nhưng không tự kích hoạt**: xem mục "Giao dịch cần xem" trong trang quản trị;
cấp key tay cho khách, khách dán vào mục **Nhập key** trong app.

## Sao lưu

Toàn bộ đơn hàng nằm trong `active_private/voice_studio2/data.sqlite`. Thỉnh thoảng tải file này
về máy. Giữ kín `config.php` và `vsmh-private-key.txt`; bật xác thực 2 lớp cho cPanel.
