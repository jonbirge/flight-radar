// Cloud settings sync via PocketBase + Google OAuth.
// Loaded after defaults.js/config.js, before settings.js.
// Does NOT depend on Cesium, radar-core, or any other radar module.

// ============================================================
// Constants
// ============================================================

const POCKETBASE_URL = 'https://nyc.birgefuller.com/pb/';

// PocketBase collection names
const USERS_COLLECTION = 'users';
const SETTINGS_COLLECTION = 'flight_settings';

// Keys that are never synced to cloud (UI state or runtime-only)
const CLOUD_EXCLUDE_KEYS = [
  'credentialsExpanded',
  'turbulenceLevel',  // runtime-only: computed from altitude, not a user setting
];

// API credential keys stored in cloud (source of truth when logged in)
const CREDENTIAL_KEYS = ['openskyClientId', 'openskyClientSecret', 'flightawareApiKey'];

// ============================================================
// State
// ============================================================

let pb = null;           // PocketBase client instance
let cloudUser = null;    // Current authenticated user info { name, email, avatarUrl }
let saveTimer = null;    // Debounce timer for cloud saves
let pendingSaveSettings = null; // Settings waiting for debounce to fire
let settingsRecordId = null; // Cached PocketBase record ID for upserts

// ============================================================
// Initialize
// ============================================================

/** Resolve the PocketBase constructor (IIFE global on web, dynamic import on Electron). */
async function _resolvePocketBase() {
  if (window.PocketBase) return window.PocketBase;
  try {
    const mod = await import('pocketbase');
    return mod.default || mod;
  } catch {
    return null;
  }
}

/** Create PocketBase client and restore any saved auth session. */
async function initCloud() {
  try {
    const PB = await _resolvePocketBase();
    if (!PB) {
      console.warn('[Cloud] PocketBase SDK not available');
      return;
    }
    pb = new PB(POCKETBASE_URL);
    pb.autoCancellation(false);

    // PocketBase SDK persists auth in localStorage automatically.
    // Check if we have a valid session.
    if (pb.authStore.isValid) {
      _setUserFromAuth();
      // Silently refresh the token
      try {
        await pb.collection(USERS_COLLECTION).authRefresh({ $autoCancel: false });
        _setUserFromAuth();
        console.log('[Cloud] Auth session restored for', cloudUser?.email);
      } catch (err) {
        console.warn('[Cloud] Auth refresh failed, clearing session:', err.message);
        pb.authStore.clear();
        cloudUser = null;
      }
    }
  } catch (err) {
    console.warn('[Cloud] Init failed:', err.message);
  }
}

// ============================================================
// Auth
// ============================================================

/** Trigger Google OAuth login via PocketBase. Returns user info or throws. */
async function cloudLogin() {
  if (!pb) throw new Error('Cloud not initialized — PocketBase SDK failed to load');

  // Verify the Google OAuth provider is configured on the PocketBase server
  try {
    const methods = await pb.collection(USERS_COLLECTION).listAuthMethods({ $autoCancel: false });
    const providers = methods?.oauth2?.providers || methods?.authProviders || [];
    const hasGoogle = providers.some(p => p.name === 'google');
    if (!hasGoogle) {
      throw new Error('Google OAuth is not configured on the PocketBase server. Enable it in the PocketBase admin dashboard.');
    }
  } catch (err) {
    if (err.message?.includes('Google OAuth')) throw err;
    throw new Error('Cannot reach PocketBase server: ' + err.message);
  }

  const authData = await pb.collection(USERS_COLLECTION).authWithOAuth2({
    provider: 'google',
    urlCallback: (url) => {
      // Open a centered popup window for the OAuth flow.
      // In Electron, this goes through setWindowOpenHandler which must allow it.
      // In browsers, this opens a standard popup.
      const w = 600, h = 700;
      const left = Math.round((screen.width - w) / 2);
      const top = Math.round((screen.height - h) / 2);
      window.open(url, 'pb_oauth', `popup=true,width=${w},height=${h},left=${left},top=${top}`);
    },
  });
  _setUserFromAuth();
  console.log('[Cloud] Logged in as', cloudUser?.email);
  return cloudUser;
}

/** Log out and clear auth state. */
async function cloudLogout() {
  if (pb) {
    pb.authStore.clear();
  }
  cloudUser = null;
  settingsRecordId = null;
  console.log('[Cloud] Logged out');
}

/** Check if user is authenticated. Lazily rehydrates cloudUser from authStore
 *  so a login in a sibling Electron window (shared localStorage) is picked up. */
function isCloudLoggedIn() {
  if (pb == null) return false;
  if (!pb.authStore.isValid) {
    if (cloudUser) cloudUser = null;
    return false;
  }
  if (!cloudUser) _setUserFromAuth();
  return cloudUser != null;
}

/** Get current user info or null. */
function getCloudUser() {
  if (pb != null && pb.authStore.isValid && !cloudUser) _setUserFromAuth();
  return cloudUser;
}

// ============================================================
// Settings CRUD
// ============================================================

/** Fetch the user's settings from PocketBase. Returns settings object or null. */
async function cloudLoadSettings() {
  if (!pb || !pb.authStore.isValid) return null;
  try {
    const userId = pb.authStore.record?.id;
    if (!userId) return null;
    const record = await pb.collection(SETTINGS_COLLECTION).getFirstListItem(`user="${userId}"`, { $autoCancel: false });
    settingsRecordId = record.id;
    return record.settings || null;
  } catch (err) {
    // 404 means no settings record yet — that's fine
    if (err.status === 404) return null;
    _logPbError(`Load settings failed [${SETTINGS_COLLECTION}.getFirstListItem]`, err);
    return null;
  }
}

/** Save settings to PocketBase (debounced 500ms). Strips sensitive keys. */
function cloudSaveSettings(settings) {
  if (!isCloudLoggedIn()) {
    console.log('[Cloud] Save skipped — not logged in');
    return Promise.resolve();
  }
  pendingSaveSettings = settings;
  if (saveTimer) clearTimeout(saveTimer);
  console.log('[Cloud] Save queued (debounce 500ms)');
  return new Promise((resolve) => {
    saveTimer = setTimeout(async () => {
      const toSave = pendingSaveSettings;
      pendingSaveSettings = null;
      saveTimer = null;
      try {
        await _doCloudSave(toSave);
      } catch (err) {
        _logPbError(`Save settings failed [${SETTINGS_COLLECTION}]`, err);
      }
      resolve();
    }, 500);
  });
}

/** Flush any pending debounced cloud save immediately. Used when a window is
 *  about to close and we can't wait for the 500ms debounce to fire. */
async function flushCloudSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!pendingSaveSettings) return;
  const toSave = pendingSaveSettings;
  pendingSaveSettings = null;
  if (!isCloudLoggedIn()) return;
  try {
    await _doCloudSave(toSave);
    console.log('[Cloud] Pending save flushed');
  } catch (err) {
    _logPbError(`Flush save failed [${SETTINGS_COLLECTION}]`, err);
  }
}

/** Immediate cloud save (used internally after debounce). */
async function _doCloudSave(settings) {
  // Only save keys that exist in DEFAULT_SETTINGS, minus excluded keys
  const sanitized = {};
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (!CLOUD_EXCLUDE_KEYS.includes(k) && settings[k] !== undefined) {
      sanitized[k] = settings[k];
    }
  }

  const userId = pb.authStore.record?.id;
  if (!userId) return;

  const payload = { user: userId, settings: sanitized };
  const coll = pb.collection(SETTINGS_COLLECTION);

  if (settingsRecordId) {
    try {
      await coll.update(settingsRecordId, payload, { $autoCancel: false });
      console.log(`[Cloud] Settings saved [${SETTINGS_COLLECTION}.update ${settingsRecordId}]`);
      return;
    } catch (err) {
      if (err.status !== 404) {
        err._op = `${SETTINGS_COLLECTION}.update(${settingsRecordId})`;
        throw err;
      }
      settingsRecordId = null;
    }
  }

  let record;
  try {
    record = await coll.getFirstListItem(`user="${userId}"`, { $autoCancel: false });
  } catch (err) {
    if (err.status !== 404) {
      err._op = `${SETTINGS_COLLECTION}.getFirstListItem(user="${userId}")`;
      throw err;
    }
    // No record yet → create
    try {
      record = await coll.create(payload, { $autoCancel: false });
      settingsRecordId = record.id;
      console.log(`[Cloud] Settings saved [${SETTINGS_COLLECTION}.create ${settingsRecordId}]`);
      return;
    } catch (createErr) {
      createErr._op = `${SETTINGS_COLLECTION}.create`;
      throw createErr;
    }
  }

  settingsRecordId = record.id;
  try {
    await coll.update(settingsRecordId, payload, { $autoCancel: false });
    console.log(`[Cloud] Settings saved [${SETTINGS_COLLECTION}.update ${settingsRecordId} (post-find)]`);
  } catch (err) {
    err._op = `${SETTINGS_COLLECTION}.update(${settingsRecordId})`;
    throw err;
  }
}

// ============================================================
// Internal helpers
// ============================================================

/** Verbose PocketBase error logger — surfaces status, URL, server response,
 *  and field-level validation errors so server rule/hook failures are visible.
 *  ClientResponseError shape: { url, status, response: {code, message, data: {field: {code, message}}}, isAbort, originalError }
 */
function _logPbError(label, err) {
  const status = err?.status ?? '?';
  const url = err?.url || '';
  const op = err?._op || '';
  const response = err?.response || {};
  const serverMsg = response?.message || '';
  const fieldErrors = response?.data || {};
  const authRecord = pb?.authStore?.record;
  const authCtx = authRecord
    ? { id: authRecord.id, collectionName: authRecord.collectionName, collectionId: authRecord.collectionId }
    : null;

  console.warn(`[Cloud] ${label}${op ? ' @ ' + op : ''}`);
  console.warn('  message :', err?.message || String(err));
  console.warn('  status  :', status);
  console.warn('  url     :', url);
  if (serverMsg) console.warn('  server  :', serverMsg);
  if (Object.keys(fieldErrors).length) console.warn('  fields  :', fieldErrors);
  console.warn('  auth    :', authCtx);
  if (err?.originalError) console.warn('  cause   :', err.originalError);
}

function _setUserFromAuth() {
  const record = pb.authStore.record;
  if (!record) {
    cloudUser = null;
    return;
  }
  cloudUser = {
    id: record.id,
    name: record.name || '',
    email: record.email || '',
    avatarUrl: record.avatar
      ? `${POCKETBASE_URL}api/files/${record.collectionId}/${record.id}/${record.avatar}`
      : '',
  };
}

// ============================================================
// Credential helpers (Electron: PocketBase is source of truth)
// ============================================================

/** Load only credential fields from PocketBase. Returns object or null. */
async function cloudLoadCredentials() {
  const settings = await cloudLoadSettings();
  if (!settings) return null;
  const creds = {};
  let hasAny = false;
  for (const k of CREDENTIAL_KEYS) {
    if (settings[k]) {
      creds[k] = settings[k];
      hasAny = true;
    }
  }
  return hasAny ? creds : null;
}

/** Save only credential fields to PocketBase (merges with existing cloud settings). */
async function cloudSaveCredentials(creds) {
  if (!pb || !pb.authStore.isValid) return;
  // Load existing cloud settings, merge credentials in, and save
  const existing = await cloudLoadSettings() || {};
  for (const k of CREDENTIAL_KEYS) {
    if (creds[k] !== undefined) existing[k] = creds[k];
  }
  await _doCloudSave(existing);
  console.log('[Cloud] Credentials saved to PocketBase');
}

// ============================================================
// Unified settings save (cloud-first when logged in)
// ============================================================

/**
 * Save settings everywhere needed:
 * - If cloud-logged-in: save to PocketBase (source of truth) + local file (main process needs credentials for API calls)
 * - If not logged in: save to local file only
 */
async function saveSettingsUnified(settings) {
  // Always save locally — main process reads credentials from the local file
  if (window.flightAPI?.saveSettings) {
    await window.flightAPI.saveSettings(settings);
  } else if (window.settingsAPI?.updateSettings) {
    await window.settingsAPI.updateSettings(settings);
  }
  // Save to cloud if logged in
  if (isCloudLoggedIn()) {
    cloudSaveSettings(settings);
    // Also persist credentials separately for backward compat
    const creds = {};
    for (const k of CREDENTIAL_KEYS) {
      if (settings[k] !== undefined) creds[k] = settings[k];
    }
    if (Object.values(creds).some(v => v)) cloudSaveCredentials(creds);
  }
}

/**
 * Load settings from the appropriate source:
 * - If cloud-logged-in: load from PocketBase only (cloud is source of truth)
 * - If not logged in: load from local file
 * Falls back to local if cloud load fails.
 */
async function loadSettingsUnified() {
  const localSettings = window.flightAPI
    ? await window.flightAPI.getSettings()
    : (window.settingsAPI ? await window.settingsAPI.getSettings() : { ...DEFAULT_SETTINGS });

  if (!isCloudLoggedIn()) return localSettings;

  try {
    const cloudSettings = await cloudLoadSettings();
    if (cloudSettings) {
      // Cloud is sole source of truth — use cloud settings with defaults as base
      return { ...DEFAULT_SETTINGS, ...cloudSettings };
    }
  } catch (err) {
    console.warn('[Cloud] Failed to load cloud settings, falling back to local:', err.message);
  }
  return localSettings;
}

// ============================================================
// Window exports
// ============================================================

window.POCKETBASE_URL = POCKETBASE_URL;
window.initCloud = initCloud;
window.cloudLogin = cloudLogin;
window.cloudLogout = cloudLogout;
window.isCloudLoggedIn = isCloudLoggedIn;
window.getCloudUser = getCloudUser;
window.cloudLoadSettings = cloudLoadSettings;
window.cloudSaveSettings = cloudSaveSettings;
window.flushCloudSave = flushCloudSave;
window.cloudLoadCredentials = cloudLoadCredentials;
window.cloudSaveCredentials = cloudSaveCredentials;
window.CREDENTIAL_KEYS = CREDENTIAL_KEYS;
window.saveSettingsUnified = saveSettingsUnified;
window.loadSettingsUnified = loadSettingsUnified;
