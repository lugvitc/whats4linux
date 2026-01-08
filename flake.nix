{
  description = "A basic flake with custom webkitgtk and libsoup derivations";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  inputs.webkitgtkpkgs.url = "github:NixOS/nixpkgs?rev=e6f23dc08d3624daab7094b701aa3954923c6bbb";
  inputs.flake-utils.url = "github:numtide/flake-utils";

  outputs = { self, nixpkgs, webkitgtkpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config = {
            permittedInsecurePackages = [ "libsoup-2.74.3" ];
          };
        };

        # Create pinned pkgs instance
        pinnedPkgs = import webkitgtkpkgs {
          inherit system;
          config = {
            permittedInsecurePackages = [ "libsoup-2.74.3" ];
          };
        };

        # Overlay with recursive overrides
        overlays = [
          (final: prev: let
            # Override libsoup_2_4 first (must be recursive due to webkitgtk dep)
            libsoup_2_4 = pkgs.libsoup_2_4.overrideAttrs (old: {
              insecure = true;
              src = final.fetchurl {
                url = "https://download.gnome.org/sources/libsoup/2.74/libsoup-2.74.3.tar.xz";
                sha256 = "sha256-5Ld8Qc/EyMWgNfzcMgx7xs+3XvfFoDQVPfFBP6HZLxM=";
              };
            });

            /*
            # Custom webkitgtk_4_0 override using pinned version as base
            webkitgtk_4_0 = pinnedPkgs.webkitgtk_4_0.overrideAttrs (old: {
              outputs = [ "dev" "out" ];
              stdenv = final.clangStdenv;
              nativeBuildInputs = old.nativeBuildInputs ++ [ final.wayland-scanner ];
              buildInputs = with final; old.buildInputs ++ [
                fontconfig.dev
                freetype.dev
                libpng.dev
                libtiff.dev
                libjpeg.dev
                libwebp
                libxml2.dev
                libxslt.dev
                sqlite.dev
                libsecret.dev
                enchant2
                hyphen
                libmanette
                woff2
                openjpeg
                libavif
                pcre2.dev
                libwpe
                libwpe-fdo
                libxt.dev
                libcap.dev
                systemdLibs
                wayland-protocols
                icu74
                icu74.dev
                libxdmcp.dev
                libgcrypt.lib
                libgcrypt.dev
                gpgme.dev
                gpgmepp.dev
                harfbuzz.dev
                harfbuzzFull.dev
                libepoxy.dev
                libtasn1.dev
                libxkbcommon.dev
                libgbm
                lcms.dev
                gst_all_1.gst-plugins-base
                gst_all_1.gst-plugins-bad
                gst_all_1.gst-plugins-good
                gst_all_1.gst-plugins-ugly
                libsysprof-capture
                util-linux
                libsoup_2_4.dev  # Uses the recursive override above
                flite.dev
              ];
              cmakeFlags = [
                "-DENABLE_INTROSPECTION=ON"
                "-DPORT=GTK"
                "-DUSE_GTK=OFF"
                "-DUSE_GTK4=OFF"
                "-DUSE_SOUP2=ON"
                "-DUSE_SOUP3=OFF"
                "-DUSE_LIBSECRET=ON"
                "-DENABLE_BUBBLEWRAP_SANDBOX=OFF"
                "-DENABLE_EXPERIMENTAL_FEATURES=OFF"
                "-DENABLE_TRANSLATIONS=OFF"
                "-DCMAKE_C_FLAGS=-w"
                "-DCMAKE_CXX_FLAGS=-w"
                "-DCMAKE_CXX_STANDARD=17"
                "-DENABLE_VIDEO=OFF"
                "-DENABLE_WEB_AUDIO=OFF"
                "-DENABLE_WEBGL=OFF"
                "-DENABLE_GEOLOCATION=OFF"
                "-DENABLE_SPELLCHECK=OFF"
                "-DENABLE_GAMEPAD=OFF"
                "-DENABLE_GLES2=OFF"
                "-DENABLE_OPENGL=OFF"
                "-DUSE_JPEGXL=OFF"
                "-DENABLE_X11_TARGET=OFF"
                "-DENABLE_MINIBROWSER=OFF"
                "-DENABLE_GTKDOC=OFF"
                "-DENABLE_JOURNALD_LOG=OFF"
                "-DENABLE_WEBDRIVER=OFF"
                "-DENABLE_API_TESTS=OFF"
                "-DENABLE_TOOLS=OFF"
                "-DENABLE_PRINT_SUPPORT=OFF"
                "-DENABLE_PLUGIN_PROCESS_GTK2=OFF"
                "-DUSE_LIBBACKTRACE=OFF"
                "-DENABLE_INSPECTOR=OFF"
                "-DENABLE_DOM=OFF"
                "-DENABLE_DATABASE=OFF"
                "-DENABLE_INDEXED_DATABASE=OFF"
                "-DENABLE_WORKERS=OFF"
                "-DENABLE_WEB_RTC=OFF"
                "-DENABLE_WEB_SOCKETS=OFF"
                "-DENABLE_WEB_TIMING=OFF"
                "-DENABLE_WEB_ANIMATIONS=OFF"
                "-DENABLE_WEB_CRYPTO=OFF"
                "-DENABLE_WEB_AUTHN=OFF"
                "-DENABLE_WEBXR=OFF"
                "-DENABLE_MEDIA_STREAM=OFF"
                "-DENABLE_MEDIA_SOURCE=OFF"
                "-DENABLE_MEDIA_SESSION=OFF"
                "-DENABLE_MEDIA_CONTROLS=OFF"
                "-DENABLE_MATHML=OFF"
                "-DENABLE_SVG=OFF"
                "-DENABLE_CSS3=OFF"
                "-DENABLE_CSS4=OFF"
                "-DENABLE_FTP=OFF"
                "-DENABLE_JIT=OFF"
                "-DENABLE_JAVASCRIPTCORE=OFF"
                "-DENABLE_LLINT=OFF"
                "-DENABLE_WEBKIT2=OFF"
                "-DENABLE_WEBKIT=OFF"
              ];
            });
            */
          in {
            inherit libsoup_2_4; # webkitgtk_4_0;
          })
        ];

        # Apply overlays to base pkgs
        pkgsWithOverlays = import nixpkgs {
          inherit system;
          config = {
            permittedInsecurePackages = [ "libsoup-2.74.3" ];
          };
          overlays = overlays;
        };

        callPackage = pkgsWithOverlays.callPackage;

        # Helper to provide fallback for missing hook
        writableTmpDirAsHomeHook = pkgsWithOverlays.writableTmpDirAsHomeHook or pkgs.stdenvNoCC.cc.libc.out;

        # Test and lint derivations using pkgsWithOverlays
        go-test = pkgs.stdenvNoCC.mkDerivation {
          name = "go-test";
          dontBuild = true;
          src = ./.;
          doCheck = true;
          nativeBuildInputs = with pkgsWithOverlays; [
            go
            webkitgtk_4_1
            wails
            writableTmpDirAsHomeHook
            fontconfig
          ];
          checkPhase = ''
            go test -v ./...
          '';
          installPhase = ''
            mkdir "$out"
          '';
        };

        go-lint = pkgs.stdenvNoCC.mkDerivation {
          name = "go-lint";
          dontBuild = true;
          src = ./.;
          doCheck = true;
          nativeBuildInputs = with pkgsWithOverlays; [
            golangci-lint
            go
            wails
            writableTmpDirAsHomeHook
            fontconfig
          ];
          checkPhase = ''
            golangci-lint run
          '';
          installPhase = ''
            mkdir "$out"
          '';
        };
      in {
        checks = {
          inherit go-test go-lint;
        };

        packages.default = callPackage ./default.nix { 
          # webkitgtk = pkgsWithOverlays.webkitgtk_4_1;
          libsoup = pkgsWithOverlays.libsoup_2_4;
        };

        devShells.default = callPackage ./shell.nix {
          # webkitgtk = pkgsWithOverlays.webkitgtk_4_0;
          libsoup = pkgsWithOverlays.libsoup_2_4;
        };

        devShells.shell = callPackage ./shell.nix {
          # webkitgtk = pkgsWithOverlays.webkitgtk_4_0;
          libsoup = pkgsWithOverlays.libsoup_2_4;
        };
      });
}
