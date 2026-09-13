"""Rally scene: original robot, bounded chassis and an actuated human paddle."""
import xml.etree.ElementTree as ET
import mujoco
import numpy as np
from bracket_pong.model import build_xml


def load_rally_model(mobile=False):
    root = ET.fromstring(build_xml(lift_enabled=True))
    root.set("model", "bracket_rally_v1")
    root.find("default/geom").set("solref", "0.008 0.15")
    root.find("default/geom").set("friction", "0.05 0.001 0.0001")
    world, actuators = root.find("worldbody"), root.find("actuator")
    mount = world.find("body[@name='robot_mount']")
    ET.SubElement(mount, "joint", name="base_y", type="slide", axis="0 1 0", range="-0.45 0.45", damping="5")
    ET.SubElement(mount, "inertial", mass="20", pos="0 0 0.15", diaginertia="1 1 1")
    ET.SubElement(mount, "geom", name="chassis_guard", type="box", pos="0 0 0.2", size="0.15 0.18 0.12", rgba="0.12 0.18 0.25 1", contype="2", conaffinity="2", mass="0", group="3")
    ET.SubElement(actuators, "velocity", name="base_drive", joint="base_y", kv="120", ctrlrange="-0.8 0.8", forcerange="-45 45")
    world.find("geom[@name='table']").set("conaffinity", "3")
    world.find("geom[@name='table']").set("contype", "3")
    for name,pos,size in (
        ("edge_left","0 -0.751 0.761","1.37 0.006 0.001"),
        ("edge_right","0 0.751 0.761","1.37 0.006 0.001"),
        ("edge_robot","-1.358 0 0.761","0.006 0.7625 0.001"),
        ("edge_human","1.358 0 0.761","0.006 0.7625 0.001"),
        ("center_line","0 0 0.761","1.37 0.003 0.001")):
        ET.SubElement(world,"geom",name=name,type="box",pos=pos,size=size,rgba="0.85 0.92 0.94 1",contype="0",conaffinity="0",mass="0")
    # Conservative capsules between adjacent joint frames, separate from CAD visuals.
    for name in ("shoulder_knuckle__shoulder_knuckle", "bicep__bicep", "forearm__forearm", "forearm_rotation__forearm_rotation", "wrist_knuckle__wrist_knuckle"):
        body = root.find(f".//body[@name='{name}']")
        child = next((b for b in body.findall("body") if b.find("joint") is not None), None)
        if child is not None:
            ET.SubElement(body, "geom", name=f"guard_{name}", type="capsule", fromto=f'0 0 0 {child.get("pos")}', size="0.012", contype="2", conaffinity="2", mass="0", rgba="0.3 0.4 0.5 0", group="3")
    human = ET.SubElement(world, "body", name="human_paddle")
    ET.SubElement(human, "inertial", mass="0.25", pos="0 0 0", diaginertia="0.002 0.002 0.002")
    for axis, limits in (("x", "1.28 1.9"), ("y", "-0.85 0.85"), ("z", "0.84 1.5")):
        vector = {"x":"1 0 0", "y":"0 1 0", "z":"0 0 1"}[axis]
        ET.SubElement(human, "joint", name=f"human_{axis}", type="slide", axis=vector, range=limits, damping="1")
        ET.SubElement(actuators, "position", name=f"human_{axis}", joint=f"human_{axis}", kp="2500", kv="60", ctrlrange=limits, forcerange="-80 80")
    for axis, vector in (("pitch", "0 1 0"), ("yaw", "0 0 1")):
        ET.SubElement(human, "joint", name=f"human_{axis}", type="hinge", axis=vector, range="-0.65 0.65", damping="0.02")
        ET.SubElement(actuators, "position", name=f"human_{axis}", joint=f"human_{axis}", kp="20", kv="0.4", ctrlrange="-0.65 0.65", forcerange="-3 3")
    ET.SubElement(human, "geom", name="human_rubber", type="cylinder", size="0.11 0.008", quat="0.70710678 0 0.70710678 0", rgba="0.12 0.55 0.95 0.85", mass="0")
    ET.SubElement(human, "site", name="human_center", size="0.001")
    if mobile:
        # CAD wheel links are fixed and share assembly frames. Extract their
        # visuals in world coordinates before reparenting onto real axle hinges.
        reference = mujoco.MjModel.from_xml_string(ET.tostring(root, encoding="unicode"))
        data = mujoco.MjData(reference)
        mujoco.mj_forward(reference, data)
        root.set("model", "bracket_rally_wheels_v2")
        mount.remove(mount.find("joint[@name='base_y']"))
        actuators.remove(actuators.find("velocity[@name='base_drive']"))
        ET.SubElement(mount, "freejoint", name="chassis_free")
        floor = world.find("geom[@name='floor']")
        floor.set("contype", "4")
        floor.set("conaffinity", "7")
        for side, y in (("left", .16108), ("right", -.16108)):
            center = np.array([0., y, .0846])
            wheel = ET.SubElement(mount, "body", name=f"drive_{side}", pos=" ".join(map(str, center)))
            ET.SubElement(wheel, "joint", name=f"wheel_{side}", type="hinge", axis="0 1 0", limited="false", damping="0.02", armature="0.002")
            ET.SubElement(wheel, "geom", name=f"tire_{side}", type="cylinder", size="0.0846 0.02265", quat="0.70710678 0.70710678 0 0", mass="0.6", friction="1.2 0.005 0.0001", solref="0.01 1", contype="4", conaffinity="6", rgba="0.08 0.08 0.09 1")
            ET.SubElement(actuators, "velocity", name=f"drive_{side}", joint=f"wheel_{side}", kv="2", ctrlrange="-12 12", forcerange="-3 3")
            for part in ("cap", "tire"):
                body = root.find(f".//body[@name='{side}_wheel_{part}__{side}_wheel_{part}']")
                bid = reference.body(body.get("name")).id
                for geom in list(body.findall("geom")):
                    # Preserve the original visual's body-frame transform.
                    local = np.fromstring(geom.get("pos", "0 0 0"), sep=" ")
                    quat = np.fromstring(geom.get("quat", "1 0 0 0"), sep=" ")
                    composed = np.zeros(4)
                    mujoco.mju_mulQuat(composed, data.xquat[bid], quat)
                    geom.set("pos", " ".join(map(str, data.xpos[bid]+data.xmat[bid].reshape(3,3)@local-np.array([-1.65,0,0])-center)))
                    geom.set("quat", " ".join(map(str, composed)))
                    body.remove(geom)
                    wheel.append(geom)
        # Passive low-friction spherical supports; not lateral propulsion.
        for x in (-.13, .13):
            ET.SubElement(mount, "geom", name=f"support_{x}", type="sphere", pos=f"{x} 0 0.025", size="0.025", mass="0.1", friction="0.005 0.0001 0.0001", solref="0.01 1", contype="4", conaffinity="6", rgba="0.2 0.2 0.2 1")
    model = mujoco.MjModel.from_xml_string(ET.tostring(root, encoding="unicode"))
    model.vis.headlight.ambient[:] = 0.4
    return model
