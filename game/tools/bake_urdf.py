"""Bake the BracketBot URDF into game/assets/robot/robot.json.

Output shape (parents before children):
  { "links": [ { name, parent, joint: {name,type,lower,upper,mimic}|null,
                 xyz, rpy, visual: {xyz, rpy}|null, mesh, color } ],
    "check": { "<link>": [x, y, z] } }   # zero-pose world positions from numpy FK

URDF rpy is fixed-axis XYZ: R = Rz(yaw) @ Ry(pitch) @ Rx(roll). The JS loader
must reproduce the `check` positions (see game/tests/robot_fk.test.mjs).
"""
from __future__ import annotations

import argparse
import json
import math
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np

CHECK_LINKS = ["right_eef", "left_eef", "left_wheel_tire__left_wheel_tire", "head__head__head__head"]


def floats(s: str | None, n: int) -> list[float]:
    if not s:
        return [0.0] * n
    return [float(v) for v in s.split()]


def rot(rpy: list[float]) -> np.ndarray:
    r, p, y = rpy
    cr, sr, cp, sp, cy, sy = math.cos(r), math.sin(r), math.cos(p), math.sin(p), math.cos(y), math.sin(y)
    rx = np.array([[1, 0, 0], [0, cr, -sr], [0, sr, cr]])
    ry = np.array([[cp, 0, sp], [0, 1, 0], [-sp, 0, cp]])
    rz = np.array([[cy, -sy, 0], [sy, cy, 0], [0, 0, 1]])
    return rz @ ry @ rx


def transform(xyz: list[float], rpy: list[float]) -> np.ndarray:
    t = np.eye(4)
    t[:3, :3] = rot(rpy)
    t[:3, 3] = xyz
    return t


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--urdf", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--draco", default=None, help="dir holding the .glb meshes (default: <urdf>/../../draco)")
    args = ap.parse_args()

    urdf = Path(args.urdf)
    draco = Path(args.draco) if args.draco else urdf.parent.parent / "draco"
    root = ET.parse(urdf).getroot()

    links: dict[str, dict] = {}
    for el in root.findall("link"):
        name = el.get("name")
        vis = el.find("visual")
        mesh = color = visual = None
        if vis is not None:
            m = vis.find("geometry/mesh")
            if m is not None:
                mesh = Path(m.get("filename")).stem + ".glb"
                assert (draco / mesh).exists(), f"missing {draco / mesh}"
            c = vis.find("material/color")
            if c is not None:
                color = floats(c.get("rgba"), 4)[:3]
            o = vis.find("origin")
            if o is not None:
                xyz, rpy = floats(o.get("xyz"), 3), floats(o.get("rpy"), 3)
                if any(abs(v) > 1e-12 for v in xyz + rpy):
                    visual = {"xyz": xyz, "rpy": rpy}
        links[name] = {"name": name, "parent": None, "joint": None, "xyz": [0, 0, 0], "rpy": [0, 0, 0],
                       "visual": visual, "mesh": mesh, "color": color or [0.8, 0.8, 0.8]}

    joints = root.findall("joint")
    for j in joints:
        child = j.find("child").get("link")
        parent = j.find("parent").get("link")
        o = j.find("origin")
        axis = j.find("axis")
        if axis is not None and j.get("type") != "fixed":
            assert floats(axis.get("xyz"), 3) == [0.0, 0.0, 1.0], f"{j.get('name')} axis is not +Z"
        lim = j.find("limit")
        mim = j.find("mimic")
        links[child]["parent"] = parent
        links[child]["xyz"] = floats(o.get("xyz") if o is not None else None, 3)
        links[child]["rpy"] = floats(o.get("rpy") if o is not None else None, 3)
        links[child]["joint"] = {
            "name": j.get("name"),
            "type": j.get("type"),
            "lower": float(lim.get("lower")) if lim is not None and lim.get("lower") else None,
            "upper": float(lim.get("upper")) if lim is not None and lim.get("upper") else None,
            "mimic": {"joint": mim.get("joint"), "multiplier": float(mim.get("multiplier", 1)),
                      "offset": float(mim.get("offset", 0))} if mim is not None else None,
        }

    # Topological order: parents before children.
    ordered: list[dict] = []
    seen: set[str] = set()

    def visit(name: str) -> None:
        if name in seen:
            return
        p = links[name]["parent"]
        if p:
            visit(p)
        seen.add(name)
        ordered.append(links[name])

    for name in links:
        visit(name)

    world: dict[str, np.ndarray] = {}
    for l in ordered:
        local = transform(l["xyz"], l["rpy"])
        world[l["name"]] = (world[l["parent"]] @ local) if l["parent"] else local
    check = {n: [round(float(v), 9) for v in world[n][:3, 3]] for n in CHECK_LINKS}

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"links": ordered, "check": check}, indent=1))
    roots = [l["name"] for l in ordered if l["parent"] is None]
    movable = sum(1 for l in ordered if l["joint"] and l["joint"]["type"] != "fixed")
    print(f"{len(ordered)} links, {len(joints)} joints ({movable} movable), root={roots}, wrote {out}")
    for n, p in check.items():
        print(f"  {n}: {p}")


if __name__ == "__main__":
    main()
