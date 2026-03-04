<?php
// vfrmap-proxy.php - Caching proxy for VFRMap.com tile server
// Solves CORS restrictions when fetching aviation chart tiles from the browser.
// Caches tile images in /tmp to avoid excessive requests to VFRMap.com.

ini_set('display_errors', '0');

$VFRMAP_BASE = 'https://vfrmap.com';
$CACHE_DIR = '/tmp/vfrmap-tiles';
$CACHE_TTL = 86400; // 24 hours — chart tiles rarely change within an FAA cycle

// Allowed chart types (whitelist for security)
$ALLOWED_CHARTS = ['vfrc', 'ifrlc', 'ehc'];

// ---------- Validate request ----------

$date = $_GET['date'] ?? '';
$chart = $_GET['chart'] ?? '';
$z = $_GET['z'] ?? '';
$y = $_GET['y'] ?? '';
$x = $_GET['x'] ?? '';

if (!preg_match('/^\d{8}$/', $date)) {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Invalid date parameter']);
    exit;
}

if (!in_array($chart, $ALLOWED_CHARTS, true)) {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Invalid chart type']);
    exit;
}

if (!preg_match('/^\d+$/', $z) || !preg_match('/^\d+$/', $y) || !preg_match('/^\d+$/', $x)) {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Invalid tile coordinates']);
    exit;
}

// ---------- Build upstream URL ----------

$upstreamUrl = "$VFRMAP_BASE/$date/tiles/$chart/$z/$y/$x.jpg";

// ---------- Cache lookup ----------

// Organize cache by chart type and zoom for easier management
$cacheSubDir = "$CACHE_DIR/$date/$chart/$z/$y";
$cacheFile = "$cacheSubDir/$x.jpg";

if (file_exists($cacheFile) && (time() - filemtime($cacheFile)) < $CACHE_TTL) {
    header('Content-Type: image/jpeg');
    header('Cache-Control: public, max-age=86400');
    header('X-Cache: HIT');
    header('X-Cache-Age: ' . (time() - filemtime($cacheFile)));
    readfile($cacheFile);
    exit;
}

// ---------- Fetch from VFRMap.com ----------

$ch = curl_init($upstreamUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 15,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS      => 3,
    CURLOPT_USERAGENT      => 'FlightRadar-VFRMap-Proxy/1.0',
]);

$body = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$error = curl_error($ch);
curl_close($ch);

if ($body === false || $httpCode !== 200) {
    http_response_code(502);
    header('Content-Type: application/json');
    echo json_encode([
        'error' => 'VFRMap request failed',
        'detail' => $error ?: "HTTP $httpCode",
    ]);
    exit;
}

// ---------- Write cache ----------

if (!is_dir($cacheSubDir)) {
    if (!@mkdir($cacheSubDir, 0755, true) && !is_dir($cacheSubDir)) {
        // Cache write failed — still serve the tile, just uncached
        header('Content-Type: image/jpeg');
        header('Cache-Control: public, max-age=86400');
        header('X-Cache: MISS');
        echo $body;
        exit;
    }
}
if (file_put_contents($cacheFile, $body, LOCK_EX) === false) {
    // Cache write failed — still serve the tile, just uncached
    header('Content-Type: image/jpeg');
    header('Cache-Control: public, max-age=86400');
    header('X-Cache: MISS');
    echo $body;
    exit;
}

// ---------- Respond ----------

header('Content-Type: image/jpeg');
header('Cache-Control: public, max-age=86400');
header('X-Cache: MISS');
echo $body;
