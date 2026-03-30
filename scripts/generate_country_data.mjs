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
        add: [994, 1005, 1006, 1073, 1151, 1247],
      },
      // Ireland reads better as its own 3-dot island without borrowing the
      // shared UK spine dots.
      Ireland: {
        replace: [1077, 1150, 1186],
      },
    },
  },
  {
    name: 'North Atlantic Seam',
    countries: {
      // One seam dot sits visually against Greenland on this artwork and reads
      // like part of the Arctic arc rather than a separate island cluster.
      Greenland: {
        add: [642],
      },
    },
  },
  {
    name: 'Canadian Arctic Archipelago',
    countries: {
      // On this stylized map, the western seam of Greenland actually reads like
      // Canada's high-arctic island chain. The upper rows read Canadian farther
      // east, while the lower rows only read Canadian on the west side of the
      // archipelago. Split it that way so the seam follows the visible water.
      Canada: {
        add: [
          2, 10, 16, 31, 32, 44, 49, 60, 71, 77, 86, 92,
          110, 111, 112, 130, 137, 164, 175, 224, 236,
          241, 251, 262, 305, 319, 342, 343, 352, 359, 369, 415, 459,
          483, 516, 603, 640,
        ],
      },
      Greenland: {
        remove: [
          2, 10, 16, 31, 32, 44, 49, 60, 71, 77, 86, 92,
          110, 111, 112, 130, 137, 164, 175, 224, 236,
          241, 251, 262, 305, 319, 342, 343, 352, 359, 369, 415, 459,
          483, 516, 603, 640,
        ],
      },
    },
  },
  {
    name: 'European Arctic',
    countries: {
      // The stylized Arctic islands north of Scandinavia and Russia read much
      // more like Norway/Russia than the inland countries they were pulled into
      // by the automatic pass.
      Norway: {
        add: [994, 995, 996, 1005, 1006, 1007, 1008],
      },
      'Faroe Islands': {
        remove: [994],
      },
      Estonia: {
        remove: [995, 996],
      },
      Lithuania: {
        remove: [1007],
      },
      Latvia: {
        remove: [1008],
      },
      Russia: {
        add: [
          1076, 1083, 1100, 1104, 1119, 1126, 1141, 1147, 1153, 1154,
          1161, 1169, 1170, 1172, 1178, 1179, 1191, 1194, 1215, 1216,
          1248, 1255,
        ],
      },
      Belarus: {
        remove: [1104],
      },
      Kazakhstan: {
        remove: [1083, 1100, 1119, 1126, 1141],
      },
      China: {
        remove: [1076],
      },
      Ukraine: {
        remove: [1153, 1154, 1191, 1248, 1255],
      },
    },
  },
  {
    name: 'Nordic Atlantic and Baltics',
    countries: {
      // Keep Norway on the Scandinavia-facing island chain and avoid letting it
      // drift into the far-west North Atlantic dots above the UK.
      Norway: {
        remove: [994, 995, 996, 1005, 1006, 1007, 1008],
      },
      Finland: {
        add: [995, 996, 1007, 1008],
      },
      // Keep the tiny Baltic states on the mainland coastline instead of on
      // Arctic bridge dots created by the ownership completion pass.
      Estonia: {
        replace: [1074],
      },
      Latvia: {
        replace: [1153],
      },
      Lithuania: {
        replace: [1190, 1248],
      },
      // The Faroe Islands are a single shared North Atlantic dot on this art.
      'Faroe Islands': {
        replace: [994],
      },
      Mauritania: {
        remove: [1005, 1006],
      },
    },
  },
  {
    name: 'Caribbean Continent Split',
    countries: {
      // Keep the North America continent selection off the northern South
      // America shoreline by pulling the small Caribbean territories back onto
      // shared Caribbean dots instead of Venezuela-adjacent dots.
      Haiti: {
        replace: [2015],
      },
      'Dominican Republic': {
        replace: [2015],
      },
      'Turks and Caicos Islands': {
        replace: [2015],
      },
      'Puerto Rico': {
        replace: [2015],
      },
      'Trinidad and Tobago': {
        replace: [2015],
      },
      'Saint Martin': {
        replace: [2006],
      },
      'Sint Maarten': {
        replace: [2006],
      },
      'Curaçao': {
        replace: [2006],
      },
      Aruba: {
        replace: [2006],
      },
      Grenada: {
        replace: [2006],
      },
      'Saint Vincent and the Grenadines': {
        replace: [2006],
      },
      Barbados: {
        replace: [2006],
      },
      'Saint Lucia': {
        replace: [2006],
      },
      Dominica: {
        replace: [2006],
      },
      Montserrat: {
        replace: [2006],
      },
      'Antigua and Barbuda': {
        replace: [2006],
      },
      'Saint Kitts and Nevis': {
        replace: [2006],
      },
      'United States Virgin Islands': {
        replace: [2006],
      },
      'Saint Barthelemy': {
        replace: [2006],
      },
      Anguilla: {
        replace: [2006],
      },
      'British Virgin Islands': {
        replace: [2006],
      },
    },
  },
  {
    name: 'South Pacific Representation',
    countries: {
      // These small Pacific countries should read as Oceania on the artwork,
      // not as scattered dots above Australia or on the Americas side.
      Palau: {
        replace: [2453],
      },
      Guam: {
        replace: [2453],
      },
      'Northern Mariana Islands': {
        replace: [2453],
      },
      'Federated States of Micronesia': {
        replace: [2456],
      },
      Kiribati: {
        replace: [2456],
      },
      'Marshall Islands': {
        replace: [2456],
      },
      Nauru: {
        replace: [2456],
      },
      'Solomon Islands': {
        replace: [2549],
      },
      'American Samoa': {
        replace: [2667],
      },
      'Cook Islands': {
        replace: [2667],
      },
      Niue: {
        replace: [2667],
      },
      Samoa: {
        replace: [2667],
      },
      Tonga: {
        replace: [2667],
      },
      'Wallis and Futuna': {
        replace: [2667],
      },
      'French Polynesia': {
        replace: [2683],
      },
      'Pitcairn Islands': {
        replace: [2683],
      },
    },
  },
  {
    name: 'Southeast Asia and Oceania Boundary',
    countries: {
      // On this stylized map, Australia should stay visually pure and the
      // islands north of it should carry the Asia/Oceania mental map. Keep
      // East Timor on the Indonesia chain and move Papua New Guinea onto the
      // far-right island cluster instead of borrowing Australia mainland dots.
      Indonesia: {
        remove: [2234, 2240, 2275, 2285, 2293, 2298],
      },
      'Papua New Guinea': {
        replace: [2234, 2240, 2275, 2285, 2293, 2298],
      },
      'East Timor': {
        replace: [2255],
      },
    },
  },
  {
    name: 'Florida and Bahamas',
    countries: {
      // The stylized Southeast US / Bahamas cluster is too sparse to separate
      // cleanly, so let Miami and the Bahamas share the same seam dot.
      'United States of America': {
        add: [1906],
      },
      'The Bahamas': {
        add: [1906],
      },
    },
  },
  {
    name: 'Korean Peninsula',
    countries: {
      // Keep Korea intentionally tiny on this artwork: use the lower 3-dot
      // peninsula chain just left of Japan so it reads below China instead of
      // floating too high.
      China: {
        remove: [1596, 1653, 1658],
      },
      'North Korea': {
        replace: [1596, 1653],
      },
      'South Korea': {
        replace: [1653, 1658],
      },
    },
  },
  {
    name: 'China East Edge',
    countries: {
      // The far-east coastal tip reads as part of China's stylized outline.
      China: {
        add: [1465],
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
  {
    name: 'Maghreb Atlantic Coast',
    countries: {
      // Western Sahara reads more clearly when it occupies the lower coastal
      // chain instead of sitting inside Morocco's footprint.
      Morocco: {
        replace: [1655, 1710, 1719, 1790, 1828, 1900],
      },
      'Western Sahara': {
        replace: [1849, 1889, 1901],
      },
    },
  },
  {
    name: 'Northern Andes',
    countries: {
      // Brazil's north coast can creep too far toward the Caribbean on this
      // artwork, while Ecuador and Bolivia need more shared Andes dots to feel
      // proportionate.
      Brazil: {
        remove: [2198, 2199],
      },
      Ecuador: {
        replace: [2250, 2280, 2288, 2290],
      },
      Bolivia: {
        replace: [
          2382, 2394, 2426, 2431, 2435, 2465, 2466, 2472, 2483, 2492,
          2495, 2504, 2511, 2525, 2528, 2533, 2544, 2556, 2563,
        ],
      },
    },
  },
  {
    name: 'Guiana Coast',
    countries: {
      // Fill the last north-coast seam dot so continent unions do not leave a
      // grey hole between Venezuela, Guyana, and Brazil.
      Guyana: {
        add: [2198],
      },
    },
  },
  {
    name: 'South Asia Connections',
    countries: {
      // Nepal reads more clearly as a short connected strip instead of two
      // separated diagonal dots.
      Nepal: {
        replace: [1730, 1764, 1765],
      },
      // Northeast India needs one bridge dot so the eastern pair reads as
      // connected to mainland India.
      India: {
        add: [1780],
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

const DOT_COMPLETION_DISTANCE_LIMIT = 90;

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

const sortUniqueDots = (dotIndexes) => Array.from(new Set(dotIndexes)).sort((a, b) => a - b);

const applyVisualRegionRules = (mapping) => {
  for (const region of VISUAL_REGION_RULES) {
    for (const [countryName, rule] of Object.entries(region.countries ?? {})) {
      if (!rule) continue;

      const baseDots = rule.replace?.length ? rule.replace : (mapping[countryName] ?? []);
      const addDots = rule.add ?? [];
      const removeDots = new Set(rule.remove ?? []);

      mapping[countryName] = sortUniqueDots(
        [...baseDots, ...addDots].filter((dotIndex) => !removeDots.has(dotIndex)),
      );
    }
  }
};

const pickRepresentativeDot = ({
  countryName,
  feature,
  dotCoords,
  constants,
}) => {
  const overrideDots = REPRESENTATIVE_DOT_OVERRIDES[countryName];
  if (overrideDots?.length) {
    return {
      mode: 'override',
      dots: [...overrideDots],
    };
  }

  if (REPRESENTATIVE_DOT_EXCLUSIONS.has(countryName)) {
    return null;
  }

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
    return null;
  }

  return {
    mode: best.distance <= SHAPE_SAMPLE_DISTANCE_LIMIT ? 'nearest-shared-dot' : 'remote-nearest-shared-dot',
    dots: [best.dotIndex],
    distance: Number(best.distance.toFixed(2)),
  };
};

const assignRepresentativeDots = ({
  mapping,
  featureMeta,
  dotCoords,
  constants,
  representativeDotAssignments,
}) => {
  for (const { name, feature } of featureMeta) {
    if (mapping[name]?.length) continue;

    const pick = pickRepresentativeDot({
      countryName: name,
      feature,
      dotCoords,
      constants,
    });

    if (!pick?.dots?.length) continue;

    mapping[name] = sortUniqueDots(pick.dots);
    representativeDotAssignments[name] = pick;
  }
};

const buildOwnersByDot = (mapping, dotCount) => {
  const ownersByDot = Array.from({ length: dotCount }, () => []);

  for (const [countryName, dotIndexes] of Object.entries(mapping)) {
    for (const dotIndex of dotIndexes) {
      ownersByDot[dotIndex].push(countryName);
    }
  }

  return ownersByDot;
};

const fillUnassignedDotComponents = ({
  mapping,
  components,
  dotCoords,
  featureMeta,
  constants,
}) => {
  const ownersByDot = buildOwnersByDot(mapping, dotCoords.length);

  for (const component of components) {
    const unownedDots = component.filter((dotIndex) => ownersByDot[dotIndex].length === 0);
    if (!unownedDots.length) continue;

    const nearbyCountryScores = new Map();

    for (const missingDotIndex of unownedDots) {
      const missingDot = dotCoords[missingDotIndex];

      for (let candidateIndex = 0; candidateIndex < dotCoords.length; candidateIndex += 1) {
        if (!ownersByDot[candidateIndex].length) continue;

        const candidateDot = dotCoords[candidateIndex];
        const distance = Math.hypot(candidateDot.x - missingDot.x, candidateDot.y - missingDot.y);

        if (distance > DOT_COMPLETION_DISTANCE_LIMIT) continue;

        for (const countryName of ownersByDot[candidateIndex]) {
          nearbyCountryScores.set(
            countryName,
            (nearbyCountryScores.get(countryName) ?? 0) + (DOT_COMPLETION_DISTANCE_LIMIT - distance),
          );
        }
      }
    }

    let bestCountryName = null;

    if (nearbyCountryScores.size > 0) {
      bestCountryName = Array.from(nearbyCountryScores.entries())
        .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    } else {
      const centroid = unownedDots.reduce(
        (acc, dotIndex) => {
          acc.x += dotCoords[dotIndex].x;
          acc.y += dotCoords[dotIndex].y;
          return acc;
        },
        { x: 0, y: 0 },
      );
      centroid.x /= unownedDots.length;
      centroid.y /= unownedDots.length;

      let bestDistance = Infinity;

      for (const { name, feature } of featureMeta) {
        if (REPRESENTATIVE_DOT_EXCLUSIONS.has(name)) continue;

        const candidatePoints = [
          ...getRepresentativePoints(feature, constants),
          ...getFeatureShapePoints(feature, constants),
        ];

        for (const point of candidatePoints) {
          const distance = Math.hypot(point.pixel.x - centroid.x, point.pixel.y - centroid.y);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestCountryName = name;
          }
        }
      }
    }

    if (!bestCountryName) continue;

    mapping[bestCountryName] = sortUniqueDots([
      ...(mapping[bestCountryName] ?? []),
      ...unownedDots,
    ]);

    for (const dotIndex of unownedDots) {
      ownersByDot[dotIndex].push(bestCountryName);
    }
  }
};

const applyCanadaGreenlandArcticSeam = ({
  mapping,
  dotCoords,
}) => {
  const candidateDots = dotCoords
    .filter((dot) => dot.x >= 900 && dot.x <= 1205 && dot.y <= 360)
    .map((dot) => dot.index);

  const canadaDots = new Set((mapping.Canada ?? []).filter((dotIndex) => !candidateDots.includes(dotIndex)));
  const greenlandDots = new Set((mapping.Greenland ?? []).filter((dotIndex) => !candidateDots.includes(dotIndex)));

  for (const dotIndex of candidateDots) {
    const dot = dotCoords[dotIndex];

    if (dot.x >= 1000) {
      greenlandDots.add(dotIndex);
    } else {
      canadaDots.add(dotIndex);
    }
  }

  // The Canada/Greenland seam is not a clean vertical split on this artwork.
  // The high-arctic east strip reads as Greenland, while the lower Labrador
  // edge swings back to Canada.
  // Must cover every index Canada: { add: [...] } forces onto Canada in
  // applyVisualRegionRules, or those dots stay Canadian after the seam pass.
  // Do NOT list dots here that should remain Canada on the artwork (893–915 seam
  // column, Baffin/Labrador strip, etc.); see committed utils/countryData.ts.
  const greenlandWestArcDots = [
    2, 31, 32, 44, 49, 60, 71, 77, 86, 91, 92,
    110, 111, 112, 130, 137, 164, 175, 224, 289, 320, 434, 518, 622,
    759, 963,
  ];
  // Pulls dots back onto Canada after the west-arc pass (e.g. top-of-archipelago seam
  // dot 2 should stay Canadian; was only in Greenland because it is listed in the arc).
  // 211/252 stay Greenland (main island column); do not force them onto Canada.
  const canadaEastEdgeDots = [2, 369, 415, 483, 603, 701];

  for (const dotIndex of greenlandWestArcDots) {
    canadaDots.delete(dotIndex);
    greenlandDots.add(dotIndex);
  }

  for (const dotIndex of canadaEastEdgeDots) {
    greenlandDots.delete(dotIndex);
    canadaDots.add(dotIndex);
  }

  mapping.Canada = sortUniqueDots([...canadaDots]);
  mapping.Greenland = sortUniqueDots([...greenlandDots]);
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
  assignRepresentativeDots({
    mapping,
    featureMeta,
    dotCoords,
    constants,
    representativeDotAssignments,
  });

  applyVisualRegionRules(mapping);

  applyCanadaGreenlandArcticSeam({
    mapping,
    dotCoords,
  });

  fillUnassignedDotComponents({
    mapping,
    components,
    dotCoords,
    featureMeta,
    constants,
  });

  applyVisualRegionRules(mapping);

  applyCanadaGreenlandArcticSeam({
    mapping,
    dotCoords,
  });

  assignRepresentativeDots({
    mapping,
    featureMeta,
    dotCoords,
    constants,
    representativeDotAssignments,
  });

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
