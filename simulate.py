"""Export a single stationary scattering solution or a parameter sweep."""

import argparse
import csv
import json
from pathlib import Path

from quantum_tunneling import Parameters, simulate, sweep


def main():
    parser = argparse.ArgumentParser(description="一维电子隧穿模拟；单位 eV、nm")
    for name, default in (("energy", 1), ("height", 2), ("width", 0.5),
                          ("gap", 0.5), ("dx", 0.005)):
        parser.add_argument(f"--{name}", type=float, default=default)
    parser.add_argument("--shape", choices=["rectangle", "triangle", "double"], default="rectangle")
    parser.add_argument("--output", type=Path, default=Path("results/demo"), help="输出文件前缀")
    parser.add_argument("--sweep", choices=["energy", "height", "width"])
    parser.add_argument("--start", type=float)
    parser.add_argument("--stop", type=float)
    parser.add_argument("--count", type=int, default=81)
    args = parser.parse_args()
    p = Parameters(**{name: getattr(args, name) for name in Parameters.__dataclass_fields__})
    try:
        if args.sweep:
            ranges = {"width": (0, 2), "height": (0, 8), "energy": (0.05, 5)}
            low, high = ranges[args.sweep]
            data = sweep(p, args.sweep, low if args.start is None else args.start,
                         high if args.stop is None else args.stop, args.count)
            fields = [args.sweep, "transmission", "analytic_transmission"]
            rows = zip(data["values"], data["transmission"], data["analytic"])
        else:
            if args.start is not None or args.stop is not None:
                parser.error("--start/--stop 需与 --sweep 一起使用")
            data = simulate(p)
            fields = ["x_nm", "potential_eV", "psi_real", "psi_imag", "relative_density"]
            rows = zip(*(data[key] for key in ("x", "potential", "real", "imag", "density")))
    except ValueError as error:
        parser.error(str(error))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    json_path = Path(str(args.output) + ".json")
    csv_path = Path(str(args.output) + ".csv")
    json_path.write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    with csv_path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.writer(stream)
        writer.writerow(fields)
        writer.writerows(rows)
    if not args.sweep:
        print(f"T = {data['transmission']:.12g}, R = {data['reflection']:.12g}")
        print(f"|T+R-1| = {data['conservation_error']:.3e}")
        if data["analytic_transmission"] is not None:
            print(f"解析 T = {data['analytic_transmission']:.12g}; 绝对误差 = {data['absolute_error']:.3e}")
    print(f"已保存 {json_path} 和 {csv_path}")


if __name__ == "__main__":
    main()
