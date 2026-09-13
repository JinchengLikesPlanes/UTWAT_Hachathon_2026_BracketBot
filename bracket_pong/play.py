"""Native mouse-aiming challenge. Run with python (not mjpython) on macOS."""
import argparse
import json
from pathlib import Path
import time

import glfw
import mujoco
import numpy as np
from OpenGL.GL import glViewport

from bracket_pong.challenge import Challenge, default_checkpoint

# Warm paper and ink, the ramp from docs/UI_DESIGN.md. MuJoCo's overlay has
# two bitmap fonts and flat rectangles only, so the ramp is carried by shade.
PAPER = (0.984, 0.973, 0.961, 1)     # #FBF8F5, bands
CARD = (1, 1, 1, 1)                  # #FFFFFF, surfaces that sit on the page
HAIRLINE = (0.878, 0.867, 0.855, 1)  # rgba(23,23,23,.12) flattened onto paper
INK = (0.09, 0.09, 0.09, 1)          # #171717
INK2 = (0.227, 0.227, 0.227, 1)      # #3A3A3A
INK3 = (0.42, 0.42, 0.42, 1)         # #6B6B6B, captions and help
GOOD = (0.18, 0.42, 0.271, 1)        # #2E6B45, the only colour: pass
BAD = (0.627, 0.251, 0.184, 1)       # #A0402F, fail


class PlayWindow:
    def __init__(self, game):
        self.game = game
        if not glfw.init():
            raise RuntimeError("Cannot initialize graphics. Run from a logged-in desktop session.")
        self.window = glfw.create_window(1280, 800, "Bracket Pong - Can you beat the robot?", None, None)
        if not self.window:
            glfw.terminate()
            raise RuntimeError("Cannot create the simulation window")
        glfw.set_window_size_limits(self.window, 1000, 780, glfw.DONT_CARE, glfw.DONT_CARE)
        glfw.make_context_current(self.window)
        glfw.swap_interval(1)
        self.width, self.height = glfw.get_window_size(self.window)
        fw, _ = glfw.get_framebuffer_size(self.window)
        scale = 200 if fw / self.width > 1.5 else 150
        self.context = mujoco.MjrContext(game.env.model, scale)
        self.scene = mujoco.MjvScene(game.env.model, maxgeom=2000)
        self.options = mujoco.MjvOption()
        self.camera = mujoco.MjvCamera()
        self.camera.lookat[:] = [-0.4, 0, 0.85]
        self.camera.distance = 4.0
        self.camera.azimuth = 125
        self.camera.elevation = -22
        game.env.model.vis.headlight.ambient[:] = 0.4
        game.env.model.vis.headlight.diffuse[:] = 0.45
        self.drag = None
        self.last_cursor = (0, 0)
        glfw.set_mouse_button_callback(self.window, self.mouse_button)
        glfw.set_cursor_pos_callback(self.window, self.mouse_move)
        glfw.set_scroll_callback(self.window, self.scroll)
        glfw.set_key_callback(self.window, self.key)

    def boxes(self):
        x = self.width - 304
        return {
            "aim": (x, 220, 280, 180),
            "speed": (x, 458, 280, 22),
            "mode": (x, 507, 280, 36),
            "lift": (x, 579, 280, 22),
            "launch": (x, self.height-112, 280, 46),
        }

    @staticmethod
    def contains(box, x, y):
        a, b, w, h = box
        return a <= x <= a+w and b <= y <= b+h

    def set_control(self, name, x, y):
        if not self.game.edit():
            return
        bx, by, w, h = self.boxes()[name]
        u, v = np.clip((x-bx)/w, 0, 1), np.clip((y-by)/h, 0, 1)
        if name == "aim":
            self.game.shot.aim_y = float((u-0.5)*0.5)
            self.game.shot.aim_z = float((0.5-v)*0.4)
        elif name == "speed":
            self.game.shot.speed = float(1.5 + u*3.5)
        elif name == "lift":
            self.game.auto_lift = False
            self.game.lift_target = float(-1.03044*(1-u))

    def click(self, x, y):
        for name, box in self.boxes().items():
            if self.contains(box, x, y):
                if name == "launch":
                    self.game.launch()
                elif name == "mode":
                    self.game.toggle_lift()
                else:
                    self.drag = name
                    self.set_control(name, x, y)
                return

    def mouse_button(self, window, button, action, mods):
        x, y = glfw.get_cursor_pos(window)
        if action == glfw.RELEASE:
            self.drag = None
        elif button == glfw.MOUSE_BUTTON_LEFT:
            self.click(x, y)
        elif button == glfw.MOUSE_BUTTON_RIGHT and x < self.width-328:
            self.drag = "camera"
        self.last_cursor = x, y

    def mouse_move(self, window, x, y):
        if self.drag == "camera":
            self.camera.azimuth -= (x-self.last_cursor[0])*0.3
            self.camera.elevation = np.clip(self.camera.elevation-(y-self.last_cursor[1])*0.2, -85, -5)
        elif self.drag:
            self.set_control(self.drag, x, y)
        self.last_cursor = x, y

    def scroll(self, window, dx, dy):
        self.camera.distance = np.clip(self.camera.distance-0.15*dy, 2, 7)

    def key(self, window, key, scancode, action, mods):
        if action not in (glfw.PRESS, glfw.REPEAT):
            return
        game = self.game
        if key == glfw.KEY_ESCAPE:
            glfw.set_window_should_close(window, True)
        elif key == glfw.KEY_SPACE and action == glfw.PRESS:
            game.launch()
        elif key == glfw.KEY_P and action == glfw.PRESS:
            game.paused = not game.paused
        elif key == glfw.KEY_R and action == glfw.PRESS:
            game.reset_score()
        elif key == glfw.KEY_L and action == glfw.PRESS:
            game.toggle_lift()
        elif game.edit():
            if key in (glfw.KEY_LEFT, glfw.KEY_RIGHT):
                game.shot.aim_y = float(np.clip(game.shot.aim_y + (0.01 if key == glfw.KEY_RIGHT else -0.01), -0.25, 0.25))
            elif key in (glfw.KEY_UP, glfw.KEY_DOWN):
                game.shot.aim_z = float(np.clip(game.shot.aim_z + (0.01 if key == glfw.KEY_UP else -0.01), -0.2, 0.2))
            elif key in (glfw.KEY_EQUAL, glfw.KEY_MINUS):
                game.shot.speed = float(np.clip(game.shot.speed+(0.2 if key == glfw.KEY_EQUAL else -0.2), 1.5, 5))
            elif key in (glfw.KEY_U, glfw.KEY_J):
                game.auto_lift = False
                game.lift_target = float(np.clip(game.lift_target+(0.05 if key == glfw.KEY_U else -0.05), -1.03044, 0))

    def rect(self, box):
        x, y, w, h = box
        fw, fh = glfw.get_framebuffer_size(self.window)
        return mujoco.MjrRect(int(x*fw/self.width), int((self.height-y-h)*fh/self.height),
                              max(1, int(w*fw/self.width)), max(1, int(h*fh/self.height)))

    def fill(self, box, color):
        mujoco.mjr_rectangle(self.rect(box), *color)

    def panel(self, box, fill=PAPER, edges="tblr"):
        # A band or card: flat fill with a 1px hairline on the named edges.
        x, y, w, h = box
        self.fill(box, fill)
        if "t" in edges: self.fill((x, y, w, 1), HAIRLINE)
        if "b" in edges: self.fill((x, y+h-1, w, 1), HAIRLINE)
        if "l" in edges: self.fill((x, y, 1, h), HAIRLINE)
        if "r" in edges: self.fill((x+w-1, y, 1, h), HAIRLINE)

    def text(self, x, y, message, width=290, height=32, large=False, color=INK):
        font = mujoco.mjtFont.mjFONT_BIG if large else mujoco.mjtFont.mjFONT_NORMAL
        fw, fh = glfw.get_framebuffer_size(self.window)
        glViewport(0, 0, fw, fh)
        mujoco.mjr_text(font, message, self.context, x/self.width,
                       1-(y+(27 if large else 18))/self.height, *color[:3])

    def slider(self, box, fraction):
        x, y, w, h = box
        knob = x+w*np.clip(fraction, 0, 1)
        self.fill((x, y+8, w, 5), HAIRLINE)
        self.fill((x, y+8, knob-x, 5), INK)
        self.fill((knob-6, y, 12, h), INK)
        self.fill((knob-5, y+1, 10, h-2), CARD)

    def draw(self):
        self.width, self.height = glfw.get_window_size(self.window)
        if min(glfw.get_framebuffer_size(self.window)) == 0:
            return
        g = self.game
        mujoco.mjv_updateScene(g.env.model, g.env.data, self.options, None, self.camera,
                               mujoco.mjtCatBit.mjCAT_ALL, self.scene)
        if g.phase != "flight":
            marker = self.scene.geoms[self.scene.ngeom]
            mujoco.mjv_initGeom(marker, mujoco.mjtGeom.mjGEOM_SPHERE, np.array([0.026]*3),
                                g.target, np.eye(3).ravel(), np.array(INK3, dtype=np.float32))
            self.scene.ngeom += 1
        mujoco.mjr_render(self.rect((0, 0, self.width-328, self.height)), self.scene, self.context)
        self.panel((self.width-328, 0, 328, self.height), PAPER, edges="l")
        x = self.width-304
        self.panel((0, 0, self.width-328, 96), PAPER, edges="b")
        self.text(24, 20, "Bracket Pong", width=600, height=44, large=True)
        self.text(24, 62, "Aim a shot. Make the robot miss.", width=600, color=INK2)
        state, tone = ("Paused. P to resume", INK) if g.paused else {
            "aim": ("Choose your shot, then press Space", INK),
            "flight": ("Ball in play", INK),
            "result": ("Robot returns it.", BAD) if g.last_outcome == "return" else ("Your point.", GOOD),
        }[g.phase]
        self.panel((0, self.height-112, self.width-328, 112), PAPER, edges="t")
        self.text(24, self.height-86, state, width=self.width-380, large=True, height=40, color=tone)
        self.text(24, self.height-45, "Right-drag: orbit   Scroll: zoom   P: pause   R: reset score", width=self.width-380, color=INK3)
        self.text(x, 24, "You", color=INK3)
        self.text(x+170, 24, "Robot", color=INK3)
        self.text(x, 57, f"{g.you:02d}", large=True, height=48)
        self.text(x+170, 57, f"{g.robot:02d}", large=True, height=48)
        self.text(x, 111, f"{g.you+g.robot} shots completed", color=INK3)
        self.text(x, 156, "Place your shot.", large=True, height=40)
        self.text(x, 190, "Drag the target. Arrows work too.", color=INK2)
        boxes = self.boxes()
        bx, by, bw, bh = boxes["aim"]
        self.panel(boxes["aim"], CARD)
        for u in (0.25, 0.5, 0.75):
            self.fill((bx+bw*u, by, 1, bh), HAIRLINE)
            self.fill((bx, by+bh*u, bw, 1), HAIRLINE)
        cx = bx+bw*(g.shot.aim_y/0.5+0.5)
        cy = by+bh*(0.5-g.shot.aim_z/0.4)
        self.fill((cx-10, cy-1, 20, 2), INK)
        self.fill((cx-1, cy-10, 2, 20), INK)
        self.text(bx+8, by+4, "Higher", color=INK3)
        self.text(bx+8, by+bh-30, "Lower", color=INK3)
        self.text(x, 405, f"Side {g.shot.aim_y*100:+.0f} cm   Height {g.shot.aim_z*100:+.0f} cm", color=INK2)
        self.text(x, 432, f"Shot speed    {g.shot.speed:.1f} m/s   (+ / -)", color=INK2)
        self.slider(boxes["speed"], (g.shot.speed-1.5)/3.5)
        self.panel(boxes["mode"], CARD)
        self.text(x+8, 509, f'Lift: {"Automatic" if g.auto_lift else "Manual"}   (L to switch)')
        height = 1.03044+g.env.data.qpos[g.env.lq]
        self.text(x, 547, f"Carriage height    {height:.2f} m", color=INK2)
        self.slider(boxes["lift"], 1+g.lift_target/1.03044 if not g.auto_lift else height/1.03044)
        self.text(x, 607, "Drag to move lift manually. U / J.", color=INK3)
        # Dark primary button while armed; paper with a hairline while the ball flies.
        if g.phase == "flight":
            self.panel(boxes["launch"], PAPER)
            self.text(x+12, self.height-99, "Ball in play", height=40, color=INK3)
        else:
            self.fill(boxes["launch"], INK)
            self.text(x+12, self.height-99, "Launch shot   [Space]", height=40, color=CARD)
        self.text(x, self.height-52, "Return challenge" if g.learned_lift else "Arm policy: manual lift only", color=INK3)

    def save_frame(self, path):
        from PIL import Image
        self.draw()
        fw, fh = glfw.get_framebuffer_size(self.window)
        rgb = np.empty((fh, fw, 3), dtype=np.uint8)
        mujoco.mjr_readPixels(rgb, None, mujoco.MjrRect(0, 0, fw, fh), self.context)
        path.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(np.flipud(rgb)).save(path)

    def self_test(self, output):
        # Exercise the same input handlers as the visible mouse/keyboard controls.
        bx, by, bw, bh = self.boxes()["aim"]
        self.click(bx+bw*0.55, by+bh*0.55)
        assert abs(self.game.shot.aim_y-0.025) < 1e-6
        bx, by, bw, bh = self.boxes()["speed"]
        self.click(bx+bw*(2.8-1.5)/3.5, by+bh/2)
        bx, by, bw, bh = self.boxes()["lift"]
        self.click(bx+bw*0.85, by+bh/2)
        for _ in range(40):
            self.game.preview_lift()
        assert self.game.env.data.qpos[self.game.env.lq] < -0.1
        self.save_frame(output / "manual-lift.png")
        self.game.auto_lift = self.game.learned_lift
        self.game.lift_target = 0
        self.game.prepare()
        self.save_frame(output / "challenge.png")
        self.key(self.window, glfw.KEY_SPACE, 0, glfw.PRESS, 0)
        assert self.game.attempts == 1
        self.key(self.window, glfw.KEY_SPACE, 0, glfw.PRESS, 0)
        assert self.game.attempts == 1
        while self.game.phase == "flight":
            self.game.tick()
        assert self.game.robot+self.game.you == 1
        self.save_frame(output / "result.png")
        print(json.dumps({"outcome": self.game.last_outcome, "you": self.game.you, "robot": self.game.robot, "lift_policy": self.game.learned_lift}))

    def run(self):
        previous = time.monotonic()
        accumulator = 0.0
        while not glfw.window_should_close(self.window):
            glfw.poll_events()
            now = time.monotonic()
            accumulator += min(now-previous, 0.1)
            previous = now
            dt = self.game.env.config.frame_skip*self.game.env.model.opt.timestep
            while accumulator >= dt:
                if self.game.phase == "aim":
                    self.game.preview_lift()
                else:
                    self.game.tick()
                accumulator -= dt
            self.draw()
            glfw.swap_buffers(self.window)

    def close(self):
        self.context.free()
        self.scene = None
        glfw.destroy_window(self.window)
        glfw.terminate()


def main():
    parser = argparse.ArgumentParser(description="Aim shots at the trained robot")
    parser.add_argument("--model", type=Path)
    parser.add_argument("--self-test", type=Path, help="Exercise controls, save screenshots, then exit")
    args = parser.parse_args()
    game = Challenge(args.model or default_checkpoint())
    window = None
    try:
        window = PlayWindow(game)
        if args.self_test:
            window.self_test(args.self_test)
        else:
            window.run()
    finally:
        if window:
            window.close()
        game.close()


if __name__ == "__main__":
    import sys
    if "--legacy" in sys.argv:
        sys.argv.remove("--legacy")
        main()
    else:
        from bracket_pong.match import main as match_main
        match_main()
