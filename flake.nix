{
  description = "view-beads - local web dashboard for beads (bd) issue trackers";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
    in
    {
      devShells.${system}.default = pkgs.mkShell {
        packages = with pkgs; [
          nodejs_24
          git
          playwright
        ];
        PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright.browsers}";
      };

      packages.${system} = rec {
        default = view-beads;
        view-beads = pkgs.buildNpmPackage {
          pname = "view-beads";
          version = "0.1.0";
          src = ./.;
          npmDepsHash = "sha256-u/gTdGYBSUhwznNA8UnjZRfaE+IEMzy+i+b05pCfFoQ=";
          npmInstallFlags = [ "--ignore-scripts" ];
          env = {
            NEXT_TELEMETRY_DISABLED = "1";
          };
          installPhase = ''
            runHook preInstall
            mkdir -p $out/lib/view-beads $out/bin
            cp -r .next/standalone/. $out/lib/view-beads/
            cp -r .next/static $out/lib/view-beads/.next/static
            cp -r public $out/lib/view-beads/public
            cp bin/view-beads.mjs $out/lib/view-beads/view-beads.mjs
            cat > $out/bin/view-beads <<EOF
            #!${pkgs.runtimeShell}
            export BEADS_BIN="${pkgs.lib.getExe pkgs.beads}"
            export VIEW_BEADS_SERVER="$out/lib/view-beads/server.js"
            exec ${pkgs.lib.getExe pkgs.nodejs_24} "$out/lib/view-beads/view-beads.mjs" "\$@"
            EOF
            chmod +x $out/bin/view-beads
            runHook postInstall
          '';
        };
      };
    };
}
