"""Small deterministic classifier for the introductory vision lesson."""
from dataclasses import dataclass

import numpy as np
import torch


LABELS = ("red", "blue", "yellow")


@dataclass
class ColorClassifier:
    weights: list[list[float]]
    bias: list[float]

    def predict(self, rgb):
        x = torch.tensor([value / 255.0 for value in rgb], dtype=torch.float32)
        logits = x @ torch.tensor(self.weights).T + torch.tensor(self.bias)
        probs = torch.softmax(logits, dim=0).tolist()
        return {"label": LABELS[int(np.argmax(probs))], "scores": dict(zip(LABELS, probs))}


def train_classifier(samples: list[dict], epochs: int = 180):
    counts = {label: 0 for label in LABELS}
    for sample in samples:
        label = sample.get("label")
        rgb = sample.get("rgb")
        if label not in LABELS or not isinstance(rgb, list) or len(rgb) != 3:
            raise ValueError("Each sample needs a valid label and three RGB values")
        if any(not isinstance(v, (int, float)) or not 0 <= v <= 255 for v in rgb):
            raise ValueError("RGB values must be between 0 and 255")
        counts[label] += 1
    if any(count < 2 for count in counts.values()):
        raise ValueError("Add at least two examples of every color")

    torch.manual_seed(7)
    x = torch.tensor([[v / 255.0 for v in s["rgb"]] for s in samples], dtype=torch.float32)
    y = torch.tensor([LABELS.index(s["label"]) for s in samples], dtype=torch.long)
    model = torch.nn.Linear(3, 3)
    optimizer = torch.optim.SGD(model.parameters(), lr=0.45, weight_decay=0.002)
    for _ in range(epochs):
        optimizer.zero_grad()
        loss = torch.nn.functional.cross_entropy(model(x), y)
        loss.backward()
        optimizer.step()
    with torch.no_grad():
        accuracy = float((model(x).argmax(1) == y).float().mean())
    classifier = ColorClassifier(model.weight.tolist(), model.bias.tolist())
    return classifier, {"training_accuracy": round(accuracy, 3), "examples": len(samples), "epochs": epochs}

