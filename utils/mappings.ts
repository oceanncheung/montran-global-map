import * as d3 from 'd3';
import { MAP_DOTS } from '../constants';
import { pixelToGeo } from './geo';

export type CountryDotMap = Record<string, number[]>;

// ------------------------------------------------------------------
// MANUAL MAPPINGS
// Left empty to force the high-precision runtime calculation.
// This ensures that we use exact Point-in-Polygon matching (D3) 
// rather than approximate bounding boxes or stale static data.
// ------------------------------------------------------------------
export const MANUAL_MAPPINGS: CountryDotMap = {};

// ------------------------------------------------------------------
// RUNTIME GENERATION
// ------------------------------------------------------------------

// Pre-calculate dot coordinates in Lat/Lng to optimize the loop
// This runs once when the module loads, saving processing time during the map loop.
const DOT_COORDS = MAP_DOTS.map(dot => {
  const geo = pixelToGeo(dot.x, dot.y);
  let lng = geo.lng;
  // Normalize longitude to -180 to 180 to match GeoJSON standards
  while (lng > 180) lng -= 360;
  while (lng < -180) lng += 360;
  return { lng, lat: geo.lat };
});

/**
 * computeMappings
 * 
 * Asynchronously calculates the mapping of dots to countries using GeoJSON data.
 * Merges the result with MANUAL_MAPPINGS (which take precedence).
 * 
 * @param geoData The GeoJSON FeatureCollection
 * @returns A promise resolving to the complete Record<string, number[]>
 */
export const computeMappings = async (geoData: any): Promise<CountryDotMap> => {
  if (!geoData) return MANUAL_MAPPINGS;

  return new Promise((resolve) => {
    // Use setTimeout to allow the UI to render/unblock before heavy calculation
    setTimeout(() => {
      console.time("MappingCalculation");
      
      // Start with a fresh object containing manual overrides
      const finalMapping: CountryDotMap = { ...MANUAL_MAPPINGS };

      let calculatedCount = 0;

      geoData.features.forEach((feature: any) => {
        const name = feature.properties.ADMIN || feature.properties.name || feature.properties.NAME;
        
        // Skip if invalid name or if we already have a manual override for this country
        if (!name || finalMapping[name]) return;

        const indices: number[] = [];
        
        // 1. Broad Phase: GeoJSON Bounding Box Check
        // d3.geoBounds returns [[west, south], [east, north]]
        const bounds = d3.geoBounds(feature);
        const [minLng, minLat] = bounds[0];
        const [maxLng, maxLat] = bounds[1];
        
        // Iterate through all pre-calculated dot coordinates
        DOT_COORDS.forEach((coord, idx) => {
          // Check if dot is within the bounding box of the country (Fast)
          if (coord.lng >= minLng && coord.lng <= maxLng &&
              coord.lat >= minLat && coord.lat <= maxLat) {
            
            // 2. Precise Phase: Point-in-Polygon Check (Slower, but exact)
            // d3.geoContains returns true if the point is strictly inside the feature polygon
            if (d3.geoContains(feature, [coord.lng, coord.lat])) {
              indices.push(idx);
            }
          }
        });
        
        if (indices.length > 0) {
          finalMapping[name] = indices;
          calculatedCount++;
        }
      });

      console.timeEnd("MappingCalculation");
      console.log(`Generated precise mappings for ${calculatedCount} countries.`);
      
      resolve(finalMapping);
    }, 50); // Small delay to yield to main thread
  });
};
