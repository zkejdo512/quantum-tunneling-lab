"""Central differences with exact discrete outgoing-wave lead conditions.

The analytic rectangle formula is an independent benchmark, never the numerical
solver. Incident amplitude is one, and both leads have V=0 and electron mass.
"""

from dataclasses import asdict, dataclass, replace
import cmath
import math

# hbar**2 / (2 m_e), in eV nm**2 (rounded to 10 significant figures).
KINETIC = 0.0380998212


@dataclass(frozen=True)
class Parameters:
    energy: float = 1.0
    height: float = 2.0
    width: float = 0.5
    shape: str = "rectangle"
    gap: float = 0.5
    dx: float = 0.005

    def validate(self):
        limits = {"energy": (0.01, 10.0), "height": (0.0, 20.0),
                  "width": (0.0, 3.0), "gap": (0.0, 3.0),
                  "dx": (0.0005, 0.02)}
        for name, (low, high) in limits.items():
            value = getattr(self, name)
            if not isinstance(value, (int, float)) or not math.isfinite(value):
                raise ValueError(f"{name} must be finite")
            if not low <= value <= high:
                raise ValueError(f"{name} must be between {low} and {high}")
        if self.shape not in ("rectangle", "triangle", "double"):
            raise ValueError("shape must be rectangle, triangle or double")
        return self


def analytic_transmission(energy, height, width):
    """Continuum rectangle T, including E=V and very opaque barriers.

    Positive E, nonnegative height and width; no finite-difference calculation.
    """
    if not all(math.isfinite(v) for v in (energy, height, width)):
        raise ValueError("Parameters must be finite")
    if energy <= 0 or height < 0 or width < 0:
        raise ValueError("Require E>0, V>=0, a>=0")
    if height == 0 or width == 0:
        return 1.0
    delta = height - energy
    z = width * math.sqrt(abs(delta) / KINETIC)
    # sinh(z)/z and sin(z)/z have the same limit 1, avoiding 0/0.
    if z < 1e-5:
        ratio = 1.0 + (1 if delta >= 0 else -1) * z * z / 6
        return 1 / (1 + height**2 * width**2 / (4 * energy * KINETIC) * ratio**2)
    if delta > 0:
        # Evaluate in the log domain so sinh(z)**2 cannot overflow.
        log_sinh = z + math.log(-math.expm1(-2 * z)) - math.log(2)
        log_factor = 2 * math.log(height) - math.log(4 * energy * delta) + 2 * log_sinh
        if log_factor > 0:
            inverse = math.exp(-log_factor)
            return inverse / (1 + inverse)
        return 1 / (1 + math.exp(log_factor))
    return 1 / (1 + height**2 * math.sin(z)**2 / (4 * energy * (-delta)))


def _grid(p):
    # Each barrier comprises an integer number of cells, so its specified
    # width is exact, even under refinement. Sites are at cell midpoints.
    cells = max(1, math.ceil(p.width / p.dx)) if p.width else 0
    dx = p.width / cells if cells else p.dx
    # Avoid unbounded allocations for vanishing user-supplied widths.
    if dx < 0.0001:
        raise ValueError("Nonzero barrier width must be at least 0.0001 nm; use 0 for no barrier")
    pad = max(2, math.ceil(1.2 / dx))
    gap_cells = round(p.gap / dx) if p.shape == "double" and cells else 0
    body = 2 * cells + gap_cells if p.shape == "double" else cells
    count = 2 * pad + body
    if count > 100000:
        raise ValueError("Grid too large; increase dx or reduce the spatial extent")
    x = [(j - pad + 0.5) * dx for j in range(count)]
    potential = [0.0] * count
    for i in range(cells):
        if p.shape == "triangle":
            potential[pad + i] = p.height * (1 - abs(2 * (i + 0.5) / cells - 1))
        else:
            potential[pad + i] = p.height
            if p.shape == "double":
                potential[pad + cells + gap_cells + i] = p.height
    return x, potential, dx, gap_cells * dx


def _tridiagonal(diagonal, rhs):
    """O(N) complex Thomas solve; both off-diagonals equal -1.

    For this real potential and open, propagating leads, the imaginary part
    supplied by the boundary conditions keeps elimination pivots nonzero.
    """
    d = list(diagonal)
    b = list(rhs)
    for j in range(1, len(d)):
        inv = 1 / d[j - 1]
        d[j] -= inv
        b[j] += b[j - 1] * inv
    answer = [0j] * len(d)
    answer[-1] = b[-1] / d[-1]
    for j in range(len(d) - 2, -1, -1):
        answer[j] = (b[j] + answer[j + 1]) / d[j]
    return answer


def simulate(params=None):
    """Solve -C psi''+V psi=E psi with incident wave only from the left."""
    p = (params or Parameters()).validate()
    x, potential, dx, effective_gap = _grid(p)
    hopping = KINETIC / dx**2
    if p.energy >= 4 * hopping:
        raise ValueError("Energy exceeds the grid propagation band; reduce dx")
    # Equivalent to acos(1-E/(2t)), with less cancellation for small dx.
    q = 2 * math.asin(math.sqrt(p.energy / (4 * hopping)))
    phase = cmath.exp(1j * q)
    diagonal = [complex(2 + (v - p.energy) / hopping) for v in potential]
    diagonal[0] -= phase
    diagonal[-1] -= phase
    rhs = [0j] * len(x)
    rhs[0] = -2j * math.sin(q)
    psi = _tridiagonal(diagonal, rhs)
    transmission = abs(psi[-1])**2
    reflection = abs(psi[0] - 1)**2
    analytic = analytic_transmission(p.energy, p.height, p.width) if p.shape == "rectangle" else None
    # Link current normalized by incident current: Im(psi_j* psi_{j+1})/sin(q).
    # This should be constant, and independently equal to T.
    current_error = max(abs((psi[j].conjugate() * psi[j + 1]).imag / math.sin(q)
                            - transmission) for j in range(len(psi) - 1))
    peak = p.height if p.width else 0
    regime = "threshold" if p.energy == peak else "tunneling" if p.energy < peak else "above"
    return {"params": asdict(p), "x": x, "potential": potential,
            "real": [v.real for v in psi], "imag": [v.imag for v in psi],
            "density": [abs(v)**2 for v in psi],
            "transmission": transmission, "reflection": reflection,
            "conservation_error": abs(transmission + reflection - 1),
            "current_error": current_error,
            "analytic_transmission": analytic,
            "absolute_error": abs(transmission - analytic) if analytic is not None else None,
            "dx": dx, "points": len(x), "effective_gap": effective_gap,
            "regime": regime, "method": "central difference / discrete transparent leads"}


def sweep(params=None, variable="width", start=0, stop=2, count=81):
    p = (params or Parameters()).validate()
    if variable not in ("energy", "height", "width"):
        raise ValueError("Sweep variable must be energy, height or width")
    if not isinstance(count, int) or not 2 <= count <= 201:
        raise ValueError("Sweep count must be an integer from 2 to 201")
    if not math.isfinite(start) or not math.isfinite(stop) or start >= stop:
        raise ValueError("Sweep start must be less than stop; both must be finite")
    values = [start + (stop - start) * j / (count - 1) for j in range(count)]
    numerical, analytic, worst = [], [], 0.0
    for value in values:
        result = simulate(replace(p, **{variable: value}))
        numerical.append(result["transmission"])
        analytic.append(result["analytic_transmission"])
        worst = max(worst, result["conservation_error"])
    return {"variable": variable, "values": values, "transmission": numerical,
            "analytic": analytic, "max_conservation_error": worst, "params": asdict(p)}


def surface(params=None, count=41):
    """Numerical T(width, height) at fixed incident energy; rows are heights.

    This is a parameter surface of 1D solutions, not a 3D spatial solver.
    Sampled meshes can miss narrow resonances; they do not certify convergence.
    """
    p = (params or Parameters()).validate()
    if type(count) is not int or not 5 <= count <= 61:
        raise ValueError("Surface count per axis must be an integer from 5 to 61")
    widths = [2.0 * i / (count - 1) for i in range(count)]
    heights = [8.0 * j / (count - 1) for j in range(count)]
    rows, worst = [], 0.0
    for height in heights:
        row = []
        for width in widths:
            result = simulate(replace(p, height=height, width=width))
            row.append(result["transmission"])
            worst = max(worst, result["conservation_error"])
        rows.append(row)
    return {"widths": widths, "heights": heights, "transmission": rows,
            "params": asdict(p), "count": count, "max_conservation_error": worst}
