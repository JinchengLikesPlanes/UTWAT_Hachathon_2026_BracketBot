"""Stratified curriculum for residual PPO over a physics-based intercept controller."""
from dataclasses import dataclass, asdict
import gymnasium as gym
from gymnasium import spaces
import numpy as np
from bracket_pong.rally import RallySim


@dataclass(frozen=True)
class RallyConfig:
    spread_y: float = 0.55
    min_z: float = 0.90
    max_z: float = 1.30
    speed_min: float = 2.6
    speed_max: float = 4.0
    rallies: bool = False
    randomize: bool = False
    base_enabled: bool = True
    mobile: bool = False
    serve_fraction: float = 0.0


class RallyEnv(gym.Env):
    def __init__(self, config=None):
        self.config = config or RallyConfig()
        if not 0 <= self.config.serve_fraction <= 1:
            raise ValueError("serve_fraction must be between 0 and 1")
        self.sim = RallySim(mobile=self.config.mobile)
        self.sim.base_enabled = self.config.base_enabled
        self.action_space = spaces.Box(-1,1,(8,),dtype=np.float32)
        self.observation_space = spaces.Box(-np.inf,np.inf,self.sim.observation().shape,dtype=np.float32)
        self.failures = np.ones((5,5))
        self.uniform_index = 0
        self.ended = True

    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)
        options = options or {}
        c = self.config
        if "cell" in options:
            row,col = options["cell"]
        else:
            choice = self.np_random.random()
            if choice < 0.3:
                row,col = 2,2
            elif choice < 0.8:
                row,col = divmod(self.uniform_index%25,5)
                self.uniform_index += 1
            else:
                probabilities = self.failures.ravel()/self.failures.sum()
                row,col = divmod(self.np_random.choice(25,p=probabilities),5)
        self.cell = int(row),int(col)
        y = -c.spread_y+(col+self.np_random.random())*2*c.spread_y/5
        z = c.min_z+(row+self.np_random.random())*(c.max_z-c.min_z)/5
        speed = self.np_random.uniform(c.speed_min,c.speed_max)
        self.sim.feed(y,z,speed,self.np_random.uniform(-0.25,0.25))
        if c.serve_fraction and self.np_random.random()<c.serve_fraction:
            self.sim.serve("human",float(self.np_random.uniform(-.25,.25)))
        if c.randomize:
            ids = [self.sim.ids[n] for n in ("ball_geom","paddle","human_rubber","table","net")]
            self.sim.model.geom_friction[ids,0] = self.np_random.uniform(0.04,0.07)
            self.sim.model.geom_solref[ids,1] = self.np_random.uniform(0.14,0.16)
        self.opponent = self.np_random.choice(["blocker","wide","attacker","lobber","novice"])
        self.steps,self.previous_hits,self.previous_returns = 0,0,0
        self.ended = False
        self.min_base=self.max_base=0
        return self.sim.observation(), {"cell":self.cell,"config":asdict(c)}

    def step(self, action):
        if self.ended:
            raise RuntimeError("Reset after episode end")
        self.sim.robot_control(action)
        self.sim.opponent(self.opponent)
        self.sim.advance()
        self.steps += 1
        sim = self.sim
        reward = -0.002*float(np.sum(np.asarray(action)**2))
        if sim.rules.hits>self.previous_hits and sim.rules.last_hitter=="robot":
            reward += 1
        returns = sim.robot_returns-self.previous_returns
        reward += returns*10
        self.previous_hits,self.previous_returns=sim.rules.hits,sim.robot_returns
        terminated = sim.rules.winner is not None or (not self.config.rallies and sim.robot_returns>0)
        truncated = self.steps>=1000 and not terminated
        if terminated and sim.rules.winner=="human":
            reward -= 2
        success = sim.robot_returns>0 if not self.config.rallies else sim.rules.winner=="robot"
        self.ended = terminated or truncated
        self.min_base=min(self.min_base,float(sim.data.qpos[sim.baseq]))
        self.max_base=max(self.max_base,float(sim.data.qpos[sim.baseq]))
        if self.ended:
            self.failures[self.cell] = 0.95*self.failures[self.cell]+(0.05 if success else 0.5)
        return sim.observation(),reward,terminated,truncated,{
            "is_success":success,"hits":sim.rules.hits,"returns":sim.robot_returns,
            "reason":sim.rules.reason or "Legal return","cell":self.cell,
            "base_travel":self.max_base-self.min_base,"collisions":sim.collision_count,
            "opponent":str(self.opponent)}
