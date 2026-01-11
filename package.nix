{ 
  pkgs, 
  version ? "0.0.1",
  webkitgtk ? pkgs.webkitgtk_4_1,
  libsoup ? pkgs.libsoup_3,
}:

pkgs.buildGoModule {
  pname = "whats4linux";
  inherit version;
  
  src = ./.;
  
  vendorHash = "sha256-lIsdQeSsrs1d9Y2uZ9oVj6Ir/C8lMrswr8gDkCK83FU=";
  
  subPackages = [ "." ];
  
  tags = [ "desktop" ];
  
  nativeBuildInputs = [
    pkgs.makeWrapper
    pkgs.nodejs_24
    pkgs.pkg-config
  ];
  
  buildInputs = [
    pkgs.gtk3.dev
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
  
  # Build frontend first
  preBuild = ''
    cd frontend
    npm install
    npm run build
    cd ..
  '';
  
  postInstall = ''
    # Wrap the binary with required library paths
    wrapProgram $out/bin/whats4linux \
      --prefix LD_LIBRARY_PATH : "${pkgs.lib.makeLibraryPath [
        pkgs.gtk3
        pkgs.webkitgtk_4_1.dev
        pkgs.libsoup_3.dev
      ]}" \
      --prefix PKG_CONFIG_PATH : "${pkgs.lib.concatStringsSep ":" [
        "${pkgs.gtk3.dev}/lib/pkgconfig"
        "${pkgs.webkitgtk_4_1.dev}/lib/pkgconfig"
        "${pkgs.pango.dev}/lib/pkgconfig"
        "${pkgs.glib.dev}/lib/pkgconfig"
        "${pkgs.harfbuzz.dev}/lib/pkgconfig"
        "${pkgs.atk.dev}/lib/pkgconfig"
        "${pkgs.cairo.dev}/lib/pkgconfig"
        "${pkgs.gdk-pixbuf.dev}/lib/pkgconfig"
        "${pkgs.libsoup_3.dev}/lib/pkgconfig"
        "${pkgs.zlib.dev}/lib/pkgconfig"
        "${pkgs.fontconfig.dev}/lib/pkgconfig"
      ]}"
  '';
  
  meta = with pkgs.lib; {
    homepage = "https://github.com/lugvitc/whats4linux";
    description = "An unofficial WhatsApp client for Linux";
    license = licenses.agpl3Plus;
    platforms = platforms.linux;
    mainProgram = "whats4linux";
  };
}
