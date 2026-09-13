"""Coverage and rally evaluation with raw episodes and a standalone heatmap."""
import argparse
from collections import Counter
from dataclasses import asdict
import json
from pathlib import Path
import numpy as np
import torch
from stable_baselines3 import PPO
from bracket_pong.rally_env import RallyEnv,RallyConfig


def evaluate(model=None, per_cell=10, seed=70000, base=True, rallies=False, mobile=False):
    torch.set_num_threads(1)
    policy=PPO.load(model,device="cpu") if model else None
    env=RallyEnv(RallyConfig(base_enabled=base,rallies=rallies,mobile=mobile))
    rows=[]
    for row in range(5):
        for col in range(5):
            for trial in range(per_cell):
                episode_seed=seed+(row*5+col)*per_cell+trial
                obs,_=env.reset(seed=episode_seed,options={"cell":(row,col)})
                speed=float(-env.sim.velocity[0])
                while True:
                    action=policy.predict(obs,deterministic=True)[0] if policy else np.zeros(8)
                    obs,_,done,truncated,info=env.step(action)
                    if done or truncated:
                        info.update(seed=episode_seed,speed=speed)
                        rows.append(info)
                        break
    matrix=[[float(np.mean([r["is_success"] for r in rows if r["cell"]==(y,x)])) for x in range(5)] for y in range(5)]
    return {"model":str(model) if model else "controller_baseline","base_enabled":base,
            "config":asdict(env.config),"seed":seed,"per_cell":per_cell,
            "success_metric":"point_win" if rallies else "legal_return",
            "rallies":rallies,"episodes":len(rows),"success":float(np.mean([r["is_success"] for r in rows])),
            "worst_cell":float(np.min(matrix)),"p10_cell":float(np.percentile(matrix,10)),
            "median_hits":float(np.median([r["hits"] for r in rows])),
            "reasons":dict(Counter(r["reason"] for r in rows)),"coverage":matrix,"rows":rows}


def save_report(result,output):
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(result,indent=2))
    cells=[]
    for row in reversed(result["coverage"]):
        for value in row:
            color=f"rgb({int(170*(1-value))},{int(70+100*value)},100)"
            cells.append(f'<div style="background:{color}">{value:.0%}</div>')
    output.with_suffix(".html").write_text(f'''<!doctype html><html><meta charset="utf-8"><title>Rally coverage</title>
<style>body{{background:#152936;color:#edf3f7;font:18px system-ui;max-width:800px;margin:60px auto;padding:20px}}.grid{{display:grid;grid-template-columns:repeat(5,1fr);gap:4px}}.grid div{{padding:30px 10px;text-align:center}}p{{line-height:1.5}}a{{color:#80d1ff}}</style>
<h1>Robot court coverage</h1><p>{result["episodes"]} shots · {result["success"]:.1%} overall · {result["worst_cell"]:.1%} worst cell</p>
<p>Rows: height 0.90–1.30 m (higher at top). Columns: lateral −0.55–+0.55 m. Feed speed 2.6–4.0 m/s.</p>
<div class="grid">{"".join(cells)}</div><p>Chassis {"enabled" if result["base_enabled"] else "disabled"}. A high average does not imply coverage in every region.</p>
<a href="{output.name}">Raw episode results</a></html>''')


def main():
    p=argparse.ArgumentParser()
    p.add_argument("--model",type=Path)
    p.add_argument("--output",type=Path,required=True)
    p.add_argument("--per-cell",type=int,default=10)
    p.add_argument("--seed",type=int,default=70000)
    p.add_argument("--no-base",action="store_true")
    p.add_argument("--rallies",action="store_true")
    p.add_argument("--mobile",action="store_true")
    a=p.parse_args()
    if a.output.exists() or a.per_cell<1:p.error("Use a fresh report path and positive per-cell count")
    result=evaluate(a.model,a.per_cell,a.seed,not a.no_base,a.rallies,a.mobile)
    save_report(result,a.output)
    print(json.dumps({k:v for k,v in result.items() if k!="rows"},indent=2))


if __name__=="__main__":main()
