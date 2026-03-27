<?php
// faa-proxy.php - Caching proxy for FAA NASSTATUS airport delay data
// Solves CORS restrictions when fetching FAA delay XML from the browser.
// Caches the XML response for 15 minutes.

ini_set('display_errors', '0');

$FAA_URL = 'https://nasstatus.faa.gov/api/airport-status-information';
$CACHE_DIR = __DIR__ . '/cache/faa';
$CACHE_TTL = 900; // 15 minutes

// ---------- Cache lookup ----------

if (!is_dir($CACHE_DIR)) {
    @mkdir($CACHE_DIR, 0755, true);
}

$cacheKey = md5($FAA_URL);
$cacheMeta = "$CACHE_DIR/$cacheKey.meta";
$cacheData = "$CACHE_DIR/$cacheKey.data";

if (file_exists($cacheMeta) && file_exists($cacheData)) {
    $meta = json_decode(file_get_contents($cacheMeta), true);
    if ($meta && (time() - $meta['time']) < $CACHE_TTL) {
        header('Content-Type: application/xml');
        header('X-Cache: HIT');
        header('X-Cache-Age: ' . (time() - $meta['time']));
        header('Access-Control-Allow-Origin: *');
        readfile($cacheData);
        exit;
    }
}

// ---------- Fetch from FAA ----------

$ch = curl_init($FAA_URL);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 30,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS      => 3,
    CURLOPT_USERAGENT      => 'FlightRadar-FAA-Proxy/1.0',
]);

$body = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$error = curl_error($ch);
curl_close($ch);

if ($body === false || $httpCode !== 200) {
    http_response_code(502);
    header('Content-Type: application/json');
    echo json_encode([
        'error' => 'FAA request failed',
        'detail' => $error ?: "HTTP $httpCode",
    ]);
    exit;
}

// ---------- Write cache ----------

file_put_contents($cacheData, $body, LOCK_EX);
file_put_contents($cacheMeta, json_encode([
    'time' => time(),
    'url'  => $FAA_URL,
]), LOCK_EX);

// ---------- Respond ----------

header('Content-Type: application/xml');
header('X-Cache: MISS');
header('Access-Control-Allow-Origin: *');
echo $body;
