"""Deterministic legal-serve rally benchmark, separate from isolated feeds."""
import argparse
from collections import Counter
import json
import hashlib
import io
from pathlib import Path
import numpy as np
import torch
from stable_baselines3 import PPO
from bracket_pong.rally import RallySim


def evaluate(model=None, seed=81234, episodes=50):
    torch.set_num_threads(1)
    checkpoint=Path(model).read_bytes() if model else None
    policy=PPO.load(io.BytesIO(checkpoint),device="cpu") if checkpoint else None
    sim=RallySim(mobile=True)
    rng=np.random.default_rng(seed)
    rows=[]
    for i in range(episodes):
        style=("blocker","wide","attacker","lobber","novice")[i%5]
        y=0.0 if i==0 else float(rng.uniform(-.25,.25))
        sim.serve("human",y)
        for _ in range(1251):
            action=policy.predict(sim.observation(),deterministic=True)[0] if policy else np.zeros(8)
            sim.robot_control(action)
            sim.opponent(style)
            sim.advance()
            if sim.rules.winner:
                break
        rows.append(dict(y=y,style=style,hits=sim.rules.hits,returns=sim.robot_returns,
                         winner=sim.rules.winner,reason=sim.rules.reason))
    return dict(model=str(model) if model else "baseline",
                checkpoint_sha256=hashlib.sha256(checkpoint).hexdigest() if checkpoint else None,
                seed=seed,episodes=episodes,
                legal_return_rate=float(np.mean([r["returns"]>0 for r in rows])),
                robot_win_rate=float(np.mean([r["winner"]=="robot" for r in rows])),
                median_hits=float(np.median([r["hits"] for r in rows])),
                mean_hits=float(np.mean([r["hits"] for r in rows])),
                reasons=dict(Counter(r["reason"] for r in rows)),rows=rows)


def main():
    p=argparse.ArgumentParser()
    p.add_argument("--model",type=Path)
    p.add_argument("--output",type=Path,required=True)
    p.add_argument("--seed",type=int,default=81234)
    p.add_argument("--episodes",type=int,default=50)
    a=p.parse_args()
    if a.output.exists() or a.episodes<1:
        p.error("Use a fresh output path and positive episode count")
    result=evaluate(a.model,a.seed,a.episodes)
    a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps(result,indent=2))
    print(json.dumps({k:v for k,v in result.items() if k!="rows"},indent=2))


if __name__=="__main__":
    main()
