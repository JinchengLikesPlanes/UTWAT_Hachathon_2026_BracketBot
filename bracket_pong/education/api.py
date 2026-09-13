"""Local API for the BracketBot learning lab."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
from pathlib import Path
from threading import Event, Lock
import uuid

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from bracket_pong.education.pid import DISTURBANCES, PIDGains, run_pid_experiment
from bracket_pong.education.rl import REFERENCE_CHECKPOINT, evaluate_policy, train_lesson_policy
from bracket_pong.education.vision import ColorClassifier, train_classifier


ROOT = Path(__file__).resolve().parents[2]
RUN_ROOT = ROOT / "lesson_runs"
WEB_DIST = ROOT / "web" / "dist"


LESSONS = [
    {"id": "pid", "number": "01", "title": "Keep it steady", "subtitle": "Tune a PID controller", "minutes": 15,
     "stages": ["See the error", "Tune P", "Add D", "Add I", "Challenge"]},
    {"id": "rl", "number": "02", "title": "Teach a return", "subtitle": "Train a ping-pong policy", "minutes": 20,
     "stages": ["Set the task", "Choose senses & actions", "Design rewards", "Train", "Evaluate"]},
    {"id": "vision", "number": "03", "title": "Teach it colors", "subtitle": "Build a visual classifier", "minutes": 15,
     "stages": ["Label examples", "Train", "Test", "Improve", "Try your own"]},
]


class PIDRequest(BaseModel):
    kp: float = Field(ge=0, le=8)
    ki: float = Field(ge=0, le=2)
    kd: float = Field(ge=0, le=4)
    disturbance: str = "push"


class SamplesRequest(BaseModel):
    samples: list[dict]


class PredictRequest(BaseModel):
    rgb: list[float]
    weights: list[list[float]]
    bias: list[float]


class JobRequest(BaseModel):
    kind: str = "rl"
    preset: str = "return"
    steps: int = Field(default=10_240, ge=256, le=100_000)


class EvalRequest(BaseModel):
    preset: str = "return"
    checkpoint: str = "reference"
    episodes: int = Field(default=20, ge=1, le=50)


class SessionRequest(BaseModel):
    learner_name: str = "Explorer"


class CommandRequest(BaseModel):
    lesson: str
    stage: int = Field(ge=0, le=4)
    completed: bool = False


jobs: dict[str, dict] = {}
sessions: dict[str, dict] = {}
job_lock = Lock()
executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="lesson-worker")


def now():
    return datetime.now(timezone.utc).isoformat()


def create_app():
    app = FastAPI(title="BracketBot Learning Lab", version="0.1.0")
    app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                       allow_methods=["*"], allow_headers=["*"])

    @app.get("/api/health")
    def health():
        return {"status": "ok", "service": "BracketBot Learning Lab"}

    @app.get("/api/lessons")
    def lessons():
        return LESSONS

    @app.post("/api/sessions")
    def create_session(request: SessionRequest):
        session_id = uuid.uuid4().hex[:12]
        sessions[session_id] = {"id": session_id, "learner_name": request.learner_name,
                               "progress": {}, "created_at": now(), "updated_at": now()}
        return sessions[session_id]

    @app.post("/api/sessions/{session_id}/commands")
    def command(session_id: str, request: CommandRequest):
        if session_id not in sessions:
            raise HTTPException(404, "Session not found")
        if request.lesson not in {lesson["id"] for lesson in LESSONS}:
            raise HTTPException(400, "Unknown lesson")
        sessions[session_id]["progress"][request.lesson] = {
            "stage": request.stage, "completed": request.completed,
        }
        sessions[session_id]["updated_at"] = now()
        return sessions[session_id]

    @app.post("/api/pid/run")
    def pid_run(request: PIDRequest):
        try:
            return run_pid_experiment(PIDGains(request.kp, request.ki, request.kd), request.disturbance)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

    @app.post("/api/vision/train")
    def vision_train(request: SamplesRequest):
        try:
            model, metrics = train_classifier(request.samples)
            return {"model": {"weights": model.weights, "bias": model.bias}, "metrics": metrics}
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

    @app.post("/api/vision/predict")
    def vision_predict(request: PredictRequest):
        try:
            return ColorClassifier(request.weights, request.bias).predict(request.rgb)
        except (ValueError, RuntimeError) as exc:
            raise HTTPException(400, "Invalid classifier or RGB input") from exc

    def set_job(job_id, **changes):
        with job_lock:
            jobs[job_id].update(changes, updated_at=now())

    def run_job(job_id: str, request: JobRequest):
        set_job(job_id, state="running")
        job = jobs[job_id]
        output = RUN_ROOT / job_id / "policy"
        try:
            result = train_lesson_policy(output, request.preset, request.steps, job["cancel_event"],
                                         lambda progress, steps: set_job(job_id, progress=progress, trained_steps=steps))
            if result["cancelled"]:
                set_job(job_id, state="cancelled", progress=job.get("progress", 0))
            else:
                metrics = evaluate_policy(output.with_suffix(".zip"), request.preset, 20)
                metadata = {"preset": request.preset, "steps": request.steps, "created_at": job["created_at"],
                            "result": result, "evaluation": metrics}
                (output.parent / "run.json").write_text(json.dumps(metadata, indent=2))
                set_job(job_id, state="completed", progress=1.0, result={**result, "evaluation": metrics})
        except Exception as exc:  # worker failures must be visible to the learner
            set_job(job_id, state="failed", error=f"{type(exc).__name__}: {exc}")

    @app.post("/api/jobs")
    def create_job(request: JobRequest):
        if request.kind != "rl" or request.preset not in ("contact", "return"):
            raise HTTPException(400, "Only contact or return RL jobs are supported")
        with job_lock:
            if any(job["state"] in ("queued", "running") for job in jobs.values()):
                raise HTTPException(409, "Another training experiment is already running")
            job_id = uuid.uuid4().hex[:12]
            jobs[job_id] = {"id": job_id, "kind": request.kind, "preset": request.preset,
                            "requested_steps": request.steps, "trained_steps": 0, "progress": 0.0,
                            "state": "queued", "created_at": now(), "updated_at": now(), "cancel_event": Event()}
        executor.submit(run_job, job_id, request)
        return public_job(jobs[job_id])

    @app.get("/api/jobs")
    def list_jobs():
        """Newest first, so a reloaded browser can resume the active experiment."""
        with job_lock:
            ordered = sorted(jobs.values(), key=lambda job: job["created_at"], reverse=True)
        return [public_job(job) for job in ordered]

    @app.get("/api/jobs/{job_id}")
    def get_job(job_id: str):
        if job_id not in jobs:
            raise HTTPException(404, "Job not found")
        return public_job(jobs[job_id])

    @app.post("/api/jobs/{job_id}/cancel")
    def cancel_job(job_id: str):
        if job_id not in jobs:
            raise HTTPException(404, "Job not found")
        jobs[job_id]["cancel_event"].set()
        return public_job(jobs[job_id])

    @app.post("/api/rl/evaluate")
    def rl_evaluate(request: EvalRequest):
        if request.checkpoint != "reference":
            raise HTTPException(400, "Use a completed job result to evaluate a student checkpoint")
        if not REFERENCE_CHECKPOINT.exists():
            raise HTTPException(503, "Reference checkpoint is not installed")
        return evaluate_policy(REFERENCE_CHECKPOINT, request.preset, request.episodes)

    asset_root = ROOT / "chopped_urdf_v2" / "chopped_urdf_v2"
    if asset_root.exists():
        app.mount("/robot-assets", StaticFiles(directory=asset_root), name="robot-assets")
    if WEB_DIST.exists():
        app.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="web-assets")

        @app.get("/{path:path}")
        def spa(path: str):
            candidate = WEB_DIST / path
            return FileResponse(candidate if candidate.is_file() else WEB_DIST / "index.html")
    return app


def public_job(job):
    return {key: value for key, value in job.items() if key != "cancel_event"}


app = create_app()

