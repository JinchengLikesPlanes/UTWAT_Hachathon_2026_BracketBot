import pytest
from bracket_pong.rules import PointRules,MatchScore


def test_continuous_exchange_and_double_bounce():
    r=PointRules(last_hitter="human",bounces=1)
    r.paddle("robot");r.table("human");r.paddle("human");r.table("robot")
    assert r.winner is None and r.hits==2
    r.table("robot")
    assert r.winner=="human" and r.reason=="Double bounce"


@pytest.mark.parametrize("event,winner",[("volley","human"),("own","human"),("double","robot"),("out","robot")])
def test_faults(event,winner):
    r=PointRules(last_hitter="human")
    if event=="volley":r.paddle("robot")
    if event=="own":r.last_hitter="robot";r.table("robot")
    if event=="double":r.paddle("human")
    if event=="out":r.out()
    assert r.winner==winner
    before=r.winner;r.end("human" if before=="robot" else "robot","late")
    assert r.winner==before


def test_serve_requires_both_halves():
    r=PointRules(serving=True)
    r.table("human");r.table("robot");r.paddle("robot")
    assert r.winner is None and r.hits==1 and not r.serving
    bad=PointRules(serving=True);bad.table("robot")
    assert bad.winner=="robot"


def test_match_service_and_deuce():
    score=MatchScore()
    assert score.server=="human"
    score.point("human");score.point("robot")
    assert score.server=="robot"
    score.human=score.robot=10
    assert score.server=="human" and score.winner is None
    score.point("human")
    assert score.server=="robot" and score.winner is None
    score.point("human")
    assert score.winner=="human"
    score.point("robot")
    assert score.robot==10
