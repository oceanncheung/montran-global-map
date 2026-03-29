import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as d3 from 'd3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const GEOJSON_PATH = path.join(projectRoot, 'data', 'countries.geojson');
const GEOJSON_URL = 'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson';
const GEO_CONSTANTS_PATH = path.join(projectRoot, 'utils', 'geo.ts');
const MAP_DOTS_PATH = path.join(projectRoot, 'constants.tsx');
const OUTPUT_PATH = path.join(projectRoot, 'utils', 'countryData.ts');

const DEFAULT_GEO_CONSTANTS = {
  X_SCALE: 7.26,
  Y_SCALE: 9.1,
  X_OFFSET: 1310,
  Y_OFFSET: 930,
};

const REPRESENTATIVE_DOT_DISTANCE_LIMIT = 120;
const SHAPE_SAMPLE_DISTANCE_LIMIT = 180;
const REPRESENTATIVE_DOT_EXCLUSIONS = new Set([
  'Antarctica',
]);
const REPRESENTATIVE_DOT_OVERRIDES = {
};
const VISUAL_REGION_RULES = [
  {
    name: 'British Isles',
    countries: {
      // The British Isles are highly compressed in the artwork, so the UK
      // needs a few shared dots to feel like Great Britain instead of a thin spine.
      'United Kingdom': {
        add: [1073, 1151, 1247],
      },
    },
  },
  {
    name: 'Korean Peninsula',
    countries: {
      // On this dotted artwork, the peninsula reads as a connected mainland
      // chain. Using a connected shared chain feels more correct than letting
      // South Korea jump over to the nearby Japan cluster.
      'North Korea': {
        replace: [1411, 1428, 1486, 1528],
      },
      'South Korea': {
        replace: [1486, 1528, 1596, 1658],
      },
    },
  },
  {
    name: 'Balkans',
    countries: {
      // This region is so compressed that the artwork reads as one connected
      // Adriatic-to-Aegean cluster. Shared chains preserve the mental map
      // better than isolated one-dot countries.
      Slovenia: {
        replace: [1356],
      },
      Croatia: {
        replace: [1356, 1380, 1422],
      },
      'Bosnia and Herzegovina': {
        replace: [1422, 1450],
      },
      Montenegro: {
        replace: [1450],
      },
      'Republic of Serbia': {
        replace: [1381, 1444],
      },
      Kosovo: {
        replace: [1444],
      },
      Albania: {
        replace: [1450, 1521],
      },
      'North Macedonia': {
        replace: [1444, 1515],
      },
      Bulgaria: {
        replace: [1383, 1478],
      },
    },
  },
];

const DOT_SAMPLE_OFFSETS = [
  [0, 0],
  [5, 0],
  [-5, 0],
  [0, 5],
  [0, -5],
  [3.5, 3.5],
  [3.5, -3.5],
  [-3.5, 3.5],
  [-3.5, -3.5],
];

const getCountryName = (feature) =>
  feature?.properties?.ADMIN ||
  feature?.properties?.name ||
  feature?.properties?.NAME ||
  null;

const isLongitudeInBounds = (lng, minLng, maxLng) => {
  if (minLng <= maxLng) {
    return lng >= minLng && lng <= maxLng;
  }

  return lng >= minLng || lng <= maxLng;
};

const parseGeoConstants = async () => {
  const content = await fs.readFile(GEO_CONSTANTS_PATH, 'utf8');
  const constants = { ...DEFAULT_GEO_CONSTANTS };

  for (const key of Object.keys(constants)) {
    const match = content.match(new RegExp(`const\\s+${key}\\s*=\\s*([\\d.]+);`));
    if (match) {
      constants[key] = Number.parseFloat(match[1]);
    }
  }

  return constants;
};

const parseMapDots = async () => {
  const content = await fs.readFile(MAP_DOTS_PATH, 'utf8');
  const match =
    content.match(/export const MAP_DOTS: MapPoint\[\]\s*=\s*\[(.*?)\];/s) ||
    content.match(/export const MAP_DOTS\s*=\s*\[(.*?)\];/s);

  if (!match) {
    throw new Error('Could not find MAP_DOTS array in constants.tsx');
  }

  const dotPattern = /\{\s*x\s*:\s*([\d.-]+)\s*,\s*y\s*:\s*([\d.-]+)\s*\}/g;
  const dots = [];
  let dotMatch;

  while ((dotMatch = dotPattern.exec(match[1])) !== null) {
    dots.push({
      index: dots.length,
      x: Number.parseFloat(dotMatch[1]),
      y: Number.parseFloat(dotMatch[2]),
    });
  }

  return dots;
};

const loadGeoJson = async () => {
  try {
    const content = await fs.readFile(GEOJSON_PATH, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  console.log(`Downloading GeoJSON from ${GEOJSON_URL}...`);
  const response = await fetch(GEOJSON_URL);
  if (!response.ok) {
    throw new Error(`Failed to download GeoJSON: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  await fs.mkdir(path.dirname(GEOJSON_PATH), { recursive: true });
  await fs.writeFile(GEOJSON_PATH, text, 'utf8');
  return JSON.parse(text);
};

const pixelToGeo = (x, y, constants) => {
  const lng = (x - constants.X_OFFSET) / constants.X_SCALE;
  const lat = -(y - constants.Y_OFFSET) / constants.Y_SCALE;
  return { lat, lng };
};

const geoToPixel = (lng, lat, constants) => ({
  x: lng * constants.X_SCALE + constants.X_OFFSET,
  y: -lat * constants.Y_SCALE + constants.Y_OFFSET,
});

const normalizeLng = (lng) => {
  let normalized = lng;

  while (normalized > 180) normalized -= 360;
  while (normalized < -180) normalized += 360;

  return normalized;
};

const getBoundsCenter = (feature) => {
  const [[minLng, minLat], [maxLng, maxLat]] = d3.geoBounds(feature);
  const centerLng = minLng <= maxLng
    ? (minLng + maxLng) / 2
    : normalizeLng((minLng + (maxLng + 360)) / 2);

  return [centerLng, (minLat + maxLat) / 2];
};

const getLargestPartFeature = (feature) => {
  if (!feature?.geometry) return feature;

  if (feature.geometry.type === 'Polygon') {
    return feature;
  }

  if (feature.geometry.type !== 'MultiPolygon') {
    return feature;
  }

  let bestCoordinates = null;
  let bestArea = -1;

  for (const coordinates of feature.geometry.coordinates) {
    const polygonFeature = {
      type: 'Feature',
      properties: feature.properties,
      geometry: {
        type: 'Polygon',
        coordinates,
      },
    };
    const area = d3.geoArea(polygonFeature);
    if (area > bestArea) {
      bestArea = area;
      bestCoordinates = coordinates;
    }
  }

  if (!bestCoordinates) {
    return feature;
  }

  return {
    type: 'Feature',
    properties: feature.properties,
    geometry: {
      type: 'Polygon',
      coordinates: bestCoordinates,
    },
  };
};

const getRepresentativePoints = (feature, constants) => {
  const points = [
    d3.geoCentroid(feature),
    d3.geoCentroid(getLargestPartFeature(feature)),
    getBoundsCenter(feature),
  ];

  const unique = [];
  const seen = new Set();

  for (const [lng, lat] of points) {
    const key = `${lng.toFixed(6)}:${lat.toFixed(6)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({
      lng: normalizeLng(lng),
      lat,
      pixel: geoToPixel(normalizeLng(lng), lat, constants),
    });
  }

  return unique;
};

const getFeatureShapePoints = (feature, constants) => {
  if (!feature?.geometry) return [];

  const rings = [];
  if (feature.geometry.type === 'Polygon') {
    rings.push(feature.geometry.coordinates[0] ?? []);
  } else if (feature.geometry.type === 'MultiPolygon') {
    for (const polygon of feature.geometry.coordinates) {
      rings.push(polygon[0] ?? []);
    }
  }

  const points = [];
  const seen = new Set();

  for (const ring of rings) {
    if (!ring.length) continue;

    const stride = Math.max(1, Math.floor(ring.length / 10));
    for (let index = 0; index < ring.length; index += stride) {
      const [lng, lat] = ring[index];
      const normalizedLng = normalizeLng(lng);
      const key = `${normalizedLng.toFixed(6)}:${lat.toFixed(6)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      points.push({
        lng: normalizedLng,
        lat,
        pixel: geoToPixel(normalizedLng, lat, constants),
      });
    }
  }

  return points;
};

const generateCountryData = async () => {
  const [constants, dots, geoData] = await Promise.all([
    parseGeoConstants(),
    parseMapDots(),
    loadGeoJson(),
  ]);

  const featureMeta = geoData.features
    .map((feature) => {
      const name = getCountryName(feature);
      if (!name) return null;

      return {
        name,
        feature,
        bounds: d3.geoBounds(feature),
      };
    })
    .filter(Boolean);

  const dotCoords = dots.map((dot) => {
    const geo = pixelToGeo(dot.x, dot.y, constants);
    const samples = DOT_SAMPLE_OFFSETS.map(([dx, dy]) => {
      const sampleGeo = pixelToGeo(dot.x + dx, dot.y + dy, constants);
      return { lat: sampleGeo.lat, lng: normalizeLng(sampleGeo.lng) };
    });

    return {
      ...dot,
      lat: geo.lat,
      lng: normalizeLng(geo.lng),
      samples,
    };
  });

  const countryNames = Array.from(
    new Set(geoData.features.map((feature) => getCountryName(feature)).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b));

  const seedLabels = new Array(dotCoords.length).fill(null);
  const unlabeledDots = [];

  for (const dot of dotCoords) {
    const scores = new Map();

    for (const sample of dot.samples) {
      for (const { name, feature, bounds } of featureMeta) {
        const [[minLng, minLat], [maxLng, maxLat]] = bounds;

        if (
          isLongitudeInBounds(sample.lng, minLng, maxLng) &&
          sample.lat >= minLat &&
          sample.lat <= maxLat &&
          d3.geoContains(feature, [sample.lng, sample.lat])
        ) {
          scores.set(name, (scores.get(name) ?? 0) + 1);
        }
      }
    }

    if (scores.size === 0) {
      unlabeledDots.push(dot.index);
      continue;
    }

    let bestCountry = null;
    let bestScore = -1;

    for (const [countryName, score] of scores.entries()) {
      if (score > bestScore) {
        bestCountry = countryName;
        bestScore = score;
      }
    }

    seedLabels[dot.index] = bestCountry;
  }

  const delaunay = d3.Delaunay.from(dotCoords, (dot) => dot.x, (dot) => dot.y);
  const neighbors = dotCoords.map((_, index) => (
    Array.from(delaunay.neighbors(index)).filter((neighborIndex) => {
      const dx = dotCoords[index].x - dotCoords[neighborIndex].x;
      const dy = dotCoords[index].y - dotCoords[neighborIndex].y;
      return Math.hypot(dx, dy) <= 34;
    })
  ));

  const finalLabels = [...seedLabels];
  const queue = [];

  for (let index = 0; index < finalLabels.length; index += 1) {
    if (finalLabels[index]) {
      queue.push(index);
    }
  }

  for (let head = 0; head < queue.length; head += 1) {
    const index = queue[head];
    const label = finalLabels[index];

    for (const neighborIndex of neighbors[index]) {
      if (finalLabels[neighborIndex]) continue;
      finalLabels[neighborIndex] = label;
      queue.push(neighborIndex);
    }
  }

  const components = [];
  const seen = new Array(dotCoords.length).fill(false);

  for (let index = 0; index < dotCoords.length; index += 1) {
    if (seen[index]) continue;

    const component = [];
    const componentQueue = [index];
    seen[index] = true;

    for (let head = 0; head < componentQueue.length; head += 1) {
      const currentIndex = componentQueue[head];
      component.push(currentIndex);

      for (const neighborIndex of neighbors[currentIndex]) {
        if (seen[neighborIndex]) continue;
        seen[neighborIndex] = true;
        componentQueue.push(neighborIndex);
      }
    }

    components.push(component);
  }

  for (const component of components) {
    if (component.length < 40) continue;

    for (let pass = 0; pass < 4; pass += 1) {
      const labelCounts = component.reduce((acc, index) => {
        const label = finalLabels[index];
        if (!label) return acc;
        acc[label] = (acc[label] ?? 0) + 1;
        return acc;
      }, {});

      const entries = Object.entries(labelCounts).sort((a, b) => b[1] - a[1]);
      if (entries.length < 2 || entries.length > 4) break;

      const [dominantLabel, dominantCount] = entries[0];
      const dominantRatio = dominantCount / component.length;
      if (dominantRatio < 0.8) break;

      let changed = false;

      for (const index of component) {
        const currentLabel = finalLabels[index];
        if (!currentLabel || currentLabel === dominantLabel) continue;

        const currentComponentCount = labelCounts[currentLabel] ?? 0;
        if (currentComponentCount > component.length * 0.2) continue;

        const neighborCounts = {};
        for (const neighborIndex of neighbors[index]) {
          const neighborLabel = finalLabels[neighborIndex];
          if (!neighborLabel) continue;
          neighborCounts[neighborLabel] = (neighborCounts[neighborLabel] ?? 0) + 1;
        }

        const dominantNeighbors = neighborCounts[dominantLabel] ?? 0;
        const currentNeighbors = neighborCounts[currentLabel] ?? 0;

        if (
          dominantNeighbors > currentNeighbors ||
          (dominantNeighbors === currentNeighbors && dominantNeighbors >= 2)
        ) {
          finalLabels[index] = dominantLabel;
          changed = true;
        }
      }

      if (!changed) {
        break;
      }
    }
  }

  const mapping = {};
  for (let index = 0; index < finalLabels.length; index += 1) {
    const label = finalLabels[index];
    if (!label) continue;

    if (!mapping[label]) {
      mapping[label] = [];
    }
    mapping[label].push(index);
  }

  const representativeDotAssignments = {};

  for (const { name, feature } of featureMeta) {
    if (mapping[name]) continue;

    const overrideDots = REPRESENTATIVE_DOT_OVERRIDES[name];
    if (overrideDots?.length) {
      mapping[name] = [...overrideDots];
      representativeDotAssignments[name] = {
        mode: 'override',
        dots: [...overrideDots],
      };
      continue;
    }

    if (REPRESENTATIVE_DOT_EXCLUSIONS.has(name)) continue;

    const representativePoints = getRepresentativePoints(feature, constants);
    const shapePoints = getFeatureShapePoints(feature, constants);
    let best = null;

    for (const dot of dotCoords) {
      let bestPointDistance = Infinity;

      for (const point of representativePoints) {
        const distance = Math.hypot(dot.x - point.pixel.x, dot.y - point.pixel.y);
        if (distance < bestPointDistance) {
          bestPointDistance = distance;
        }
      }

      if (!best || bestPointDistance < best.distance) {
        best = {
          dotIndex: dot.index,
          distance: bestPointDistance,
        };
      }
    }

    if ((!best || best.distance > REPRESENTATIVE_DOT_DISTANCE_LIMIT) && shapePoints.length > 0) {
      for (const dot of dotCoords) {
        let bestShapeDistance = Infinity;

        for (const point of shapePoints) {
          const distance = Math.hypot(dot.x - point.pixel.x, dot.y - point.pixel.y);
          if (distance < bestShapeDistance) {
            bestShapeDistance = distance;
          }
        }

        if (!best || bestShapeDistance < best.distance) {
          best = {
            dotIndex: dot.index,
            distance: bestShapeDistance,
          };
        }
      }
    }

    if (!best) {
      continue;
    }

    mapping[name] = [best.dotIndex];
    representativeDotAssignments[name] = {
      mode: best.distance <= SHAPE_SAMPLE_DISTANCE_LIMIT ? 'nearest-shared-dot' : 'remote-nearest-shared-dot',
      dots: [best.dotIndex],
      distance: Number(best.distance.toFixed(2)),
    };
  }

  for (const region of VISUAL_REGION_RULES) {
    for (const [countryName, rule] of Object.entries(region.countries ?? {})) {
      if (!rule) continue;

      const baseDots = rule.replace?.length ? rule.replace : (mapping[countryName] ?? []);
      const addDots = rule.add ?? [];

      mapping[countryName] = Array.from(new Set([...baseDots, ...addDots])).sort((a, b) => a - b);
    }
  }

  const mappedCountryCount = Object.keys(mapping).length;
  const uniqueMappedDotCount = new Set(Object.values(mapping).flat()).size;
  const seededDotCount = seedLabels.filter(Boolean).length;
  const propagatedDotCount = finalLabels.filter(Boolean).length - seededDotCount;
  const representativeCountryNames = Object.keys(representativeDotAssignments).sort((a, b) => a.localeCompare(b));

  const output = `// This file is generated by scripts/generate_country_data.mjs.\n// Do not edit it by hand; regenerate it with \`npm run generate:mappings\`.\n\nexport type CountryDotMap = Record<string, number[]>;\n\nexport const COUNTRY_NAMES: string[] = ${JSON.stringify(countryNames, null, 2)};\n\nexport const REPRESENTATIVE_DOT_COUNTRIES: string[] = ${JSON.stringify(representativeCountryNames, null, 2)};\n\nexport const MANUAL_MAPPINGS: CountryDotMap = ${JSON.stringify(mapping, null, 2)};\n`;

  await fs.writeFile(OUTPUT_PATH, output, 'utf8');

  console.log(`Parsed ${dots.length} dots.`);
  console.log(`Seeded ${seededDotCount} dots directly from country overlap.`);
  console.log(`Filled ${propagatedDotCount} additional dots via nearest-neighbor propagation.`);
  console.log(`Assigned ${representativeCountryNames.length} shared representative country dots.`);
  console.log(`Mapped ${uniqueMappedDotCount} unique dots across ${mappedCountryCount} countries.`);
  console.log(`Left ${dotCoords.length - finalLabels.filter(Boolean).length} dots unlabeled after seeding.`);
  console.log(`Wrote ${OUTPUT_PATH}.`);
};

generateCountryData().catch((error) => {
  console.error(error);
  process.exit(1);
});
