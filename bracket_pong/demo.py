"""Native MuJoCo preview. On macOS launch through mjpython."""
import argparse
import json
from pathlib import Path
import time

import mujoco.viewer
import numpy as np

from bracket_pong.env import ReturnEnv, TaskConfig


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot", type=Path)
    parser.add_argument("--model", type=Path)
    parser.add_argument("--record", type=Path, help="Record one seeded episode as an animated GIF")
    parser.add_argument("--seed", type=int, default=10000)
    args = parser.parse_args()
    model = None
    config = TaskConfig()
    if args.model:
        from stable_baselines3 import PPO
        config = TaskConfig(**json.loads((args.model.parent / "run.json").read_text())["config"])
        model = PPO.load(args.model, device="cpu")
    env = ReturnEnv(config)
    obs, _ = env.reset(seed=args.seed)
    try:
        if args.record:
            from PIL import Image, ImageDraw
            frames = []
            while True:
                action = model.predict(obs, deterministic=True)[0] if model else np.zeros(env.action_space.shape)
                obs, _, done, truncated, info = env.step(action)
                if env.steps % 2 == 0 or done or truncated:
                    frame = Image.fromarray(env.render()).resize((960, 540))
                    draw = ImageDraw.Draw(frame)
                    draw.rectangle((0, 0, 960, 34), fill=(15, 20, 28))
                    draw.text((12, 10), f'{"PPO policy" if model else "Zero action"} | seed {args.seed} | {info["outcome"]}', fill="white")
                    frames.append(frame)
                if done or truncated:
                    break
            args.record.parent.mkdir(parents=True, exist_ok=True)
            frames[0].save(args.record, save_all=True, append_images=frames[1:], duration=40, loop=0)
            print(f'{args.record}: {info["outcome"]}')
            return
        if args.snapshot:
            from PIL import Image
            args.snapshot.parent.mkdir(parents=True, exist_ok=True)
            Image.fromarray(env.render()).save(args.snapshot)
            print(args.snapshot)
            return
        print("Running learned policy" if model else "Zero-action preview: no trained policy loaded")
        with mujoco.viewer.launch_passive(env.model, env.data) as viewer:
            viewer.cam.lookat[:] = [-0.3, 0, 0.75]
            viewer.cam.distance = 4.8
            viewer.cam.azimuth = 125
            viewer.cam.elevation = -24
            while viewer.is_running():
                start = time.monotonic()
                action = model.predict(obs, deterministic=True)[0] if model else np.zeros(env.action_space.shape)
                obs, _, done, truncated, info = env.step(action)
                viewer.sync()
                if done or truncated:
                    print(info["outcome"])
                    obs, _ = env.reset()
                time.sleep(max(0, 0.02-(time.monotonic()-start)))
    finally:
        env.close()


if __name__ == "__main__":
    main()
