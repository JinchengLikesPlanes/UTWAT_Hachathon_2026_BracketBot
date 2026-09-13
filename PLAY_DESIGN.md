# Interactive challenge design

Native MuJoCo window: authoritative simulation on the left, a 328 px control
bench on the right. The score is the first panel item, then the aiming plane,
speed, lift and launch control. Large title and score use MuJoCo's built-in
sans bitmap font; body text uses its normal font. No web or font downloads.

Palette: court blue #2B475E, panel #1F3045, chalk #E0EFF7, ball orange #F79C38,
grid #54738C. Orange identifies the shot marker and slider selection, matching
the physical ball. Grid lines encode target height and lateral offset.

The subject-specific centerpiece is the target pad paired with a marker in the
robot's hitting plane. This is a shot launcher challenge, not a fake opponent
paddle. A fixed-width panel keeps aiming coordinates stable when resizing;
the scene gets the additional space. Minimum window 1000×780.

Mouse drag for aiming, speed and carriage height. Keyboard equivalents: arrows,
+/-, U/J, L for lift mode, Space to launch, P to pause and R to reset score.
Disable shot editing while a ball is in flight. Exactly one score update per
completed shot; rapid repeated launch input cannot create multiple shots.
Automatic lift must be labeled unavailable for arm-only checkpoints.
