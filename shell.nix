{
  pkgs ,
  nodejs_24 ? pkgs.nodejs_24,
  go ? pkgs.go,
  wails ? pkgs.wails,
  jq ? pkgs.jq,
  pkg-config-unwrapped ? pkgs.pkg-config-unwrapped,
  gtk3 ? pkgs.gtk3,
  glib ? pkgs.glib,
  pango ? pkgs.pango,
  harfbuzz ? pkgs.harfbuzz,
  cairo ? pkgs.cairo,
  gdk-pixbuf ? pkgs.gdk-pixbuf,
  atk ? pkgs.atk,
  gcc ? pkgs.gcc,
  webkitgtk ? pkgs.webkitgtk_4_1,
  libsoup ? pkgs.libsoup_3,
}:

pkgs.mkShell {
  packages = [
    go
    wails
    jq
    pkg-config-unwrapped
    gcc
    nodejs_24
    pkgs.python3
    pkgs.makeWrapper
    pkgs.fontconfig
    pkgs.pkg-config
  ];

  buildInputs = [
    pkgs.gtk3.dev
    pkgs.pkg-config
    pkgs.pango.dev
    pkgs.glib.dev
    pkgs.harfbuzz.dev
    pkgs.atk.dev
    pkgs.cairo.dev
    pkgs.gdk-pixbuf.dev
    pkgs.zlib.dev
    pkgs.fontconfig.dev
    pkgs.webkitgtk_4_1.dev
    pkgs.libsoup_3.dev
  ];

  shellHook = ''
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[0;33m'
    BLUE='\033[0;34m'
    NC='\033[0m' # No Color (resets the text color)

    # Set explicit LDFLAGS for FontConfig linking
    export LDFLAGS="-L${pkgs.fontconfig.dev}/lib -lfontconfig"
    
    # Compose PKG_CONFIG_PATH from all relevant dev outputs
    export PKG_CONFIG_PATH=""
    for pkg in ${pkgs.gtk3.dev} ${pkgs.webkitgtk_4_1.dev} ${pkgs.pango.dev} ${pkgs.glib.dev} ${pkgs.harfbuzz.dev} ${pkgs.atk.dev} ${pkgs.cairo.dev} ${pkgs.gdk-pixbuf.dev} ${pkgs.libsoup_3.dev} ${pkgs.zlib.dev} ${pkgs.fontconfig.dev}; do
      if [ -d "$pkg/lib/pkgconfig" ]; then
        export PKG_CONFIG_PATH="$pkg/lib/pkgconfig:$PKG_CONFIG_PATH"
      fi
    done
    export PKG_CONFIG_PATH
    export LD_LIBRARY_PATH=""
    for pkg in ${pkgs.gtk3.dev} ${pkgs.webkitgtk_4_1.dev} ${pkgs.pango.dev} ${pkgs.glib.dev} ${pkgs.harfbuzz.dev} ${pkgs.atk.dev} ${pkgs.cairo.dev} ${pkgs.gdk-pixbuf.dev} ${pkgs.libsoup_3.dev} ${pkgs.zlib.dev} ${pkgs.fontconfig.dev}; do
      if [ -d "$pkg/lib" ]; then
        export LD_LIBRARY_PATH="$pkg/lib:$LD_LIBRARY_PATH"
      fi
    done
    export LD_LIBRARY_PATH
    
    # Set up a proper home directory for binding generation (similar to package.nix)
    export HOME=$(mktemp -d)
    
    # Wrap pkg-config to always use correct PKG_CONFIG_PATH
    makeWrapper $(command -v pkg-config) "$PWD/.pkg-config-wrapped" --set PKG_CONFIG_PATH "$PKG_CONFIG_PATH"
    export PATH="$PWD:$PATH"
    
    # Wrap wails to ensure PATH and PKG_CONFIG_PATH
    if command -v wails >/dev/null; then
      makeWrapper $(command -v wails) "$PWD/.wails-wrapped" --set PKG_CONFIG_PATH "$PKG_CONFIG_PATH" --set LD_LIBRARY_PATH "$LD_LIBRARY_PATH" --set PATH "$PATH" --set LDFLAGS "$LDFLAGS" --set HOME "$HOME"
      export PATH="$PWD:$PATH"
    fi
    
    alias wails=".wails-wrapped"
    alias pkg-config=".pkg-config-wrapped"
    
    # For building with Nix (similar to package.nix)
    build-nix() {
      echo "Building with Nix..."
      nix-build -E 'with import <nixpkgs> {}; callPackage ./package.nix {}'
    }
    
    # echo "Development shell configured with custom webkitgtk and libsoup"
    # echo "PKG_CONFIG_PATH set to: $PKG_CONFIG_PATH"
    # echo "LD_LIBRARY_PATH set to: $LD_LIBRARY_PATH"
    # echo "LDFLAGS set to: $LDFLAGS"
    # echo "HOME set to: $HOME"
    echo -e "Available commands:"
    echo -e "  Development build:$GREEN wails build -s -tags \"webkit2_41,soup_3\"$NC (uses buildGoModule vendoring)"
    echo -e "  Nix package build:$GREEN build-nix$NC (reproducible build)"
  '';
}
