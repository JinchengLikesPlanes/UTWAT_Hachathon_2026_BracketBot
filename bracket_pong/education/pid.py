"""Repeatable position-hold experiments using the wheel-driven MuJoCo model."""
from dataclasses import dataclass

import mujoco
import numpy as np

from bracket_pong.rally import RallySim


@dataclass(frozen=True)
class PIDGains:
    kp: float = 3.2
    ki: float = 0.35
    kd: float = 1.1


DISTURBANCES = {
    "push": {"label": "Quick push", "force": 230.0, "start": 0.65, "end": 0.73},
    "long_push": {"label": "Long push", "force": 70.0, "start": 0.65, "end": 1.25},
    "steady_pull": {"label": "Steady pull", "force": 22.0, "start": 0.65, "end": 7.4},
}


def run_pid_experiment(gains: PIDGains, disturbance: str = "push", seconds: float = 8.0):
    if disturbance not in DISTURBANCES:
        raise ValueError(f"Unknown disturbance: {disturbance}")
    if not (0 <= gains.kp <= 8 and 0 <= gains.ki <= 2 and 0 <= gains.kd <= 4):
        raise ValueError("PID gains are outside the lesson limits")

    sim = RallySim(mobile=True)
    # The lab pushes along x, so the chassis must face +x with its wheels free to roll.
    sim.rest_heading, sim.rest_base = 0.0, 0.0
    sim.reset()
    target = float(sim.data.qpos[sim.cq])
    body_id = sim.model.body("robot_mount").id
    wheel_radius = 0.0846
    integral = 0.0
    previous_measurement = target
    derivative = 0.0
    trajectory = []
    spec = DISTURBANCES[disturbance]
    control_dt = 0.02
    physics_steps = round(control_dt / sim.model.opt.timestep)

    for step in range(round(seconds / control_dt)):
        now = step * control_dt
        position = float(sim.data.qpos[sim.cq])
        measurement_rate = (position - previous_measurement) / control_dt
        derivative = 0.72 * derivative + 0.28 * measurement_rate
        error = target - position
        proposed_integral = float(np.clip(integral + error * control_dt, -0.7, 0.7))
        raw = gains.kp * error + gains.ki * proposed_integral - gains.kd * derivative
        command = float(np.clip(raw, -0.65, 0.65))
        if abs(raw) <= 0.65 or np.sign(error) != np.sign(raw):
            integral = proposed_integral
        previous_measurement = position
        wheel_speed = command / wheel_radius
        sim.data.ctrl[sim.wheels] += np.clip(wheel_speed - sim.data.ctrl[sim.wheels], -0.8, 0.8)
        sim.data.xfrc_applied[body_id, 0] = spec["force"] if spec["start"] <= now < spec["end"] else 0.0
        for _ in range(physics_steps):
            mujoco.mj_step(sim.model, sim.data)
        if step % 2 == 0:
            trajectory.append({
                "time": round(now, 2), "position": round(position - target, 4),
                "target": 0.0, "output": round(command, 4),
                "p": round(gains.kp * error, 4), "i": round(gains.ki * integral, 4),
                "d": round(-gains.kd * derivative, 4),
            })

    tail = [abs(point["position"]) for point in trajectory if point["time"] >= seconds - 2]
    values = [abs(point["position"]) for point in trajectory]
    return {
        "trajectory": trajectory,
        "metrics": {
            "max_error_cm": round(max(values, default=0) * 100, 1),
            "final_error_cm": round(values[-1] * 100, 1),
            "tail_error_cm": round(max(tail, default=0) * 100, 1),
            "stable": bool(tail and max(tail) <= 0.05),
        },
        "disturbance": {"id": disturbance, "label": spec["label"]},
    }
