// Cloud settings sync via PocketBase + Google OAuth.
// Loaded after defaults.js/config.js, before settings.js.
// Does NOT depend on Cesium, radar-core, or any other radar module.

// ============================================================
// Constants
// ============================================================

const POCKETBASE_URL = 'https://nyc.birgefuller.com/pb/';

// Keys that are never synced to cloud (UI state or runtime-only)
const CLOUD_EXCLUDE_KEYS = [
  'credentialsExpanded',
  'turbulenceLevel',  // runtime-only: computed from altitude, not a user setting
];

// ============================================================
// State
// ============================================================

let pb = null;           // PocketBase client instance
let cloudUser = null;    // Current authenticated user info { name, email, avatarUrl }
let saveTimer = null;    // Debounce timer for cloud saves
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
        await pb.collection('users').authRefresh({ $autoCancel: false });
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
    const methods = await pb.collection('users').listAuthMethods({ $autoCancel: false });
    const providers = methods?.oauth2?.providers || methods?.authProviders || [];
    const hasGoogle = providers.some(p => p.name === 'google');
    if (!hasGoogle) {
      throw new Error('Google OAuth is not configured on the PocketBase server. Enable it in the PocketBase admin dashboard.');
    }
  } catch (err) {
    if (err.message?.includes('Google OAuth')) throw err;
    throw new Error('Cannot reach PocketBase server: ' + err.message);
  }

  const authData = await pb.collection('users').authWithOAuth2({
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

/** Check if user is authenticated. */
function isCloudLoggedIn() {
  return pb != null && pb.authStore.isValid && cloudUser != null;
}

/** Get current user info or null. */
function getCloudUser() {
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
    const record = await pb.collection('user_settings').getFirstListItem(`user="${userId}"`, { $autoCancel: false });
    settingsRecordId = record.id;
    return record.settings || null;
  } catch (err) {
    // 404 means no settings record yet — that's fine
    if (err.status === 404) return null;
    console.warn('[Cloud] Load settings failed:', err.message);
    return null;
  }
}

/** Save settings to PocketBase (debounced 500ms). Strips sensitive keys. */
function cloudSaveSettings(settings) {
  if (!pb || !pb.authStore.isValid) {
    console.log('[Cloud] Save skipped — not logged in');
    return Promise.resolve();
  }
  if (saveTimer) clearTimeout(saveTimer);
  console.log('[Cloud] Save queued (debounce 500ms)');
  return new Promise((resolve) => {
    saveTimer = setTimeout(async () => {
      try {
        await _doCloudSave(settings);
      } catch (err) {
        console.warn('[Cloud] Save settings failed:', err.message);
      }
      resolve();
    }, 500);
  });
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

  if (settingsRecordId) {
    // Update existing record
    try {
      await pb.collection('user_settings').update(settingsRecordId, payload, { $autoCancel: false });
      console.log('[Cloud] Settings saved to PocketBase (update, record:', settingsRecordId + ')');
      return;
    } catch (err) {
      // Record may have been deleted; fall through to create
      if (err.status !== 404) throw err;
      settingsRecordId = null;
    }
  }

  // Try to find existing record first
  try {
    const record = await pb.collection('user_settings').getFirstListItem(`user="${userId}"`, { $autoCancel: false });
    settingsRecordId = record.id;
    await pb.collection('user_settings').update(settingsRecordId, payload, { $autoCancel: false });
    console.log('[Cloud] Settings saved to PocketBase (found + update, record:', settingsRecordId + ')');
  } catch (err) {
    if (err.status === 404) {
      // Create new record
      const record = await pb.collection('user_settings').create(payload, { $autoCancel: false });
      settingsRecordId = record.id;
      console.log('[Cloud] Settings saved to PocketBase (new record:', settingsRecordId + ')');
    } else {
      throw err;
    }
  }
}

// ============================================================
// Internal helpers
// ============================================================

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
