# Toon stage backgrounds

The default arena presentation uses generated scenery with the approved sculpted, low-detail toon direction. Platforms, collision, spawns, hazards, actors and simulation are independent of the images. `?look=classic` retains the original scenery.

| Environment | Campaign levels | Layers |
| --- | --- | --- |
| Neon Rooftop | 1, 7 | far, near |
| Slime Cavern | 2 | far, near |
| Bone Graveyard | 3, 4 | far, near |
| Ghost Ship | 5, 6, 8 | far, near |
| Eagle Peak | 9, 10 | far, mid, near |
| Final Arena | 11, 12 | far, near |
| Lava Volcano | 13, 16 | far, near |
| Ice Kingdom | 14, 15 | far, near |

## Assets and rendering

- `art/backgrounds/<theme>/`: original generated PNG plates and exact prompts. Eagle Peak reuses the approved mockup. Built-in image generation produced the artwork; native alpha attempts failed earlier, so isolated overlays used a magenta backing.
- `scripts/prepare-backgrounds.py`: Pillow + NumPy normalization, narrow backing-color removal, two-source-pixel edge cleanup, and WebP encoding. Run with a Python environment containing those packages. No keying occurs in the game.
- `public/backgrounds/<theme>/`: 17 runtime WebP textures, all 1536 × 864, about 0.5 MB combined. Far plates are opaque; overlays contain alpha. Only the current stage's textures are requested, with normal browser caching; no runtime dependency or asset service was added.
- `src/stages/Scenery.ts`: camera-facing, non-repeating planes behind the stage; 20% overscan and bounded camera movement prevent uncovered edges across aspect ratios. Scroll factors are 0.08 far, 0.28 middle, 0.60 near. Decoded textures/mipmaps cost more GPU memory than compressed download sizes (roughly 7 MB per RGBA plate including mipmaps).
- Stage ownership disposes textures/materials/geometry. Existing scenery remains visible until all new layers load, and stays as fallback on failure. Late loads cannot restore a disposed stage. The asset gallery requests a render when scenery readiness settles.

## Review and checks

Run `npm run dev` and visit `/bigfight/assets.html?family=stages&asset=rooftop` to browse all stages, or play the campaign normally.

`npm run check` and `npm run build` validate the source/build. `node scripts/check-backgrounds.mjs http://localhost:5192/bigfight/` uses an isolated Playwright context to check all 16 campaign levels, stage replacement, failed/late image loads, camera extremes at portrait/landscape/ultrawide sizes, and both quality tiers. It writes screenshots/results under the local `background-lab/campaign-captures/` review directory. Physical-device performance and online play are not measured by this art check.
