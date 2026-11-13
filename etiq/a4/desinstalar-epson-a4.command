#!/bin/bash
# Quita SOLO el puente A4. El de etiquetas DYMO no se toca.
set -u
PLIST="$HOME/Library/LaunchAgents/com.minecore.epson-a4.plist"
launchctl unload "$PLIST" >/dev/null 2>&1 || true
rm -f "$PLIST"
rm -rf "$HOME/.minecore-dymo/a4"
echo "Puente A4 quitado. Las etiquetas siguen igual."
