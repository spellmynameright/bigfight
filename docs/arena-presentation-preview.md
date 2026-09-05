# Arena presentation

Standard builds use the approved arena presentation and character roster. `?look=classic` retains the earlier appearance for comparison. These switches do not change progression or match rules.

## Review surfaces

- `/`: play the real campaign and online game.
- `/mockup.html`: compare fighter poses and attacks in the Character Lab.
- `/assets.html`: inspect the runtime fighters, weapons, enemies, bosses, stages, and loot.

The interface uses Barlow Condensed display lettering, Barlow interface text, ink blue surfaces, white selection panels, scarlet primary actions, cobalt secondary actions, and gold selection states. Fonts are served locally; licenses are in `public/fonts/`.

## Asset coverage

| Family | Inventory | Presentation |
| --- | --- | --- |
| Fighters | 11 | Shared studio lighting, satin/metal/energy surface response, softer contact shadows, matching runtime portraits |
| Weapons | 14 | Material response and consistent portrait lighting |
| Enemies | 9 definitions, 5 rig families | Matte surfaces and improved dimensional lighting |
| Bosses | 4 | Surface response, controlled highlights, preserved attack cues |
| Stages | 8 | Distinct atmosphere, layered terrain, beveled structural edges, metal/stone/wood/ice/lava surface detail |
| Sidekicks | 3 | Shared surface finish and lighting |
| Projectiles | 12 visual forms | Shared surface finish with original silhouettes and behavior |
| Loot | Gold and 5 materials | Minted coin texture and distinct material silhouettes |
| Powerups | 5 crate contents | Rounded shell, visible colored core, restrained orbit halo |
| Effects | Particles, trails, glows | Lower bloom spill; trail transparency and taper |
| UI | Title, modes, campaign, fighter/weapon selects, online, HUD, market, results, settings, help | Shared typography, spacing, clear state/focus treatment, live fighter cards, compact mobile layouts |

## Visual boundaries

This pass preserves fighter identities, rig proportions, attack timing, collider definitions, gameplay RNG, and the number of gameplay entities. Presentation helpers run when assets are constructed. Surface maps are generated once per stage and disposed with it. No new postprocessing pass is added.

The approved roster combines 12 Vanguard, nine Wildform, and six Relic procedural designs across all fighters, enemies, bosses, and companions. The Character Studio retains all three directions for future comparison. See `character-style-studio.md` for the geometry and animation integration and `releasing.md` for production validation and deployment.

## Build and deploy

```
BASE_PATH=/ VITE_ARENA_PREVIEW=1 RELEASE_ID=<unique-preview-id> npm run build
flyctl deploy . --config server/fly.preview.toml \
  --remote-only --ha=false --build-arg RELEASE_ID=<unique-preview-id>
```

`server/fly.preview.toml` names the isolated `bigfight-arena-preview` app and uses one small machine that can stop when idle. The production app is `bigfight-online` and uses its existing configuration. The preview source can remain uncommitted while under review.
