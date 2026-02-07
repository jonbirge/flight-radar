<?php
// cred.php - Server-side OAuth2 token proxy for OpenSky Network
// Reads credentials from cred.json, fetches/caches a token, returns it as JSON.

header('Content-Type: application/json');

$TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
$CRED_FILE = __DIR__ . '/cred.json';
$CACHE_FILE = sys_get_temp_dir() . '/opensky_token_cache.json';

// Load credentials
if (!file_exists($CRED_FILE)) {
    http_response_code(404);
    echo json_encode(['error' => 'No credentials configured']);
    exit;
}

$creds = json_decode(file_get_contents($CRED_FILE), true);
if (!$creds || empty($creds['openskyClientId']) || empty($creds['openskyClientSecret'])) {
    http_response_code(500);
    echo json_encode(['error' => 'Invalid credentials file']);
    exit;
}

// Check cache
if (file_exists($CACHE_FILE)) {
    $cache = json_decode(file_get_contents($CACHE_FILE), true);
    if ($cache && isset($cache['access_token'], $cache['expires_at'])) {
        // Return cached token if still valid (60s buffer)
        if ($cache['expires_at'] > time() + 60) {
            echo json_encode([
                'access_token' => $cache['access_token'],
                'expires_in'   => $cache['expires_at'] - time(),
            ]);
            exit;
        }
    }
}

// Fetch new token
$postData = http_build_query([
    'grant_type'    => 'client_credentials',
    'client_id'     => $creds['openskyClientId'],
    'client_secret' => $creds['openskyClientSecret'],
]);

$ch = curl_init($TOKEN_URL);
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => $postData,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 10,
    CURLOPT_HTTPHEADER     => ['Content-Type: application/x-www-form-urlencoded'],
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$error    = curl_error($ch);

if ($response === false || $httpCode !== 200) {
    http_response_code(502);
    echo json_encode(['error' => 'Token request failed', 'detail' => $error ?: "HTTP $httpCode"]);
    exit;
}

$data = json_decode($response, true);
if (!$data || empty($data['access_token'])) {
    http_response_code(502);
    echo json_encode(['error' => 'Invalid token response']);
    exit;
}

// Cache token
$expiresIn = $data['expires_in'] ?? 1500;
file_put_contents($CACHE_FILE, json_encode([
    'access_token' => $data['access_token'],
    'expires_at'   => time() + $expiresIn,
]));

echo json_encode([
    'access_token' => $data['access_token'],
    'expires_in'   => $expiresIn,
]);
