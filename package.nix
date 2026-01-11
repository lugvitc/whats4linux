{
  lib,
  version ? "0.0.1",
  makeWrapper,
  buildGoModule,
  buildNpmPackage,
  pkg-config,
  wails,
  gtk3,
  pango,
  glib,
  harfbuzz,
  atk,
  cairo,
  gdk-pixbuf,
  zlib,
  fontconfig,
  webkitgtk_4_1,
  libsoup_3,
  nodejs_24,
}:

let
frontend = buildNpmPackage {
    pname = "whats4linux-frontend";
    inherit version;
    
    src = ./frontend;
    
    npmDepsHash = "sha256-IUzpbPrNFdhWGQL/e9gNRlhZmR6L8ZYJKdB8VRHCViY=";
    
    buildPhase = ''
      # runHook preBuild
      
      # Fix shebang lines for all node executables
      find node_modules/.bin -type f -exec sed -i 's|#!/usr/bin/env node|#!${nodejs_24}/bin/node|g' {} \; || true

      # Run TypeScript and Vite directly instead of npm script
      ${nodejs_24}/bin/node node_modules/typescript/bin/tsc && ${nodejs_24}/bin/node node_modules/vite/bin/vite.js build
      # runHook postBuild
    '';
    
    installPhase = ''
      runHook preInstall
      mkdir -p $out
      cp -r dist $out/
      runHook postInstall
    '';
  };
in
buildGoModule {
  pname = "whats4linux";
  inherit version;
  
  src = ./.;
  
  vendorHash = "sha256-KzMQoQ1bQlxpx52CGNrCz4H0xJxYtr12GGvke1PksjY=";
  
  proxyVendor = true;
  
  subPackages = [ "." ];
  
  tags = [ "desktop,production" ];
  
  nativeBuildInputs = [
    makeWrapper
    pkg-config
    wails
    nodejs_24
  ];
  
  buildInputs = [
    gtk3.dev
    pango.dev
    glib.dev
    harfbuzz.dev
    atk.dev
    cairo.dev
    gdk-pixbuf.dev
    zlib.dev
    fontconfig.dev
    webkitgtk_4_1.dev
    libsoup_3.dev
  ];
  
  # Build frontend first
  preBuild = ''
    # Copy pre-built frontend
    cp -r ${frontend}/dist frontend/
    
    # Set up a proper home directory for binding generation
    export HOME=$(mktemp -d)
    
    # Build with Wails using buildGoModule's vendoring
    wails build -s -tags "webkit2_41,soup_3"
  '';
  
  postInstall = ''
    # Wrap the binary with required library paths
    wrapProgram $out/bin/whats4linux \
      --prefix LD_LIBRARY_PATH : "${lib.makeLibraryPath [
        gtk3
        webkitgtk_4_1.dev
        libsoup_3.dev
      ]}" \
      --prefix PKG_CONFIG_PATH : "${lib.concatStringsSep ":" [
        "${gtk3.dev}/lib/pkgconfig"
        "${webkitgtk_4_1.dev}/lib/pkgconfig"
        "${pango.dev}/lib/pkgconfig"
        "${glib.dev}/lib/pkgconfig"
        "${harfbuzz.dev}/lib/pkgconfig"
        "${atk.dev}/lib/pkgconfig"
        "${cairo.dev}/lib/pkgconfig"
        "${gdk-pixbuf.dev}/lib/pkgconfig"
        "${libsoup_3.dev}/lib/pkgconfig"
        "${zlib.dev}/lib/pkgconfig"
        "${fontconfig.dev}/lib/pkgconfig"
      ]}"
  '';
  
  meta = {
    homepage = "https://github.com/lugvitc/whats4linux";
    description = "An unofficial WhatsApp client for Linux";
    license = lib.licenses.agpl3Plus;
    maintainers = with lib.maintainers; [
      zstg
    ];
    platforms = lib.platforms.linux;
    mainProgram = "whats4linux";
  };
}
