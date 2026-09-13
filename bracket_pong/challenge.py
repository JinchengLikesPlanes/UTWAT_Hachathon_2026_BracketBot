"""Interactive challenge state, independent of windowing and rendering."""
from dataclasses import dataclass, replace
import json
from pathlib import Path

import mujoco
import numpy as np
from stable_baselines3 import PPO

from bracket_pong.env import ReturnEnv, TaskConfig
from bracket_pong.model import ROOT


def default_checkpoint():
    for relative in ("runs/ppo-lift-300k/best_model.zip", "runs/ppo-continued-300k/best_model.zip"):
        path = ROOT / relative
        if path.exists():
            return path
    raise FileNotFoundError("No trained checkpoint found. Supply --model path/to/policy.zip")


@dataclass
class Shot:
    aim_y: float = 0.0
    aim_z: float = 0.0
    speed: float = 2.8

    def options(self):
        return {"aim_y": self.aim_y, "aim_z": self.aim_z, "speed": self.speed}


class Challenge:
    def __init__(self, checkpoint, seed=30000):
        self.checkpoint = Path(checkpoint)
        config = TaskConfig(**json.loads((self.checkpoint.parent / "run.json").read_text())["config"])
        self.policy = PPO.load(self.checkpoint, device="cpu")
        self.learned_lift = self.policy.action_space.shape == (7,)
        self.env = ReturnEnv(replace(config, lift_enabled=True))
        self.auto_lift = self.learned_lift
        self.lift_target = 0.0
        self.shot = Shot()
        self.seed = seed
        self.attempts = self.you = self.robot = 0
        self.phase = "aim"
        self.paused = False
        self.last_outcome = ""
        self.prepare()

    def prepare(self):
        self.obs, _ = self.env.reset(seed=self.seed+self.attempts, options=self.shot.options())
        self.reference = self.env.shot_target - np.array([0, self.shot.aim_y, self.shot.aim_z])
        self.phase = "aim"
        self.paused = False

    @property
    def target(self):
        return self.reference + [0, self.shot.aim_y, self.shot.aim_z]

    def launch(self):
        if self.phase == "flight":
            return False
        self.obs, _ = self.env.reset(seed=self.seed+self.attempts, options=self.shot.options())
        if not self.auto_lift:
            # Episode initialization, not a mid-shot teleport. Full manual travel
            # is an exploration control and can put the paddle below the table.
            self.env.data.qpos[self.env.lq] = self.lift_target
            self.env.data.qvel[self.env.lv] = 0
            self.env.data.ctrl[self.env.la] = self.lift_target
            mujoco.mj_forward(self.env.model, self.env.data)
            self.obs = self.env._obs()
        self.env.manual_lift_target = None if self.auto_lift else self.lift_target
        self.attempts += 1
        self.phase = "flight"
        self.paused = False
        return True

    def tick(self):
        if self.phase != "flight" or self.paused:
            return None
        policy_obs = self.obs if self.learned_lift else self.obs[:32]
        action = self.policy.predict(policy_obs, deterministic=True)[0]
        if not self.learned_lift:
            action = np.r_[action, 0]
        self.obs, _, done, truncated, info = self.env.step(action)
        if done or truncated:
            self.phase = "result"
            self.last_outcome = info["outcome"]
            self.robot += int(info["is_success"])
            self.you += int(not info["is_success"])
        return info

    def preview_lift(self):
        if self.phase != "aim":
            return
        env = self.env
        env.data.ctrl[env.arm_actuators] = env.ready
        env.data.ctrl[env.la] = 0 if self.auto_lift else self.lift_target
        ball_q = env.data.qpos[env.bq:env.bq+7].copy()
        for _ in range(env.config.frame_skip):
            mujoco.mj_step(env.model, env.data)
            env.data.qpos[env.bq:env.bq+7] = ball_q
            env.data.qvel[env.bv:env.bv+6] = 0
        mujoco.mj_forward(env.model, env.data)

    def edit(self):
        if self.phase == "flight":
            return False
        if self.phase == "result":
            self.prepare()
        return True

    def toggle_lift(self):
        if not self.edit():
            return
        self.auto_lift = not self.auto_lift if self.learned_lift else False

    def reset_score(self):
        self.attempts = self.you = self.robot = 0
        self.last_outcome = ""
        self.prepare()

    def close(self):
        self.env.close()
