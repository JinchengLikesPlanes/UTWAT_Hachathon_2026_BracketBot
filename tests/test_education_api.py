from fastapi.testclient import TestClient

from bracket_pong.education.api import create_app


client = TestClient(create_app())


def test_health_and_lessons_are_served():
    assert client.get("/api/health").json()["status"] == "ok"
    lessons = client.get("/api/lessons").json()
    assert [lesson["id"] for lesson in lessons] == ["pid", "rl", "vision"]
    assert all(len(lesson["stages"]) == 5 for lesson in lessons)


def test_pid_endpoint_rejects_bad_inputs():
    assert client.post("/api/pid/run", json={"kp": 1, "ki": 0, "kd": 0, "disturbance": "earthquake"}).status_code == 400
    assert client.post("/api/pid/run", json={"kp": 99, "ki": 0, "kd": 0}).status_code == 422


def test_vision_train_and_predict_round_trip():
    samples = [
        {"label": "red", "rgb": [230, 45, 40]}, {"label": "red", "rgb": [180, 35, 35]},
        {"label": "blue", "rgb": [35, 75, 220]}, {"label": "blue", "rgb": [45, 95, 180]},
        {"label": "yellow", "rgb": [235, 195, 40]}, {"label": "yellow", "rgb": [205, 165, 35]},
    ]
    trained = client.post("/api/vision/train", json={"samples": samples}).json()
    prediction = client.post("/api/vision/predict", json={"rgb": [240, 200, 50], **trained["model"]}).json()
    assert prediction["label"] == "yellow"
    assert abs(sum(prediction["scores"].values()) - 1) < 1e-6
    assert client.post("/api/vision/train", json={"samples": samples[:4]}).status_code == 400
    assert client.post("/api/vision/predict", json={"rgb": [1, 2], **trained["model"]}).status_code == 400


def test_job_listing_and_validation():
    assert client.get("/api/jobs").json() == []
    assert client.get("/api/jobs/missing").status_code == 404
    assert client.post("/api/jobs", json={"kind": "rl", "preset": "dance"}).status_code == 400
    assert client.post("/api/jobs", json={"kind": "rl", "preset": "return", "steps": 10}).status_code == 422
    assert client.post("/api/rl/evaluate", json={"checkpoint": "student"}).status_code == 400
