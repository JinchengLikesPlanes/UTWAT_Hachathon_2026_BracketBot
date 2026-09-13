"""Lesson-specific PPO jobs and paired policy evaluation."""
from dataclasses import replace
from pathlib import Path
from threading import Event

import numpy as np
from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import BaseCallback
from stable_baselines3.common.env_util import make_vec_env

from bracket_pong.env import ReturnEnv, TaskConfig


ROOT = Path(__file__).resolve().parents[2]
EARLY_CHECKPOINT = ROOT / "runs/ppo-first-100k/checkpoints/rl_model_10000_steps.zip"
REFERENCE_CHECKPOINT = ROOT / "runs/ppo-continued-300k/best_model.zip"


def lesson_config(preset: str):
    if preset == "contact":
        return TaskConfig(contact_reward=8.0, success_reward=2.0, failure_penalty=1.0)
    if preset == "return":
        return TaskConfig(contact_reward=2.0, success_reward=10.0, failure_penalty=2.0)
    raise ValueError("Reward preset must be contact or return")


class ProgressCallback(BaseCallback):
    def __init__(self, total, cancel: Event, update):
        super().__init__()
        self.total, self.cancel, self.update = total, cancel, update

    def _on_step(self):
        if self.cancel.is_set():
            return False
        if self.num_timesteps % 256 == 0:
            self.update(min(self.num_timesteps / self.total, 0.99), self.num_timesteps)
        return True


def train_lesson_policy(output: Path, preset: str, steps: int, cancel: Event, update):
    config = lesson_config(preset)
    env = make_vec_env(lambda: ReturnEnv(config), n_envs=1, seed=101)
    try:
        if EARLY_CHECKPOINT.exists():
            model = PPO.load(EARLY_CHECKPOINT, env=env, device="cpu")
            source = str(EARLY_CHECKPOINT.relative_to(ROOT))
        else:
            model = PPO("MlpPolicy", env, seed=101, device="cpu", n_steps=256,
                        batch_size=64, learning_rate=3e-4, policy_kwargs={"net_arch": [64, 64]})
            source = "fresh policy"
        model.learn(total_timesteps=steps, reset_num_timesteps=True,
                    callback=ProgressCallback(steps, cancel, update), progress_bar=False)
        if cancel.is_set():
            return {"cancelled": True, "source": source}
        output.parent.mkdir(parents=True, exist_ok=True)
        model.save(output)
        return {"cancelled": False, "source": source, "checkpoint": str(output.with_suffix('.zip'))}
    finally:
        env.close()


def evaluate_policy(model_path: Path | None, preset: str, episodes: int = 20):
    config = lesson_config(preset)
    env = ReturnEnv(config)
    model = PPO.load(model_path, device="cpu") if model_path and model_path.exists() else None
    outcomes = []
    try:
        for episode in range(episodes):
            obs, _ = env.reset(seed=9000 + episode)
            finished = False
            while not finished:
                action = model.predict(obs, deterministic=True)[0] if model else np.zeros(env.action_space.shape)
                obs, reward, terminated, truncated, info = env.step(action)
                finished = terminated or truncated
            outcomes.append(info)
    finally:
        env.close()
    return {
        "episodes": episodes,
        "contacts": sum(bool(item["hit"]) for item in outcomes),
        "legal_returns": sum(bool(item["is_success"]) for item in outcomes),
        "outcomes": {name: sum(item["outcome"] == name for item in outcomes)
                     for name in ("return", "miss", "net", "own_side", "timeout")},
    }

