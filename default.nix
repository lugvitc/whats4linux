{
  pkgs ? (
    let
      inherit (builtins) fetchTree fromJSON readFile;
      inherit ((fromJSON (readFile ./flake.lock)).nodes) nixpkgs;
    in
    import (fetchTree nixpkgs.locked) {}
  ),
  buildGoModule ? pkgs.buildGoModule,
  webkitgtk ? pkgs.webkitgtk_4_1,
  libsoup ? pkgs.libsoup_2_4,
}:

let
  # Pre-fetch npm dependencies
  npmDeps = pkgs.fetchNpmDeps {
    src = ./frontend;
    hash = "sha256-IUzpbPrNFdhWGQL/e9gNRlhZmR6L8ZYJKdB8VRHCViY=";
  };

  # Build frontend separately
  frontend = pkgs.buildNpmPackage {
    pname = "whats4linux-frontend";
    version = "0.0.1";
    src = ./frontend;
    npmDeps = npmDeps;
    
    installPhase = ''
      mkdir -p $out
      cp -r dist/* $out/
    '';
  };

in
pkgs.buildGoModule {
  pname = "whats4linux";
  version = "0.0.1";
  
  # Use current directory as source
  src = ./.;
  
  # Use Go modules with vendor hash  
  vendorHash = "sha256-lIsdQeSsrs1d9Y2uZ9oVj6Ir/C8lMrswr8gDkCK83FU=";
  
  # Sub packages to build
  subPackages = [ "." ];
  
  # Allow network access for dependency download during build
  env = {
    HOME = "$(mktemp -d)";
  };
  
  # Allow network for first-time dependency fetch
  proxySupport = true;
  
  # Needed to be able to make a copy of Go below
  allowGoReference = true;
  
  # Add necessary build inputs for Wails
  nativeBuildInputs = [
    pkgs.makeWrapper
    pkgs.nodejs_24
    pkgs.fontconfig
    pkgs.fontconfig.dev
  ];
  
  # Add runtime dependencies 
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
    libsoup.dev
  ];
  # ++ (if old_webkitgtk != null then [ old_webkitgtk ] else []) ++
  # (if old_libsoup != null then [ old_libsoup ] else []);
  
  # Platform-specific build
  tags = [ "desktop" ];
  
  dontStrip = true;
 
  # Add Wails build tags and ldflags if needed
  # ldflags = [ "-s" "-w" ];
  # ldflags = [ "-X main.Version=${version}" ];
  
  # Setup npm dependencies before Go build
  postPatch = ''
    cd frontend
    cp package*.json ../
    cp package-lock.json ../package-lock.json
    cd ..
    local postPatchHooks=()
    source ${pkgs.npmHooks.npmConfigHook}/nix-support/setup-hook
    export npmDeps=${npmDeps}
    npmRoot=./ npmConfigHook
  '';
  
  # Build with Wails - let Go build embed frontend assets
  preBuild = ''
    # Copy built frontend to the expected location for Go embed
    rm -rf frontend/dist
    cp -r ${frontend} frontend/dist
  '';
  
  postInstall = let
    pkgConfigPath = pkgs.lib.makeBinPath [ pkgs.pkg-config ];
  in
    ''
      # Injects the needed dependencies into pkg-config
      makeWrapper "${pkgConfigPath}/pkg-config" "$out/lib/pkg-config" \
        --prefix PKG_CONFIG_PATH : "${
          pkgs.lib.concatStringsSep ":" [
            "${pkgs.gtk3.dev}/lib/pkgconfig"
            "${pkgs.webkitgtk_4_1.dev}/lib/pkgconfig"
            "${pkgs.pango.dev}/lib/pkgconfig"
            "${pkgs.glib.dev}/lib/pkgconfig"
            "${pkgs.harfbuzz.dev}/lib/pkgconfig"
            "${pkgs.atk.dev}/lib/pkgconfig"
            "${pkgs.cairo.dev}/lib/pkgconfig"
            "${pkgs.gdk-pixbuf.dev}/lib/pkgconfig"
            "${libsoup.dev}/lib/pkgconfig"
            "${pkgs.zlib.dev}/lib/pkgconfig"
          ]
        }" \
        --prefix LD_LIBRARY_PATH : "${
          pkgs.lib.concatStringsSep ":" [
            "${pkgs.gtk3.dev}/lib/pkgconfig"
            "${pkgs.webkitgtk_4_1.dev}/lib/pkgconfig"
            "${pkgs.pango.dev}/lib/pkgconfig"
            "${pkgs.glib.dev}/lib/pkgconfig"
            "${pkgs.harfbuzz.dev}/lib/pkgconfig"
            "${pkgs.atk.dev}/lib/pkgconfig"
            "${pkgs.cairo.dev}/lib/pkgconfig"
            "${pkgs.gdk-pixbuf.dev}/lib/pkgconfig"
            "${libsoup.dev}/lib/pkgconfig"
            "${pkgs.zlib.dev}/lib/pkgconfig"
          ]
        }"

      # Wails runs Go directly, so we need to give it access to it. We need to copy it, so we can wrap it below.
      cp ${pkgs.go}/bin/go $out/lib

      # Without the shell.nix file, I get the following error when "wails dev" is run:
      # ---
      # Compiling application: # github.com/wailsapp/wails/v2/internal/frontend/desktop/linux
      # /nix/store/h19zwlkrp6b0hp3ypbqdcggnyarn3af6-binutils-2.35.2/bin/ld: cannot find -lz
      # collect2: error: ld returned 1 exit status
      # ---
      # This means that I'm missing some dependencies here, I think. In fact, some of these are probably not needed, but I ran out of ideas and just started adding stuff.
      wrapProgram $out/lib/go \
        --prefix PATH : "${pkgs.lib.makeBinPath [ pkgs.webkitgtk_4_1.dev pkgs.gcc pkgs.stdenv.cc.cc pkgs.glibc ]}"

      # Inject dependencies into "whats4linux" executable
      wrapProgram $out/bin/whats4linux \
        --prefix PATH : "$out/lib:${pkgs.lib.makeBinPath [ pkgs.webkitgtk_4_1.dev pkgs.gtk3 ]}"
    '';
  
  meta = with pkgs.lib; {
    homepage = "https://github.com/lugvitc/whats4linux";
    description = "An unofficial WhatsApp client for Linux";
    license = licenses.agpl3Plus;
    platforms = platforms.linux;
  };
}
