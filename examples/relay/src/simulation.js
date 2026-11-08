/** Deterministic kinematic traffic, in metres. This is not a physics/dynamics engine. */
export const ROBOT_COUNT = 2000;
export const ROUTES = 20;
export const ROBOTS_PER_ROUTE = ROBOT_COUNT / ROUTES;
export const STRAIGHT = 76;
export const TURN_RADIUS = 1.1;
export const ROUTE_LENGTH = 2 * STRAIGHT + 2 * Math.PI * TURN_RADIUS;
const mod = (a, b) => ((a % b) + b) % b;
export function robotPose(index, time) {
  if (!Number.isInteger(index) || index < 0 || index >= ROBOT_COUNT || !Number.isFinite(time) || time < 0) throw Error('Invalid robot or simulation time');
  const route = Math.floor(index / ROBOTS_PER_ROUTE);
  const speed = 1.6 + (route % 4) * .06;
  const offset = (index % ROBOTS_PER_ROUTE) * ROUTE_LENGTH / ROBOTS_PER_ROUTE;
  let distance = mod(offset + time * speed, ROUTE_LENGTH);
  let x, z, heading;
  if (distance < STRAIGHT) { x = -STRAIGHT / 2 + distance; z = -TURN_RADIUS; heading = Math.PI / 2; }
  else if ((distance -= STRAIGHT) < Math.PI * TURN_RADIUS) {
    const angle = -Math.PI / 2 + distance / TURN_RADIUS;
    x = STRAIGHT / 2 + TURN_RADIUS * Math.cos(angle); z = TURN_RADIUS * Math.sin(angle); heading = -angle;
  } else if ((distance -= Math.PI * TURN_RADIUS) < STRAIGHT) { x = STRAIGHT / 2 - distance; z = TURN_RADIUS; heading = -Math.PI / 2; }
  else {
    distance -= STRAIGHT;
    const angle = Math.PI / 2 + distance / TURN_RADIUS;
    x = -STRAIGHT / 2 + TURN_RADIUS * Math.cos(angle); z = TURN_RADIUS * Math.sin(angle); heading = -angle;
  }
  z += (route - (ROUTES - 1) / 2) * 3.3;
  return { x, z, heading, route: route + 1, speed, laps: Math.floor((offset + time * speed) / ROUTE_LENGTH),
    assignment: route % 2 ? 'Outbound / packing' : 'Inbound / sorting', battery: 57 + (index * 17 % 43) };
}
export function indexFromId(value) {
  const match = /^robot-(\d+)$/.exec(String(value));
  const index = match ? Number(match[1]) : -1;
  return index >= 0 && index < ROBOT_COUNT ? index : null;
}
