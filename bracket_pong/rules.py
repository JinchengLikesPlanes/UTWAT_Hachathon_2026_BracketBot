"""Contact-event rules and match scoring, independent of the renderer."""
from dataclasses import dataclass


@dataclass
class PointRules:
    last_hitter: str = "human"
    bounces: int = 0
    serving: bool = False
    serve_own_bounce: bool = False
    hits: int = 0
    winner: str | None = None
    reason: str = ""

    @property
    def receiver(self):
        return "robot" if self.last_hitter == "human" else "human"

    def end(self, winner, reason):
        if self.winner is None:
            self.winner, self.reason = winner, reason

    def paddle(self, side):
        if self.winner:
            return
        if side == self.last_hitter:
            self.end(self.receiver, "Double hit")
        elif self.bounces != 1:
            self.end(self.last_hitter, "Volley before bounce")
        else:
            self.last_hitter, self.bounces = side, 0
            self.serving = False
            self.hits += 1

    def table(self, side):
        if self.winner:
            return
        if self.serving and not self.serve_own_bounce:
            if side != self.last_hitter:
                self.end(self.receiver, "Serve missed own half")
            else:
                self.serve_own_bounce = True
            return
        if side == self.last_hitter:
            self.end(self.receiver, "Return landed on own half")
        else:
            self.bounces += 1
            if self.bounces >= 2:
                self.end(self.last_hitter, "Double bounce")

    def out(self, reason="Out"):
        self.end(self.last_hitter if self.bounces else self.receiver, reason)


@dataclass
class MatchScore:
    human: int = 0
    robot: int = 0
    first_server: str = "human"

    @property
    def server(self):
        total = self.human + self.robot
        changes = total//2 if total < 20 else 10 + (total-20)
        return self.first_server if changes % 2 == 0 else ("robot" if self.first_server == "human" else "human")

    @property
    def winner(self):
        if max(self.human, self.robot) >= 11 and abs(self.human-self.robot) >= 2:
            return "human" if self.human > self.robot else "robot"
        return None

    def point(self, winner):
        if winner not in ("human", "robot"):
            raise ValueError("Unknown winner")
        if not self.winner:
            setattr(self, winner, getattr(self, winner)+1)
