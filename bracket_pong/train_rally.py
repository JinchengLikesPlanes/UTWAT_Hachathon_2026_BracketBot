"""Train residual rally policies; record configuration, progress and validation."""
import argparse
from dataclasses import asdict
import hashlib
import importlib.metadata
import json
from pathlib import Path
import shutil
import torch
from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import EvalCallback, CheckpointCallback
from stable_baselines3.common.env_util import make_vec_env
from stable_baselines3.common.logger import configure
from bracket_pong.rally_env import RallyEnv,RallyConfig


def main():
    p=argparse.ArgumentParser()
    p.add_argument("--output",type=Path,required=True)
    p.add_argument("--seed",type=int,default=0)
    p.add_argument("--steps",type=int,default=300000)
    p.add_argument("--resume",type=Path)
    p.add_argument("--rallies",action="store_true")
    p.add_argument("--randomize",action="store_true")
    p.add_argument("--mobile",action="store_true",help="Train wheels-v2 physical drivetrain (new policy required)")
    p.add_argument("--serve-fraction",type=float,default=0.0,help="Fraction of episodes starting with an actual legal serve")
    args=p.parse_args()
    if args.output.exists() or args.steps<1:
        p.error("Use a fresh output directory and positive step count")
    torch.set_num_threads(1)
    config=RallyConfig(rallies=args.rallies,randomize=args.randomize,mobile=args.mobile,serve_fraction=args.serve_fraction)
    args.output.mkdir(parents=True)
    source=args.output/"source"
    source.mkdir()
    hashes={}
    for path in Path(__file__).parent.glob("*.py"):
        shutil.copy2(path,source/path.name)
        hashes[path.name]=hashlib.sha256(path.read_bytes()).hexdigest()
    metadata={"config":asdict(config),"seed":args.seed,"requested_steps":args.steps,
              "kind":"rally_wheels_v2" if args.mobile else "rally_residual_v1","status":"training","resume":str(args.resume) if args.resume else None,
              "hashes":hashes,"versions":{n:importlib.metadata.version(n) for n in ("mujoco","numpy","stable-baselines3","torch")}}
    (args.output/"run.json").write_text(json.dumps(metadata,indent=2))
    env=make_vec_env(lambda:RallyEnv(config),n_envs=2,seed=args.seed,monitor_dir=str(args.output/"monitor"))
    validation=make_vec_env(lambda:RallyEnv(config),n_envs=1,seed=50000)
    try:
        model=PPO.load(args.resume,env=env,device="cpu") if args.resume else PPO("MlpPolicy",env,device="cpu",seed=args.seed,n_steps=256,batch_size=64,learning_rate=2e-4,policy_kwargs={"net_arch":[64,64]})
        if not args.resume:
            with torch.no_grad():
                model.policy.action_net.weight.zero_()
                model.policy.action_net.bias.zero_()
                model.policy.log_std.fill_(-1.5)
        model.set_logger(configure(str(args.output),["csv"]))
        model.learn(args.steps,callback=[
            EvalCallback(validation,best_model_save_path=str(args.output),log_path=str(args.output),eval_freq=12500,n_eval_episodes=50,verbose=1),
            CheckpointCallback(25000,str(args.output/"checkpoints"))])
        model.save(args.output/"policy")
        metadata.update(status="complete",actual_steps=model.num_timesteps)
        (args.output/"run.json").write_text(json.dumps(metadata,indent=2))
    except BaseException as exc:
        metadata.update(status="interrupted",error=type(exc).__name__)
        (args.output/"run.json").write_text(json.dumps(metadata,indent=2))
        raise
    finally:
        env.close(); validation.close()


if __name__=="__main__":
    main()
