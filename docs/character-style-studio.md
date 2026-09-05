# Character Studio

`/styles.html` is a separate review page for choosing a new procedural character direction. It includes all 11 fighters, nine enemy definitions, four bosses, and three companions. Each of the 27 subjects has three new geometry concepts, for 81 designs.

- **Vanguard:** tailored action heroes, sculpted armor, signature equipment, and articulated creature anatomy.
- **Wildform:** expressive creature forms, oversized hands and feet, organic contours, and collectible proportions.
- **Relic:** carved masks, suspended armor, elemental cores, and geometric silhouettes.

The cast wall shows a complete direction. Opening a character compares all three concepts with synchronized turning, zoom, color/silhouette views, and six movement studies: ready, run, attack, jump, hit reaction, and victory. Models are individually framed for inspection; the images do not indicate their relative gameplay size. These movement studies are design poses, separate from game attack timing.

The timeline supports scrubbing, steps of 1/60 second, and playback at 0.25x, 0.5x, 1x, or 1.5x. Its caption identifies anticipation, impact hold, recovery, airborne, and landing phases. Switching characters preserves the selected movement and normalized position. A URL with `character`, `motion`, and `phase` reopens the same pose.

Shared timing in `motion.ts` defines each subject's attack kind and weight. Lighter subjects have quicker locomotion and attack cycles. Style builders provide articulated motion, secondary movement, and distinct creature behaviors. Every pose is evaluated from absolute time, so scrubbing and replaying do not depend on previous poses.

Choose one style for everyone or make individual picks. Choices use `bigfight_character_choices_v1` in local storage, can be undone, and can be shared in a URL containing validated character/style pairs. Share choices opens a dialog with the complete link, copy confirmation, and manual selection. Review choices do not modify the game save or the shipped roster.

All models are built from local Three.js geometry and materials. The cast photographs are rendered from those generated models in the browser. No imported character models, bitmap character art, or network-generated assets are used. One WebGL renderer serves the photographs and comparison views; animation starts paused, stops when the page is hidden, and generated model resources are disposed when a view is replaced.

Comparison cameras use bounds sampled over one full movement cycle, including deformed skinned geometry. Framing accounts for the chosen viewing angle and perspective depth. Extended wings and equipment remain in frame without moving the camera during the movement. The jump shadow contracts and softens as the subject rises.

Implementation lives in `src/mockup/styleStudio.ts`, its stylesheet, and `src/mockup/styles/`. The game reuses the procedural geometry through `src/rigs/ApprovedRig.ts`. Its fixed roster mapping in `src/rigs/approvedStyles.ts` matches the confirmed selections in `docs/character-style-selections.json`: 12 Vanguard, nine Wildform, and six Relic designs. Gameplay rigs normalize the designs to existing body heights, attach real held weapons, retain damage and invulnerability effects, and align animation impact holds with each attack's active hitbox interval. Physical bodies control jump height. Changing a review pick requires a new release to change the shipped roster.

The isolated Fly preview uses `server/fly.preview.toml`. Build from the repository root with `BASE_PATH=/ VITE_ARENA_PREVIEW=1 RELEASE_ID=<unique-id> npm run build`, then deploy the uncommitted snapshot with `flyctl deploy . --config server/fly.preview.toml --remote-only --ha=false --build-arg RELEASE_ID=<unique-id>`.

`node --import tsx --test src/mockup/styles/motion.test.ts` checks the leg solver, support/swing timing, impact holds, camera framing, and all 486 subject/style/movement combinations for finite transforms, actual movement, loop closure, pose reset, and independence from evaluation order. It also checks that run poses are independent of the display parent's transform. Run heavy checks one at a time with `nice -n 19`; render inspection uses hardware-accelerated Chrome because the bundled headless browser's SwiftShader backend failed PBR shader compilation on this machine.
