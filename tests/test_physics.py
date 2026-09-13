import xml.etree.ElementTree as ET

import mujoco
import numpy as np
import pytest

from bracket_pong.model import URDF, load_model, rotation
from bracket_pong.control import arm_indices
from bracket_pong.env import ReturnEnv, TaskConfig


def test_import_matches_independent_urdf_forward_kinematics():
    model = load_model()
    data = mujoco.MjData(model)
    values = dict(zip([f"rj{i}" for i in range(1, 7)], [0.2, -0.4, 0.5, 0.1, -0.3, 0.6]))
    for name, value in values.items():
        data.qpos[model.joint(name).qposadr[0]] = value
    mujoco.mj_forward(model, data)
    frames = {"root": np.eye(4)}
    frames["root"][0, 3] = -1.65
    remaining = list(ET.parse(URDF).getroot().findall("joint"))
    while remaining:
        progressed = False
        for joint in remaining[:]:
            parent = joint.find("parent").get("link")
            if parent not in frames:
                continue
            origin = joint.find("origin")
            transform = np.eye(4)
            transform[:3, :3] = rotation(np.fromstring(origin.get("rpy", "0 0 0"), sep=" "))
            transform[:3, 3] = np.fromstring(origin.get("xyz", "0 0 0"), sep=" ")
            motion = np.eye(4)
            motion[:3, :3] = rotation([0, 0, values.get(joint.get("name"), 0)])
            frames[joint.find("child").get("link")] = frames[parent] @ transform @ motion
            remaining.remove(joint)
            progressed = True
        assert progressed, "Disconnected URDF"
    for name, frame in frames.items():
        np.testing.assert_allclose(data.body(name).xpos, frame[:3, 3], atol=1e-8)
        np.testing.assert_allclose(data.body(name).xmat.reshape(3, 3), frame[:3, :3], atol=1e-8)
    assert model.nmesh == 50
    assert model.nu == 6


def test_table_bounce_timestep_convergence():
    rebounds = []
    for timestep in (0.001, 0.0005):
        model = load_model()
        model.opt.timestep = timestep
        data = mujoco.MjData(model)
        q = model.joint("ball_free").qposadr[0]
        v = model.joint("ball_free").dofadr[0]
        data.qpos[q:q+3] = [0.5, 0, 0.95]
        data.qvel[v:v+3] = [0, 0, -3]
        peak_velocity = 0
        for _ in range(round(0.15/timestep)):
            mujoco.mj_step(model, data)
            peak_velocity = max(peak_velocity, data.qvel[v+2])
        assert peak_velocity > 0.5
        rebounds.append(peak_velocity)
    assert abs(rebounds[0]-rebounds[1]) < 0.3


def test_seeded_rollouts_and_real_contacts():
    env = ReturnEnv()
    try:
        histories = []
        for _ in range(2):
            obs, _ = env.reset(seed=123)
            history = [obs]
            while True:
                obs, reward, done, truncated, info = env.step(np.zeros(6))
                assert env.observation_space.contains(obs)
                assert np.isfinite(reward)
                history.append(obs)
                if done or truncated:
                    break
            assert info["hit"]
            assert not info["is_success"]  # touching is not a legal return
            histories.append(np.array(history))
        np.testing.assert_array_equal(*histories)
        with pytest.raises(RuntimeError):
            env.step(np.zeros(6))
    finally:
        env.close()


def test_no_paddle_means_no_hit_credit():
    env = ReturnEnv()
    env.model.geom_contype[env.paddle_id] = 0
    env.model.geom_conaffinity[env.paddle_id] = 0
    try:
        env.reset(seed=123)
        while True:
            _, _, done, truncated, info = env.step(np.zeros(6))
            assert not info["hit"]
            assert not info["is_success"]
            if done or truncated:
                break
    finally:
        env.close()


def test_timeout_and_invalid_action():
    env = ReturnEnv(TaskConfig(max_steps=1))
    try:
        env.reset(seed=1)
        with pytest.raises(ValueError):
            env.step(np.full(6, np.nan))
        _, _, terminated, truncated, info = env.step(np.zeros(6))
        assert truncated and not terminated and info["outcome"] == "timeout"
    finally:
        env.close()


def test_gymnasium_and_sb3_contract():
    from stable_baselines3.common.env_checker import check_env
    env = ReturnEnv()
    try:
        check_env(env, warn=True)
    finally:
        env.close()


@pytest.mark.parametrize("x,hit,expected", [(0.5, True, "return"), (-0.5, True, "own_side"), (0.5, False, None)])
def test_landing_requires_prior_hit_and_correct_side(x, hit, expected):
    env = ReturnEnv()
    try:
        env.reset(seed=0)
        env.hit = hit  # Isolate the post-contact scoring state.
        env.ball_pos[:] = [x, 0, 0.82]
        env.data.qvel[env.bv:env.bv+6] = [0, 0, -1, 0, 0, 0]
        info = {}
        for _ in range(5):
            _, _, done, truncated, info = env.step(np.zeros(6))
            if done or truncated:
                break
        if expected:
            assert info["outcome"] == expected
            assert info["is_success"] == (expected == "return")
        else:
            assert not info["is_success"]
    finally:
        env.close()
