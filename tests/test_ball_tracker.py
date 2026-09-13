"""The Level 2 pipeline on synthetic frames: a rendered orange ball on a brown table."""
import math

import numpy as np

from bracket_pong.education.ball_tracker import BallTracker, Camera, bounce_in_window, deproject, detect, predict_cross

W, H = 160, 120
CAM = Camera(fx=128.7, fy=128.7, cx=W / 2 - 0.5, cy=H / 2 - 0.5, height=0.815, x=-0.45, pitch=0.35)


def project(x, y, cam=CAM):
    rx, ry = x - cam.x, y - cam.height
    cp, sp = math.cos(cam.pitch), math.sin(cam.pitch)
    z = rx * cp - ry * sp
    up = rx * sp + ry * cp
    return cam.cx, cam.cy - cam.fy * up / z, z


def frame(x, y, radius_px=3):
    """Brown table everywhere (hue ≈ 40), an orange disc (hue 24) where the ball projects, flat depth."""
    rgb = np.zeros((H, W, 3), np.uint8)
    rgb[...] = (150, 100, 40)
    u, v, z = project(x, y)
    vv, uu = np.mgrid[0:H, 0:W]
    disc = (uu - u) ** 2 + (vv - v) ** 2 <= radius_px ** 2
    rgb[disc] = (255, 102, 0)
    depth = np.full((H, W), z + 0.5, np.float32)
    depth[disc] = z
    return rgb, depth


def test_detect_and_deproject_recover_the_ball():
    rgb, depth = frame(1.2, 0.25)
    found, u, v, n, _ = detect(rgb, 24, 8)
    assert found and n > 20
    p = deproject(u, v, depth[int(round(v)), int(round(u))], CAM)
    assert abs(p[0] - 1.2) < 0.02 and abs(p[1] - 0.25) < 0.02


def test_wide_colour_window_grabs_the_table():
    rgb, _ = frame(1.2, 0.25)
    _, _, _, n_good, _ = detect(rgb, 24, 8)
    _, _, _, n_wide, _ = detect(rgb, 24, 30)
    assert n_wide > 100 * n_good


def test_bounce_rule():
    assert bounce_in_window([0.30, 0.20, 0.05, 0.12])
    assert not bounce_in_window([0.30, 0.20, 0.10, 0.05])


def test_forecast_matches_a_simulated_flight():
    # fly a ball with the same physics and check the tracker's forecast against where it really crossed
    x, y, vx, vy = 2.4, 0.3, -3.5, 0.5
    truth = predict_cross(x, y, vx, vy)
    assert truth is not None
    tracker = BallTracker(CAM, gap=3)
    fps, dt = 30, 1 / 240
    state = None
    px, py, pvx, pvy, t = x, y, vx, vy, 0.0
    for k in range(60):
        rgb, depth = frame(px, py)
        out = tracker.update(rgb, depth, t)
        if out and out["forecast_y"] is not None and px < 1.0 and state is None:
            state = out
        for _ in range(int(1 / (fps * dt))):
            pvy -= 9.81 * dt
            px += pvx * dt
            py += pvy * dt
            if py < 0:
                py, pvy, pvx = -py * 0.8, -pvy * 0.8, pvx * 0.92
        t += 1 / fps
        if px <= 0:
            break
    assert state is not None
    assert abs(state["forecast_y"] - truth[0]) < 0.05
    assert abs(state["vx"] - vx * 0.92) < 0.4 or abs(state["vx"] - vx) < 0.4
