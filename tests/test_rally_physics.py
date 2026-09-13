import numpy as np
import mujoco
from bracket_pong.rally import RallySim,MotionLimit,intercept
from bracket_pong.rally_env import RallyEnv


def test_cursor_teleport_is_rate_limited():
    motion=MotionLimit(np.array([1.58,0,1.1,0,0.0]),np.zeros(5))
    previous=motion.value.copy()
    motion.move([1.3,.8,1.45,.6,.6],.02)
    assert np.max(np.abs(motion.value-previous))<=30*.02**2+1e-9
    for _ in range(100):motion.move([1.3,.8,1.45,.6,.6],.02)
    assert np.max(np.abs(motion.speed))<=3.5


def test_base_is_bounded_and_controller_acceleration_limited():
    sim=RallySim();sim.feed(y=.5)
    last=0
    for _ in range(60):
        sim.robot_control(np.r_[np.zeros(7),1])
        assert abs(sim.base_command-last)<=2*sim.dt+1e-9
        assert abs(sim.base_command)<=.8
        last=sim.base_command
        sim.advance()
        assert abs(sim.data.qpos[sim.baseq])<.451
    assert sim.data.qpos[sim.baseq]>.02


def test_same_ball_has_both_paddle_contacts():
    sim=RallySim();sim.feed()
    original_id=sim.ids["ball_geom"]
    for _ in range(200):
        sim.robot_control(np.zeros(8));sim.opponent();sim.advance()
        assert sim.ids["ball_geom"]==original_id
        if sim.rules.winner:break
    assert sim.rules.hits>=2
    assert sim.robot_returns>=1


def test_rally_env_contract():
    from stable_baselines3.common.env_checker import check_env
    env=RallyEnv()
    check_env(env)


def test_return_reward_requires_legal_landing():
    env=RallyEnv()
    obs,_=env.reset(seed=0,options={"cell":(2,2)})
    total=0
    while True:
        obs,r,done,truncated,info=env.step(np.zeros(8));total+=r
        assert env.observation_space.contains(obs)
        if done or truncated:break
    if info["is_success"]:assert info["returns"]>=1 and total>=10
    else:assert total<10


def test_fast_table_bounce_converges_without_energy_creation():
    velocities=[]
    for dt in (.001,.0005):
        sim=RallySim();sim.model.opt.timestep=dt
        sim.ball[:]=[.5,0,.96];sim.velocity[:]=[0,0,-4]
        peak=0
        for _ in range(int(.15/dt)):
            mujoco.mj_step(sim.model,sim.data)
            peak=max(peak,sim.velocity[2])
        velocities.append(peak)
    assert 0<min(velocities)<max(velocities)<4.5
    assert abs(velocities[0]-velocities[1])<.4
