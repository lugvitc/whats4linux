{
  description = "A basic flake for building W4L";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];

      forAllSystems = nixpkgs.lib.genAttrs systems;

    in {
      packages = forAllSystems (system:
        let
          pkgs = import nixpkgs { inherit system; };
        in { default = pkgs.callPackage ./package.nix { }; }
      );

      devShells = forAllSystems (system:
        let
          pkgs = import nixpkgs { inherit system; };
        in { default = pkgs.callPackage ./shell.nix { }; }
      );

      checks = forAllSystems (system:
        let
          pkgs = import nixpkgs { inherit system; };

          writableTmpDirAsHomeHook =
            pkgs.writableTmpDirAsHomeHook or pkgs.stdenvNoCC.cc.libc.out;

          go-test = pkgs.stdenvNoCC.mkDerivation {
            name = "go-test";
            src = ./.;
            dontBuild = true;
            doCheck = true;

            nativeBuildInputs = with pkgs; [
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
              mkdir -p $out
            '';
          };

          go-lint = pkgs.stdenvNoCC.mkDerivation {
            name = "go-lint";
            src = ./.;
            dontBuild = true;
            doCheck = true;

            nativeBuildInputs = with pkgs; [
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
              mkdir -p $out
            '';
          };

        in { inherit go-test go-lint; }
      );
    };
}

