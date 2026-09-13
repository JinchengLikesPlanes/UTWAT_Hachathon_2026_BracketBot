"""Build MJCF from the source URDF without modifying the source asset.

URDF frames/visuals are preserved. Inertias and collision masks are deliberate
simulation approximations; see PLAN.md. Inactive joints are fixed at zero.
"""
from pathlib import Path
import xml.etree.ElementTree as ET

import mujoco
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
ASSET_ROOT = ROOT / "chopped_urdf_v2/chopped_urdf_v2"
URDF = ASSET_ROOT / "urdf/chopped_urdf_v2.urdf"
ARM_JOINTS = tuple(f"rj{i}" for i in range(1, 7))
TABLE_HEIGHT = 0.76
TABLE_HALF_LENGTH = 1.37
TABLE_HALF_WIDTH = 0.7625
BALL_RADIUS = 0.02


def rotation(rpy):
    r, p, y = rpy
    cr, cp, cy = np.cos([r, p, y])
    sr, sp, sy = np.sin([r, p, y])
    return np.array([
        [cy*cp, cy*sp*sr-sy*cr, cy*sp*cr+sy*sr],
        [sy*cp, sy*sp*sr+cy*cr, sy*sp*cr-cy*sr],
        [-sp, cp*sr, cp*cr],
    ])


def pose(origin):
    if origin is None:
        return {"pos": "0 0 0", "quat": "1 0 0 0"}
    quat = np.zeros(4)
    mujoco.mju_mat2Quat(quat, rotation(np.fromstring(origin.get("rpy", "0 0 0"), sep=" ")).ravel())
    return {"pos": origin.get("xyz", "0 0 0"), "quat": " ".join(map(str, quat))}


def build_xml(lift_enabled=False):
    source = ET.parse(URDF).getroot()
    links = {e.get("name"): e for e in source.findall("link")}
    children = {}
    child_names = set()
    for joint in source.findall("joint"):
        parent = joint.find("parent").get("link")
        children.setdefault(parent, []).append(joint)
        child_names.add(joint.find("child").get("link"))
    roots = set(links) - child_names
    if roots != {"root"}:
        raise ValueError(f"Unexpected URDF roots: {roots}")

    mj = ET.Element("mujoco", model="bracket_pong")
    ET.SubElement(mj, "compiler", angle="radian", autolimits="true")
    ET.SubElement(mj, "option", timestep="0.001", integrator="implicitfast", gravity="0 0 -9.81")
    visual = ET.SubElement(mj, "visual")
    ET.SubElement(visual, "global", offwidth="1280", offheight="720")
    defaults = ET.SubElement(mj, "default")
    ET.SubElement(defaults, "geom", friction="0.25 0.005 0.0001", solref="0.006 0.3", solimp="0.95 0.99 0.001")
    assets = ET.SubElement(mj, "asset")
    world = ET.SubElement(mj, "worldbody")
    ET.SubElement(world, "light", pos="0 -2 5", dir="0 0 -1", diffuse="0.8 0.8 0.8")
    ET.SubElement(world, "geom", name="floor", type="plane", size="5 5 0.1", rgba="0.09 0.12 0.17 1")
    ET.SubElement(world, "geom", name="table", type="box", pos="0 0 0.735", size="1.37 0.7625 0.025", rgba="0.04 0.3 0.36 1")
    ET.SubElement(world, "geom", name="net", type="box", pos="0 0 0.83625", size="0.006 0.79 0.07625", rgba="0.8 0.85 0.9 0.7")
    for x in (-1.05, 1.05):
        for y in (-0.55, 0.55):
            ET.SubElement(world, "geom", type="box", pos=f"{x} {y} 0.355", size="0.035 0.035 0.355", contype="0", conaffinity="0", rgba="0.2 0.23 0.28 1")
    wrapper = ET.SubElement(world, "body", name="robot_mount", pos="-1.65 0 0")
    actuator = ET.SubElement(mj, "actuator")
    mesh_names = {}

    def add_link(name, parent, joint=None):
        body = ET.SubElement(parent, "body", name=name, **pose(joint.find("origin") if joint is not None else None))
        if joint is not None and joint.get("name") == "rj0" and lift_enabled:
            ET.SubElement(body, "joint", name="rj0", type="slide", axis=joint.find("axis").get("xyz"), range="-1.03044 0", damping="20", armature="0.2")
            ET.SubElement(body, "inertial", pos="0 0 0", mass="0.5", diaginertia="0.003 0.003 0.003")
            # Surrogate lift drive, not the uncalibrated URDF's 10 N actuator.
            ET.SubElement(actuator, "position", name="servo_rj0", joint="rj0", kp="10000", kv="200", ctrlrange="-1.03044 0", forcerange="-200 200")
        if joint is not None and joint.get("name") in ARM_JOINTS:
            limit = joint.find("limit")
            jname = joint.get("name")
            ET.SubElement(body, "joint", name=jname, type="hinge", axis=joint.find("axis").get("xyz"), range=f'{limit.get("lower")} {limit.get("upper")}', damping="0.2", armature="0.02")
            # Explicit surrogate, not copied from suspicious CAD mass values.
            ET.SubElement(body, "inertial", pos="0 0 0", mass="0.3", diaginertia="0.002 0.002 0.002")
            ET.SubElement(actuator, "position", name=f"servo_{jname}", joint=jname, kp="60", kv="4", ctrlrange=f'{limit.get("lower")} {limit.get("upper")}', forcerange="-10 10")
        for v in links[name].findall("visual"):
            mesh = v.find("geometry/mesh")
            if mesh is None:
                raise ValueError(f"Unsupported non-mesh visual on {name}")
            filename = Path(mesh.get("filename")).name
            if filename not in mesh_names:
                mesh_names[filename] = f"mesh_{len(mesh_names)}"
                ET.SubElement(assets, "mesh", name=mesh_names[filename], file=str(ASSET_ROOT / "meshes" / filename), scale=mesh.get("scale", "1 1 1"))
            color = v.find("material/color")
            ET.SubElement(body, "geom", type="mesh", mesh=mesh_names[filename], **pose(v.find("origin")), rgba=color.get("rgba") if color is not None else "0.7 0.7 0.7 1", contype="0", conaffinity="0", group="1", mass="0")
        if name == "right_eef":
            ET.SubElement(body, "geom", name="paddle", type="cylinder", size="0.09 0.008", pos="0 0 0.10", mass="0.17", rgba="0.9 0.12 0.09 1")
            ET.SubElement(body, "geom", name="handle", type="capsule", fromto="0 0 0 0 0 0.10", size="0.013", contype="0", conaffinity="0", mass="0.03", rgba="0.65 0.42 0.22 1")
            ET.SubElement(body, "site", name="paddle_center", pos="0 0 0.10", size="0.008", rgba="1 1 0 1")
        for child in children.get(name, []):
            add_link(child.find("child").get("link"), body, child)

    add_link("root", wrapper)
    ball = ET.SubElement(world, "body", name="ball", pos="0.7 0 1.1")
    ET.SubElement(ball, "freejoint", name="ball_free")
    ET.SubElement(ball, "geom", name="ball_geom", type="sphere", size=str(BALL_RADIUS), mass="0.0027", rgba="1 0.75 0.15 1")
    return ET.tostring(mj, encoding="unicode")


def load_model(lift_enabled=False):
    return mujoco.MjModel.from_xml_string(build_xml(lift_enabled))
