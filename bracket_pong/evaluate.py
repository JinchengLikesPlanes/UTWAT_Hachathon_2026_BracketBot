"""Evaluate independent shot seeds, reporting success separately from reward."""
import argparse
from collections import Counter
import json
from pathlib import Path

import numpy as np

from bracket_pong.env import ReturnEnv, TaskConfig


def evaluate(policy="zero", episodes=100, seed=10000, config=None, model_path=None):
    model = None
    if policy == "ppo":
        from stable_baselines3 import PPO
        model = PPO.load(model_path, device="cpu")
    rng = np.random.default_rng(seed)
    outcomes, hits, rewards = Counter(), 0, []
    env = ReturnEnv(config)
    try:
        for i in range(episodes):
            obs, _ = env.reset(seed=seed+i)
            total = 0
            while True:
                action = model.predict(obs, deterministic=True)[0] if model else (rng.uniform(-1, 1, env.action_space.shape) if policy == "random" else np.zeros(env.action_space.shape))
                obs, reward, done, truncated, info = env.step(action)
                total += reward
                if done or truncated:
                    outcomes[info["outcome"]] += 1
                    hits += int(info["hit"])
                    rewards.append(total)
                    break
    finally:
        env.close()
    return {"policy": policy, "episodes": episodes, "seed_start": seed,
            "return_rate": outcomes["return"]/episodes, "hit_rate": hits/episodes,
            "mean_reward": float(np.mean(rewards)), "outcomes": dict(outcomes)}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--policy", choices=["zero", "random", "ppo"], default="zero")
    p.add_argument("--model", type=Path)
    p.add_argument("--episodes", type=int, default=100)
    p.add_argument("--seed", type=int, default=10000)
    p.add_argument("--spread", type=float, default=None)
    p.add_argument("--output", type=Path, help="Save evaluation metrics as JSON")
    args = p.parse_args()
    if args.episodes < 1 or (args.policy == "ppo" and args.model is None):
        p.error("Positive episodes and --model for PPO are required")
    config = TaskConfig()
    if args.policy == "ppo":
        meta = args.model.parent / "run.json"
        if not meta.exists():
            p.error("Model must have run.json alongside it")
        config = TaskConfig(**json.loads(meta.read_text())["config"])
    if args.spread is not None:
        from dataclasses import replace
        config = replace(config, shot_spread=args.spread)
    if args.output and args.output.exists():
        p.error("Evaluation output already exists; choose a fresh path")
    result = evaluate(args.policy, args.episodes, args.seed, config, args.model)
    from dataclasses import asdict
    result.update(config=asdict(config), model=str(args.model) if args.model else None)
    output = json.dumps(result, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output)
    print(output)


if __name__ == "__main__":
    main()
