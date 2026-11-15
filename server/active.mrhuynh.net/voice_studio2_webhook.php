<?php
/*
 * Webhook SePay cho Voice Studio - Mr.Huỳnh.
 * SePay gọi địa chỉ này khi có tiền vào; xác thực bằng header
 * "Authorization: Apikey <API_KEY>". Mỗi giao dịch (id SePay) chỉ xử lý một lần.
 */
declare(strict_types=1);
require __DIR__ . '/voice_studio2_bootstrap.php';

function vs2_webhook_ok(): never
{
    // SePay coi phản hồi {"success": true} với HTTP 200 là đã nhận.
    vs2_json(['success' => true]);
}

try {
    $expected = trim((string) (vs2_config()['sepay_api_key'] ?? ''));
    $header = trim(vs2_authorization_header());
    $given = preg_match('/^Apikey\s+(.+)$/i', $header, $m) ? trim($m[1]) : '';
    if ($expected === '' || !hash_equals($expected, $given)) {
        vs2_telegram(sprintf(
            "⚠️ <b>Webhook sai xác thực</b>\nIP: %s\n%s",
            vs2_h(vs2_client_ip()),
            $header === ''
                ? 'Không thấy header Authorization: hosting có thể đã chặn header này (xem mục Xử lý sự cố trong hướng dẫn).'
                : 'API Key không khớp với config.php — có thể là yêu cầu giả mạo.'
        ));
        vs2_json(['success' => false, 'error' => 'unauthorized'], 401);
    }

    $raw = (string) file_get_contents('php://input');
    $data = json_decode($raw, true);
    if (!is_array($data) || !isset($data['id'])) {
        vs2_json(['success' => false, 'error' => 'bad_request'], 400);
    }
    if (strtolower((string) ($data['transferType'] ?? '')) !== 'in') {
        vs2_webhook_ok();
    }

    $db = vs2_db();
    $sepayId = (int) $data['id'];
    $amount = (int) ($data['transferAmount'] ?? 0);
    $content = (string) ($data['content'] ?? ($data['description'] ?? ''));

    // Mã đơn: trường "code" của SePay, hoặc tìm trong nội dung chuyển khoản.
    $prefix = strtoupper((string) (vs2_config()['order_prefix'] ?? 'ACT'));
    $candidates = [];
    if (!empty($data['code'])) {
        $candidates[] = strtoupper((string) $data['code']);
    }
    if (preg_match_all('/' . preg_quote($prefix, '/') . '[A-Z0-9]{8}/i', $content, $found)) {
        foreach ($found[0] as $code) {
            $candidates[] = strtoupper($code);
        }
    }

    $db->beginTransaction();
    $seen = $db->prepare('SELECT 1 FROM vs2_transactions WHERE sepay_id = ?');
    $seen->execute([$sepayId]);
    if ($seen->fetchColumn()) {
        $db->commit();
        vs2_webhook_ok(); // SePay gửi lại giao dịch đã xử lý
    }

    $order = null;
    foreach (array_unique($candidates) as $code) {
        $stmt = $db->prepare('SELECT * FROM vs2_orders WHERE code = ?');
        $stmt->execute([$code]);
        if ($order = $stmt->fetch()) {
            break;
        }
    }

    $log = $db->prepare(
        'INSERT INTO vs2_transactions (sepay_id, received_at, amount, content, order_code, result, raw)
         VALUES (?, ?, ?, ?, ?, ?, ?)'
    );

    if (!$order) {
        $ignored = false;
        foreach ((array) (vs2_config()['ignore_prefixes'] ?? []) as $other) {
            if ($other !== '' && stripos($content . ' ' . ($data['code'] ?? ''), (string) $other) !== false) {
                $ignored = true;
            }
        }
        $log->execute([$sepayId, time(), $amount, $content, null, $ignored ? 'ignored' : 'unmatched', $raw]);
        $db->commit();
        if (!$ignored) {
            vs2_telegram(sprintf(
                "⚠️ <b>Tiền vào không khớp đơn nào</b>\nSố tiền: %s\nNội dung: %s\nMã GD SePay: %d\n→ Kiểm tra và cấp key tay nếu là khách Voice Studio.",
                vs2_money($amount),
                vs2_h($content),
                $sepayId
            ));
        }
        vs2_webhook_ok();
    }

    if ($order['status'] === 'paid') {
        $log->execute([$sepayId, time(), $amount, $content, $order['code'], 'duplicate', $raw]);
        $db->commit();
        vs2_telegram(sprintf(
            "⚠️ <b>Khách chuyển thêm tiền cho đơn đã thanh toán</b> %s\nSố tiền: %s\nMã máy: <code>%s</code>\n→ Có thể khách chuyển 2 lần, cần hoàn tiền hoặc cấp thêm gói.",
            vs2_h($order['code']),
            vs2_money($amount),
            vs2_h($order['machine_code'])
        ));
        vs2_webhook_ok();
    }

    // Cộng dồn nếu khách chuyển nhiều lần cho cùng một đơn.
    $paid = (int) $order['paid_amount'] + $amount;
    if ($paid < (int) $order['amount']) {
        $db->prepare("UPDATE vs2_orders SET status = 'underpaid', paid_amount = ? WHERE id = ?")
            ->execute([$paid, $order['id']]);
        $log->execute([$sepayId, time(), $amount, $content, $order['code'], 'underpaid', $raw]);
        $db->commit();
        vs2_telegram(sprintf(
            "⚠️ <b>Chuyển thiếu tiền</b> %s\nGói: %s — cần %s, đã nhận %s\nMã máy: <code>%s</code>\n→ Chờ khách chuyển thêm, hoặc cấp key trong trang quản trị.",
            vs2_h($order['code']),
            vs2_h(VS2_PLAN_LABELS[$order['plan']] ?? $order['plan']),
            vs2_money((int) $order['amount']),
            vs2_money($paid),
            vs2_h($order['machine_code'])
        ));
        vs2_webhook_ok();
    }

    try {
        $issued = vs2_fulfil($order, $paid);
    } catch (Throwable $error) {
        $db->prepare("UPDATE vs2_orders SET status = 'error', paid_amount = ? WHERE id = ?")
            ->execute([$paid, $order['id']]);
        $log->execute([$sepayId, time(), $amount, $content, $order['code'], 'error', $raw]);
        $db->commit();
        error_log('[voice_studio2_webhook] ' . $error->getMessage());
        vs2_telegram(sprintf(
            "🛑 <b>Lỗi cấp key</b> cho đơn đã thanh toán %s\nLỗi: %s\n→ Kiểm tra config.php, rồi cấp key tay trong trang quản trị.",
            vs2_h($order['code']),
            vs2_h($error->getMessage())
        ));
        vs2_webhook_ok();
    }
    $log->execute([$sepayId, time(), $amount, $content, $order['code'], 'paid', $raw]);
    $db->commit();
    vs2_telegram(sprintf(
        "✅ <b>Đã thanh toán, đã cấp key</b> %s\nGói: %s — nhận %s\nHạn dùng: %s\nMã máy: <code>%s</code>",
        vs2_h($order['code']),
        vs2_h(VS2_PLAN_LABELS[$order['plan']] ?? $order['plan']),
        vs2_money($paid),
        $issued['expires_on'] ? 'đến ' . vs2_h($issued['expires_on']) : 'vĩnh viễn',
        vs2_h($order['machine_code'])
    ));
    vs2_webhook_ok();
} catch (Throwable $error) {
    if (isset($db) && $db->inTransaction()) {
        $db->rollBack();
    }
    error_log('[voice_studio2_webhook] ' . $error->getMessage());
    vs2_telegram('🛑 <b>Lỗi webhook</b>: ' . vs2_h($error->getMessage()));
    // 500 để SePay gửi lại khi bật "thử lại khi lỗi".
    vs2_json(['success' => false, 'error' => 'server_error'], 500);
}
