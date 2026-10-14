# Chain Reaction Lab

Two static web apps, no build step, no dependencies.

## `/` — the game

Run a nuclear reactor without melting it down. One screen, built for touch and mouse:

- **Drag a control rod** in the core to move it; drag the **lever** to move all rods. Mouse wheel / `↑` `↓` also work.
- **Pumps, ECCS, Refuel, SCRAM** live in the bottom bar. `X` = SCRAM, `P` = pause.
- Instruments: power (log below 1%, linear above), reactor period, reactivity in dollars, fuel centerline / cladding / coolant temperatures, water level, flow, xenon, and an annunciator panel.

Levels, each built on a real event or design trait:

| # | Level | Design | Lesson |
|---|-------|--------|--------|
| 1 | First Criticality | PWR | Startup through 7 decades of power; reactor period; Doppler feedback |
| 2 | Follow the Grid | PWR | Load following against xenon-135 |
| 3 | Loss of Coolant | PWR | Decay heat, ECCS, zirconium–steam reaction (TMI-2) |
| 4 | Online Refuelling | CANDU | Natural uranium has little excess reactivity |
| 5 | The Night Test | RBMK | Positive void coefficient, slow SCRAM, graphite rod tips (Chernobyl) |
| 6 | Walk-Away Safe | SFR | Inherent shutdown on loss of flow (EBR-II, 1986) |

Plus free play on any design, with fault buttons.

### Physics (`plant.js`)

- One-delayed-group point kinetics, implicit integration, real β per fuel; ~10× time compression.
- Reactivity: rod S-curves weighted by flux, Doppler, moderator temperature, void, xenon, burnup, ECCS boron, RBMK graphite tips.
- Iodine-135 → xenon-135 dynamics, decay heat, lumped fuel/coolant temperatures, pumps with coast-down, natural circulation, boiling and dry-out, loss-of-coolant inventory, ECCS.
- The particle core from `sim.js` is the visual layer: its fission rate is steered to follow plant power, while rods still absorb neutrons where they are.

## `/simulator/` — the sandbox

The original free-form particle simulation: pick a fuel and moderator, set rods, fire neutrons, watch k-effective.

## Files

- `sim.js` – particle neutronics engine (shared; DOM-free)
- `plant.js` – plant model for the game (DOM-free)
- `game.js`, `index.html` – the game
- `simulator/` – the sandbox UI

Node can load `sim.js` and `plant.js` directly for tuning and scenario tests.

## Run locally

```sh
python3 -m http.server 8000   # http://localhost:8000 and /simulator/
```

## Deploy

`.github/workflows/pages.yml` publishes to GitHub Pages on push to `main`. GitHub Pages on a private repo requires a paid plan; otherwise make the repo public, then set Settings → Pages → Source to "GitHub Actions".
