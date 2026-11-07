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
// onClear(point) fires when the engine clears its stand, with the screen point of
// the launch pad; the returned promise settles when the flight is over.
export const launchEngine = (onClear) =>
  current ? current.launch(onClear) : Promise.resolve();
// Resolves with the launch-pad point as soon as the engine clears its stand
// (or with null at once when there is no engine on screen).
export const engineCleared = () =>
  new Promise((resolve) => {
    launchEngine(resolve).then(() => resolve(null));
  });
export const resetEngine = () => current?.reset();
// A ready-made image of the stand without its engine, for the tear's copy of the page.
export const standImage = () => current?.standUrl?.() || null;
