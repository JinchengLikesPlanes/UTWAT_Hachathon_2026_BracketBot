import json
from types import SimpleNamespace

import numpy as np
import pytest

from bracket_pong.challenge import Challenge


@pytest.fixture
def game(tmp_path, monkeypatch):
    (tmp_path / "run.json").write_text(json.dumps({"config": {"lift_enabled": True}}))
    policy = SimpleNamespace(action_space=SimpleNamespace(shape=(7,)),
                             predict=lambda obs, deterministic: (np.zeros(7), None))
    monkeypatch.setattr("bracket_pong.challenge.PPO.load", lambda *a, **kw: policy)
    instance = Challenge(tmp_path / "policy.zip")
    yield instance
    instance.close()


def test_score_once_and_no_double_launch(game):
    assert game.launch()
    assert not game.launch()
    assert game.attempts == 1
    assert not game.edit()
    while game.phase == "flight":
        game.tick()
    score = game.you+game.robot
    assert score == 1
    for _ in range(10):
        game.tick()
    assert game.you+game.robot == score
    game.reset_score()
    assert game.you == game.robot == game.attempts == 0
    assert game.phase == "aim"


def test_pause_and_resume(game):
    game.launch()
    game.paused = True
    state = game.env.data.qpos.copy()
    assert game.tick() is None
    np.testing.assert_array_equal(state, game.env.data.qpos)
    game.paused = False
    game.tick()
    assert not np.array_equal(state, game.env.data.qpos)


def test_manual_lift_launch_matches_preview_height(game):
    game.auto_lift = False
    game.lift_target = -0.3
    for _ in range(40):
        game.preview_lift()
    assert game.env.data.qpos[game.env.lq] == pytest.approx(-0.3, abs=0.01)
    game.launch()
    assert game.env.data.qpos[game.env.lq] == -0.3
    game.tick()
    assert game.env.data.ctrl[game.env.la] == -0.3


def test_lift_transfer_preserves_original_arm_outputs(monkeypatch):
    from stable_baselines3 import PPO
    from bracket_pong.env import ReturnEnv, TaskConfig
    from bracket_pong.transfer import warm_start
    old_env, new_env = ReturnEnv(), ReturnEnv(TaskConfig(lift_enabled=True))
    try:
        source = PPO("MlpPolicy", old_env, seed=12)
        target = PPO("MlpPolicy", new_env, seed=13)
        monkeypatch.setattr("bracket_pong.transfer.PPO.load", lambda *a, **kw: source)
        warm_start(target, "unused.zip")
        obs, _ = old_env.reset(seed=0)
        old_action = source.predict(obs, deterministic=True)[0]
        new_action = target.predict(np.r_[obs, -0.15, 0.2, -0.8].astype(np.float32), deterministic=True)[0]
        np.testing.assert_allclose(old_action, new_action[:6], atol=1e-7)
        assert new_action[6] == 0
    finally:
        old_env.close()
        new_env.close()
