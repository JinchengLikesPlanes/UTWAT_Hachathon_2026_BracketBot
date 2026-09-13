// Every player-visible string. Swap this module to translate the game.
export const STR = {
  app: { title: 'BracketBot Robotics', loading: 'Loading BracketBot…' },
  common: {
    next: 'Next', back: 'Back', run: 'Run', retry: 'Try again', hub: 'Hub', done: 'Done', close: 'Close',
    correct: 'Correct!', wrong: 'Not quite — try again.', step: 'Step {n} of 5', concept: 'Concept check',
    badgeTitle: 'Badge earned!', realRobot: 'Try it on the real BracketBot', backToHub: 'Back to hub',
    move: 'Move',
  },
  hub: {
    title: 'BracketBot Robotics',
    subtitle: 'Three small missions with one real robot. Nothing here is faked: the robot really tunes, really learns, and sometimes really fails.',
    levels: {
      pid: { name: 'Hold the Line', blurb: 'Someone keeps pushing the robot. Tune P, I and D so it holds its spot.', icon: '🎯' },
      rl: { name: 'Teach the Rally', blurb: 'Choose senses, controls and a reward, then train the robot to return a serve.', icon: '🏓' },
      vision: { name: 'Robot Eyes', blurb: 'Label photos, train a tiny brain, and test it on pictures it never saw.', icon: '👁️' },
    },
    progress: 'Step {n} of 5',
    badge: 'Badge earned',
    play: 'Play',
    resume: 'Continue',
    realRobot: 'Real robot',
    reset: 'Reset progress',
    resetConfirm: 'Tap again to erase everything',
    resetDone: 'Progress erased',
  },
  real: {
    pid: {
      title: 'Hold the Line — on the real BracketBot',
      lines: [
        'Mark a target line on a clear, level floor and put BracketBot on it.',
        'The robot needs measured forward position and wheel speed control — the same loop you tuned here.',
        'Use a repeatable, low-force disturbance (a rolling ball or a weight on a string), not your hands.',
        'Start with the wheels raised or on a test stand, check the command sign, then lower it and re-tune the gains.',
      ],
      warn: 'Always have a supervised stop button and the manufacturer\'s speed and current limits enabled.',
    },
    rl: {
      title: 'Teach the Rally — on the real BracketBot',
      lines: [
        'Fix the robot base, fence the paddle workspace, and use a repeatable ball launcher.',
        'Every sense you picked here maps to a real sensor: ball tracking camera, a contact sensor on the paddle, a landing detector on the table.',
        'Check joint directions, limits, speeds and the emergency stop before any learned policy moves the arm.',
        'A policy trained in simulation is a starting point, not a hardware-ready controller.',
      ],
      warn: 'Never stand inside the paddle workspace while a learned policy is enabled.',
    },
    vision: {
      title: 'Robot Eyes — on the real BracketBot',
      lines: [
        'Place one red, blue or yellow card in front of the head camera, centred in the frame.',
        'Collect examples under at least two kinds of lighting, and keep a separate test set the robot never trains on.',
        'Crop the same centre region you used here before measuring the colour.',
        'This activity ends at "the robot says a colour". Connecting that to motors is a separate, reviewed step.',
      ],
      warn: 'Keep fingers and cables away from the mast carriage while the head moves.',
    },
  },
}
