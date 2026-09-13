"""Reproducible PPO training and checkpoints; CPU is deliberate for small MLPs."""
import argparse
from dataclasses import asdict
import importlib.metadata
import json
from pathlib import Path

from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import CheckpointCallback, EvalCallback
from stable_baselines3.common.env_util import make_vec_env
from stable_baselines3.common.logger import configure
import torch

from bracket_pong.env import ReturnEnv, TaskConfig


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--steps", type=int, default=100_000)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--envs", type=int, default=4)
    parser.add_argument("--spread", type=float, default=0.025)
    parser.add_argument("--output", type=Path, default=Path("runs/ppo-starter"))
    parser.add_argument("--resume", type=Path, help="Checkpoint with matching run.json in its directory")
    parser.add_argument("--warm-start", type=Path, help="Initialize lift policy from an existing arm/lift checkpoint")
    parser.add_argument("--lift", action="store_true")
    parser.add_argument("--speed-range", type=float, nargs=2, default=(0, 0), metavar=("MIN", "MAX"))
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Output already exists; choose a fresh run directory")
    if args.steps < 1 or args.envs < 1:
        parser.error("steps and envs must be positive")
    torch.set_num_threads(1)
    config = TaskConfig(shot_spread=args.spread, lift_enabled=args.lift, speed_min=args.speed_range[0], speed_max=args.speed_range[1])
    if args.resume and args.warm_start:
        parser.error("Use either resume or warm-start")
    if args.warm_start and not args.lift:
        parser.error("Warm-start requires --lift")
    if args.resume:
        parent_metadata = json.loads((args.resume.parent / "run.json").read_text())
        if asdict(TaskConfig(**parent_metadata["config"])) != asdict(config):
            parser.error("Resume task configuration differs; use matching --spread")
    args.output.mkdir(parents=True)
    metadata = {"seed": args.seed, "requested_steps": args.steps, "envs": args.envs,
                "config": asdict(config), "status": "training", "resume": str(args.resume) if args.resume else None,
                "warm_start": str(args.warm_start) if args.warm_start else None,
                "versions": {p: importlib.metadata.version(p) for p in ("mujoco", "numpy", "gymnasium", "stable-baselines3", "torch")}}
    meta_path = args.output / "run.json"
    meta_path.write_text(json.dumps(metadata, indent=2))
    env = make_vec_env(lambda: ReturnEnv(config), n_envs=args.envs, seed=args.seed,
                       monitor_dir=str(args.output / "monitor"))
    eval_env = make_vec_env(lambda: ReturnEnv(config), n_envs=1, seed=5000)
    try:
        model = PPO.load(args.resume, env=env, device="cpu") if args.resume else PPO("MlpPolicy", env, seed=args.seed, device="cpu", verbose=1,
                    n_steps=256, batch_size=64, learning_rate=3e-4,
                    policy_kwargs={"net_arch": [64, 64]})
        if args.warm_start:
            from bracket_pong.transfer import warm_start
            warm_start(model, args.warm_start)
        model.set_logger(configure(str(args.output), ["csv"]))
        model.learn(args.steps, callback=[
            CheckpointCallback(max(10_000//args.envs, 1), str(args.output / "checkpoints")),
            EvalCallback(eval_env, best_model_save_path=str(args.output),
                         log_path=str(args.output), eval_freq=max(25_000//args.envs, 1),
                         n_eval_episodes=50, deterministic=True, verbose=1),
        ])
        model.save(args.output / "policy")
        metadata.update(status="complete", actual_steps=model.num_timesteps)
        meta_path.write_text(json.dumps(metadata, indent=2))
    finally:
        env.close()
        eval_env.close()


if __name__ == "__main__":
    main()
