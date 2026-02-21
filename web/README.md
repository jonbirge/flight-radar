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

Both OpenSky and FlightAware API credentials are stored in a single `web/creds.json` file. Copy the example to get started:

```bash
cp web/creds.json.example web/creds.json
```

Then edit `web/creds.json` with your credentials:

```json
{
  "client_id": "your_opensky_client_id",
  "client_secret": "your_opensky_client_secret",
  "flightaware_api_key": "your_flightaware_aeroapi_key"
}
```

All fields are optional — include only the APIs you have credentials for.

**Important:** `creds.json` is git-ignored. If your web server is public, make sure it is not cached by CDNs or indexed by search engines.

### OpenSky Network

The web version supports three ways to authenticate with the OpenSky Network API, checked in this order:

1. **User-entered credentials (via Settings UI)** — Users can enter their own OAuth2 Client ID and Secret in the Settings panel. These are saved to `localStorage` and always take priority.
2. **Server-side `creds.json`** — If no user credentials are set, `cred.php` falls back to `client_id` and `client_secret` from `creds.json`.
3. **Anonymous access** — If no credentials are available, the app uses anonymous OpenSky API access with lower rate limits.

To get OAuth2 credentials, create a free account at https://opensky-network.org and generate client credentials from your account settings.

### FlightAware AeroAPI

Flight plan search requires a FlightAware AeroAPI key. The `flightaware-proxy.php` reads the `flightaware_api_key` from `creds.json`.

To get an API key, sign up at https://www.flightaware.com/aeroapi/.
