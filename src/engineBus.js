// Lets the app start the hero rocket's liftoff and wait for it. The engine scene
// registers itself when it is on screen; without it (phones, reduced data) the
// launch resolves at once.
let current = null;

export function registerEngine(controls) {
  current = controls;
  return () => {
    if (current === controls) current = null;
  };
}
export const launchEngine = () =>
  current ? current.launch() : Promise.resolve();
export const resetEngine = () => current?.reset();
