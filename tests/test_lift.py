import numpy as np
import mujoco
import pytest
from stable_baselines3.common.env_checker import check_env
from bracket_pong.env import ReturnEnv, TaskConfig


def test_lift_translation_and_travel():
    env = ReturnEnv(TaskConfig(lift_enabled=True))
    try:
        env.reset(seed=0)
        assert env.model.nu == 7
        p = env.data.site("paddle_center").xpos.copy()
        env.data.qpos[env.lq] -= 0.2
        mujoco.mj_forward(env.model, env.data)
        delta = env.data.site("paddle_center").xpos - p
        np.testing.assert_allclose(delta, [0, 0, -0.2], atol=2e-5)
        np.testing.assert_allclose(env.model.joint("rj0").range, [-1.03044, 0])
    finally:
        env.close()


def test_lift_action_physically_moves_carriage():
    env = ReturnEnv(TaskConfig(lift_enabled=True))
    try:
        env.reset(seed=0)
        original = env.data.qpos[env.lq]
        for _ in range(10):
            obs, _, done, truncated, _ = env.step(np.r_[np.zeros(6), -1])
            assert obs.shape == (35,)
            assert np.isfinite(obs).all()
            if done or truncated:
                break
        assert env.data.qpos[env.lq] < original-0.05
        assert env.data.ctrl[env.la] == -0.2
    finally:
        env.close()


def test_explicit_shot_aim_and_speed():
    env = ReturnEnv()
    try:
        env.reset(seed=0, options={"aim_y": 0.1, "aim_z": -0.05, "speed": 4})
        center = env.data.site("paddle_center").xpos
        np.testing.assert_allclose(env.shot_target[1:]-center[1:], [0.1, -0.05])
        assert env.data.qvel[env.bv] == pytest.approx(-4)
        with pytest.raises(ValueError):
            env.reset(options={"speed": float("nan")})
        with pytest.raises(ValueError):
            env.reset(options={"aim_z": 1})
    finally:
        env.close()


def test_lift_env_contract():
    env = ReturnEnv(TaskConfig(lift_enabled=True, speed_min=2.3, speed_max=3.5))
    try:
        check_env(env)
    finally:
        env.close()
