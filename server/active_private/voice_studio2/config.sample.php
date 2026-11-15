<?php
/*
 * CẤU HÌNH MÁY CHỦ BẢN QUYỀN VOICE STUDIO - MR.HUỲNH
 *
 * Đổi tên file này thành config.php rồi điền các mục có dấu  <<< ĐIỀN
 * File này nằm ngoài thư mục web nên không ai đọc được qua trình duyệt.
 */
return [
    // Nội dung file vsmh-private-key.txt (64 ký tự hex).                         <<< ĐIỀN
    'private_key' => '',

    // API Key bạn đã nhập khi tạo webhook trên SePay.                            <<< ĐIỀN
    'sepay_api_key' => '',

    // Telegram: token bot (từ @BotFather) và Chat ID nhận thông báo.             <<< ĐIỀN
    'telegram_bot_token' => '',
    'telegram_chat_id' => '',
    // Báo Telegram mỗi khi khách tạo đơn mới (chưa thanh toán).
    'telegram_notify_new_order' => true,

    // Mật khẩu đăng nhập trang quản trị voice_studio2_admin.php (ít nhất 10 ký tự). <<< ĐIỀN
    'admin_password' => '',

    // Tài khoản nhận tiền (hiện trên mã QR).
    'bank' => [
        'name' => 'BIDV',            // đúng tên ngân hàng trong qr.sepay.vn/banks.json
        'account' => '9624788159',
        'holder' => 'HUYNH XUYEN SON',
    ],

    // Tiền tố mã đơn đã cấu hình trên SePay; mã đơn = tiền tố + 8 ký tự chữ và số.
    'order_prefix' => 'ACT',

    // Giá các gói (VNĐ).
    'plans' => [
        'month1' => 55000,
        'month3' => 150000,
        'year1' => 500000,
        'permanent' => 1000000,
    ],

    // Gói thử thanh toán 2.000đ (cấp key 1 tháng) để tự kiểm tra hệ thống.
    // Chỉ bật khi thử, nhớ tắt (false) sau khi thử xong.
    'test_plan_enabled' => false,
    'test_plan_price' => 2000,

    // Tiền tố mã đơn của các hệ thống KHÁC dùng chung tài khoản ngân hàng
    // (vd. Voice AI). Giao dịch có các tiền tố này được bỏ qua, không báo lỗi.
    'ignore_prefixes' => [],

    // Cơ sở dữ liệu: để trống = SQLite (file data.sqlite trong thư mục này).
    // Muốn dùng MySQL: 'mysql:host=localhost;dbname=TEN_DB;charset=utf8mb4'
    'db_dsn' => '',
    'db_user' => '',
    'db_password' => '',

    // Thời gian giữ mã QR trên app (phút). Khách chuyển trễ vẫn được kích hoạt.
    'order_ttl_minutes' => 15,
];
