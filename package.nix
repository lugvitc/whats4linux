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
  nodejs_latest,
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
      find node_modules/.bin -type f -exec sed -i 's|#!/usr/bin/env node|#!${nodejs_latest}/bin/node|g' {} \; || true

      # Run TypeScript and Vite directly instead of npm script
      ${nodejs_latest}/bin/node node_modules/typescript/bin/tsc && ${nodejs_latest}/bin/node node_modules/vite/bin/vite.js build
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
  
  vendorHash = "sha256-83Ht02V6N6F2E0Sf1+Z3v3Dc4o8b8BYKTDCSYdEfzXY=";
  
  proxyVendor = true;
  
  subPackages = [ ]; # this defaults to "."
  doBuild = false; 
  
  tags = [ "desktop,production" ];
  
  nativeBuildInputs = [
    makeWrapper
    pkg-config
    wails
    nodejs_latest
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

  buildPhase = "runHook preBuild"; # no `go build`

  installPhase = ''
    runHook preInstall

    mkdir -p $out/bin $out/lib
    [ -d build/bin ] && cp build/bin/whats4linux $out/bin/ || true   
    [ -d build/lib ] && cp build/lib/* $out/lib/ || true   

    runHook postInstall
  '';
  
  postFixup = ''
    # Wrap the binary with required library paths
    wrapProgram $out/bin/whats4linux \
      --prefix LD_LIBRARY_PATH : "${lib.makeLibraryPath [
        gtk3
        webkitgtk_4_1
        libsoup_3
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
