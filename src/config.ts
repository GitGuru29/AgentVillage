/** Shared client constants. */

export const WS_URL =
  (import.meta.env.VITE_VILLAGE_WS as string | undefined) ??
  `ws://${window.location.hostname}:8787`;

/** True isometric-ish angle: 45° yaw, ~35.26° pitch (CoC-style). */
export const CAMERA_YAW = Math.PI / 4;
export const CAMERA_PITCH = (35.264 * Math.PI) / 180;

/** World bounds for camera panning (tiles). */
export const WORLD_HALF_SIZE = 48;

export const ZOOM_MIN = 0.35;
export const ZOOM_MAX = 6;
