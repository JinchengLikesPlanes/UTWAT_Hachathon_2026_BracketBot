"""Continuous mouse-paddle match. Both paddles interact with the same ball."""
import argparse
import json
import hashlib
from pathlib import Path
import time
import glfw
import mujoco
import numpy as np
import torch
from stable_baselines3 import PPO

from bracket_pong.model import ROOT
from bracket_pong.play import PlayWindow, PAPER, CARD, INK, INK2, INK3, GOOD, BAD
from bracket_pong.rally import RallySim, intercept
from bracket_pong.rules import MatchScore


def checkpoints():
    active=ROOT/"runs/wheels-default.json"
    if active.exists():
        entry=json.loads(active.read_text())
        path=ROOT/entry["checkpoint"]
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=entry["sha256"]:
            raise ValueError("The selected wheel policy is missing or changed; check runs/wheels-default.json")
        return [(entry["label"],path)]
    folder=ROOT/"runs/rally-wheels-seed0"
    choices=[("Checkpoint 50k",folder/"checkpoints/rl_model_50000_steps.zip"),
             ("Checkpoint 100k",folder/"checkpoints/rl_model_100000_steps.zip"),
             ("Best validated",folder/"best_model.zip")]
    return [(name,path) for name,path in choices if path.exists()]


PADDLE_LOW,PADDLE_HIGH=np.array([-.8,.86]),np.array([.8,1.48])


def move_paddle(position,delta_px,sensitivity):
    """Relative mouse control, as in mouse-driven pong games: paddle moves by
    pixels x metres-per-pixel, clipped to the hitting window. Screen up is +z."""
    dx,dy=delta_px
    return np.clip(position+np.array([dx,-dy])*sensitivity,PADDLE_LOW,PADDLE_HIGH)


class RallyMatch:
    def __init__(self,model=None):
        torch.set_num_threads(1)
        self.sim=RallySim(mobile=True)
        self.env=self.sim
        self.score=MatchScore()
        self.policy=None
        self.difficulty="Controller baseline"
        if model:
            self.load_policy(model,"Custom policy")
        elif checkpoints():
            name,path=checkpoints()[-1]
            self.load_policy(path,name)
        self.phase="pre_serve"
        self.paused=False
        self.human_y,self.human_z=0,1.08
        self.pitch,self.yaw=0.3,0
        self.pitch_bias=0.0   # from mouse motion, added to the loft angle
        self.swing=False
        self.power=0.5
        self.auto_swing=True
        self.swing_lead=0.14   # seconds before the ball reaches the paddle plane
        self.swing_reach=0.16  # metres from the paddle centre
        self.replay_frames=[]
        self.replay_index=0
        self.replaying=False
        self.point_history=[]
        self.pre_time=0
        self.bot_mode=False

    def load_policy(self,path,name):
        policy=PPO.load(path,device="cpu")
        if policy.action_space.shape!=(8,) or policy.observation_space.shape!=self.sim.observation().shape:
            raise ValueError("This match requires a wheels-v2 policy. Slider/arm checkpoints need retraining.")
        self.policy,self.difficulty=policy,name

    def serve(self):
        if self.phase=="point":
            self.phase="pre_serve"
            self.pre_time=0
            self.replaying=False
        if self.phase!="pre_serve":
            return False
        self.sim.serve(self.score.server, float(np.clip(self.human_y,-0.25,0.25)) if self.score.server=="human" else 0)
        self.sim.data.qpos[self.sim.hq]=[1.58,self.human_y,self.human_z,self.pitch,self.yaw]
        self.sim.data.ctrl[self.sim.ha]=self.sim.data.qpos[self.sim.hq]
        self.sim.human_motion.value[:]=self.sim.data.qpos[self.sim.hq]
        mujoco.mj_forward(self.sim.model,self.sim.data)
        self.phase="play"
        return True

    def tick(self):
        if self.paused:
            return
        if self.replaying and self.replay_frames:
            self.sim.data.qpos[:]=self.replay_frames[self.replay_index%len(self.replay_frames)]
            mujoco.mj_forward(self.sim.model,self.sim.data)
            self.replay_index+=1
            return
        if self.phase=="pre_serve":
            self.pre_time+=self.sim.dt
            self.sim.human_control(self.human_y,self.human_z,False,self.pitch,self.yaw)
            for _ in range(round(self.sim.dt/self.sim.model.opt.timestep)):
                mujoco.mj_step(self.sim.model,self.sim.data)
                self.sim.ball[:]=[1.30,self.human_y,self.human_z+0.12]
                self.sim.velocity[:]=0
            mujoco.mj_forward(self.sim.model,self.sim.data)
            if (self.score.server=="robot" or self.bot_mode) and self.pre_time>0.8:
                self.serve()
            return
        if self.phase!="play":
            return
        action=self.policy.predict(self.sim.observation(),deterministic=True)[0] if self.policy else np.zeros(8)
        self.sim.robot_control(action)
        if self.bot_mode:
            self.sim.opponent("blocker")
        else:
            self.aim_paddle()
            self.sim.human_control(self.human_y,self.human_z,self.swing,self.pitch,self.yaw,power=self.power)
        self.swing=False
        self.sim.advance()
        if self.sim.rules.winner:
            self.score.point(self.sim.rules.winner)
            self.point_history.append({"winner":self.sim.rules.winner,"reason":self.sim.rules.reason,"hits":self.sim.rules.hits})
            self.replay_frames=[p.copy() for p in self.sim.trajectory]
            self.phase="game_over" if self.score.winner else "point"

    def aim_paddle(self):
        """Face angle and swing timing while a ball is incoming. The face opens
        enough to lift the ball to mid-court (the formula opponent() uses); the
        swing fires by itself when the ball is about to reach the paddle."""
        incoming=self.sim.velocity[0]>0.2 and self.sim.rules.receiver=="human"
        if not (self.auto_swing and incoming):
            self.pitch=float(np.clip(0.3+self.pitch_bias,0.1,0.5))
            return
        p,t,vin=intercept(self.sim.ball,self.sim.velocity,1.48)
        outgoing=(np.array([-0.6,0,0.78])-p)/0.55
        outgoing[2]+=4.905*0.55
        n=vin-outgoing
        n/=max(np.linalg.norm(n),1e-6)
        self.pitch=float(np.clip(-np.arcsin(np.clip(n[2],-0.56,0.56))+self.pitch_bias,0.1,0.6))
        if not self.swing and t<self.swing_lead and np.linalg.norm(p[1:]-[self.human_y,self.human_z])<self.swing_reach:
            self.swing=True

    def replay(self):
        if self.phase in ("point","game_over") and self.replay_frames:
            self.replaying=not self.replaying
            self.replay_index=0

    def new_match(self):
        self.score=MatchScore()
        self.sim.reset()
        self.phase="pre_serve"
        self.paused=self.replaying=False
        self.point_history=[]
        self.pre_time=0

    def save_playtest(self,path):
        path.parent.mkdir(parents=True,exist_ok=True)
        path.write_text(json.dumps({"policy":self.difficulty,"score":{"human":self.score.human,"robot":self.score.robot},
                                   "points":self.point_history},indent=2))


class MatchWindow(PlayWindow):
    def __init__(self,game):
        super().__init__(game)
        glfw.set_window_title(self.window,"Bracket Pong - Rally")
        glfw.set_window_size_limits(self.window,960,640,glfw.DONT_CARE,glfw.DONT_CARE)
        self.camera.lookat[:]=[-0.1,0,0.95]
        self.camera.distance=4.3
        self.camera.azimuth=180
        self.camera.elevation=-19
        self.mouse_time=time.monotonic()
        self.mouse_position=np.array([0.0,1.08])
        self.sensitivity=0.0009   # metres of paddle travel per pixel of mouse travel
        self.captured=False
        self.last_cursor=None

    def mouse_move(self,window,x,y):
        game=self.game
        if self.drag=="camera" or game.paused or game.replaying:
            if self.drag=="camera" and self.last_cursor is not None:
                self.camera.azimuth-=(x-self.last_cursor[0])*0.3
                self.camera.elevation=np.clip(self.camera.elevation-(y-self.last_cursor[1])*0.2,-85,-5)
            self.last_cursor=x,y
            return
        if self.last_cursor is None:
            self.last_cursor=x,y
            return
        # Relative motion, as mouse pong games do: the cursor is captured and
        # each pixel of travel moves the paddle a fixed distance.
        target=move_paddle(self.mouse_position,(x-self.last_cursor[0],y-self.last_cursor[1]),self.sensitivity)
        now=time.monotonic()
        velocity=np.clip((target-self.mouse_position)/max(now-self.mouse_time,0.01),-3.5,3.5)
        game.human_y,game.human_z=target
        game.pitch_bias=float(np.clip(velocity[1]*0.06,-0.2,0.2))
        game.yaw=float(np.clip(-velocity[0]*0.08,-0.3,0.3))
        self.mouse_position,self.mouse_time=target,now
        self.last_cursor=x,y

    def capture_cursor(self,captured):
        if captured==self.captured:
            return
        self.captured=captured
        glfw.set_input_mode(self.window,glfw.CURSOR,glfw.CURSOR_DISABLED if captured else glfw.CURSOR_NORMAL)
        if captured and glfw.raw_mouse_motion_supported():
            glfw.set_input_mode(self.window,glfw.RAW_MOUSE_MOTION,glfw.TRUE)
        self.last_cursor=None

    def mouse_button(self,window,button,action,mods):
        if button==glfw.MOUSE_BUTTON_LEFT and action==glfw.PRESS:
            self.game.swing=True
        if button==glfw.MOUSE_BUTTON_RIGHT:
            self.drag="camera" if action==glfw.PRESS else None
            self.mouse_position=np.array([self.game.human_y,self.game.human_z])
            self.mouse_time=time.monotonic()
        self.last_cursor=glfw.get_cursor_pos(window)

    def scroll(self,window,dx,dy):
        super().scroll(window,dx,dy)

    def key(self,window,key,scancode,action,mods):
        if action!=glfw.PRESS:
            return
        g=self.game
        if key in (glfw.KEY_ESCAPE,glfw.KEY_P):
            g.paused=not g.paused
        elif key==glfw.KEY_SPACE and not g.paused:
            if g.phase=="point" or (g.phase=="pre_serve" and g.score.server=="human"):
                g.serve()
        elif key==glfw.KEY_R:
            g.replay()
        elif key==glfw.KEY_N:
            g.new_match()
        elif key==glfw.KEY_Q:
            glfw.set_window_should_close(window,True)
        elif key==glfw.KEY_C:
            self.camera.lookat[:]=[-0.1,0,0.95]
            self.camera.distance,self.camera.azimuth,self.camera.elevation=4.3,180,-19
        elif key in (glfw.KEY_LEFT_BRACKET,glfw.KEY_RIGHT_BRACKET):
            g.power=float(np.clip(g.power+(.1 if key==glfw.KEY_RIGHT_BRACKET else -.1),0,1))
        elif key in (glfw.KEY_MINUS,glfw.KEY_EQUAL):
            self.sensitivity=float(np.clip(self.sensitivity*(1.25 if key==glfw.KEY_EQUAL else 0.8),0.0003,0.003))
        elif key in (glfw.KEY_1,glfw.KEY_2,glfw.KEY_3) and g.phase!="play":
            choices=checkpoints()
            index=key-glfw.KEY_1
            if index<len(choices):
                name,path=choices[index]
                g.load_policy(path,name)

    def draw(self):
        self.width,self.height=glfw.get_window_size(self.window)
        if min(glfw.get_framebuffer_size(self.window))==0:
            return
        g=self.game
        self.capture_cursor(not g.paused and not g.replaying and g.phase!="game_over")
        mujoco.mjv_updateScene(g.sim.model,g.sim.data,self.options,None,self.camera,mujoco.mjtCatBit.mjCAT_ALL,self.scene)
        mujoco.mjr_render(self.rect((0,0,self.width,self.height)),self.scene,self.context)
        self.panel((0,0,self.width,84),PAPER,edges="b")
        self.text(24,18,"Bracket Pong",large=True)
        self.text(self.width/2-145,20,f"You  {g.score.human:02d}       Robot  {g.score.robot:02d}",large=True)
        self.text(self.width-230,20,g.difficulty,color=INK3)
        self.text(self.width-230,49,f"Rally: {g.sim.rules.hits} hits",color=INK3)
        self.text(24,53,"First to 11, win by two",color=INK3)
        tone=INK
        if g.phase=="pre_serve":
            status="Your serve. Press Space" if g.score.server=="human" else "Robot preparing to serve"
        elif g.phase=="play":
            status=f"Move to the ball; the paddle swings by itself. Power {g.power:.0%} ([ / ]), mouse {self.sensitivity*1000:.1f} mm/px (- / =)"
        elif g.phase=="game_over":
            tone=GOOD if g.score.winner=="human" else BAD
            status=("You win." if g.score.winner=="human" else "Robot wins.")+"   N: new match   R: replay"
        else:
            tone=GOOD if g.sim.rules.winner=="human" else BAD
            status=("Your point." if g.sim.rules.winner=="human" else "Robot point.")+f" {g.sim.rules.reason}.  Space: next point"
        if g.replaying:
            status,tone="Point replay. R to stop, Space for next point",INK
        self.panel((0,self.height-85,self.width,85),PAPER,edges="t")
        self.text(24,self.height-72,status,color=tone)
        self.text(24,self.height-37,"Right-drag: view   Scroll: zoom   C: reset view   Esc: pause   R: replay   N: new   Q: quit",color=INK3)
        if g.paused:
            self.panel((self.width/2-220,self.height/2-100,440,200),CARD)
            self.text(self.width/2-190,self.height/2-75,"Paused.",large=True)
            self.text(self.width/2-190,self.height/2-25,"Esc: resume     N: new match",color=INK2)
            self.text(self.width/2-190,self.height/2+10,"1 / 2 / 3: difficulty between points",color=INK2)
            self.text(self.width/2-190,self.height/2+45,"Q: quit     Right-drag: inspect court",color=INK2)

    def run(self):
        previous=time.monotonic();accumulator=0
        while not glfw.window_should_close(self.window):
            glfw.poll_events()
            now=time.monotonic();accumulator+=min(now-previous,0.1);previous=now
            while accumulator>=self.game.sim.dt:
                self.game.tick();accumulator-=self.game.sim.dt
            self.draw();glfw.swap_buffers(self.window)

    def self_test(self,output):
        self.draw()
        assert self.captured
        self.mouse_move(self.window,400,300)
        self.mouse_move(self.window,500,250)
        assert abs(self.game.human_y-100*self.sensitivity)<1e-9 and abs(self.game.human_z-1.08-50*self.sensitivity)<1e-9
        self.key(self.window,glfw.KEY_EQUAL,0,glfw.PRESS,0)
        assert self.sensitivity>0.0009
        self.key(self.window,glfw.KEY_SPACE,0,glfw.PRESS,0)
        assert self.game.phase=="play"
        paddle_before=(self.game.human_y,self.game.human_z)
        azimuth=self.camera.azimuth
        self.mouse_button(self.window,glfw.MOUSE_BUTTON_RIGHT,glfw.PRESS,0)
        self.mouse_move(self.window,self.last_cursor[0]+40,self.last_cursor[1]+10)
        assert self.camera.azimuth!=azimuth
        assert (self.game.human_y,self.game.human_z)==paddle_before
        self.mouse_button(self.window,glfw.MOUSE_BUTTON_RIGHT,glfw.RELEASE,0)
        distance=self.camera.distance
        self.scroll(self.window,0,1)
        assert self.camera.distance!=distance
        self.key(self.window,glfw.KEY_C,0,glfw.PRESS,0)
        self.key(self.window,glfw.KEY_RIGHT_BRACKET,0,glfw.PRESS,0)
        assert self.game.power>.5
        self.game.bot_mode=True
        for _ in range(300):
            self.game.tick()
            if self.game.phase!="play":break
        assert self.game.score.human+self.game.score.robot==1
        self.save_frame(output/"rally-match.png")
        self.game.replay()
        self.game.tick()
        assert self.game.replaying
        self.game.new_match()
        self.save_frame(output/"ready.png")
        print(json.dumps({"ui":"passed","mode":"continuous-rally","policy":self.game.difficulty}))


def main():
    p=argparse.ArgumentParser()
    p.add_argument("--model",type=Path)
    p.add_argument("--self-test",type=Path)
    p.add_argument("--record-stats",type=Path,help="Save local point outcomes on exit")
    args=p.parse_args()
    game=RallyMatch(args.model)
    window=None
    try:
        window=MatchWindow(game)
        if args.self_test:window.self_test(args.self_test)
        else:window.run()
    finally:
        if window:window.close()
        if args.record_stats:game.save_playtest(args.record_stats)


if __name__=="__main__":
    main()
