<?php
// awc-proxy.php - Caching proxy for FAA AWC (Aviation Weather Center) API
// Solves CORS restrictions when fetching weather data from the browser.
// Caches JSON responses for 10 minutes and image responses for 15 minutes.

ini_set('display_errors', '0');

$AWC_BASE = 'https://aviationweather.gov/api/data';
$CACHE_DIR = __DIR__ . '/cache/awc';

// Allowed AWC endpoints (whitelist for security)
$ALLOWED_ENDPOINTS = ['pirep', 'sigmet', 'gairmet', 'model'];

// Cache TTL in seconds per endpoint
$CACHE_TTL = [
    'pirep'   => 600,  // 10 minutes
    'sigmet'  => 600,  // 10 minutes
    'gairmet' => 600,  // 10 minutes
    'model'   => 900,  // 15 minutes
];

// ---------- Validate request ----------

$endpoint = $_GET['endpoint'] ?? '';
if (!in_array($endpoint, $ALLOWED_ENDPOINTS, true)) {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Invalid or missing endpoint parameter']);
    exit;
}

// ---------- Build upstream URL ----------

// Forward all query params except 'endpoint' and cache-busting '_t'
$params = $_GET;
unset($params['endpoint'], $params['_t']);
$query = http_build_query($params);
$upstreamUrl = "$AWC_BASE/$endpoint" . ($query ? "?$query" : '');

// ---------- Cache lookup ----------

if (!is_dir($CACHE_DIR)) {
    @mkdir($CACHE_DIR, 0755, true);
}

// Cache key: hash of full upstream URL
$cacheKey = md5($upstreamUrl);
$cacheMeta = "$CACHE_DIR/$cacheKey.meta";
$cacheData = "$CACHE_DIR/$cacheKey.data";
$ttl = $CACHE_TTL[$endpoint] ?? 600;

if (file_exists($cacheMeta) && file_exists($cacheData)) {
    $meta = json_decode(file_get_contents($cacheMeta), true);
    if ($meta && (time() - $meta['time']) < $ttl) {
        // Serve from cache
        header('Content-Type: ' . $meta['content_type']);
        header('X-Cache: HIT');
        header('X-Cache-Age: ' . (time() - $meta['time']));
        readfile($cacheData);
        exit;
    }
}

// ---------- Fetch from AWC ----------

$ch = curl_init($upstreamUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 30,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS      => 3,
    CURLOPT_USERAGENT      => 'FlightRadar-AWC-Proxy/1.0',
]);

$body = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE) ?: 'application/octet-stream';
$error = curl_error($ch);

if ($body === false || $httpCode !== 200) {
    http_response_code(502);
    header('Content-Type: application/json');
    echo json_encode([
        'error' => 'AWC request failed',
        'detail' => $error ?: "HTTP $httpCode",
    ]);
    exit;
}

// ---------- Write cache ----------

file_put_contents($cacheData, $body, LOCK_EX);
file_put_contents($cacheMeta, json_encode([
    'time'         => time(),
    'content_type' => $contentType,
    'url'          => $upstreamUrl,
]), LOCK_EX);

// ---------- Respond ----------

header('Content-Type: ' . $contentType);
header('X-Cache: MISS');
echo $body;
