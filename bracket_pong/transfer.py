"""Initialize a lift policy from an arm policy without pretending it is trained."""
import torch
from stable_baselines3 import PPO


def warm_start(model, checkpoint):
    source = PPO.load(checkpoint, device="cpu")
    old = source.policy.state_dict()
    state = model.policy.state_dict()
    if source.observation_space.shape not in ((32,), (35,)) or model.observation_space.shape != (35,):
        raise ValueError("Warm start supports the Bracket Pong arm/lift policies only")
    with torch.no_grad():
        for key, value in state.items():
            previous = old[key]
            if previous.shape == value.shape:
                value.copy_(previous)
            elif key in ("mlp_extractor.policy_net.0.weight", "mlp_extractor.value_net.0.weight"):
                value.zero_()
                value[:, :previous.shape[1]].copy_(previous)
            elif key in ("action_net.weight", "action_net.bias", "log_std"):
                value.zero_()
                value[:previous.shape[0]].copy_(previous)
                if key == "log_std":
                    value[-1] = -1.5
            else:
                raise ValueError(f"Unsupported transfer parameter: {key}")
    model.policy.load_state_dict(state)
