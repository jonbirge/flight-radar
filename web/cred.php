<?php
// cred.php - Server-side OAuth2 token proxy for OpenSky Network
// Reads credentials from creds.json, fetches/caches a token, returns it as JSON.

header('Content-Type: application/json');

$TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
$CRED_FILE = __DIR__ . '/creds.json';
// Load credentials: prefer POST body, fall back to creds.json
$input = json_decode(file_get_contents('php://input'), true);
$clientId     = !empty($input['client_id'])     ? $input['client_id']     : null;
$clientSecret = !empty($input['client_secret']) ? $input['client_secret'] : null;

if (!$clientId || !$clientSecret) {
    // Fall back to server-side creds.json
    if (file_exists($CRED_FILE)) {
        $creds = json_decode(file_get_contents($CRED_FILE), true);
        if ($creds) {
            $clientId     = $clientId     ?: ($creds['client_id']     ?? null);
            $clientSecret = $clientSecret ?: ($creds['client_secret'] ?? null);
        }
    }
}

if (empty($clientId) || empty($clientSecret)) {
    http_response_code(400);
    echo json_encode(['error' => 'No credentials provided or configured']);
    exit;
}

// Fetch token
$postData = http_build_query([
    'grant_type'    => 'client_credentials',
    'client_id'     => $clientId,
    'client_secret' => $clientSecret,
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

echo json_encode([
    'access_token' => $data['access_token'],
    'expires_in'   => $data['expires_in'] ?? 1500,
]);
