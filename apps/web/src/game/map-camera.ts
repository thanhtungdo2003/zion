export interface MapCamera { x: number; z: number; scale: number }
/** Up-pointing map arrows: world yaw turns toward -X, while screen angles turn toward +X. */
export function mapHeading(yaw: number): number { return -yaw; }
export function screenToMap(x: number, y: number, width: number, height: number, camera: MapCamera): { x: number; z: number } {
  return { x: camera.x + (x - width / 2) / camera.scale, z: camera.z + (y - height / 2) / camera.scale };
}
export function mapToScreen(x: number, z: number, width: number, height: number, camera: MapCamera): { x: number; y: number } {
  return { x: width / 2 + (x - camera.x) * camera.scale, y: height / 2 + (z - camera.z) * camera.scale };
}
export function zoomMap(camera: MapCamera, factor: number, x: number, y: number, width: number, height: number): MapCamera {
  const world = screenToMap(x, y, width, height, camera);
  const scale = Math.max(0.025, Math.min(8, camera.scale * factor));
  return { x: world.x - (x - width / 2) / scale, z: world.z - (y - height / 2) / scale, scale };
}
