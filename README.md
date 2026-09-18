# Quantum Tunneling Lab

An English-language, local interactive lab for **actual time-dependent wave-packet scattering** and stationary one-dimensional quantum tunneling. The interface retains the black, square-edged design and the interactive 3D transmission parameter surface.

## Run

Python 3.10+ is sufficient to serve the application; there are no third-party runtime dependencies.

```sh
git clone https://github.com/zkejdo512/quantum-tunneling-lab.git
cd quantum-tunneling-lab
python3 app.py --port 8765
```

Open http://127.0.0.1:8765/. On macOS, `启动模拟器.command` starts the same local server. A modern browser with module Web Workers is required for the wave-packet experiment. Its computation runs locally in the browser, without an external API or CDN. `/blog` is an English methods article; `/source.zip` packages only this project's source.

## Wave-packet experiment

The default tab evolves a normalized Gaussian electron wave packet toward a single or double rectangular barrier. Watch reflection, transmission and interference; pause, slow down, scrub the recorded timeline, return before the collision, or jump to the final frame. Editing controls preserves the current recorded experiment until Relaunch is selected. Presets launch immediately. A relaunch terminates any previous background computation.

- **Tunneling:** E₀ = 1 eV, V₀ = 1.5 eV, width 0.30 nm, σₓ = 1.4 nm.
- **Free flight:** the same packet with V₀ = 0, illustrating propagation and spreading.
- **Resonance / Off resonance:** two 0.20 nm barriers of height 1.5 eV, separated by a 0.60 nm well; E₀ = 0.405 / 0.650 eV and σₓ = 2.4 nm. The finite momentum distribution broadens the resonance response.

Probabilities always integrate the **full computation domain**, even though the plot displays a central crop. The three regions are x < 0, the whole barrier/well structure, and x beyond that structure. Initially, almost all probability is on the left: that is incident probability, **not reflection**. Only well after collision and separation can left/right approximate the reflected/transmitted fractions. The page continues to call them spatial probabilities and flags residual probability near the structure. Double-barrier resonances can retain probability longer than the recorded window.

### Actual TDSE solver

`static/packet-core.js` independently implements

```
i ℏ ∂ψ/∂t = [−C ∂²/∂x² + V(x)] ψ
C = ℏ² / (2mₑ) = 0.0380998212 eV nm²
ℏ = 0.6582119569 eV fs
ψ(x,0) ∝ exp[−(x−x₀)²/(4σₓ²)] exp[ik₀(x−x₀)]
k₀ = sqrt(E₀/C), x₀ = −(6σₓ + 6) nm
```

The Hamiltonian uses second-order centered finite differences. Every time step solves the complex tridiagonal system

```
(I + i Δt H / 2ℏ) ψⁿ⁺¹ = (I − i Δt H / 2ℏ) ψⁿ
```

with precomputed Thomas/LU factors. This is the **Crank–Nicolson method**, second order in time and unitary for the finite Hermitian Hamiltonian (up to floating-point roundoff). It is not a translated stationary solution or a hand-authored moving envelope. The real and imaginary values are evolved together; density is their squared modulus. No numerical source code was copied from external projects.

Defaults: Δx = 0.020 nm, optional 0.010 nm; Δt = 0.008 fs. Width and gap are rounded to complete grid cells and the actual geometry is displayed. Energies 0.25–3 eV, heights 0–5 eV, individual widths 0–1 nm, gap 0–2 nm and σₓ 0.7–2.4 nm keep the experiment practical. The temporal window is approximately `(2|x₀| + structure span + 8 nm) / group velocity`, with 481 recorded states. Playback speed changes the replay rate, not the numerical time step. Downsampled Float32 wave amplitudes are used only for rendering; evolution and probability diagnostics use Float64 on every spatial point.

**Boundary condition:** the large box spans −80 to +80 nm, with ψ = 0 on outside ghost points. These are reflecting walls, not transparent or absorbing boundaries. Every recorded frame measures probability in the outermost 8 nm, and the worker stops if it exceeds 10⁻⁷. Within the supported experiments, outgoing packets remain distant from those walls. The displayed norm and outer-edge probability make this check visible. Norm conservation alone does not establish continuum accuracy; spatial refinement and independent benchmarks are necessary.

The initial Gaussian has an energy distribution, with mean `⟨E⟩ = E₀ + C/(4σₓ²)`. For single rectangles the interface separately displays the analytic monochromatic `T(E₀)` and the Gaussian-momentum weighted integral of analytic `T(Ck²)`. The latter is the appropriate continuum reference for a sufficiently separated outgoing packet. The tiny initially negative-momentum tail is included in normalization and contributes no right-moving transmitted probability. Neither reference is substituted for the TDSE calculation.

## Stationary modes

**3D surface** retains the rotating transmission surface T(a,V₀), with a 41×41 numerical grid, logarithmic or linear transmission, hover readouts and PNG export. The surface describes one-dimensional scattering over a parameter space; it is not a three-dimensional spatial simulation. Narrow resonances can be missed by this sampling and warrant a denser local sweep.

**Stationary wave** shows real/imaginary ψ, density and potential for rectangle, triangle and double-barrier potentials. Phase playback multiplies a stationary state by `exp(−iφ)` and leaves its density fixed. This intentionally differs from actual wave-packet evolution in the first tab. The stationary metrics and controls are separate from the packet controls.

The Python solver uses second-order finite differences, a complex Thomas solve, and discrete transparent outgoing-wave lead conditions. It calculates stationary flux ratios R and T with identical electron mass and zero asymptotic potential on both sides. Rectangle analytic comparisons, parameter sweeps, CSV export and all existing CLI functionality remain available.

```sh
python3 simulate.py --energy 1 --height 2 --width 0.5 --output results/demo
python3 simulate.py --sweep width --start 0 --stop 2 --count 81 --output results/width-sweep
python3 validate.py
```

`validate.py --plots` optionally requires matplotlib. The normal simulator and validation report need only the Python standard library. The existing Chinese derivation is preserved in `docs/technical-blog.zh-CN.md` as a stationary-model article.

## Verification

```sh
python3 -m unittest discover -s tests -v
node --test tests/test_packet.mjs
```

The independent JavaScript physics tests need Node.js 22+ (the browser application itself does not need Node). Seven wave-packet tests check free group motion and dispersion, probability conservation, spectrum-weighted rectangular transmission, suppression by barrier height, double-barrier resonance versus detuning, spatial/time refinement, boundary relocation, and a challenging supported parameter combination.

Recorded results for this implementation:

| Check | Result |
|---|---:|
| Default packet transmission, Δx = 0.020 nm | 0.34140753 |
| Same packet, Δx = 0.010 nm | 0.34180215 |
| Independent continuum spectrum integral | 0.34193381 |
| Default norm after scattering | 1.00000000000348 |
| Default outer-edge probability at final time | 6.33 × 10⁻²⁷ |
| Resonance preset transmitted fraction | 0.65749863 |
| Off-resonance transmitted fraction | 0.16325492 |

These are numerical regression checks, not a guarantee for every possible potential or observation time. The tests use the same numerical engine as the browser worker, and their references do not use its propagator.

## Sources and license

- Ross L. Spencer and Michael Ware, [Computational Physics 430, Labs 8–9](https://physics.byu.edu/courses/computational/docs/phys430/phys430.pdf), Brigham Young University, revised 2018: implicit methods, Crank–Nicolson, Gaussian packets and tunneling.
- W. van Dijk and F. M. Toyama, [Accurate numerical solutions of the time-dependent Schrödinger equation](https://arxiv.org/abs/physics/0701150), 2007: Crank–Nicolson methods and wave-packet scattering.
- Richard Fitzpatrick, [Square Potential Barrier](https://farside.ph.utexas.edu/teaching/qmech/Quantum/node48.html), University of Texas: continuum rectangular-barrier scattering reference.

These are mathematical references, not imported code dependencies. All numerical and interface additions were independently implemented. The project is provided under the [MIT License](LICENSE); no third-party numerical code license is required.

## Hosting

This repository contains the complete runnable application. The wave-packet solver runs in a browser worker, while stationary simulations, sweeps and the 3D parameter surface use the Python API. Static hosting alone (including GitHub Pages) does not run the full application. The included server binds to localhost and is intended for local use.
