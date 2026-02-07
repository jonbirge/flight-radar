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

## OpenSky Credentials

The web version supports three ways to authenticate with the OpenSky Network API, checked in this order:

### 1. User-entered credentials (via Settings UI)

Users can enter their own OAuth2 Client ID and Secret in the Settings panel. These are saved to `localStorage` and always take priority.

### 2. Server-side `cred.json` (fallback for deployments)

If no user credentials are set, the app checks for a `cred.json` file in the `web/` directory alongside `index.html`:

```json
{
  "openskyClientId": "your_client_id",
  "openskyClientSecret": "your_client_secret"
}
```

This provides default credentials for all visitors without requiring them to configure their own. It is loaded automatically at startup.

**Important:** If your web server is public, make sure `cred.json` is not cached by CDNs or indexed by search engines. Consider restricting access via server config if needed.

### 3. Anonymous access (default)

If no credentials are available, the app falls back to anonymous OpenSky API access, which has lower rate limits.

To get OAuth2 credentials, create a free account at https://opensky-network.org and generate client credentials from your account settings.
