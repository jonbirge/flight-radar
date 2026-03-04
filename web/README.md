# Flight Radar — Web Version

Standalone browser version of Flight Radar. No Electron required — runs entirely with `fetch()` and `localStorage`.

## Setup

1. From the project root, download CesiumJS (first time only):

   ```bash
   npm run setup
   ```

2. Serve from the project root so that `vendor/cesium/` is accessible:

   ```bash
   npx serve .
   # or: python -m http.server 8080
   ```

3. Open `http://localhost:8080/web/`

## Server Credentials (`creds.json`)

FlightAware API credentials are stored in `web/creds.json`. Copy the example to get started:

```bash
cp web/creds.json.example web/creds.json
```

Then edit `web/creds.json` with your credentials:

```json
{
  "flightaware_api_key": "your_flightaware_aeroapi_key"
}
```

All fields are optional — include only the APIs you have credentials for.

**Important:** `creds.json` is git-ignored. If your web server is public, make sure it is not cached by CDNs or indexed by search engines.

### airplanes.live

Real-time ADS-B flight data is provided by airplanes.live. No authentication
is required — the API is free and open. Rate-limited to 1 request per second.

### FlightAware AeroAPI

Flight plan search requires a FlightAware AeroAPI key. The `flightaware-proxy.php` reads the `flightaware_api_key` from `creds.json`.

To get an API key, sign up at https://www.flightaware.com/aeroapi/.
