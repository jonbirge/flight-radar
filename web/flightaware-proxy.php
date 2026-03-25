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
// Max pages to fetch for airport flights (~15 flights per category per page)
$FA_AIRPORT_FLIGHTS_PAGES = 2;

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
$ALLOWED_ENDPOINTS = ['flights', 'flights/search/advanced', 'flights/route', 'flights/track', 'airports/flights', 'airports/delays'];
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
} else if ($endpoint === 'airports/flights') {
    $airport = $params['airport'] ?? '';
    unset($params['airport']);
    if (empty($airport)) {
        http_response_code(400);
        echo json_encode(['error' => 'Missing airport parameter']);
        exit;
    }
    // Sanitize: airport codes are alphanumeric only
    $airport = preg_replace('/[^a-zA-Z0-9]/', '', $airport);

    // Check cache before paginating
    if (!is_dir($CACHE_DIR)) @mkdir($CACHE_DIR, 0755, true);
    $cacheKey = md5("$AEROAPI_BASE/airports/$airport/flights:paginated");
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

    // Paginate: fetch up to 3 pages and merge array fields
    $maxPages = $FA_AIRPORT_FLIGHTS_PAGES;
    $pageUrl = "$AEROAPI_BASE/airports/$airport/flights";
    $merged = [];

    for ($page = 0; $page < $maxPages; $page++) {
        $ch = curl_init($pageUrl);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 15,
            CURLOPT_HTTPHEADER     => [
                "x-apikey: $apiKey",
                'Accept: application/json',
            ],
            CURLOPT_USERAGENT      => 'FlightRadar-FA-Proxy/1.0',
        ]);
        $pageBody = curl_exec($ch);
        $pageHttpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $pageError = curl_error($ch);
        curl_close($ch);

        if ($pageBody === false || $pageHttpCode !== 200) {
            // If first page fails, return error; otherwise return what we have
            if ($page === 0) {
                http_response_code(502);
                echo json_encode([
                    'error' => 'FlightAware request failed',
                    'detail' => $pageError ?: "HTTP $pageHttpCode",
                ]);
                exit;
            }
            break;
        }

        $pageData = json_decode($pageBody, true);
        if (!$pageData) break;

        // Merge array fields across pages
        foreach ($pageData as $key => $value) {
            if (is_array($value) && $key !== 'links') {
                if (!isset($merged[$key])) $merged[$key] = [];
                $merged[$key] = array_merge($merged[$key], $value);
            }
        }

        // Follow cursor link if present
        if (!empty($pageData['links']['next'])) {
            $pageUrl = "$AEROAPI_BASE" . $pageData['links']['next'];
        } else {
            break;
        }
    }

    // Cache and return the merged result
    $body = json_encode($merged);
    file_put_contents($cacheData, $body, LOCK_EX);
    file_put_contents($cacheMeta, json_encode(['time' => time(), 'url' => "airports/$airport/flights"]), LOCK_EX);
    header('X-Cache: MISS');
    echo $body;
    exit;
} else if ($endpoint === 'airports/delays') {
    $airport = $params['airport'] ?? '';
    unset($params['airport']);
    if (empty($airport)) {
        http_response_code(400);
        echo json_encode(['error' => 'Missing airport parameter']);
        exit;
    }
    $airport = preg_replace('/[^a-zA-Z0-9]/', '', $airport);
    $query = http_build_query($params);
    $upstreamUrl = "$AEROAPI_BASE/airports/$airport/delays" . ($query ? "?$query" : '');
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
