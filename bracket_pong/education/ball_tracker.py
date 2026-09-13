"""Ball tracking from the head depth camera — the pipeline from the game's Level 2, for real frames.

Same steps, same order as game/sim/vision.js:
colour threshold → centroid pixel → depth at that pixel → deproject with the intrinsics →
speed from two frames (forecast from the gap's midpoint) → skip frames that straddle a bounce →
ballistic forecast of where the ball crosses the paddle plane.

Frames: x forward along the table from the paddle plane, y up from the table top, z sideways.
Only numpy; feed it the colour image (H×W×3 uint8), the depth image (H×W metres) and the camera.
"""
from dataclasses import dataclass, field
import math

import numpy as np

G = 9.81
E_TABLE = 0.8          # vertical restitution of the table (game value; measure yours)
F_TABLE = 0.92         # horizontal speed kept per bounce
TABLE_LEN = 2.74


@dataclass
class Camera:
    """Pinhole intrinsics plus where the camera sits: height above the table, forward offset from
    the paddle plane (negative = behind it) and how far it is nodded down (radians)."""
    fx: float
    fy: float
    cx: float
    cy: float
    height: float
    x: float = -0.45
    pitch: float = 0.35


def rgb_to_hsv(rgb):
    """Vectorised RGB (0–255) → hue (degrees), saturation, value (0–1)."""
    c = rgb.astype(np.float32) / 255.0
    mx, mn = c.max(-1), c.min(-1)
    d = mx - mn
    r, g, b = c[..., 0], c[..., 1], c[..., 2]
    dd = np.where(d == 0, 1, d)
    h = np.zeros_like(mx)
    m = d > 0
    rm, gm, bm = m & (mx == r), m & (mx == g) & (mx != r), m & (mx == b) & (mx != r) & (mx != g)
    h[rm] = (60 * (((g - b) / dd) % 6))[rm]
    h[gm] = (60 * ((b - r) / dd + 2))[gm]
    h[bm] = (60 * ((r - g) / dd + 4))[bm]
    s = np.where(mx > 0, d / np.where(mx == 0, 1, mx), 0)
    return h, s, mx


def detect(rgb, hue=24.0, width=8.0, min_sat=0.5, min_val=0.3):
    """Keep pixels within ±width degrees of the ball's hue; return (found, u, v, n, mask)."""
    h, s, v = rgb_to_hsv(rgb)
    dh = np.abs(((h - hue + 540) % 360) - 180)
    mask = (dh <= width) & (s >= min_sat) & (v >= min_val)
    n = int(mask.sum())
    if n == 0:
        return False, None, None, 0, mask
    vs, us = np.nonzero(mask)
    return True, float(us.mean()), float(vs.mean()), n, mask


def deproject(u, v, depth, cam: Camera):
    """Pixel + depth (along the optical axis) → point in the table frame (x forward, y up, z sideways)."""
    a = (u - cam.cx) / cam.fx
    b = (cam.cy - v) / cam.fy
    cp, sp = math.cos(cam.pitch), math.sin(cam.pitch)
    return np.array([cam.x + (cp + b * sp) * depth, cam.height + (-sp + b * cp) * depth, a * depth])


def measure(rgb, depth_img, cam: Camera, hue=24.0, width=8.0):
    """One frame → the ball's position in metres, or None."""
    found, u, v, _, _ = detect(rgb, hue, width)
    if not found:
        return None
    z = float(depth_img[int(round(v)), int(round(u))])
    if not np.isfinite(z) or z <= 0:
        return None
    return deproject(u, v, z, cam)


def bounce_in_window(ys):
    """True if the heights went down and then up — a bounce happened between these frames."""
    went_down = False
    for a, b in zip(ys, ys[1:]):
        if b < a:
            went_down = True
        elif went_down and b > a:
            return True
    return False


def predict_cross(x, y, vx, vy, x_cross=0.0, dt=1 / 240, horizon=2.0):
    """Fly the ball forward (with one or more table bounces) until it crosses x_cross. Returns (y, t) or None."""
    px, py = x, y
    for i in range(int(horizon / dt)):
        qx, qy = px, py
        vy -= G * dt
        px += vx * dt
        py += vy * dt
        if py < 0 and 0 <= px <= TABLE_LEN:
            py, vy, vx = -py * E_TABLE, -vy * E_TABLE, vx * F_TABLE
        if (qx - x_cross) * (px - x_cross) <= 0 and qx != px:
            return qy + (py - qy) * (qx - x_cross) / (qx - px), (i + 1) * dt
    return None


@dataclass
class BallTracker:
    """Feed frames in order; `update` returns the state the policy reads once a forecast exists."""
    cam: Camera
    hue: float = 24.0
    width: float = 8.0
    gap: int = 3
    bounce_rule: bool = True
    history: list = field(default_factory=list)   # (t, position or None)

    def update(self, rgb, depth_img, t):
        p = measure(rgb, depth_img, self.cam, self.hue, self.width)
        self.history.append((t, p))
        if p is None or len(self.history) <= self.gap:
            return None
        t0, p0 = self.history[-1 - self.gap]
        if p0 is None:
            return None
        window = [q[1] for q in self.history[-max(self.gap, 2) - 1:] if q[1] is not None]
        if self.bounce_rule and bounce_in_window([q[1] for q in window]):
            return None
        dt = t - t0
        v = (p - p0) / dt
        mid = (p + p0) / 2                      # the measured speed belongs to the midpoint
        forecast = predict_cross(mid[0], mid[1], v[0], v[1])
        return {
            "x": float(p[0]), "y": float(p[1]), "vx": float(v[0]), "vy": float(v[1]),
            "forecast_y": None if forecast is None else float(forecast[0]),
            "time_to_cross": None if forecast is None else float(forecast[1]),
        }
