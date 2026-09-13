"""Shared physical rally engine, used by training, evaluation and live play."""
from dataclasses import dataclass
import mujoco
import numpy as np

from bracket_pong.control import arm_indices, solve_pose
from bracket_pong.model import ARM_JOINTS
from bracket_pong.rally_model import load_rally_model
from bracket_pong.rules import PointRules


def intercept(position, velocity, x, restitution=0.7):
    """Ballistic forecast with one table bounce, using current state only."""
    p, v = np.asarray(position).copy(), np.asarray(velocity).copy()
    if abs(v[0]) < 0.1:
        return p, 2.0, v
    time = float(np.clip((x-p[0])/v[0], 0, 2))
    bounce = (v[2]+np.sqrt(max(0, v[2]**2+19.62*(p[2]-0.78))))/9.81
    if 0 < bounce < time and abs(p[0]+v[0]*bounce) < 1.37 and abs(p[1]+v[1]*bounce) < 0.7625:
        p += v*bounce
        p[2] -= 4.905*bounce*bounce
        v[2] = -(v[2]-9.81*bounce)*restitution
        remaining = time-bounce
    else:
        remaining = time
    p += v*remaining
    p[2] -= 4.905*remaining*remaining
    v[2] -= 9.81*remaining
    return p, time, v


@dataclass
class MotionLimit:
    value: np.ndarray
    speed: np.ndarray

    def move(self, target, dt, max_speed=3.5, acceleration=30):
        desired = np.clip((np.asarray(target)-self.value)/dt, -max_speed, max_speed)
        self.speed += np.clip(desired-self.speed, -acceleration*dt, acceleration*dt)
        delta = self.speed*dt
        remaining = np.asarray(target)-self.value
        crossed = (delta*remaining >= 0) & (np.abs(delta) > np.abs(remaining))
        delta[crossed] = remaining[crossed]
        self.value += delta
        return self.value


class RallySim:
    dt = 0.02
    # Chassis controller. paddle_offset is the paddle site's y relative to the
    # chassis at the ready pose; base_range and base_speed bound the drive.
    # The ready stance is side-on (heading +90 deg, parked at y=+0.10): a
    # differential drive turns at ~45 deg/s, so facing the table it could
    # never reach a wide ball in time. Side-on, lateral moves are straight
    # driving. Measured with evaluate_rally: worst column 0.00 -> 0.24.
    paddle_offset = 0.08
    base_range = 0.45
    base_speed = 0.55
    rest_base = 0.10
    rest_heading = np.pi/2

    def __init__(self, mobile=False):
        self.mobile = mobile
        self.model = load_rally_model(mobile=mobile)
        self.data = mujoco.MjData(self.model)
        self.ikdata = mujoco.MjData(self.model)
        self.qids, self.vids = arm_indices(self.model)
        self.aids = np.array([self.model.actuator(f"servo_{n}").id for n in ARM_JOINTS])
        self.ready = solve_pose(self.model)
        self.bq = self.model.joint("ball_free").qposadr[0]
        self.bv = self.model.joint("ball_free").dofadr[0]
        self.lq, self.lv = self.model.joint("rj0").qposadr[0], self.model.joint("rj0").dofadr[0]
        if mobile:
            self.cq = self.model.joint("chassis_free").qposadr[0]
            self.cv = self.model.joint("chassis_free").dofadr[0]
            self.baseq, self.basev = self.cq+1, self.cv+1
            self.wheels = np.array([self.model.actuator(f"drive_{s}").id for s in ("left", "right")])
        else:
            self.baseq, self.basev = self.model.joint("base_y").qposadr[0], self.model.joint("base_y").dofadr[0]
            self.ba = self.model.actuator("base_drive").id
        self.la = self.model.actuator("servo_rj0").id
        self.hnames = [f"human_{n}" for n in ("x", "y", "z", "pitch", "yaw")]
        self.hq = np.array([self.model.joint(n).qposadr[0] for n in self.hnames])
        self.ha = np.array([self.model.actuator(n).id for n in self.hnames])
        self.ids = {n:self.model.geom(n).id for n in ("ball_geom", "paddle", "human_rubber", "table", "net", "floor")}
        self.guard_ids = {i for i in range(self.model.ngeom) if (mujoco.mj_id2name(self.model, mujoco.mjtObj.mjOBJ_GEOM, i) or "").startswith(("guard_", "chassis_guard"))}
        self.jp, self.jr = np.zeros((3, self.model.nv)), np.zeros((3, self.model.nv))
        self.sid = self.model.site("paddle_center").id
        self.lo, self.hi = self.model.jnt_range[[self.model.joint(n).id for n in ARM_JOINTS]].T
        self.base_enabled = True
        self.reset()

    @property
    def ball(self):
        return self.data.qpos[self.bq:self.bq+3]

    @property
    def velocity(self):
        return self.data.qvel[self.bv:self.bv+3]

    def reset(self):
        mujoco.mj_resetData(self.model, self.data)
        self.data.qpos[self.qids] = self.ready
        self.data.ctrl[self.aids] = self.ready
        self.data.qpos[self.hq] = [1.55, 0, 1.1, 0, 0]
        self.data.ctrl[self.ha] = self.data.qpos[self.hq]
        if self.mobile:
            # Ready stance: the chassis starts parked where it idles between points.
            self.data.qpos[self.cq+1] = self.rest_base
            self.data.qpos[self.cq+3:self.cq+7] = [np.cos(self.rest_heading/2), 0, 0, np.sin(self.rest_heading/2)]
        self.ball[:] = [0.9, 0, 1.25]
        self.data.qpos[self.bq+3:self.bq+7] = [1, 0, 0, 0]
        self.base_command = 0.0
        self.human_motion = MotionLimit(self.data.qpos[self.hq].copy(), np.zeros(5))
        self.rules = PointRules()
        self.contacts = set()
        self.contact_times = {}
        self.clock = 0
        self.robot_returns = 0
        self.collision_count = 0
        self.trajectory = []
        self.last_action = np.zeros(8)
        self.swing_remaining = 0
        self.last_swing = -1
        mujoco.mj_forward(self.model, self.data)

    def feed(self, y=0, z=1.05, speed=3.2, angle=0):
        """Reset-only post-bounce feed for stratified return training."""
        self.reset()
        duration = 1.9/speed
        target = np.array([-1.3, y, z])
        self.ball[:] = [0.6, y-angle*duration, z-0.04]
        self.velocity[:] = (target-self.ball)/duration
        self.velocity[2] += 4.905*duration
        self.rules = PointRules(last_hitter="human", bounces=1)
        mujoco.mj_forward(self.model, self.data)

    def serve(self, side, y=0):
        """Simplified machine serve: ball initialized after racket launch.

        It must bounce on the server's half and then receiver's half. No ball
        state is modified again until the next point's serve.
        """
        self.reset()
        direction = -1 if side == "human" else 1
        self.ball[:] = [-direction*0.9, y, 0.98]
        self.velocity[:] = [direction*3.4, 0, -2.5]
        self.rules = PointRules(last_hitter=side, serving=True)
        mujoco.mj_forward(self.model, self.data)

    def robot_control(self, action):
        action = np.asarray(action, dtype=float)
        if action.shape != (8,) or not np.isfinite(action).all():
            raise ValueError("Rally action must contain 8 finite values")
        action = np.clip(action, -1, 1)
        p, time, vin = intercept(self.ball, self.velocity, -1.30)
        approaching = self.velocity[0] < -0.2 and self.rules.receiver == "robot"
        if approaching:
            landing = np.array([0.6, action[4]*0.35, 0.78])
            flight = 0.58 + 0.08*action[5]
            outgoing = (landing-p)/flight
            outgoing[2] += 4.905*flight
            normal = outgoing-vin
            normal /= max(np.linalg.norm(normal), 1e-6)
            speed = np.clip((outgoing@normal+0.7*(vin@normal))/1.7, 0.0, 2)
            target = p.copy()
            target[0] = np.clip(-1.3 + speed*(0.06-time), -1.52, -1.13)
            target += action[:3]*[0.08, 0.12, 0.12]
            target[2] = np.clip(target[2], 0.87, 1.43)
            normal[2] += 0.25*action[3]
            normal /= np.linalg.norm(normal)
            desired_base = np.clip(p[1]+self.paddle_offset+action[7]*0.2, -self.base_range, self.base_range)
            lift = np.clip((p[2]-1.1)*0.4+action[6]*0.12, -0.3, 0)
        else:
            desired_base, lift = self.rest_base, -0.02
            target = np.array([-1.40, self.data.qpos[self.baseq]-0.10, 1.08])
            normal = np.array([0.96, 0, 0.28])
        self.data.ctrl[self.la] = lift
        distance = desired_base-self.data.qpos[self.baseq]
        brake_speed = np.sqrt(max(0, 2*2*abs(distance)))
        desired_speed = np.clip(4*distance, -min(0.8, brake_speed), min(0.8, brake_speed)) if self.base_enabled else 0.0
        self.base_command += np.clip(desired_speed-self.base_command, -2*self.dt, 2*self.dt)
        if self.mobile:
            self.drive_to(-1.65, desired_base)
        else:
            self.data.ctrl[self.ba] = self.base_command
        self.ikdata.qpos[:] = self.data.qpos
        self.ikdata.qvel[:] = 0
        for _ in range(6):
            mujoco.mj_forward(self.model, self.ikdata)
            current = self.ikdata.site_xmat[self.sid].reshape(3,3)[:,2]
            error = np.r_[target-self.ikdata.site_xpos[self.sid], 0.25*np.cross(current, normal)]
            mujoco.mj_jacSite(self.model, self.ikdata, self.jp, self.jr, self.sid)
            jac = np.vstack([self.jp[:,self.vids], 0.25*self.jr[:,self.vids]])
            delta = jac.T@np.linalg.solve(jac@jac.T+0.0003*np.eye(6), error)
            self.ikdata.qpos[self.qids] = np.clip(self.ikdata.qpos[self.qids]+np.clip(delta,-0.18,0.18), self.lo+0.01, self.hi-0.01)
        # Gravity feed-forward expressed as a servo offset; force remains capped.
        command = self.ikdata.qpos[self.qids]+self.data.qfrc_bias[self.vids]/60
        previous = self.data.ctrl[self.aids]
        self.data.ctrl[self.aids] = np.clip(previous+np.clip(command-previous,-10*self.dt,10*self.dt),self.lo,self.hi)
        self.last_action = action.copy()

    def drive_to(self, x, y):
        """Differential drive: rotate, roll, brake. Never set chassis pose/velocity."""
        position = self.data.qpos[self.cq:self.cq+3]
        matrix = self.data.xmat[self.model.body("robot_mount").id].reshape(3,3)
        heading = np.arctan2(matrix[1,0], matrix[0,0])
        delta = np.array([np.clip(x,-1.95,-1.60), np.clip(y,-self.base_range,self.base_range)])-position[:2]
        distance = np.linalg.norm(delta)
        error = (np.arctan2(delta[1],delta[0])-heading+np.pi)%(2*np.pi)-np.pi
        direction = 1
        if abs(error)>np.pi/2:
            direction = -1
            error = (error+np.pi+np.pi)%(2*np.pi)-np.pi
        if distance<.035:
            error = (self.rest_heading-heading+np.pi)%(2*np.pi)-np.pi
        speed = direction*min(self.base_speed,1.8*distance) if distance>=.035 and abs(error)<.20 else 0
        turn = np.clip(3*error,-2,2)
        commands = np.array([speed-turn*.16108, speed+turn*.16108])/.0846
        if not self.base_enabled:
            commands[:]=0
        previous = self.data.ctrl[self.wheels]
        self.data.ctrl[self.wheels] = previous+np.clip(commands-previous,-.8,.8)

    def human_control(self, y, z, swing=False, pitch=0.0, yaw=0.0, x=None, power=0.5):
        if swing and self.clock-self.last_swing > 0.25:
            self.swing_remaining, self.last_swing = 0.18, self.clock
            self.swing_power = float(np.clip(power,0,1))
        self.swing_remaining = max(0, self.swing_remaining-self.dt)
        target = [np.clip(x,1.30,1.8) if x is not None else (1.36 if self.swing_remaining else 1.58),
                  np.clip(y,-0.8,0.8), np.clip(z,0.86,1.48),
                  np.clip(pitch,-0.6,0.6), np.clip(yaw,-0.6,0.6)]
        swing_power = getattr(self,"swing_power",0.5)
        self.data.ctrl[self.ha] = self.human_motion.move(target,self.dt,
            max_speed=1.2+2.3*swing_power if self.swing_remaining else 3.5,
            acceleration=12+28*swing_power if self.swing_remaining else 30)

    def opponent(self, style="blocker"):
        p, t, vin = intercept(self.ball, self.velocity, 1.48)
        if self.velocity[0] <= 0 or self.rules.receiver != "human":
            self.human_control(0, 1.1)
            return
        target_y = {"blocker":0, "wide":0.4*np.sin(self.rules.hits*1.7), "attacker":-0.25, "lobber":0.2, "novice":0.06*np.sin(self.clock*12)}[style]
        duration = 0.75 if style == "lobber" else 0.55
        outgoing = (np.array([-0.6,target_y,0.78])-p)/duration
        outgoing[2] += 4.905*duration
        n = vin-outgoing
        n /= max(np.linalg.norm(n),1e-6)
        pitch = -np.arcsin(np.clip(n[2],-0.56,0.56))
        yaw = np.arctan2(n[1],n[0])
        speed = np.clip((outgoing@n+0.7*(vin@n))/1.7, -2, 0)
        self.human_control(p[1],p[2],False,pitch,yaw,x=np.clip(1.48+speed*(0.06-t),1.34,1.75))

    def advance(self):
        if self.rules.winner:
            return
        for _ in range(round(self.dt/self.model.opt.timestep)):
            mujoco.mj_step(self.model,self.data)
            self.clock += self.model.opt.timestep
            touches = set()
            for c in self.data.contact:
                pair = {int(c.geom1),int(c.geom2)}
                if self.ids["ball_geom"] in pair:
                    touches.update(pair-{self.ids["ball_geom"]})
                if self.ids["table"] in pair and pair & self.guard_ids:
                    self.collision_count += 1
                    self.rules.end("human", "Robot touched table")
            # Contact manifolds may flicker across solver frames; debounce by
            # surface and time, but allow a genuine later second hit/bounce.
            for gid in touches-self.contacts:
                if self.clock-self.contact_times.get(gid,-1) < 0.06:
                    continue
                self.contact_times[gid] = self.clock
                if gid == self.ids["paddle"]:
                    self.rules.paddle("robot")
                elif gid == self.ids["human_rubber"]:
                    self.rules.paddle("human")
                elif gid == self.ids["table"]:
                    before = self.rules.bounces
                    self.rules.table("robot" if self.ball[0]<0 else "human")
                    if not self.rules.winner and self.rules.last_hitter == "robot" and before == 0 and self.rules.bounces == 1:
                        self.robot_returns += 1
                elif gid == self.ids["net"]:
                    self.rules.end(self.rules.receiver,"Net")
                elif gid == self.ids["floor"]:
                    self.rules.out("Floor")
            self.contacts = touches
            if abs(self.ball[0])>2.1 or abs(self.ball[1])>1.1 or self.ball[2]<0.4:
                self.rules.out("Missed the ball" if self.rules.bounces else "Out")
            if self.clock > 25:
                self.rules.out("Point time limit")
            if self.rules.winner:
                break
        if not np.isfinite(self.data.qpos).all() or not np.isfinite(self.data.qvel).all():
            raise FloatingPointError("Unstable rally physics")
        self.trajectory.append(self.data.qpos.copy())

    def observation(self):
        extra = np.r_[self.data.qpos[self.cq:self.cq+7],self.data.qvel[self.cv:self.cv+6]] if self.mobile else np.array([])
        predicted, t, _ = intercept(self.ball,self.velocity,-1.3)
        return np.r_[extra,self.data.qpos[self.qids],self.data.qvel[self.vids],
            self.data.qpos[self.lq],self.data.qvel[self.lv],self.data.qpos[self.baseq],self.data.qvel[self.basev],
            self.ball,self.data.qvel[self.bv:self.bv+6],self.data.site_xpos[self.sid],
            self.data.site_xmat[self.sid].reshape(3,3)[:,2],predicted,t,
            float(self.rules.last_hitter=="robot"),self.rules.bounces,self.rules.hits/20,
            self.last_action].astype(np.float32)
