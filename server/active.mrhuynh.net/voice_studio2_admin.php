<?php
/*
 * Trang quản trị bản quyền Voice Studio - Mr.Huỳnh: đơn hàng, doanh thu,
 * giao dịch lỗi, tra cứu mã máy và cấp key tay.
 */
declare(strict_types=1);
require __DIR__ . '/voice_studio2_bootstrap.php';

session_name('vs2_admin');
session_set_cookie_params(['httponly' => true, 'secure' => !empty($_SERVER['HTTPS']), 'samesite' => 'Strict']);
session_start();
header('X-Frame-Options: DENY');
header('Cache-Control: no-store');

$config = vs2_config();
$password = (string) ($config['admin_password'] ?? '');
$flash = null;
$issuedKey = null;

function vs2_csrf(): string
{
    return $_SESSION['csrf'] ??= bin2hex(random_bytes(16));
}

function vs2_check_csrf(): void
{
    if (!hash_equals(vs2_csrf(), (string) ($_POST['csrf'] ?? ''))) {
        http_response_code(400);
        exit('Phiên làm việc hết hạn, hãy tải lại trang.');
    }
}

if (($_GET['logout'] ?? '') === '1') {
    session_destroy();
    header('Location: voice_studio2_admin.php');
    exit;
}

if (empty($_SESSION['vs2_ok'])) {
    $error = '';
    if (strlen($password) < 10) {
        $error = 'Chưa đặt admin_password (ít nhất 10 ký tự) trong config.php.';
    } elseif (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
        $_SESSION['tries'] = ($_SESSION['tries'] ?? 0) + 1;
        if ($_SESSION['tries'] > 8) {
            sleep(3);
        }
        if (hash_equals($password, (string) ($_POST['password'] ?? ''))) {
            session_regenerate_id(true);
            $_SESSION['vs2_ok'] = true;
            $_SESSION['tries'] = 0;
            header('Location: voice_studio2_admin.php');
            exit;
        }
        $error = 'Sai mật khẩu.';
    }
    ?><!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Đăng nhập — Voice Studio - Mr.Huỳnh</title>
<style>body{font-family:system-ui,Segoe UI,sans-serif;background:#0f172a;color:#e2e8f0;display:grid;place-items:center;min-height:100vh;margin:0}
form{background:#1e293b;padding:28px;border-radius:12px;width:320px}input,button{width:100%;padding:10px;margin-top:10px;border-radius:8px;border:1px solid #334155;font-size:15px;box-sizing:border-box}
button{background:#7c3aed;color:#fff;border:0;cursor:pointer}.err{color:#fca5a5;margin-top:8px}</style></head><body>
<form method="post"><h2 style="margin:0 0 6px">Quản trị bản quyền</h2><div style="color:#94a3b8">Voice Studio - Mr.Huỳnh</div>
<input type="password" name="password" placeholder="Mật khẩu" autofocus required><button>Đăng nhập</button>
<?php if ($error): ?><div class="err"><?= vs2_h($error) ?></div><?php endif ?></form></body></html><?php
    exit;
}

$db = vs2_db();
$plans = vs2_plans();

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    vs2_check_csrf();
    $action = (string) ($_POST['action'] ?? '');
    try {
        if ($action === 'issue') {
            $machine = vs2_parse_machine((string) ($_POST['machine_code'] ?? ''));
            $plan = (string) ($_POST['plan'] ?? '');
            if (!$machine) {
                throw new InvalidArgumentException('Mã máy sai hoặc gõ nhầm.');
            }
            if (!isset(VS2_PLAN_TYPES[$plan])) {
                throw new InvalidArgumentException('Chọn gói.');
            }
            $startText = trim((string) ($_POST['start'] ?? ''));
            $start = $startText !== ''
                ? new DateTimeImmutable($startText, new DateTimeZone('UTC'))
                : vs2_renewal_start($machine);
            $issued = vs2_issue_key($machine, $plan, $start);
            $code = 'MAN' . strtoupper(bin2hex(random_bytes(4)));
            $db->prepare(
                "INSERT INTO vs2_orders (code, machine_code, plan, amount, status, source, created_at, paid_at,
                 paid_amount, license_key, starts_on, expires_on, note)
                 VALUES (?, ?, ?, ?, 'paid', 'manual', ?, ?, ?, ?, ?, ?, ?)"
            )->execute([
                $code, $machine, $plan, (int) ($_POST['amount'] ?? 0), time(), time(), (int) ($_POST['amount'] ?? 0),
                $issued['key'], $issued['starts_on'], $issued['expires_on'], trim((string) ($_POST['note'] ?? '')),
            ]);
            $issuedKey = $issued + ['machine' => $machine, 'plan' => $plan];
        } elseif ($action === 'fulfil') {
            $stmt = $db->prepare("SELECT * FROM vs2_orders WHERE id = ? AND status <> 'paid'");
            $stmt->execute([(int) ($_POST['id'] ?? 0)]);
            if ($order = $stmt->fetch()) {
                $issued = vs2_fulfil($order, (int) $order['paid_amount']);
                $db->prepare('UPDATE vs2_orders SET note = ? WHERE id = ?')
                    ->execute([trim(($order['note'] ?? '') . ' (cấp tay từ quản trị)'), $order['id']]);
                $issuedKey = $issued + ['machine' => $order['machine_code'], 'plan' => $issued['plan']];
            }
        } elseif ($action === 'update_policy') {
            vs2_save_update_policy((string) ($_POST['min_version'] ?? ''), (string) ($_POST['message'] ?? ''));
            $flash = trim((string) ($_POST['min_version'] ?? '')) === ''
                ? 'Đã tắt bắt buộc cập nhật.'
                : 'Đã lưu: khách dùng bản thấp hơn ' . trim((string) $_POST['min_version']) . ' phải cập nhật mới dùng tiếp.';
        } elseif ($action === 'telegram') {
            $flash = vs2_telegram('🔔 Thử thông báo từ trang quản trị: kết nối Telegram hoạt động.')
                ? 'Đã gửi tin nhắn thử tới Telegram.'
                : 'Không gửi được: kiểm tra telegram_bot_token và telegram_chat_id trong config.php.';
        }
    } catch (Throwable $error) {
        $flash = 'Lỗi: ' . $error->getMessage();
    }
}

$search = trim((string) ($_GET['q'] ?? ''));
$where = '';
$args = [];
if ($search !== '') {
    $machine = vs2_parse_machine($search);
    $where = 'WHERE code LIKE ? OR machine_code = ? OR note LIKE ?';
    $args = ['%' . strtoupper($search) . '%', $machine ?? $search, '%' . $search . '%'];
}
$orders = $db->prepare("SELECT * FROM vs2_orders $where ORDER BY id DESC LIMIT 300");
$orders->execute($args);
$orders = $orders->fetchAll();
$problems = $db->query(
    "SELECT * FROM vs2_transactions WHERE result IN ('unmatched','underpaid','duplicate','error') ORDER BY id DESC LIMIT 50"
)->fetchAll();

$sum = function (int $since) use ($db): array {
    $stmt = $db->prepare("SELECT COUNT(*) n, COALESCE(SUM(paid_amount),0) total FROM vs2_orders WHERE status='paid' AND source='qr' AND paid_at >= ?");
    $stmt->execute([$since]);
    return $stmt->fetch();
};
$tz = new DateTimeZone('Asia/Ho_Chi_Minh');
$today = $sum((new DateTimeImmutable('today', $tz))->getTimestamp());
$month = $sum((new DateTimeImmutable('first day of this month midnight', $tz))->getTimestamp());
$all = $sum(0);
$pending = (int) $db->query("SELECT COUNT(*) FROM vs2_orders WHERE status IN ('pending','underpaid','error') AND created_at > " . (time() - 86400))->fetchColumn();
$policy = vs2_update_policy();
$latest = vs2_latest_release(__DIR__ . '/downloads');
$statusLabels = ['pending' => 'Chờ thanh toán', 'paid' => 'Đã thanh toán', 'underpaid' => 'Thiếu tiền', 'error' => 'Lỗi cấp key'];
$fmtTime = fn ($ts) => $ts ? (new DateTimeImmutable('@' . $ts))->setTimezone($tz)->format('d/m/Y H:i') : '';
?><!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Quản trị — Voice Studio - Mr.Huỳnh</title>
<style>
*{box-sizing:border-box}body{font-family:system-ui,Segoe UI,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:20px}
a{color:#a78bfa}h1{margin:0;font-size:22px}h2{font-size:17px;margin:28px 0 10px}
.top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-top:16px}
.card{background:#1e293b;border-radius:10px;padding:14px}.card b{display:block;font-size:20px;margin-top:4px}.muted{color:#94a3b8;font-size:13px}
table{width:100%;border-collapse:collapse;background:#1e293b;border-radius:10px;overflow:hidden;font-size:13px}
th,td{padding:8px 10px;border-bottom:1px solid #334155;text-align:left;vertical-align:top}th{background:#273449;color:#cbd5e1}
code{font-family:Consolas,monospace;font-size:12px;word-break:break-all}
.st{padding:2px 8px;border-radius:99px;font-size:12px;white-space:nowrap}.paid{background:#14532d}.pending{background:#334155}.underpaid,.error{background:#7f1d1d}
form.inline{display:inline}input,select,button{padding:8px 10px;border-radius:8px;border:1px solid #334155;background:#0f172a;color:#e2e8f0;font-size:14px}
button{background:#7c3aed;border:0;color:#fff;cursor:pointer}.box{background:#1e293b;border-radius:10px;padding:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;align-items:end}label{font-size:13px;color:#94a3b8;display:block}
label input,label select{width:100%;margin-top:4px}.flash{background:#1e3a8a;padding:10px 14px;border-radius:8px;margin-top:14px}
.key{background:#052e16;border:1px solid #166534;padding:14px;border-radius:10px;margin-top:14px}
</style></head><body>
<div class="top"><div><h1>Quản trị bản quyền</h1><div class="muted">Voice Studio - Mr.Huỳnh · máy chủ <?= vs2_h(VS2_VERSION) ?></div></div>
<div><form class="inline" method="post"><input type="hidden" name="csrf" value="<?= vs2_csrf() ?>"><input type="hidden" name="action" value="telegram"><button type="submit" style="background:#0e7490">Thử Telegram</button></form>
<a href="?logout=1" style="margin-left:12px">Đăng xuất</a></div></div>

<?php if ($flash): ?><div class="flash"><?= vs2_h($flash) ?></div><?php endif ?>
<?php if ($issuedKey): ?><div class="key"><b>Đã cấp key</b> — <?= vs2_h(VS2_PLAN_LABELS[$issuedKey['plan']] ?? $issuedKey['plan']) ?>,
mã máy <code><?= vs2_h($issuedKey['machine']) ?></code>, hạn dùng: <?= $issuedKey['expires_on'] ? 'đến ' . vs2_h($issuedKey['expires_on']) : 'vĩnh viễn' ?>
<div style="margin-top:8px"><code id="k"><?= vs2_h($issuedKey['key']) ?></code></div>
<button type="button" style="margin-top:8px" onclick="navigator.clipboard.writeText(document.getElementById('k').textContent);this.textContent='Đã sao chép'">Sao chép key</button></div><?php endif ?>

<div class="cards">
<div class="card"><span class="muted">Hôm nay (QR)</span><b><?= vs2_money((int) $today['total']) ?></b><span class="muted"><?= (int) $today['n'] ?> đơn</span></div>
<div class="card"><span class="muted">Tháng này (QR)</span><b><?= vs2_money((int) $month['total']) ?></b><span class="muted"><?= (int) $month['n'] ?> đơn</span></div>
<div class="card"><span class="muted">Tổng (QR)</span><b><?= vs2_money((int) $all['total']) ?></b><span class="muted"><?= (int) $all['n'] ?> đơn</span></div>
<div class="card"><span class="muted">Đơn cần xem (24 giờ)</span><b><?= $pending ?></b><span class="muted">chờ / thiếu tiền / lỗi</span></div>
</div>

<h2>Phát hành &amp; cập nhật</h2>
<div class="box">
<?php if ($latest): ?>
<div>Bản mới nhất trong <code>downloads/</code>: <b><?= vs2_h($latest['version']) ?></b> — <code><?= vs2_h($latest['file']) ?></code>
<?= $latest['size'] ? '(' . round($latest['size'] / 1048576) . ' MB)' : '<span style="color:#fca5a5">(chưa thấy file .exe!)</span>' ?>
<span class="muted"> · <?= vs2_h(substr((string) $latest['date'], 0, 10)) ?></span></div>
<div class="muted" style="margin-top:4px">App của khách tự thấy bản này, tự tải và hỏi khởi động lại để cài. Trang tải cho khách: <a href="downloads/" target="_blank">active.mrhuynh.net/downloads/</a></div>
<?php else: ?>
<div style="color:#fca5a5">Chưa có bản nào trong <code>active.mrhuynh.net/downloads/</code>. Upload 3 file do script build tạo ra (xem hướng dẫn).</div>
<?php endif ?>
<form method="post" style="margin-top:14px"><input type="hidden" name="csrf" value="<?= vs2_csrf() ?>"><input type="hidden" name="action" value="update_policy">
<div class="grid">
<label>Bắt buộc cập nhật: phiên bản tối thiểu (để trống = không bắt buộc)<input name="min_version" value="<?= vs2_h($policy['min_version']) ?>" placeholder="<?= vs2_h($latest['version'] ?? '1.0.1') ?>"></label>
<label style="grid-column:span 2">Thông báo cho khách khi bắt buộc cập nhật<input name="message" value="<?= vs2_h($policy['message']) ?>" placeholder="Bản mới sửa lỗi quan trọng, vui lòng cập nhật để tiếp tục sử dụng."></label>
<div><button>Lưu</button></div></div>
<div class="muted" style="margin-top:6px">Đang bắt buộc: <?= $policy['min_version'] !== '' ? '<b>' . vs2_h($policy['min_version']) . '</b> trở lên' : 'không' ?>. Chỉ bật sau khi đã upload bản mới vào downloads/.</div>
</form></div>

<h2>Cấp key tay</h2>
<form class="box" method="post"><input type="hidden" name="csrf" value="<?= vs2_csrf() ?>"><input type="hidden" name="action" value="issue">
<div class="grid">
<label>Mã máy<input name="machine_code" placeholder="VSMH-XXXX-XXXX-XXXX-XXXX" required></label>
<label>Gói<select name="plan"><?php foreach (['month1', 'month3', 'year1', 'permanent'] as $p): ?><option value="<?= $p ?>"><?= vs2_h(VS2_PLAN_LABELS[$p]) ?></option><?php endforeach ?></select></label>
<label>Tính từ ngày (để trống = tự cộng dồn)<input type="date" name="start"></label>
<label>Số tiền đã nhận (ghi sổ)<input type="number" name="amount" min="0" step="1000" value="0"></label>
<label>Ghi chú (tên khách…)<input name="note"></label>
<div><button>Tạo key</button></div></div></form>

<h2>Đơn hàng <?= $search !== '' ? '— tìm: ' . vs2_h($search) : '' ?></h2>
<form method="get" style="margin-bottom:10px"><input name="q" value="<?= vs2_h($search) ?>" placeholder="Mã đơn, mã máy hoặc ghi chú" style="width:320px"> <button>Tìm</button> <?php if ($search !== ''): ?><a href="voice_studio2_admin.php">Xóa lọc</a><?php endif ?></form>
<table><tr><th>Thời gian</th><th>Mã đơn</th><th>Gói</th><th>Số tiền</th><th>Trạng thái</th><th>Mã máy</th><th>Hạn dùng</th><th>Key / thao tác</th></tr>
<?php foreach ($orders as $o): ?><tr>
<td><?= vs2_h($fmtTime((int) $o['created_at'])) ?><div class="muted"><?= $o['source'] === 'manual' ? 'cấp tay' : 'QR' ?></div></td>
<td><code><?= vs2_h($o['code']) ?></code><?php if ($o['note']): ?><div class="muted"><?= vs2_h($o['note']) ?></div><?php endif ?></td>
<td><?= vs2_h(VS2_PLAN_LABELS[$o['plan']] ?? $o['plan']) ?></td>
<td><?= vs2_money((int) $o['amount']) ?><?php if ((int) $o['paid_amount'] && (int) $o['paid_amount'] !== (int) $o['amount']): ?><div class="muted">nhận <?= vs2_money((int) $o['paid_amount']) ?></div><?php endif ?></td>
<td><span class="st <?= vs2_h($o['status']) ?>"><?= vs2_h($statusLabels[$o['status']] ?? $o['status']) ?></span></td>
<td><code><?= vs2_h($o['machine_code']) ?></code></td>
<td><?= $o['status'] === 'paid' ? ($o['expires_on'] ? vs2_h($o['expires_on']) : 'Vĩnh viễn') : '' ?></td>
<td><?php if ($o['license_key']): ?><code style="cursor:pointer" title="Bấm để sao chép" onclick="navigator.clipboard.writeText(this.textContent)"><?= vs2_h($o['license_key']) ?></code>
<?php elseif ($o['status'] !== 'pending' || (int) $o['paid_amount'] > 0): ?><form class="inline" method="post" onsubmit="return confirm('Cấp key cho đơn này dù chưa đủ tiền?')"><input type="hidden" name="csrf" value="<?= vs2_csrf() ?>"><input type="hidden" name="action" value="fulfil"><input type="hidden" name="id" value="<?= (int) $o['id'] ?>"><button>Cấp key cho đơn này</button></form>
<?php else: ?><form class="inline" method="post" onsubmit="return confirm('Xác nhận đã nhận tiền và cấp key cho đơn này?')"><input type="hidden" name="csrf" value="<?= vs2_csrf() ?>"><input type="hidden" name="action" value="fulfil"><input type="hidden" name="id" value="<?= (int) $o['id'] ?>"><button style="background:#334155">Đã nhận tiền → cấp key</button></form><?php endif ?></td>
</tr><?php endforeach ?>
<?php if (!$orders): ?><tr><td colspan="8" class="muted">Chưa có đơn nào.</td></tr><?php endif ?></table>

<h2>Giao dịch cần xem</h2>
<table><tr><th>Thời gian</th><th>Số tiền</th><th>Nội dung</th><th>Mã đơn</th><th>Vấn đề</th><th>Mã GD SePay</th></tr>
<?php $problemLabels = ['unmatched' => 'Không khớp đơn nào', 'underpaid' => 'Thiếu tiền', 'duplicate' => 'Chuyển thêm cho đơn đã trả', 'error' => 'Lỗi cấp key'];
foreach ($problems as $t): ?><tr><td><?= vs2_h($fmtTime((int) $t['received_at'])) ?></td><td><?= vs2_money((int) $t['amount']) ?></td>
<td><?= vs2_h($t['content']) ?></td><td><code><?= vs2_h($t['order_code']) ?></code></td><td><?= vs2_h($problemLabels[$t['result']] ?? $t['result']) ?></td><td><?= (int) $t['sepay_id'] ?></td></tr><?php endforeach ?>
<?php if (!$problems): ?><tr><td colspan="6" class="muted">Không có giao dịch lỗi.</td></tr><?php endif ?></table>
</body></html>
