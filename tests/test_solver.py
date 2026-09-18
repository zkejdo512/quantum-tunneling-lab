import math
import unittest

from quantum_tunneling.solver import KINETIC, Parameters, analytic_transmission, simulate, sweep


class SolverPhysicsTests(unittest.TestCase):
    def test_zero_barrier_and_zero_width_are_fully_transmitted(self):
        cases = (
            Parameters(energy=1.0, height=0.0, width=0.5, dx=0.005),
            Parameters(energy=1.0, height=2.0, width=0.0, dx=0.005),
        )
        for params in cases:
            with self.subTest(params=params):
                result = simulate(params)
                self.assertAlmostEqual(result["transmission"], 1.0, delta=1e-10)
                self.assertLess(result["reflection"], 1e-10)

    def test_rectangle_matches_continuum_in_all_energy_regimes(self):
        for energy in (1.0, 2.0, 3.0):
            with self.subTest(energy=energy):
                result = simulate(
                    Parameters(energy=energy, height=2.0, width=0.5, dx=0.0025)
                )
                self.assertIsNotNone(result["analytic_transmission"])
                self.assertLess(result["absolute_error"], 2e-4)
                self.assertAlmostEqual(
                    result["transmission"], result["analytic_transmission"], delta=2e-4
                )

    def test_doubling_subthreshold_width_reduces_tunneling(self):
        short = simulate(Parameters(energy=1.0, height=2.0, width=0.5, dx=0.0025))
        long = simulate(Parameters(energy=1.0, height=2.0, width=1.0, dx=0.0025))
        self.assertLess(long["transmission"], short["transmission"])
        self.assertLess(long["transmission"], 0.01)

    def test_above_barrier_resonance_is_nearly_perfect(self):
        energy = 3.0
        height = 2.0
        width = math.pi * math.sqrt(KINETIC / (energy - height))
        result = simulate(
            Parameters(energy=energy, height=height, width=width, dx=0.0025)
        )
        self.assertGreater(result["transmission"], 1.0 - 1e-7)
        self.assertLess(result["reflection"], 1e-7)

    def test_nonrectangular_shapes_conserve_current(self):
        for shape in ("triangle", "double"):
            with self.subTest(shape=shape):
                result = simulate(
                    Parameters(
                        energy=1.0,
                        height=2.0,
                        width=0.5,
                        gap=0.5,
                        shape=shape,
                        dx=0.005,
                    )
                )
                self.assertIsNone(result["analytic_transmission"])
                self.assertLess(result["conservation_error"], 1e-8)
                self.assertLess(result["current_error"], 1e-8)

    def test_rectangle_grid_error_decreases_at_second_order_rate(self):
        errors = []
        for dx in (0.02, 0.01, 0.005):
            result = simulate(
                Parameters(energy=1.0, height=2.0, width=0.5, dx=dx)
            )
            errors.append(result["absolute_error"])

        self.assertGreater(errors[0], errors[1])
        self.assertGreater(errors[1], errors[2])
        first_ratio = errors[1] / errors[0]
        second_ratio = errors[2] / errors[1]
        self.assertGreater(first_ratio, 0.15)
        self.assertLess(first_ratio, 0.4)
        self.assertGreater(second_ratio, 0.15)
        self.assertLess(second_ratio, 0.4)


class SolverValidationTests(unittest.TestCase):
    def test_nan_and_infinity_are_rejected(self):
        invalid_parameters = (
            Parameters(energy=math.nan),
            Parameters(height=math.inf),
            Parameters(width=-math.inf),
            Parameters(dx=math.nan),
        )
        for params in invalid_parameters:
            with self.subTest(params=params):
                with self.assertRaises(ValueError):
                    simulate(params)

        with self.assertRaises(ValueError):
            analytic_transmission(math.inf, 2.0, 0.5)
        with self.assertRaises(ValueError):
            sweep(Parameters(), start=math.nan, stop=1.0, count=3)

    def test_sweep_includes_endpoints_and_requested_count(self):
        result = sweep(
            Parameters(energy=1.0, height=2.0, width=0.5, dx=0.01),
            variable="width",
            start=0.1,
            stop=0.6,
            count=5,
        )
        self.assertEqual(result["variable"], "width")
        self.assertEqual(len(result["values"]), 5)
        self.assertEqual(len(result["transmission"]), 5)
        self.assertEqual(len(result["analytic"]), 5)
        self.assertAlmostEqual(result["values"][0], 0.1)
        self.assertAlmostEqual(result["values"][-1], 0.6)
        self.assertTrue(all(value is not None for value in result["analytic"]))

    def test_nonrectangular_sweep_has_no_analytic_reference(self):
        for shape in ("triangle", "double"):
            with self.subTest(shape=shape):
                result = sweep(
                    Parameters(
                        energy=1.0,
                        height=2.0,
                        width=0.5,
                        gap=0.4,
                        shape=shape,
                        dx=0.01,
                    ),
                    variable="width",
                    start=0.1,
                    stop=0.6,
                    count=4,
                )
                self.assertEqual(len(result["analytic"]), 4)
                self.assertTrue(all(value is None for value in result["analytic"]))


if __name__ == "__main__":
    unittest.main()
