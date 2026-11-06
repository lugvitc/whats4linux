#!/bin/sh
# Install a locally built Whats4Linux for the current user: binaries,
# desktop entry and icon. Run ./scripts/build.sh first.
#
#   ./scripts/install.sh              install
#   ./scripts/install.sh --uninstall  remove everything installed here
#
# Override locations with BIN_DIR or XDG_DATA_HOME.
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
BIN_DIR=${BIN_DIR:-"$HOME/.local/bin"}
DATA_DIR=${XDG_DATA_HOME:-"$HOME/.local/share"}
APPS_DIR="$DATA_DIR/applications"
ICON_DIR="$DATA_DIR/icons/hicolor/512x512/apps"

DESKTOP_FILE="$APPS_DIR/whats4linux.desktop"
ICON_FILE="$ICON_DIR/whats4linux.png"
ICON_SRC="$ROOT/packaging/AppImage/AppDir/usr/share/hicolor/256x256/apps/whats4linux.png"

refresh_caches() {
	if command -v update-desktop-database >/dev/null 2>&1; then
		update-desktop-database "$APPS_DIR" >/dev/null 2>&1 || true
	fi
	if command -v gtk-update-icon-cache >/dev/null 2>&1; then
		gtk-update-icon-cache -q -t "$DATA_DIR/icons/hicolor" >/dev/null 2>&1 || true
	fi
}

if [ "${1:-}" = "--uninstall" ]; then
	rm -f "$BIN_DIR/whats4linux" "$BIN_DIR/whats4linux_tray" "$DESKTOP_FILE" "$ICON_FILE"
	refresh_caches
	echo "Whats4Linux uninstalled. Your account data in ~/.config/whats4linux was kept."
	exit 0
fi

for bin in whats4linux whats4linux_tray; do
	if [ ! -x "$ROOT/build/bin/$bin" ]; then
		echo "error: build/bin/$bin not found, run ./scripts/build.sh first" >&2
		exit 1
	fi
done

# The app starts the tray from its own directory, so keep them together.
install -Dm755 "$ROOT/build/bin/whats4linux" "$BIN_DIR/whats4linux"
install -Dm755 "$ROOT/build/bin/whats4linux_tray" "$BIN_DIR/whats4linux_tray"
install -Dm644 "$ICON_SRC" "$ICON_FILE"

# Absolute Exec path so the launcher works even if BIN_DIR is not on PATH.
mkdir -p "$APPS_DIR"
cat >"$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=Whats4Linux
Comment=Unofficial WhatsApp client for Linux
Exec=$BIN_DIR/whats4linux
Icon=whats4linux
Terminal=false
Categories=Network;InstantMessaging;Chat;
StartupWMClass=whats4linux
EOF

refresh_caches

echo "Installed Whats4Linux to $BIN_DIR"
echo "Desktop entry: $DESKTOP_FILE"
