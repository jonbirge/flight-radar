<?php
// flightaware-proxy.php - Server-side proxy for FlightAware AeroAPI
// Reads API key from creds.json (shared credentials file), proxies requests to FlightAware,
// and caches responses to reduce API usage.

ini_set('display_errors', '0');
header('Content-Type: application/json');

$AEROAPI_BASE = 'https://aeroapi.flightaware.com/aeroapi';
$CREDS_FILE = __DIR__ . '/creds.json';
$CACHE_DIR = __DIR__ . '/cache/flightaware';
$CACHE_TTL = 300; // 5 minutes

// ---------- Load API key ----------

if (!file_exists($CREDS_FILE)) {
    http_response_code(500);
    echo json_encode(['error' => 'Server credentials not configured']);
    exit;
}

$creds = json_decode(file_get_contents($CREDS_FILE), true);
$apiKey = $creds['flightaware_api_key'] ?? null;

if (empty($apiKey)) {
    http_response_code(500);
    echo json_encode(['error' => 'FlightAware API key not configured']);
    exit;
}

// ---------- Validate request ----------

$endpoint = $_GET['endpoint'] ?? '';
// Allowed endpoints (whitelist for security)
$ALLOWED_ENDPOINTS = ['flights', 'flights/search', 'flights/route', 'flights/track'];
if (!in_array($endpoint, $ALLOWED_ENDPOINTS, true)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid or missing endpoint parameter']);
    exit;
}

// ---------- Build upstream URL ----------

$params = $_GET;
unset($params['endpoint'], $params['_t']);

// For 'flights' endpoint, the flight ID is required as a path parameter
if ($endpoint === 'flights') {
    $flightId = $params['ident'] ?? '';
    unset($params['ident']);
    if (empty($flightId)) {
        http_response_code(400);
        echo json_encode(['error' => 'Missing ident parameter']);
        exit;
    }
    // Sanitize flight ID: alphanumeric only
    $flightId = preg_replace('/[^a-zA-Z0-9]/', '', $flightId);
    $query = http_build_query($params);
    $upstreamUrl = "$AEROAPI_BASE/flights/$flightId" . ($query ? "?$query" : '');
} else if ($endpoint === 'flights/route') {
    $faFlightId = $params['fa_flight_id'] ?? '';
    unset($params['fa_flight_id']);
    if (empty($faFlightId)) {
        http_response_code(400);
        echo json_encode(['error' => 'Missing fa_flight_id parameter']);
        exit;
    }
    $faFlightId = preg_replace('/[^a-zA-Z0-9\-_]/', '', $faFlightId);
    $query = http_build_query($params);
    $upstreamUrl = "$AEROAPI_BASE/flights/$faFlightId/route" . ($query ? "?$query" : '');
} else if ($endpoint === 'flights/track') {
    $faFlightId = $params['fa_flight_id'] ?? '';
    unset($params['fa_flight_id']);
    if (empty($faFlightId)) {
        http_response_code(400);
        echo json_encode(['error' => 'Missing fa_flight_id parameter']);
        exit;
    }
    // Sanitize: fa_flight_id contains alphanumeric, hyphens, underscores
    $faFlightId = preg_replace('/[^a-zA-Z0-9\-_]/', '', $faFlightId);
    $query = http_build_query($params);
    $upstreamUrl = "$AEROAPI_BASE/flights/$faFlightId/track" . ($query ? "?$query" : '');
} else if ($endpoint === 'flights/search') {
    // /flights/search requires a 'query' parameter (e.g. "{origin KBOS} {destination KLAX}")
    $searchQuery = $params['query'] ?? '';
    if (empty($searchQuery)) {
        http_response_code(400);
        echo json_encode(['error' => 'Missing query parameter']);
        exit;
    }
    $query = http_build_query($params);
    $upstreamUrl = "$AEROAPI_BASE/flights/search" . ($query ? "?$query" : '');
} else {
    $query = http_build_query($params);
    $upstreamUrl = "$AEROAPI_BASE/$endpoint" . ($query ? "?$query" : '');
}

// ---------- Cache lookup ----------

if (!is_dir($CACHE_DIR)) {
    @mkdir($CACHE_DIR, 0755, true);
}

$cacheKey = md5($upstreamUrl);
$cacheMeta = "$CACHE_DIR/$cacheKey.meta";
$cacheData = "$CACHE_DIR/$cacheKey.data";

if (file_exists($cacheMeta) && file_exists($cacheData)) {
    $meta = json_decode(file_get_contents($cacheMeta), true);
    if ($meta && (time() - $meta['time']) < $CACHE_TTL) {
        header('X-Cache: HIT');
        header('X-Cache-Age: ' . (time() - $meta['time']));
        readfile($cacheData);
        exit;
    }
}

// ---------- Fetch from FlightAware ----------

$ch = curl_init($upstreamUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 15,
    CURLOPT_HTTPHEADER     => [
        "x-apikey: $apiKey",
        'Accept: application/json',
    ],
    CURLOPT_USERAGENT      => 'FlightRadar-FA-Proxy/1.0',
]);

$body = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$error = curl_error($ch);
curl_close($ch);

if ($body === false || $httpCode !== 200) {
    http_response_code(502);
    echo json_encode([
        'error' => 'FlightAware request failed',
        'detail' => $error ?: "HTTP $httpCode",
    ]);
    exit;
}

// ---------- Write cache ----------

file_put_contents($cacheData, $body, LOCK_EX);
file_put_contents($cacheMeta, json_encode([
    'time' => time(),
    'url'  => $upstreamUrl,
]), LOCK_EX);

// ---------- Respond ----------

header('X-Cache: MISS');
echo $body;
