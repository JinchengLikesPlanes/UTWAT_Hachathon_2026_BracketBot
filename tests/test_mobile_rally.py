import mujoco
import numpy as np
import pytest

from bracket_pong.rally import RallySim
from bracket_pong.rally_env import RallyEnv, RallyConfig
from bracket_pong.rules import PointRules


def test_wheels_drive_and_turn_a_free_chassis():
    sim = RallySim(mobile=True)
    assert sim.model.joint("chassis_free").type[0] == mujoco.mjtJoint.mjJNT_FREE
    with pytest.raises(KeyError):
        sim.model.joint("base_y")
    largest_heading = 0
    for _ in range(400):
        sim.drive_to(-1.65, .4)
        for _ in range(20):
            mujoco.mj_step(sim.model, sim.data)
        matrix = sim.data.xmat[sim.model.body("robot_mount").id].reshape(3,3)
        largest_heading = max(largest_heading, abs(np.arctan2(matrix[1,0],matrix[0,0])))
        assert abs(sim.data.qpos[sim.cq+2]) < .03
        assert sim.data.qpos[sim.cq] < -1.5
    assert largest_heading > 1
    assert abs(sim.data.qpos[sim.baseq]-.4)<.08


def test_power_transfers_momentum_through_contact():
    speeds = []
    for power in (0., .5, 1.):
        sim = RallySim(mobile=True)
        sim.rules = PointRules(last_hitter="robot",bounces=1)
        sim.ball[:] = [1.27,0,1.1]
        sim.velocity[:] = [3,0,0]
        sim.data.qpos[sim.hq] = [1.58,0,1.1,0,0]
        sim.human_motion.value[:] = sim.data.qpos[sim.hq]
        mujoco.mj_forward(sim.model,sim.data)
        for step in range(12):
            sim.human_control(0,1.1,step==0,power=power)
            sim.advance()
            if sim.rules.hits:
                break
        assert sim.rules.last_hitter == "human"
        speeds.append(-sim.velocity[0])
    assert 0 < speeds[0] < speeds[1] < speeds[2] < 10


def test_mobile_training_contract_and_tire_randomization():
    from stable_baselines3.common.env_checker import check_env
    env = RallyEnv(RallyConfig(mobile=True,randomize=True))
    check_env(env)
    assert env.observation_space.shape == (59,)
    assert env.sim.model.geom("tire_left").friction[0] == 1.2


def test_training_can_start_from_a_real_match_serve():
    env = RallyEnv(RallyConfig(mobile=True,serve_fraction=1.0,rallies=True))
    env.reset(seed=10)
    assert env.sim.rules.serving
    assert env.sim.rules.bounces == 0
    assert env.sim.rules.last_hitter == "human"
    assert np.allclose(env.sim.velocity,[ -3.4,0,-2.5])


def test_default_policy_registry_rejects_changed_weights(tmp_path, monkeypatch):
    import hashlib
    import json
    from bracket_pong import match
    monkeypatch.setattr(match,"ROOT",tmp_path)
    runs=tmp_path/"runs"
    runs.mkdir()
    weights=runs/"selected.zip"
    weights.write_bytes(b"test checkpoint")
    entry=dict(checkpoint="runs/selected.zip",label="Verified policy",
               sha256=hashlib.sha256(weights.read_bytes()).hexdigest())
    (runs/"wheels-default.json").write_text(json.dumps(entry))
    assert match.checkpoints()==[("Verified policy",weights)]
    weights.write_bytes(b"changed")
    with pytest.raises(ValueError,match="missing or changed"):
        match.checkpoints()


def test_default_match_returns_the_opening_serve():
    from bracket_pong.match import RallyMatch
    game=RallyMatch()
    game.bot_mode=True
    game.serve()
    for _ in range(400):
        game.tick()
        if game.phase!="play":
            break
    assert game.sim.robot_returns>=1
