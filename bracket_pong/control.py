"""Deterministic pose setup and controller utilities (not learned policies)."""
import mujoco
import numpy as np

from bracket_pong.model import ARM_JOINTS


def arm_indices(model):
    joints = [model.joint(n).id for n in ARM_JOINTS]
    return model.jnt_qposadr[joints], model.jnt_dofadr[joints]


def solve_pose(model, target=(-1.40, -0.15, 1.05), seed=0):
    """Damped IK for startup only; never teleports the arm during an episode."""
    data = mujoco.MjData(model)
    qids, vids = arm_indices(model)
    sid = model.site("paddle_center").id
    lo, hi = model.jnt_range[[model.joint(n).id for n in ARM_JOINTS]].T
    rng = np.random.default_rng(seed)
    best = (np.inf, np.zeros(6))
    jp, jr = np.zeros((3, model.nv)), np.zeros((3, model.nv))
    for attempt in range(12):
        data.qpos[qids] = 0 if attempt == 0 else rng.uniform(-1.5, 1.5, 6)
        for _ in range(200):
            mujoco.mj_forward(model, data)
            normal = data.site_xmat[sid].reshape(3, 3)[:, 2]
            error = np.r_[np.asarray(target) - data.site_xpos[sid], 0.3*np.cross(normal, [1, 0, 0])]
            score = np.linalg.norm(error[:3]) + 0.3 * (1 - normal[0])
            if score < best[0]:
                best = score, data.qpos[qids].copy()
            if score < 0.001:
                return best[1]
            mujoco.mj_jacSite(model, data, jp, jr, sid)
            jac = np.vstack([jp[:, vids], 0.3*jr[:, vids]])
            dq = jac.T @ np.linalg.solve(jac @ jac.T + 0.001*np.eye(6), error)
            data.qpos[qids] = np.clip(data.qpos[qids] + np.clip(dq, -0.15, 0.15), lo+0.01, hi-0.01)
    if best[0] > 0.03:
        raise RuntimeError(f"Ready pose unreachable: error {best[0]:.3f}")
    return best[1]
