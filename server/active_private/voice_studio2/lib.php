<?php
/*
 * Lõi máy chủ bản quyền Voice Studio - Mr.Huỳnh.
 *
 * Định dạng mã máy và key phải khớp từng byte với
 * electron/src/main/license/codec.ts và tools/keygen/vsmh_license.py.
 */
declare(strict_types=1);

const VS2_VERSION = '1.0.0';
/** Khóa công khai có trong Voice Studio — khóa bí mật trong config phải khớp. */
const VS2_PUBLIC_KEY = 'c6b424e5d1f327c5c8b3befd5dd0522e660e7bda559607cd18eb715354439cad';
const VS2_CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** Ký tự của mã đơn: bỏ O, I, L, U cho khỏi đọc nhầm. */
const VS2_ORDER_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const VS2_PLAN_TYPES = ['permanent' => 1, 'month1' => 2, 'month3' => 3, 'year1' => 4];
const VS2_PLAN_MONTHS = ['month1' => 1, 'month3' => 3, 'year1' => 12];
const VS2_PLAN_LABELS = [
    'month1' => '1 tháng',
    'month3' => '3 tháng',
    'year1' => '1 năm',
    'permanent' => 'Vĩnh viễn',
    'test' => 'Thử thanh toán (1 tháng)',
];

// ── cấu hình và cơ sở dữ liệu ───────────────────────────────────────────────

/** Khóa công khai dùng để đối chiếu (bộ test tự động dùng khóa thử riêng). */
function vs2_public_key(): string
{
    return getenv('VS2_TEST_PUBLIC_KEY') ?: VS2_PUBLIC_KEY;
}

function vs2_dir(): string
{
    return __DIR__;
}

function vs2_config(): array
{
    static $config = null;
    if ($config === null) {
        $file = getenv('VS2_CONFIG_FILE') ?: vs2_dir() . '/config.php';
        if (!is_file($file)) {
            throw new RuntimeException('Chưa có config.php (đổi tên config.sample.php rồi điền).');
        }
        $config = require $file;
        if (!is_array($config)) {
            throw new RuntimeException('config.php phải trả về một mảng.');
        }
    }
    return $config;
}

function vs2_db(): PDO
{
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }
    $c = vs2_config();
    $dsn = $c['db_dsn'] ?: 'sqlite:' . (getenv('VS2_DB_FILE') ?: vs2_dir() . '/data.sqlite');
    $pdo = new PDO($dsn, $c['db_user'] ?: null, $c['db_password'] ?: null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $sqlite = str_starts_with($dsn, 'sqlite:');
    if ($sqlite) {
        $pdo->exec('PRAGMA journal_mode=WAL');
        $pdo->exec('PRAGMA busy_timeout=5000');
    }
    $id = $sqlite ? 'INTEGER PRIMARY KEY AUTOINCREMENT' : 'BIGINT PRIMARY KEY AUTO_INCREMENT';
    $text = $sqlite ? 'TEXT' : 'VARCHAR(191)';
    $pdo->exec("CREATE TABLE IF NOT EXISTS vs2_orders (
        id $id,
        code $text NOT NULL UNIQUE,
        machine_code $text NOT NULL,
        plan $text NOT NULL,
        amount BIGINT NOT NULL,
        status $text NOT NULL,
        source $text NOT NULL,
        base_expiry $text NULL,
        created_at BIGINT NOT NULL,
        paid_at BIGINT NULL,
        paid_amount BIGINT NOT NULL DEFAULT 0,
        license_key TEXT NULL,
        starts_on $text NULL,
        expires_on $text NULL,
        note TEXT NULL,
        client_ip $text NULL
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS vs2_transactions (
        id $id,
        sepay_id BIGINT NOT NULL UNIQUE,
        received_at BIGINT NOT NULL,
        amount BIGINT NOT NULL,
        content TEXT NULL,
        order_code $text NULL,
        result $text NOT NULL,
        raw TEXT NULL
    )");
    return $pdo;
}

// ── mã máy và key (khớp codec.ts) ───────────────────────────────────────────

function vs2_base32_encode(string $bytes): string
{
    $bits = 0;
    $value = 0;
    $out = '';
    foreach (str_split($bytes) as $char) {
        $value = ($value << 8) | ord($char);
        $bits += 8;
        while ($bits >= 5) {
            $out .= VS2_CROCKFORD[($value >> ($bits - 5)) & 31];
            $bits -= 5;
        }
        $value &= (1 << $bits) - 1;
    }
    if ($bits > 0) {
        $out .= VS2_CROCKFORD[($value << (5 - $bits)) & 31];
    }
    return $out;
}

function vs2_base32_decode(string $text, int $length): ?string
{
    $bits = 0;
    $value = 0;
    $out = '';
    foreach (str_split($text) as $char) {
        $digit = strpos(VS2_CROCKFORD, $char);
        if ($digit === false) {
            return null;
        }
        $value = (($value << 5) | $digit) & 0xFFFF;
        $bits += 5;
        if ($bits >= 8) {
            if (strlen($out) >= $length) {
                return null;
            }
            $out .= chr(($value >> ($bits - 8)) & 0xFF);
            $bits -= 8;
        }
    }
    return strlen($out) === $length ? $out : null;
}

function vs2_normalize(string $text): string
{
    $text = strtoupper($text);
    $text = preg_replace('/[\s\-_.]/', '', $text) ?? '';
    return strtr($text, ['O' => '0', 'I' => '1', 'L' => '1']);
}

function vs2_checksum_char(string $data): string
{
    $sum = 0;
    for ($i = 0, $n = strlen($data); $i < $n; $i++) {
        $sum += ($i + 1) * strpos(VS2_CROCKFORD, $data[$i]);
    }
    return VS2_CROCKFORD[$sum % 32];
}

/** Mã máy chuẩn "VSMH-XXXX-XXXX-XXXX-XXXX", hoặc null khi sai / gõ nhầm. */
function vs2_parse_machine(string $text): ?string
{
    $body = vs2_normalize($text);
    if (str_starts_with($body, 'VSMH')) {
        $body = substr($body, 4);
    }
    if (!preg_match('/^[0-9A-HJKMNP-TV-Z]{16}$/', $body)) {
        return null;
    }
    if (vs2_checksum_char(substr($body, 0, 15)) !== $body[15]) {
        return null;
    }
    return 'VSMH-' . implode('-', str_split($body, 4));
}

function vs2_machine_tag(string $machine): string
{
    $body = str_replace('-', '', substr($machine, 5));
    return substr(hash('sha256', 'VSMH-KEY-v1|' . $body, true), 0, 8);
}

function vs2_epoch(): DateTimeImmutable
{
    return new DateTimeImmutable('2026-01-01', new DateTimeZone('UTC'));
}

function vs2_today(): DateTimeImmutable
{
    $now = getenv('VS2_FAKE_NOW') ?: 'now';
    return (new DateTimeImmutable($now, new DateTimeZone('UTC')))->setTime(0, 0);
}

function vs2_day_number(DateTimeImmutable $date): int
{
    return (int) vs2_epoch()->diff($date)->format('%r%a');
}

function vs2_from_day_number(int $day): DateTimeImmutable
{
    return vs2_epoch()->modify("+$day days");
}

/** Cộng tháng theo lịch; ngày không tồn tại lùi về cuối tháng (31/1 + 1 tháng = 28/2). */
function vs2_add_months(DateTimeImmutable $start, int $months): DateTimeImmutable
{
    $y = (int) $start->format('Y');
    $m = (int) $start->format('n') - 1 + $months;
    $year = $y + intdiv($m, 12);
    $month = $m % 12 + 1;
    $days = cal_days_in_month_safe($year, $month);
    $day = min((int) $start->format('j'), $days);
    return new DateTimeImmutable(sprintf('%04d-%02d-%02d', $year, $month, $day), new DateTimeZone('UTC'));
}

function cal_days_in_month_safe(int $year, int $month): int
{
    return (int) (new DateTimeImmutable(sprintf('%04d-%02d-01', $year, $month)))->format('t');
}

/** Ngày hết hạn (không tính) của gói kể từ ngày bắt đầu; null với vĩnh viễn. */
function vs2_expiry_for(string $plan, DateTimeImmutable $start): ?DateTimeImmutable
{
    if ($plan === 'permanent') {
        return null;
    }
    return vs2_add_months($start, VS2_PLAN_MONTHS[$plan]);
}

function vs2_secret_key(): string
{
    $hex = trim((string) (vs2_config()['private_key'] ?? ''));
    if (!preg_match('/^[0-9a-fA-F]{64}$/', $hex)) {
        throw new RuntimeException('private_key trong config.php phải là 64 ký tự hex.');
    }
    $pair = sodium_crypto_sign_seed_keypair(sodium_hex2bin($hex));
    if (bin2hex(sodium_crypto_sign_publickey($pair)) !== vs2_public_key()) {
        throw new RuntimeException('private_key không khớp với Voice Studio.');
    }
    return sodium_crypto_sign_secretkey($pair);
}

/** Tạo key VSMH2 cho mã máy, gói và ngày bắt đầu. */
function vs2_issue_key(string $machine, string $plan, DateTimeImmutable $start, ?int $serial = null): array
{
    if (!isset(VS2_PLAN_TYPES[$plan])) {
        throw new InvalidArgumentException('Gói không hợp lệ');
    }
    $expires = vs2_expiry_for($plan, $start);
    $serial ??= random_int(0, 0xFFFF);
    $payload = chr(2) . chr(VS2_PLAN_TYPES[$plan]) . vs2_machine_tag($machine)
        . pack('n', vs2_day_number(vs2_today()))
        . pack('n', $expires ? vs2_day_number($expires) : 0)
        . pack('n', $serial);
    $signature = sodium_crypto_sign_detached($payload, vs2_secret_key());
    $body = vs2_base32_encode($payload . $signature);
    return [
        'key' => 'VSMH2-' . implode('-', str_split($body, 5)),
        'starts_on' => $start->format('Y-m-d'),
        'expires_on' => $expires?->format('Y-m-d'),
    ];
}

/**
 * Đọc một key (VSMH1/VSMH2) app gửi lên khi gia hạn. Trả về ['plan', 'expires_on']
 * nếu chữ ký đúng và đúng máy; ngược lại null. Nhờ có chữ ký, app không khai
 * gian được ngày hết hạn để được cộng thêm.
 */
function vs2_read_key(string $text, string $machine): ?array
{
    $body = vs2_normalize($text);
    foreach (['VSMH2', 'VSMH1'] as $prefix) {
        if (str_starts_with($body, $prefix)) {
            $body = substr($body, strlen($prefix));
            break;
        }
    }
    foreach ([16, 14] as $size) {
        $bytes = vs2_base32_decode($body, $size + 64);
        if ($bytes === null) {
            continue;
        }
        $payload = substr($bytes, 0, $size);
        $signature = substr($bytes, $size);
        if (!sodium_crypto_sign_verify_detached($signature, $payload, sodium_hex2bin(vs2_public_key()))) {
            return null;
        }
        if (substr($payload, 2, 8) !== vs2_machine_tag($machine)) {
            return null;
        }
        $type = ord($payload[1]);
        $plan = array_search($type, VS2_PLAN_TYPES, true);
        if ($plan === false) {
            return null;
        }
        $expiryDay = $size === 16 ? unpack('n', substr($payload, 12, 2))[1] : 0;
        return [
            'plan' => $plan,
            'expires_on' => $expiryDay ? vs2_from_day_number($expiryDay)->format('Y-m-d') : null,
        ];
    }
    return null;
}

// ── đơn hàng ────────────────────────────────────────────────────────────────

/** Bảng giá đang bán (kể cả gói thử khi bật). */
function vs2_plans(): array
{
    $c = vs2_config();
    $plans = [];
    foreach (['month1', 'month3', 'year1', 'permanent'] as $id) {
        if (isset($c['plans'][$id])) {
            $plans[$id] = (int) $c['plans'][$id];
        }
    }
    if (!empty($c['test_plan_enabled'])) {
        $plans['test'] = (int) ($c['test_plan_price'] ?? 2000);
    }
    return $plans;
}

/** Gói thật sẽ cấp cho một gói bán ra (gói thử cấp key 1 tháng). */
function vs2_key_plan(string $plan): string
{
    return $plan === 'test' ? 'month1' : $plan;
}

function vs2_new_order_code(): string
{
    $prefix = strtoupper((string) (vs2_config()['order_prefix'] ?? 'ACT'));
    $letters = 'ABCDEFGHJKMNPQRSTVWXYZ';
    $digits = '23456789';
    do {
        $chars = [];
        for ($i = 0; $i < 8; $i++) {
            $chars[] = VS2_ORDER_ALPHABET[random_int(0, strlen(VS2_ORDER_ALPHABET) - 1)];
        }
        // Luôn có ít nhất 1 chữ và 1 số (khớp kiểu "chữ và số" của SePay).
        $chars[random_int(0, 3)] = $letters[random_int(0, strlen($letters) - 1)];
        $chars[random_int(4, 7)] = $digits[random_int(0, strlen($digits) - 1)];
        $code = $prefix . implode('', $chars);
        $exists = vs2_db()->prepare('SELECT 1 FROM vs2_orders WHERE code = ?');
        $exists->execute([$code]);
    } while ($exists->fetchColumn());
    return $code;
}

/**
 * Ngày bắt đầu cho một lần mua/cấp mới, để cộng dồn khi gia hạn:
 * muộn nhất trong (hôm nay, hạn của key app đang có, hạn xa nhất đã cấp cho máy này).
 */
function vs2_renewal_start(string $machine, ?string $baseExpiry = null): DateTimeImmutable
{
    $start = vs2_today();
    $stmt = vs2_db()->prepare(
        "SELECT MAX(expires_on) FROM vs2_orders WHERE machine_code = ? AND status = 'paid' AND expires_on IS NOT NULL"
    );
    $stmt->execute([$machine]);
    foreach ([$stmt->fetchColumn() ?: null, $baseExpiry] as $date) {
        if ($date) {
            $candidate = new DateTimeImmutable($date, new DateTimeZone('UTC'));
            if ($candidate > $start) {
                $start = $candidate;
            }
        }
    }
    return $start;
}

function vs2_has_permanent(string $machine): bool
{
    $stmt = vs2_db()->prepare(
        "SELECT 1 FROM vs2_orders WHERE machine_code = ? AND status = 'paid' AND plan = 'permanent'"
    );
    $stmt->execute([$machine]);
    return (bool) $stmt->fetchColumn();
}

function vs2_qr_url(string $code, int $amount): string
{
    $bank = vs2_config()['bank'];
    return 'https://qr.sepay.vn/img?' . http_build_query([
        'acc' => $bank['account'],
        'bank' => $bank['name'],
        'amount' => $amount,
        'des' => $code,
        'template' => 'compact',
    ]);
}

function vs2_order_public(array $order): array
{
    $bank = vs2_config()['bank'];
    $ttl = (int) (vs2_config()['order_ttl_minutes'] ?? 15);
    return [
        'code' => $order['code'],
        'plan' => $order['plan'],
        'plan_label' => VS2_PLAN_LABELS[$order['plan']] ?? $order['plan'],
        'amount' => (int) $order['amount'],
        'status' => $order['status'],
        'bank' => $bank['name'],
        'account' => $bank['account'],
        'holder' => $bank['holder'],
        'content' => $order['code'],
        'qr_url' => vs2_qr_url($order['code'], (int) $order['amount']),
        'expires_at' => gmdate('c', (int) $order['created_at'] + $ttl * 60),
    ];
}

/** Ghi nhận đã thanh toán đủ: cấp key theo gói, cộng dồn hạn dùng. */
function vs2_fulfil(array $order, int $paidAmount): array
{
    $plan = vs2_key_plan($order['plan']);
    $start = vs2_renewal_start($order['machine_code'], $order['base_expiry']);
    $issued = vs2_issue_key($order['machine_code'], $plan, $start);
    $stmt = vs2_db()->prepare(
        "UPDATE vs2_orders SET status = 'paid', paid_at = ?, paid_amount = ?, license_key = ?,
         starts_on = ?, expires_on = ? WHERE id = ?"
    );
    $stmt->execute([time(), $paidAmount, $issued['key'], $issued['starts_on'], $issued['expires_on'], $order['id']]);
    return $issued + ['plan' => $plan];
}

// ── phát hành và bắt buộc cập nhật ──────────────────────────────────────────

function vs2_update_policy(): array
{
    $file = vs2_dir() . '/update_policy.json';
    $data = is_file($file) ? json_decode((string) file_get_contents($file), true) : null;
    return [
        'min_version' => is_array($data) ? (string) ($data['min_version'] ?? '') : '',
        'message' => is_array($data) ? (string) ($data['message'] ?? '') : '',
    ];
}

function vs2_save_update_policy(string $minVersion, string $message): void
{
    $minVersion = trim($minVersion);
    if ($minVersion !== '' && !preg_match('/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/', $minVersion)) {
        throw new InvalidArgumentException('Phiên bản phải có dạng 1.0.1');
    }
    file_put_contents(
        vs2_dir() . '/update_policy.json',
        json_encode(['min_version' => $minVersion, 'message' => trim($message)], JSON_UNESCAPED_UNICODE),
        LOCK_EX
    );
}

/**
 * Bản mới nhất đang có trong thư mục downloads (đọc file electron-stable-win32-x64.yml
 * do script build tạo ra). Trả về null khi chưa upload.
 */
function vs2_latest_release(string $downloadsDir): ?array
{
    $file = $downloadsDir . '/electron-stable-win32-x64.yml';
    if (!is_file($file)) {
        return null;
    }
    $yml = (string) file_get_contents($file);
    $field = function (string $name) use ($yml): string {
        return preg_match('/^' . $name . ':\s*[\'"]?([^\'"\r\n]+)[\'"]?\s*$/m', $yml, $m) ? trim($m[1]) : '';
    };
    $notes = '';
    if (preg_match('/^releaseNotes:\s*\|-?\s*\R((?:[ \t]+.*(?:\R|$))+)/m', $yml, $m)) {
        $notes = trim(preg_replace('/^[ \t]{2}/m', '', $m[1]) ?? '');
    } elseif ($inline = $field('releaseNotes')) {
        $notes = $inline;
    }
    $path = basename($field('path'));
    return [
        'version' => $field('version'),
        'file' => $path,
        'date' => $field('releaseDate'),
        'notes' => $notes,
        'size' => is_file($downloadsDir . '/' . $path) ? filesize($downloadsDir . '/' . $path) : null,
    ];
}

// ── Telegram ────────────────────────────────────────────────────────────────

function vs2_h(?string $text): string
{
    return htmlspecialchars((string) $text, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function vs2_money(int $amount): string
{
    return number_format($amount, 0, ',', '.') . 'đ';
}

function vs2_telegram(string $html): bool
{
    return vs2_telegram_send($html) === null;
}

/**
 * Gửi tin Telegram. Trả null khi thành công, ngược lại là lý do lỗi bằng tiếng Việt
 * (hiện ở nút "Thử Telegram" và ghi vào telegram_error.log để tra cứu).
 */
function vs2_telegram_send(string $html): ?string
{
    $c = vs2_config();
    $token = trim((string) ($c['telegram_bot_token'] ?? ''));
    $chat = trim((string) ($c['telegram_chat_id'] ?? ''));
    // Hay dán nhầm cả chữ "bot" ở đầu token.
    if (stripos($token, 'bot') === 0 && preg_match('/^bot\d+:/i', $token)) {
        $token = substr($token, 3);
    }
    if ($token === '' || $chat === '' || getenv('VS2_NO_TELEGRAM')) {
        if ($outbox = getenv('VS2_TELEGRAM_OUTBOX')) {
            file_put_contents($outbox, $html . "\n---\n", FILE_APPEND);
        }
        return 'Chưa điền telegram_bot_token hoặc telegram_chat_id trong config.php.';
    }
    $body = http_build_query([
        'chat_id' => $chat,
        'text' => "<b>Voice Studio - Mr.Huỳnh</b>\n" . $html,
        'parse_mode' => 'HTML',
        'disable_web_page_preview' => 'true',
    ]);
    $url = "https://api.telegram.org/bot$token/sendMessage";
    $status = 0;
    $network = '';
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 8,
            CURLOPT_CONNECTTIMEOUT => 5,
        ]);
        $result = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $network = $result === false ? curl_error($ch) : '';
        // (curl_close() không cần từ PHP 8.0 và bị đánh dấu lỗi thời ở PHP 8.5.)
    } else {
        $context = stream_context_create(['http' => [
            'method' => 'POST',
            'header' => 'Content-Type: application/x-www-form-urlencoded',
            'content' => $body,
            'timeout' => 8,
            'ignore_errors' => true,
        ]]);
        $result = @file_get_contents($url, false, $context);
        if ($result === false) {
            $network = (string) (error_get_last()['message'] ?? 'không kết nối được');
        } elseif (preg_match('/^HTTP\/\S+\s+(\d+)/', $http_response_header[0] ?? '', $m)) {
            $status = (int) $m[1];
        }
    }
    if ($network === '' && $status === 200) {
        return null;
    }
    if ($network !== '') {
        $error = 'Hosting không kết nối được tới api.telegram.org (' . $network
            . '). Hãy nhờ nhà cung cấp hosting mở kết nối ra ngoài tới api.telegram.org cổng 443.';
    } else {
        $desc = (string) (json_decode((string) $result, true)['description'] ?? "HTTP $status");
        $error = match (true) {
            $status === 401, $status === 404 => 'Token bot sai (' . $desc . '). Lấy lại token ở @BotFather.',
            str_contains($desc, 'chat not found') => 'Sai Chat ID, hoặc bạn chưa bấm Start với bot / chưa thêm bot vào nhóm (' . $desc . ').',
            str_contains($desc, 'bot was blocked') => 'Bạn đã chặn bot: mở bot trên Telegram và bấm Bỏ chặn / Start.',
            str_contains($desc, 'kicked') || str_contains($desc, 'not a member') => 'Bot không còn trong nhóm: thêm lại bot vào nhóm.',
            str_contains($desc, 'upgraded to a supergroup') => 'Nhóm đã nâng cấp thành siêu nhóm: Chat ID mới bắt đầu bằng -100… (' . $desc . ').',
            default => 'Telegram từ chối: ' . $desc,
        };
    }
    @file_put_contents(
        vs2_dir() . '/telegram_error.log',
        date('c') . ' ' . $error . "\n",
        FILE_APPEND | LOCK_EX
    );
    return $error;
}

// ── tiện ích HTTP ───────────────────────────────────────────────────────────

function vs2_json(array $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function vs2_client_ip(): string
{
    return substr((string) ($_SERVER['REMOTE_ADDR'] ?? ''), 0, 64);
}

/** Header Authorization — một số hosting (PHP-FPM/CGI) chuyển nó sang tên khác. */
function vs2_authorization_header(): string
{
    foreach (['HTTP_AUTHORIZATION', 'REDIRECT_HTTP_AUTHORIZATION'] as $key) {
        if (!empty($_SERVER[$key])) {
            return (string) $_SERVER[$key];
        }
    }
    if (function_exists('getallheaders')) {
        foreach (getallheaders() as $name => $value) {
            if (strcasecmp((string) $name, 'Authorization') === 0) {
                return (string) $value;
            }
        }
    }
    return '';
}
