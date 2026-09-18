# Numerical validation record

Validation date: 2026-09-13. This records the local implementation delivered with the TDSE wave-packet upgrade. It does not substitute for additional convergence checks when changing the model or parameter limits.

## Automated suites

Run from the `quantum-tunneling` directory:

```sh
python3 -m unittest discover -s tests -v
node --test tests/test_packet.mjs
```

**17 / 17 Python tests passed.** They cover rectangle analytic agreement below/at/above the barrier; second-order grid convergence; free transmission; suppression with width; above-barrier resonance; nonrectangular flux conservation; NaN/Infinity rejection; sweep endpoints; absent nonrectangular analytic references; HTTP dispatch and parsing; bounded surface resolution and matrix orientation; explicit static-file access; source archive scoping; and HEAD behavior. The static-route test includes all three new packet JavaScript files and their module-compatible MIME type.

**7 / 7 JavaScript physics tests passed.**

| Test | Criterion |
|---|---|
| Free propagation and spreading | Norm error < 10⁻⁹; mean position within 0.04 nm of continuum group motion; width within 0.008 nm of the exact free Gaussian |
| Rectangle packet scattering | Finite-time right probability within 0.003 of independently integrated continuum T(k); near-structure probability < 0.005 |
| Barrier-height suppression | Raising V₀ from 1.5 to 3 eV reduces transmission by more than a factor of three; V₀ = 0 transmits > 0.999 |
| Double-barrier resonance | E₀ = 0.405 eV transmits more than twice the 0.650 eV detuned packet at identical geometry |
| Space/time refinement | Halving Δx reduces continuum transmission error; halving Δt changes transmission by < 0.0001 |
| Boundary relocation | Changing the distant box half-width from 60 to 80 nm changes transmission by < 10⁻⁸; outer-edge probability < 10⁻⁸ |
| Initial interpretation and extreme supported case | Initial probability is on the incident left side; E₀ = 0.25 eV, σₓ = 0.7 nm, two 1 nm / 5 eV barriers and 2 nm gap preserve norm and stay below the edge threshold |

## Recorded numerical values

| Quantity | Value |
|---|---:|
| Rectangle transmission, Δx = 0.020 nm | 0.3414075330641796 |
| Rectangle transmission, Δx = 0.010 nm | 0.3418021458191843 |
| Rectangle transmission, Δt halved to 0.004 fs | 0.3414075330633308 |
| Independent continuum Gaussian-spectrum reference | 0.3419338105483914 |
| Default final probability norm | 1.0000000000034759 |
| Default final edge probability | 6.328174238167643 × 10⁻²⁷ |
| Resonance preset transmitted fraction | 0.6574986252701469 |
| Off-resonance transmitted fraction | 0.1632549197476381 |
| Resonance preset remaining structure probability | 0.00003356835620071334 |
| Resonance preset final edge probability | 9.70086411784581 × 10⁻¹⁹ |

The fourfold reduction of transmission error under spatial refinement is consistent with second-order spatial accuracy. The final integrated transmission is effectively independent of the smaller time step here; this observation does not claim every intermediate phase is time-step independent.

## Worker recording check

The actual worker module was executed through its message interface with the default packet parameters. It produced 20 progress messages and 481 independently stored snapshots, each with 2,000 plotting samples. The final recorded time was 61.44 fs; the worker rounds the save interval to an integer number of integration steps. All probability metrics were computed before plotting downsampling.

- Initial left probability: 0.9999999999999989.
- Final right probability: 0.34140753306415444.
- Maximum norm error across all frames: 3.417488514401157 × 10⁻¹².
- Maximum outer-edge probability across all frames: 5.845914434081843 × 10⁻²⁷.

`node --check` passed for the new UI/worker modules and the translated stationary/surface scripts. Python sources compiled successfully. Browser visual and interaction checks are a separate part of delivery; this report records numerical, transport and server tests.

## Independent references

The continuum rectangular transmission formula and its Gaussian-momentum integral are independent of the CN propagator. Free-packet group velocity and spreading are continuum analytic benchmarks. The mathematical sources and no-copied-code statement are documented in the project README and the English `/blog` article.
