import pytest

from bracket_pong.education.pid import PIDGains, run_pid_experiment
from bracket_pong.education.rl import lesson_config
from bracket_pong.education.vision import train_classifier


@pytest.mark.parametrize("disturbance", ["push", "long_push", "steady_pull"])
def test_calibrated_pid_recovers_from_lesson_disturbances(disturbance):
    result = run_pid_experiment(PIDGains(), disturbance)
    assert result["metrics"]["stable"]
    assert result["metrics"]["tail_error_cm"] <= 5


def test_disabled_controller_does_not_recover_from_long_push():
    result = run_pid_experiment(PIDGains(0, 0, 0), "long_push")
    assert not result["metrics"]["stable"]


def test_reward_presets_change_learning_signal_only():
    contact = lesson_config("contact")
    returned = lesson_config("return")
    assert contact.contact_reward > returned.contact_reward
    assert contact.success_reward < returned.success_reward
    assert contact.frame_skip == returned.frame_skip
    assert contact.shot_spread == returned.shot_spread


def test_color_classifier_fits_three_labeled_classes():
    samples = [
        {"label": "red", "rgb": [230, 45, 40]}, {"label": "red", "rgb": [180, 35, 35]},
        {"label": "blue", "rgb": [35, 75, 220]}, {"label": "blue", "rgb": [45, 95, 180]},
        {"label": "yellow", "rgb": [235, 195, 40]}, {"label": "yellow", "rgb": [205, 165, 35]},
    ]
    model, metrics = train_classifier(samples)
    assert metrics["training_accuracy"] >= 0.99
    assert model.predict([225, 50, 45])["label"] == "red"
    assert model.predict([40, 85, 200])["label"] == "blue"


def test_color_classifier_requires_every_class():
    with pytest.raises(ValueError, match="at least two"):
        train_classifier([
            {"label": "red", "rgb": [220, 40, 40]}, {"label": "red", "rgb": [180, 30, 30]},
            {"label": "blue", "rgb": [30, 80, 210]}, {"label": "blue", "rgb": [40, 90, 180]},
        ])

