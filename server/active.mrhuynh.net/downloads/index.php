<?php
/*
 * Trang tải Voice Studio - Mr.Huỳnh: https://active.mrhuynh.net/downloads/
 * Tự hiện bản mới nhất từ file electron-stable-win32-x64.yml trong thư mục này.
 */
declare(strict_types=1);
require dirname(__DIR__) . '/voice_studio2_bootstrap.php';
$latest = vs2_latest_release(__DIR__);
header('Cache-Control: no-cache');
?><!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tải Voice Studio - Mr.Huỳnh</title>
<style>body{font-family:system-ui,Segoe UI,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;display:grid;place-items:center;min-height:100vh;padding:20px;box-sizing:border-box}
.card{background:#1e293b;border-radius:16px;padding:32px;max-width:520px;width:100%;text-align:center}
h1{margin:0 0 6px;font-size:24px}.muted{color:#94a3b8}.btn{display:inline-block;margin-top:20px;background:#7c3aed;color:#fff;text-decoration:none;padding:14px 28px;border-radius:12px;font-size:17px;font-weight:600}
pre{white-space:pre-wrap;text-align:left;background:#0f172a;border-radius:10px;padding:14px;font-family:inherit;color:#cbd5e1}
.links a{color:#a78bfa;margin:0 8px}</style></head><body><div class="card">
<h1>Voice Studio - Mr.Huỳnh</h1><div class="muted">Tạo giọng nói AI chuyên nghiệp — Windows 10/11 (64-bit)</div>
<?php if ($latest && $latest['size']): ?>
<a class="btn" href="<?= vs2_h(rawurlencode($latest['file'])) ?>">Tải bản <?= vs2_h($latest['version']) ?> (<?= round($latest['size'] / 1048576) ?> MB)</a>
<div class="muted" style="margin-top:10px">Phát hành ngày <?= vs2_h(substr((string) $latest['date'], 0, 10)) ?> · Cài đè lên bản cũ, giữ nguyên bản quyền và dữ liệu.</div>
<?php if ($latest['notes']): ?><h3 style="margin-top:24px">Có gì mới</h3><pre><?= vs2_h($latest['notes']) ?></pre><?php endif ?>
<?php else: ?><p class="muted" style="margin-top:20px">Bản cài đang được cập nhật, vui lòng quay lại sau.</p><?php endif ?>
<p class="muted" style="margin-top:24px">Windows có thể cảnh báo SmartScreen: bấm <b>More info → Run anyway</b>.</p>
<div class="links"><a href="https://zalo.me/g/lzcnxj126">Nhóm Zalo</a><a href="https://facebook.com/mr.huynhxuyenson">Facebook</a><a href="https://mrhuynh.net">Website</a></div>
</div></body></html>
