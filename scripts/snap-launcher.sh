#!/bin/bash
# Detect display server and launch Electron with the right platform flag.
# Wayland inside a strict snap often fails because the compositor socket
# is not accessible, so fall back to X11 when Wayland is unavailable.

PLATFORM="x11"

if [ -n "$WAYLAND_DISPLAY" ] && [ -e "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ]; then
  PLATFORM="wayland"
fi

exec "$SNAP/app/node_modules/electron/dist/electron" \
  --no-sandbox \
  --ozone-platform="$PLATFORM" \
  "$SNAP/app" "$@"
