"""Single-shot return task. Physics contacts, not proximity, determine hits."""
from dataclasses import asdict, dataclass

import gymnasium as gym
from gymnasium import spaces
import mujoco
import numpy as np

from bracket_pong.control import arm_indices, solve_pose
from bracket_pong.model import load_model, TABLE_HALF_LENGTH, TABLE_HALF_WIDTH, ARM_JOINTS


@dataclass(frozen=True)
class TaskConfig:
    frame_skip: int = 20
    max_steps: int = 150
    shot_spread: float = 0.025
    action_scale: float = 0.5
    lift_enabled: bool = False
    lift_action_scale: float = 0.2
    speed_min: float = 0.0
    speed_max: float = 0.0
    contact_reward: float = 2.0
    success_reward: float = 10.0
    failure_penalty: float = 2.0

    def __post_init__(self):
        if self.frame_skip < 1 or self.max_steps < 1 or self.shot_spread < 0 or self.action_scale <= 0:
            raise ValueError("Invalid task configuration")
        if not 0 < self.lift_action_scale <= 1.03044:
            raise ValueError("Lift action scale must be within its travel")
        if (self.speed_min, self.speed_max) != (0, 0) and not 1.5 <= self.speed_min <= self.speed_max <= 5:
            raise ValueError("Feed speeds must be between 1.5 and 5 m/s")
        if min(self.contact_reward, self.success_reward, self.failure_penalty) < 0:
            raise ValueError("Lesson reward values cannot be negative")


class ReturnEnv(gym.Env):
    metadata = {"render_modes": ["rgb_array"], "render_fps": 50}

    def __init__(self, config=None, render_mode=None):
        super().__init__()
        self.config = config or TaskConfig()
        self.render_mode = render_mode
        self.model = load_model(self.config.lift_enabled)
        self.data = mujoco.MjData(self.model)
        self.qids, self.vids = arm_indices(self.model)
        self.ready = solve_pose(self.model)
        self.arm_actuators = [self.model.actuator(f"servo_{name}").id for name in ARM_JOINTS]
        self.manual_lift_target = None
        if self.config.lift_enabled:
            self.lq = self.model.joint("rj0").qposadr[0]
            self.lv = self.model.joint("rj0").dofadr[0]
            self.la = self.model.actuator("servo_rj0").id
        self.bq = self.model.joint("ball_free").qposadr[0]
        self.bv = self.model.joint("ball_free").dofadr[0]
        self.ball_id = self.model.geom("ball_geom").id
        self.paddle_id = self.model.geom("paddle").id
        self.table_id = self.model.geom("table").id
        self.net_id = self.model.geom("net").id
        self.floor_id = self.model.geom("floor").id
        self.action_space = spaces.Box(-1, 1, (7 if self.config.lift_enabled else 6,), dtype=np.float32)
        # q, dq, ball position/velocity, paddle position/normal, last action,
        # contact phase, normalized elapsed time. No hidden action history.
        self.observation_space = spaces.Box(-np.inf, np.inf, (35 if self.config.lift_enabled else 32,), dtype=np.float32)
        self.renderer = None

    @property
    def ball_pos(self):
        return self.data.qpos[self.bq:self.bq+3]

    def _obs(self):
        site = self.data.site("paddle_center")
        obs = np.r_[self.data.qpos[self.qids], self.data.qvel[self.vids],
                     self.ball_pos, self.data.qvel[self.bv:self.bv+3],
                     site.xpos, site.xmat.reshape(3, 3)[:, 2], self.last_action[:6],
                     float(self.hit), self.steps/self.config.max_steps]
        if self.config.lift_enabled:
            obs = np.r_[obs, self.data.qpos[self.lq], self.data.qvel[self.lv], self.last_action[6]]
        return obs.astype(np.float32)

    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)
        options = options or {}
        for key, lo, hi in (("aim_y", -0.25, 0.25), ("aim_z", -0.2, 0.2), ("speed", 1.5, 5.0)):
            if key in options and (not np.isfinite(options[key]) or not lo <= options[key] <= hi):
                raise ValueError(f"{key} must be between {lo} and {hi}")
        mujoco.mj_resetData(self.model, self.data)
        self.data.qpos[self.qids] = self.ready
        self.data.ctrl[self.arm_actuators] = self.ready
        # Settle force-limited arm under gravity before defining the feed target.
        for _ in range(300):
            mujoco.mj_step(self.model, self.data)
        mujoco.mj_forward(self.model, self.data)
        center = self.data.site("paddle_center").xpos.copy()
        spread = self.config.shot_spread
        target = center + np.r_[0, self.np_random.uniform(-spread, spread, 2)]
        target[1] = center[1] + options.get("aim_y", target[1]-center[1])
        target[2] = center[2] + options.get("aim_z", target[2]-center[2])
        # Starter curriculum: feed after the nominal own-side bounce, from the
        # near half. Full cross-net/bounce feeds are a later curriculum stage.
        duration = self.np_random.uniform(0.26, 0.32)
        speed = options.get("speed")
        if speed is None and self.config.speed_min:
            speed = self.np_random.uniform(self.config.speed_min, self.config.speed_max)
        if speed is not None:
            duration = abs(target[0] + 0.55) / speed
        start = np.array([-0.55, target[1], target[2] - 0.03])
        velocity = (target - start) / duration
        velocity[2] += 0.5 * 9.81 * duration
        self.data.qpos[self.bq:self.bq+3] = start
        self.data.qpos[self.bq+3:self.bq+7] = [1, 0, 0, 0]
        self.data.qvel[self.bv:self.bv+6] = np.r_[velocity, 0, 0, 0]
        self.data.time = 0
        self.steps = 0
        self.hit = False
        self.finished = False
        self.last_action = np.zeros(self.action_space.shape)
        self.shot_target = target.copy()
        self.outcome = "in_flight"
        mujoco.mj_forward(self.model, self.data)
        return self._obs(), {"config": asdict(self.config)}

    def step(self, action):
        if self.finished:
            raise RuntimeError("Episode ended; call reset before step")
        action = np.asarray(action, dtype=float)
        if action.shape != self.action_space.shape or not np.isfinite(action).all():
            raise ValueError(f"Action must contain {self.action_space.shape[0]} finite values")
        action = np.clip(action, -1, 1)
        limits = self.model.actuator_ctrlrange[self.arm_actuators]
        self.data.ctrl[self.arm_actuators] = np.clip(self.ready + self.config.action_scale*action[:6], limits[:, 0], limits[:, 1])
        if self.config.lift_enabled:
            target = self.config.lift_action_scale * action[6] if self.manual_lift_target is None else self.manual_lift_target
            self.data.ctrl[self.la] = np.clip(target, -1.03044, 0)
        reward = -0.001*float(action @ action) - 0.002*float(np.sum((action-self.last_action)**2))
        self.last_action = action.copy()
        terminated = False
        for _ in range(self.config.frame_skip):
            mujoco.mj_step(self.model, self.data)
            contacts = set()
            for contact in self.data.contact:
                pair = (int(contact.geom1), int(contact.geom2))
                if self.ball_id in pair:
                    contacts.add(pair[1] if pair[0] == self.ball_id else pair[0])
            if self.paddle_id in contacts and not self.hit:
                self.hit = True
                reward += self.config.contact_reward
            if self.net_id in contacts:
                self.outcome, terminated = "net", True
            elif self.table_id in contacts and self.hit:
                x, y, _ = self.ball_pos
                success = 0 < x < TABLE_HALF_LENGTH and abs(y) < TABLE_HALF_WIDTH
                self.outcome = "return" if success else "own_side"
                reward += self.config.success_reward if success else -self.config.failure_penalty
                terminated = True
            elif self.floor_id in contacts or self.ball_pos[2] < 0.2 or abs(self.ball_pos[0]) > 2.5 or abs(self.ball_pos[1]) > 1.5:
                self.outcome, terminated = "miss", True
            if terminated:
                break
        self.steps += 1
        truncated = self.steps >= self.config.max_steps and not terminated
        if truncated:
            self.outcome = "timeout"
        if terminated and self.outcome in ("miss", "net"):
            reward -= self.config.failure_penalty
        self.finished = terminated or truncated
        if not np.isfinite(self.data.qpos).all() or not np.isfinite(self.data.qvel).all():
            raise FloatingPointError("Nonfinite simulation state")
        info = {"is_success": self.outcome == "return", "hit": self.hit,
                "outcome": self.outcome, "ball_position": self.ball_pos.copy()}
        return self._obs(), reward, terminated, truncated, info

    def render(self):
        if self.renderer is None:
            self.renderer = mujoco.Renderer(self.model, height=720, width=1280)
        camera = mujoco.MjvCamera()
        camera.lookat[:] = [-0.3, 0, 0.75]
        camera.distance = 4.8
        camera.azimuth = 125
        camera.elevation = -24
        self.renderer.update_scene(self.data, camera)
        return self.renderer.render()

    def close(self):
        if self.renderer is not None:
            self.renderer.close()
            self.renderer = None
