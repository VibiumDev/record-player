import { readFileSync } from "node:fs";
import path from "node:path";

import type { Plugin } from "vite";

const releaseAssets = [
  ["src/packages/ghostty-browser/LICENSE.ghostty", "third-party/ghostty/LICENSE.txt"],
  ["src/packages/ghostty-browser/build-info.json", "third-party/ghostty/build-info.json"],
  ["src/packages/player-react/fonts/LICENSE-JetBrainsMono.txt", "third-party/fonts/LICENSE-JetBrainsMono.txt"],
  ["src/packages/player-react/fonts/LICENSE-NotoSansMono.txt", "third-party/fonts/LICENSE-NotoSansMono.txt"],
  ["src/packages/player-react/fonts/LICENSE-NotoSansSymbols.txt", "third-party/fonts/LICENSE-NotoSansSymbols.txt"],
  ["src/packages/player-react/fonts/LICENSE-NotoSansSymbols2.txt", "third-party/fonts/LICENSE-NotoSansSymbols2.txt"],
  ["src/packages/player-react/fonts/build-info.json", "third-party/fonts/build-info.json"],
] as const;

export function emitTweeReleaseAssets(repositoryRoot: string): Plugin {
  return {
    name: "emit-twee-release-assets",
    apply: "build",
    buildStart() {
      for (const [sourcePath, fileName] of releaseAssets) {
        this.emitFile({
          type: "asset",
          fileName,
          source: readFileSync(path.join(repositoryRoot, sourcePath)),
        });
      }
    },
  };
}
