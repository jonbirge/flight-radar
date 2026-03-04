<?php
// cred.php - Deprecated: was used for OpenSky Network OAuth2 token proxy.
// airplanes.live requires no authentication, so this file is no longer needed.

header('Content-Type: application/json');
http_response_code(410);
echo json_encode(['error' => 'OpenSky credential proxy is no longer used. Flight data now comes from airplanes.live (no auth required).']);
