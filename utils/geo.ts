
const MAP_WIDTH = 2600;
const MAP_HEIGHT = 1450;

/**
 * Custom Linear Projection
 * 
 * The visual dotted map is not a standard isotropic Equirectangular projection.
 * It is vertically stretched (anisotropic) to fill the canvas aspect ratio better.
 * 
 * Calibration based on visual landmarks:
 * - Latitude Range: ~90°N to ~55°S (Antarctica cut off)
 * - Longitude Range: -180° to 180°
 * - Equator (Lat 0): Visually located at Y ≈ 930px
 * - Greenwich (Lng 0): Visually located at X ≈ 1310px
 * - South Tip of SA (Lat -55): Visually located at Y ≈ 1430px
 */

const X_SCALE = 7.26;  // Pixels per degree longitude
const Y_SCALE = 9.10;  // Pixels per degree latitude
const X_OFFSET = 1310; // X translation (Longitude 0)
const Y_OFFSET = 930;  // Y translation (Latitude 0 / Equator)

export const geoToPixel = (lat: number, lng: number): { x: number; y: number } => {
  return {
    x: (lng * X_SCALE) + X_OFFSET,
    y: -(lat * Y_SCALE) + Y_OFFSET
  };
};

export const pixelToGeo = (x: number, y: number): { lat: number; lng: number } => {
  return {
    lng: (x - X_OFFSET) / X_SCALE,
    lat: -(y - Y_OFFSET) / Y_SCALE
  };
};
