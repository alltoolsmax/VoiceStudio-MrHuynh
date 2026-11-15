<?php
/*
 * Kiểm tra cài đặt máy chủ bản quyền Voice Studio - Mr.Huỳnh.
 * Mở https://active.mrhuynh.net/voice_studio2_check.php — XÓA file này sau khi mọi mục đều đạt.
 * Trang không hiện bất kỳ khóa hay mật khẩu nào.
 */
declare(strict_types=1);
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');

$rows = [];
$add = function (string $name, bool $ok, string $detail = '') use (&$rows): void {
    $rows[] = [$name, $ok, $detail];
};

$add('PHP 8.1 trở lên', PHP_VERSION_ID >= 80100, 'Đang chạy PHP ' . PHP_VERSION);
$add('Thư viện sodium (chữ ký số)', function_exists('sodium_crypto_sign_detached'));
$drivers = array_values(array_filter(['pdo_sqlite', 'pdo_mysql'], 'extension_loaded'));
$add('PDO SQLite (hoặc MySQL)', $drivers !== [], implode(', ', $drivers));
$add('Gửi HTTP ra ngoài (cURL) cho Telegram', function_exists('curl_init') || ini_get('allow_url_fopen'));

$found = null;
$dir = dirname(__DIR__);
for ($i = 0; $i < 3 && !$found; $i++) {
    if (is_file($dir . '/active_private/voice_studio2/lib.php')) {
        $found = $dir . '/active_private/voice_studio2';
    }
    $dir = dirname($dir);
}
$inside = is_file(__DIR__ . '/active_private/voice_studio2/lib.php');
$add('Tìm thấy active_private/voice_studio2 ngoài thư mục web', $found !== null,
    $found ? 'Ở thư mục cha của thư mục web.' : ($inside ? 'Đang nằm TRONG thư mục web — hãy chuyển ra ngoài.' : 'Chưa upload thư mục active_private.'));

if ($found) {
    require __DIR__ . '/voice_studio2_bootstrap.php';
    $configOk = is_file(VS2_PRIVATE_DIR . '/config.php');
    $add('Có file config.php', $configOk, $configOk ? '' : 'Đổi tên config.sample.php thành config.php rồi điền.');
    if ($configOk) {
        $c = vs2_config();
        try {
            vs2_secret_key();
            $add('Khóa bí mật hợp lệ và khớp với Voice Studio', true);
        } catch (Throwable $e) {
            $add('Khóa bí mật hợp lệ và khớp với Voice Studio', false, $e->getMessage());
        }
        $add('Đã điền API Key webhook SePay', trim((string) ($c['sepay_api_key'] ?? '')) !== '');
        $add('Đã điền Telegram (token + chat id)', trim((string) ($c['telegram_bot_token'] ?? '')) !== '' && trim((string) ($c['telegram_chat_id'] ?? '')) !== '');
        $add('Mật khẩu quản trị ≥ 10 ký tự', strlen((string) ($c['admin_password'] ?? '')) >= 10);
        $add('Tài khoản nhận tiền', !empty($c['bank']['account']), vs2_h(($c['bank']['name'] ?? '') . ' ' . ($c['bank']['account'] ?? '') . ' — ' . ($c['bank']['holder'] ?? '')));
        $add('Gói thử 2.000đ đang TẮT', empty($c['test_plan_enabled']), empty($c['test_plan_enabled']) ? '' : 'Nhớ tắt test_plan_enabled sau khi thử xong.');
        try {
            vs2_db()->query('SELECT COUNT(*) FROM vs2_orders')->fetchColumn();
            $add('Cơ sở dữ liệu ghi được', true, $c['db_dsn'] ? 'MySQL' : 'SQLite: data.sqlite');
        } catch (Throwable $e) {
            $add('Cơ sở dữ liệu ghi được', false, $e->getMessage());
        }
        $add('Chặn truy cập web vào thư mục riêng', is_file(VS2_PRIVATE_DIR . '/.htaccess'));
    }
}

$allOk = !in_array(false, array_column($rows, 1), true);
?><!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Kiểm tra cài đặt — Voice Studio - Mr.Huỳnh</title>
<style>body{font-family:system-ui,Segoe UI,sans-serif;background:#0f172a;color:#e2e8f0;padding:24px}table{border-collapse:collapse;background:#1e293b;border-radius:10px;overflow:hidden}
td{padding:9px 14px;border-bottom:1px solid #334155}.ok{color:#4ade80}.no{color:#f87171}.muted{color:#94a3b8;font-size:13px}</style></head><body>
<h2>Kiểm tra cài đặt máy chủ bản quyền</h2>
<table><?php foreach ($rows as [$name, $ok, $detail]): ?><tr><td class="<?= $ok ? 'ok' : 'no' ?>"><?= $ok ? '✔' : '✘' ?></td><td><?= htmlspecialchars($name) ?></td><td class="muted"><?= $detail ?></td></tr><?php endforeach ?></table>
<p><?= $allOk ? '<b class="ok">Mọi mục đều đạt.</b> Hãy XÓA file voice_studio2_check.php khỏi hosting.' : '<b class="no">Còn mục chưa đạt</b> — sửa theo ghi chú rồi tải lại trang.' ?></p>
</body></html>
