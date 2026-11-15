<?php
/*
 * Tìm thư mục active_private/voice_studio2 (nằm NGOÀI thư mục web) và nạp lõi.
 * Tìm lần lượt ở thư mục cha của thư mục web, rồi các cấp cao hơn.
 */
declare(strict_types=1);

(function (): void {
    $candidates = [];
    if ($env = getenv('VS2_PRIVATE_DIR')) {
        $candidates[] = rtrim($env, '/');
    }
    $dir = dirname(__DIR__);
    for ($i = 0; $i < 3; $i++) {
        $candidates[] = $dir . '/active_private/voice_studio2';
        $dir = dirname($dir);
    }
    $candidates[] = __DIR__ . '/active_private/voice_studio2';
    foreach ($candidates as $candidate) {
        if (is_file($candidate . '/lib.php')) {
            define('VS2_PRIVATE_DIR', $candidate);
            require_once $candidate . '/lib.php';
            return;
        }
    }
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Không tìm thấy thư mục active_private/voice_studio2 (xem hướng dẫn cài đặt).";
    exit;
})();
