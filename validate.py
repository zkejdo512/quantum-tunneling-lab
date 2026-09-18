"""Reproduce numerical benchmarks and scans; optionally export publication plots."""

import argparse
import csv
from dataclasses import replace
import json
from pathlib import Path

from quantum_tunneling import Parameters, simulate, sweep


def main():
    parser = argparse.ArgumentParser(description="复现解析对照、网格收敛及三组扫描")
    parser.add_argument("--output", type=Path, default=Path("results"))
    parser.add_argument("--plots", action="store_true", help="额外输出PNG/SVG图（此选项需要matplotlib）")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    p = Parameters()
    baseline = simulate(p)
    compact = lambda result: {key: result[key] for key in ("params", "dx", "points", "transmission",
        "reflection", "conservation_error", "current_error", "analytic_transmission", "absolute_error")}
    convergence = [compact(simulate(replace(p, dx=step))) for step in (0.02, 0.01, 0.005, 0.0025)]
    benchmarks = [compact(simulate(replace(p, energy=energy, width=width, dx=0.0025)))
                  for energy in (0.2, 1, 2, 3, 5) for width in (0.2, 0.5, 1.0)]
    scans = {name: sweep(p, name, low, high, 81) for name, low, high in
             (("width", 0, 2), ("height", 0, 8), ("energy", 0.05, 5))}
    report = {"baseline": compact(baseline), "convergence": convergence, "benchmarks": benchmarks,
              "max_benchmark_absolute_error": max(r["absolute_error"] for r in benchmarks),
              "max_benchmark_conservation_error": max(r["conservation_error"] for r in benchmarks),
              "scans": scans}
    (args.output / "validation.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    for name, scan in scans.items():
        with (args.output / f"sweep-{name}.csv").open("w", newline="", encoding="utf-8") as stream:
            writer = csv.writer(stream)
            writer.writerow([name, "numerical_T", "analytic_T"])
            writer.writerows(zip(scan["values"], scan["transmission"], scan["analytic"]))
    lines = ["# 数值验证报告", "", "由 `python3 validate.py` 生成。所有能量为 eV，长度为 nm。", "",
             "默认矩形势垒：E=1，V₀=2，a=0.5。透射率是概率流比。", "",
             "| dx | 数值 T | 解析 T | 绝对误差 | 流守恒误差 |", "|---:|---:|---:|---:|---:|"]
    for row in convergence:
        lines.append(f"| {row['dx']:.4f} | {row['transmission']:.10f} | {row['analytic_transmission']:.10f} | "
                     f"{row['absolute_error']:.3e} | {row['conservation_error']:.3e} |")
    lines += ["", f"15 个解析对照案例最大绝对误差：{report['max_benchmark_absolute_error']:.3e}。",
              f"最大流守恒误差：{report['max_benchmark_conservation_error']:.3e}。", "",
              "注意：流守恒检验离散方程内部一致性，不能代替连续模型的网格收敛检验。",
              "双势垒可能有窄共振；81点扫描仅供探索，可能漏掉窄峰，需局部加密扫描和网格。"]
    (args.output / "validation.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    if args.plots:
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
        except ImportError:
            parser.exit(1, "数据报告已生成；--plots 额外需要安装 matplotlib。\n")
        plt.rcParams.update({"font.size": 10, "axes.spines.top": False, "axes.spines.right": False,
                             "axes.titleweight": "bold", "figure.facecolor": "#f6f8fa"})
        fig, axes = plt.subplots(2, 2, figsize=(12, 8), layout="constrained")
        for ax, name, title, xlabel in zip(axes.flat, ("width", "height", "energy"),
                ("Wider barriers suppress tunneling", "Barrier height changes transmission", "Above-barrier interference"),
                ("Barrier width (nm)", "Barrier height (eV)", "Incident energy (eV)")):
            scan = scans[name]
            ax.plot(scan["values"], scan["transmission"], color="#008d82", lw=2, label="Finite difference")
            ax.plot(scan["values"], scan["analytic"], "--", color="#c45e35", lw=1.4, label="Continuum analytic")
            ax.set(xlabel=xlabel, ylabel="Transmission T", title=title)
            if name != "energy":
                ax.set_yscale("log")
            ax.grid(alpha=0.16)
            ax.legend(frameon=False)
        ax = axes[1, 1]
        steps = [r["dx"] for r in convergence]
        errors = [r["absolute_error"] for r in convergence]
        ax.loglog(steps, errors, "o-", color="#008d82", label="Measured absolute error")
        ax.loglog(steps, [errors[0] * (s / steps[0])**2 for s in steps], "--", color="#c45e35", label="O(dx²) reference")
        ax.set(xlabel="Grid spacing dx (nm)", ylabel="|T numerical − T analytic|", title="Second-order convergence")
        ax.grid(alpha=0.16)
        ax.legend(frameon=False)
        fig.suptitle("Quantum Tunneling · Numerical Validation\nE = 1 eV, V₀ = 2 eV, a = 0.5 nm unless swept", fontsize=15)
        fig.savefig(args.output / "validation.png", dpi=180)
        fig.savefig(args.output / "validation.svg")
        plt.close(fig)


if __name__ == "__main__":
    main()
