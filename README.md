# Chain Reaction Lab

A stylized, interactive nuclear fission chain-reaction simulator. Static site, no build step, no dependencies.

Pick a fuel (natural U, LEU, HEU, Pu-239, MOX, thorium/U-233), a moderator (none, light water, heavy water, graphite), set control rods, toggle a Be reflector and an Am-Be startup source, then click the core to fire neutrons. Live readouts show k-effective, neutron population, fission rate, power and fissile inventory.

## What's modeled

- Hex lattice of ~1,300 nuclei; fast and thermal neutrons with different effective cross-sections
- Fission, radiative capture, scatter, leakage, reflector, B₄C control rods with SCRAM
- Moderator thermalization, parasitic absorption and resonance capture
- Delayed neutrons (β exaggerated ×8 so they're visible)
- Breeding: U-238 → Pu-239, Th-232 → U-233
- Fission-product and Xe-135 poisoning, fuel burnup
- Doppler (fuel temperature) negative feedback

Real ν, energy per fission and β are used per isotope; concentrations and time scales are stylized.

## Run locally

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

## Files

- `sim.js` – physics engine, DOM-free (runs in Node too)
- `app.js` – rendering, controls, instruments
- `index.html` – layout and styles

## Deploy

`.github/workflows/pages.yml` publishes to GitHub Pages on push to `main`. GitHub Pages on a private repo requires a paid plan; otherwise make the repo public.
