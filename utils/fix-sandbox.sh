#!/bin/bash
SANDBOX="$(dirname "$0")/node_modules/electron/dist/chrome-sandbox"
sudo chown root:root "$SANDBOX"
sudo chmod 4755 "$SANDBOX"
echo "Sandbox permissions fixed."
