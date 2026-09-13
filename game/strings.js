// Every player-visible string. Swap this module to translate the game.
export const STR = {
  app: { title: 'BracketBot Robotics', loading: 'Loading BracketBot…' },
  hub: {
    title: 'BracketBot Robotics',
    subtitle: 'Three small missions. One real robot. Nothing is faked.',
    levels: {
      pid: { name: 'Hold the Line', blurb: 'Tune the robot so it stays put when pushed.' },
      rl: { name: 'Teach the Rally', blurb: 'Train the robot to return a ping-pong serve.' },
      vision: { name: 'Robot Eyes', blurb: 'Teach the robot to tell colours apart.' },
    },
    progress: 'Step {n} of 5',
    badge: 'Badge earned',
    play: 'Play',
    resume: 'Continue',
    realRobot: 'Real robot',
    reset: 'Reset progress',
    resetConfirm: 'Tap again to erase everything',
  },
  common: { next: 'Next', back: 'Back', run: 'Run', retry: 'Try again', hub: 'Hub', done: 'Done', correct: 'Correct!', wrong: 'Not quite — try again.' },
}
