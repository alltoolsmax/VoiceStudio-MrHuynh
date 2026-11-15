<?php
/*
 * API cho app Voice Studio - Mr.Huỳnh.
 *   GET  ?action=plans                          bảng giá và tài khoản nhận tiền
 *   POST ?action=create_order  {machine_code, plan, current_key?}
 *   GET  ?action=order&code=ACT...&machine_code=VSMH-...
 *   GET  ?action=update_policy                  phiên bản tối thiểu bắt buộc (trang quản trị)
 */
declare(strict_types=1);
require __DIR__ . '/voice_studio2_bootstrap.php';

try {
    $action = (string) ($_GET['action'] ?? '');

    if ($action === 'plans') {
        $plans = [];
        foreach (vs2_plans() as $id => $price) {
            $plans[] = [
                'id' => $id,
                'label' => VS2_PLAN_LABELS[$id] ?? $id,
                'price' => $price,
                'key_plan' => vs2_key_plan($id),
            ];
        }
        vs2_json(['ok' => true, 'plans' => $plans]);
    }

    if ($action === 'update_policy') {
        $policy = vs2_update_policy();
        $latest = vs2_latest_release(__DIR__ . '/downloads');
        vs2_json([
            'ok' => true,
            'min_version' => $policy['min_version'],
            'message' => $policy['message'],
            'latest_version' => $latest['version'] ?? null,
            'download_url' => 'https://active.mrhuynh.net/downloads/',
        ]);
    }

    if ($action === 'create_order') {
        if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
            vs2_json(['ok' => false, 'error' => 'method'], 405);
        }
        $input = json_decode((string) file_get_contents('php://input'), true);
        if (!is_array($input)) {
            vs2_json(['ok' => false, 'error' => 'bad_request'], 400);
        }
        $machine = vs2_parse_machine((string) ($input['machine_code'] ?? ''));
        $plan = (string) ($input['plan'] ?? '');
        $plans = vs2_plans();
        if ($machine === null) {
            vs2_json(['ok' => false, 'error' => 'machine_code'], 400);
        }
        if (!isset($plans[$plan])) {
            vs2_json(['ok' => false, 'error' => 'plan'], 400);
        }
        $db = vs2_db();
        $ip = vs2_client_ip();
        $recent = $db->prepare('SELECT COUNT(*) FROM vs2_orders WHERE client_ip = ? AND created_at > ?');
        $recent->execute([$ip, time() - 3600]);
        if ((int) $recent->fetchColumn() >= 30) {
            vs2_json(['ok' => false, 'error' => 'rate_limited'], 429);
        }

        // Key app đang có (đã ký): dùng hạn của nó để cộng dồn khi gia hạn.
        $current = isset($input['current_key']) ? vs2_read_key((string) $input['current_key'], $machine) : null;
        if (($current['plan'] ?? null) === 'permanent' || vs2_has_permanent($machine)) {
            vs2_json(['ok' => false, 'error' => 'already_permanent'], 409);
        }
        $baseExpiry = $current['expires_on'] ?? null;

        // Khách bấm lại cùng gói khi đơn cũ còn hạn QR: dùng lại đơn cũ.
        $ttl = (int) (vs2_config()['order_ttl_minutes'] ?? 15) * 60;
        $existing = $db->prepare(
            "SELECT * FROM vs2_orders WHERE machine_code = ? AND plan = ? AND status = 'pending'
             AND source = 'qr' AND created_at > ? ORDER BY id DESC LIMIT 1"
        );
        $existing->execute([$machine, $plan, time() - $ttl + 60]);
        if ($order = $existing->fetch()) {
            vs2_json(['ok' => true, 'order' => vs2_order_public($order)]);
        }

        $code = vs2_new_order_code();
        $insert = $db->prepare(
            "INSERT INTO vs2_orders (code, machine_code, plan, amount, status, source, base_expiry, created_at, client_ip)
             VALUES (?, ?, ?, ?, 'pending', 'qr', ?, ?, ?)"
        );
        $insert->execute([$code, $machine, $plan, $plans[$plan], $baseExpiry, time(), $ip]);
        $stmt = $db->prepare('SELECT * FROM vs2_orders WHERE code = ?');
        $stmt->execute([$code]);
        $order = $stmt->fetch();

        if (!empty(vs2_config()['telegram_notify_new_order'])) {
            vs2_telegram(sprintf(
                "🆕 <b>Đơn mới</b> %s\nGói: %s — %s\nMã máy: <code>%s</code>%s",
                vs2_h($code),
                vs2_h(VS2_PLAN_LABELS[$plan] ?? $plan),
                vs2_money($plans[$plan]),
                vs2_h($machine),
                $baseExpiry ? "\nGia hạn, đang có hạn đến: " . vs2_h($baseExpiry) : ''
            ));
        }
        vs2_json(['ok' => true, 'order' => vs2_order_public($order)]);
    }

    if ($action === 'order') {
        $code = strtoupper(trim((string) ($_GET['code'] ?? '')));
        $machine = vs2_parse_machine((string) ($_GET['machine_code'] ?? ''));
        $stmt = vs2_db()->prepare('SELECT * FROM vs2_orders WHERE code = ? AND machine_code = ?');
        $stmt->execute([$code, (string) $machine]);
        $order = $stmt->fetch();
        if (!$order) {
            vs2_json(['ok' => false, 'error' => 'not_found'], 404);
        }
        $result = ['ok' => true, 'status' => $order['status'], 'paid_amount' => (int) $order['paid_amount']];
        if ($order['status'] === 'paid') {
            $result += [
                'key' => $order['license_key'],
                'plan' => vs2_key_plan($order['plan']),
                'expires_on' => $order['expires_on'],
            ];
        }
        vs2_json($result);
    }

    vs2_json(['ok' => false, 'error' => 'unknown_action'], 404);
} catch (Throwable $error) {
    error_log('[voice_studio2_api] ' . $error->getMessage());
    vs2_json(['ok' => false, 'error' => 'server_error'], 500);
}
