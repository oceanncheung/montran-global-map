import { MapPoint } from '../types';

export const COUNTRY_LABEL_HEIGHT = 32;
export const COUNTRY_LABEL_FONT_SIZE = 16;
export const COUNTRY_LABEL_ROW_GAP = 8;
export const COUNTRY_LABEL_ROW_PITCH = COUNTRY_LABEL_HEIGHT + COUNTRY_LABEL_ROW_GAP;
export const COUNTRY_LABEL_CORNER_RADIUS = 6;

export type CountryLabelPlacement = 'inside' | 'floating' | 'rail';
export type CountryLabelSide = 'left' | 'right';

export interface CountryLabelRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface CountryLabelPlacementBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface CountryLabelExportViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CountryLabelLayout {
  name: string;
  anchor: MapPoint;
  offset: MapPoint;
  width: number;
  height: number;
  rect: CountryLabelRect;
  placement: CountryLabelPlacement;
  side?: CountryLabelSide;
  railIndex?: number;
  leaderPoints?: MapPoint[];
}

export interface CountryLabelComposition {
  labels: CountryLabelLayout[];
  artboardHeight: number;
  verticalShift: number;
  exportViewBox: CountryLabelExportViewBox;
}

export interface CountryLabelCompositionOptions {
  placementScale: number;
  placementBounds?: CountryLabelPlacementBounds | null;
  viewportHeight: number;
}

interface CountryFootprint {
  name: string;
  dots: Array<MapPoint & { index: number }>;
  center: MapPoint;
  interiorAnchor: MapPoint;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
  labelWidth: number;
}

interface FloatingCandidate {
  layout: CountryLabelLayout;
  score: number;
}

interface RailResult {
  layouts: CountryLabelLayout[];
  score: number;
}

const CONNECTED_DOT_DISTANCE = 34;
const MIN_INSIDE_DOT_COUNT = 14;
const INSIDE_PADDING = 30;
const LABEL_COLLISION_PADDING = 6;
const FLOATING_GAP = 12;
const FLOATING_CLUSTER_WIDTH = 180;
const FLOATING_CLUSTER_HEIGHT = 136;
const MAX_FLOATING_PER_CLUSTER = 5;
const DENSE_SELECTION_THRESHOLD = 28;
const DOT_LEADER_GAP = 8;
const RAIL_GUTTER = 24;
const ROUTING_LANE_GAP = 8;
const ROUTING_END_GAP = 8;

const BASE_EXPORT_VIEWBOX: CountryLabelExportViewBox = {
  x: 30,
  y: 20,
  width: 2690,
  height: 1460,
};

const getCharacterWidth = (character: string) => {
  if (character === ' ') return 4.3;
  if ('ijlI1'.includes(character)) return 4;
  if ('mwMW@'.includes(character)) return 11.4;
  if (character === character.toUpperCase() && /[A-Z]/.test(character)) return 8.9;
  return 7.7;
};

export const estimateCountryLabelWidth = (name: string) => (
  Math.ceil(Array.from(name).reduce((width, character) => width + getCharacterWidth(character), 0) + 40)
);

const distanceBetween = (a: MapPoint, b: MapPoint) => Math.hypot(a.x - b.x, a.y - b.y);

const getLargestConnectedComponent = (indexes: number[], mapDots: MapPoint[]) => {
  const remaining = new Set(indexes.filter((index) => mapDots[index]));
  const components: number[][] = [];

  while (remaining.size > 0) {
    const first = remaining.values().next().value as number;
    const component: number[] = [];
    const queue = [first];
    remaining.delete(first);

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      component.push(current);

      for (const candidate of Array.from(remaining)) {
        if (distanceBetween(mapDots[current], mapDots[candidate]) <= CONNECTED_DOT_DISTANCE) {
          remaining.delete(candidate);
          queue.push(candidate);
        }
      }
    }

    components.push(component);
  }

  return components.sort((a, b) => b.length - a.length)[0] ?? [];
};

const getInteriorAnchor = (
  dots: Array<MapPoint & { index: number }>,
  center: MapPoint,
) => dots
  .map((dot) => ({
    dot,
    score: dots.filter((candidate) => distanceBetween(dot, candidate) <= 70).length * 20 -
      distanceBetween(dot, center),
  }))
  .sort((a, b) => b.score - a.score)[0]?.dot ?? center;

const getCountryFootprint = (
  name: string,
  indexes: number[],
  mapDots: MapPoint[],
): CountryFootprint | null => {
  const componentIndexes = getLargestConnectedComponent(indexes, mapDots);
  if (componentIndexes.length === 0) return null;

  const dots = componentIndexes.map((index) => ({ ...mapDots[index], index }));
  const minX = Math.min(...dots.map((dot) => dot.x));
  const maxX = Math.max(...dots.map((dot) => dot.x));
  const minY = Math.min(...dots.map((dot) => dot.y));
  const maxY = Math.max(...dots.map((dot) => dot.y));
  const center = {
    x: dots.reduce((sum, dot) => sum + dot.x, 0) / dots.length,
    y: dots.reduce((sum, dot) => sum + dot.y, 0) / dots.length,
  };

  return {
    name,
    dots,
    center,
    interiorAnchor: getInteriorAnchor(dots, center),
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    labelWidth: estimateCountryLabelWidth(name),
  };
};

const getRect = (centerX: number, centerY: number, width: number): CountryLabelRect => ({
  left: centerX - width / 2,
  right: centerX + width / 2,
  top: centerY - COUNTRY_LABEL_HEIGHT / 2,
  bottom: centerY + COUNTRY_LABEL_HEIGHT / 2,
});

export const countryLabelRectsOverlap = (
  a: CountryLabelRect,
  b: CountryLabelRect,
  padding = LABEL_COLLISION_PADDING,
) => !(
  a.right + padding <= b.left ||
  a.left >= b.right + padding ||
  a.bottom + padding <= b.top ||
  a.top >= b.bottom + padding
);

const rectSitsWithinBounds = (
  rect: CountryLabelRect,
  bounds: CountryLabelPlacementBounds,
) => (
  rect.left >= bounds.left &&
  rect.right <= bounds.right &&
  rect.top >= bounds.top &&
  rect.bottom <= bounds.bottom
);

const getMapBounds = (mapDots: MapPoint[], scale: number): CountryLabelPlacementBounds => ({
  left: Math.min(...mapDots.map((dot) => dot.x)) * scale,
  right: Math.max(...mapDots.map((dot) => dot.x)) * scale,
  top: Math.min(...mapDots.map((dot) => dot.y)) * scale,
  bottom: Math.max(...mapDots.map((dot) => dot.y)) * scale,
});

const getFootprintScreenBounds = (
  footprints: CountryFootprint[],
  scale: number,
): CountryLabelPlacementBounds => ({
  left: Math.min(...footprints.map((footprint) => footprint.minX * scale)),
  right: Math.max(...footprints.map((footprint) => footprint.maxX * scale)),
  top: Math.min(...footprints.map((footprint) => footprint.minY * scale)),
  bottom: Math.max(...footprints.map((footprint) => footprint.maxY * scale)),
});

const segmentIntersectsRect = (
  start: MapPoint,
  end: MapPoint,
  rect: CountryLabelRect,
) => {
  if (Math.abs(start.y - end.y) < 0.001) {
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    return start.y > rect.top && start.y < rect.bottom && maxX > rect.left && minX < rect.right;
  }

  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);
  return start.x > rect.left && start.x < rect.right && maxY > rect.top && minY < rect.bottom;
};

const segmentsCross = (
  firstStart: MapPoint,
  firstEnd: MapPoint,
  secondStart: MapPoint,
  secondEnd: MapPoint,
) => {
  const firstHorizontal = Math.abs(firstStart.y - firstEnd.y) < 0.001;
  const secondHorizontal = Math.abs(secondStart.y - secondEnd.y) < 0.001;
  if (firstHorizontal === secondHorizontal) return false;

  const horizontalStart = firstHorizontal ? firstStart : secondStart;
  const horizontalEnd = firstHorizontal ? firstEnd : secondEnd;
  const verticalStart = firstHorizontal ? secondStart : firstStart;
  const verticalEnd = firstHorizontal ? secondEnd : firstEnd;

  return (
    verticalStart.x > Math.min(horizontalStart.x, horizontalEnd.x) &&
    verticalStart.x < Math.max(horizontalStart.x, horizontalEnd.x) &&
    horizontalStart.y > Math.min(verticalStart.y, verticalEnd.y) &&
    horizontalStart.y < Math.max(verticalStart.y, verticalEnd.y)
  );
};

const getAbsoluteLeaderPoints = (label: CountryLabelLayout, scale: number) => (
  (label.leaderPoints ?? []).map((point) => ({
    x: label.anchor.x * scale + point.x,
    y: label.anchor.y * scale + point.y,
  }))
);

const routeIntersectsRect = (points: MapPoint[], rect: CountryLabelRect) => (
  points.slice(1).some((point, index) => segmentIntersectsRect(points[index], point, rect))
);

const routesCross = (first: MapPoint[], second: MapPoint[]) => {
  for (let firstIndex = 1; firstIndex < first.length; firstIndex += 1) {
    for (let secondIndex = 1; secondIndex < second.length; secondIndex += 1) {
      if (segmentsCross(
        first[firstIndex - 1],
        first[firstIndex],
        second[secondIndex - 1],
        second[secondIndex],
      )) return true;
    }
  }
  return false;
};

const getNearestDot = (
  footprint: CountryFootprint,
  target: MapPoint,
  scale: number,
) => [...footprint.dots]
  .sort((a, b) => (
    distanceBetween({ x: a.x * scale, y: a.y * scale }, target) -
    distanceBetween({ x: b.x * scale, y: b.y * scale }, target) ||
    a.index - b.index
  ))[0];

const getSideAnchor = (footprint: CountryFootprint, side: CountryLabelSide) => {
  const direction = side === 'left' ? -1 : 1;
  return [...footprint.dots]
    .sort((a, b) => (
      direction * (b.x - a.x) ||
      Math.abs(a.y - footprint.center.y) - Math.abs(b.y - footprint.center.y) ||
      a.index - b.index
    ))[0];
};

const createLeaderPoints = (
  anchor: MapPoint,
  center: MapPoint,
  width: number,
  scale: number,
  forcedSide?: CountryLabelSide,
  laneOffset = 0,
) => {
  const anchorScreen = { x: anchor.x * scale, y: anchor.y * scale };
  const side = forcedSide ?? (center.x < anchorScreen.x ? 'left' : 'right');
  const direction = side === 'left' ? -1 : 1;
  const start = {
    x: anchorScreen.x + direction * DOT_LEADER_GAP,
    y: anchorScreen.y,
  };
  const end = {
    x: center.x - direction * width / 2,
    y: center.y,
  };

  if (Math.abs(start.y - end.y) < 0.001) {
    return {
      side,
      points: [start, end].map((point) => ({
        x: point.x - anchorScreen.x,
        y: point.y - anchorScreen.y,
      })),
    };
  }

  const availableHorizontal = Math.abs(end.x - start.x);
  const cornerRun = Math.min(20 + laneOffset, Math.max(6, availableHorizontal / 2));
  const laneX = start.x + direction * cornerRun;
  const points = [
    start,
    { x: laneX, y: start.y },
    { x: laneX, y: end.y },
    end,
  ];

  return {
    side,
    points: points.map((point) => ({
      x: point.x - anchorScreen.x,
      y: point.y - anchorScreen.y,
    })),
  };
};

const coversSelectedDot = (
  rect: CountryLabelRect,
  footprints: CountryFootprint[],
  scale: number,
) => footprints.some((footprint) => footprint.dots.some((dot) => (
  dot.x * scale > rect.left - 4 &&
  dot.x * scale < rect.right + 4 &&
  dot.y * scale > rect.top - 4 &&
  dot.y * scale < rect.bottom + 4
)));

const layoutConflicts = (
  layout: CountryLabelLayout,
  occupied: CountryLabelLayout[],
  scale: number,
) => {
  if (occupied.some((other) => countryLabelRectsOverlap(layout.rect, other.rect))) return true;

  const points = getAbsoluteLeaderPoints(layout, scale);
  if (occupied.some((other) => routeIntersectsRect(points, other.rect))) return true;

  return occupied.some((other) => {
    const otherPoints = getAbsoluteLeaderPoints(other, scale);
    return (
      otherPoints.length > 1 &&
      (routeIntersectsRect(otherPoints, layout.rect) || routesCross(points, otherPoints))
    );
  });
};

const createFloatingCandidates = (
  footprint: CountryFootprint,
  allFootprints: CountryFootprint[],
  occupied: CountryLabelLayout[],
  visibleBounds: CountryLabelPlacementBounds,
  mapCenterX: number,
  scale: number,
) => {
  const left = footprint.minX * scale;
  const right = footprint.maxX * scale;
  const top = footprint.minY * scale;
  const bottom = footprint.maxY * scale;
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  const halfWidth = footprint.labelWidth / 2;
  const halfHeight = COUNTRY_LABEL_HEIGHT / 2;
  const horizontalX = {
    left: left - FLOATING_GAP - halfWidth,
    right: right + FLOATING_GAP + halfWidth,
  };
  const verticalY = {
    top: top - FLOATING_GAP - halfHeight,
    bottom: bottom + FLOATING_GAP + halfHeight,
  };

  const positions = [
    { id: 'right', x: horizontalX.right, y: centerY, penalty: 0 },
    { id: 'left', x: horizontalX.left, y: centerY, penalty: 0 },
    { id: 'top', x: centerX + 10, y: verticalY.top, penalty: 6 },
    { id: 'bottom', x: centerX - 10, y: verticalY.bottom, penalty: 6 },
    { id: 'top-right', x: horizontalX.right, y: verticalY.top, penalty: 12 },
    { id: 'top-left', x: horizontalX.left, y: verticalY.top, penalty: 12 },
    { id: 'bottom-right', x: horizontalX.right, y: verticalY.bottom, penalty: 12 },
    { id: 'bottom-left', x: horizontalX.left, y: verticalY.bottom, penalty: 12 },
    { id: 'right-high', x: horizontalX.right, y: centerY - COUNTRY_LABEL_ROW_PITCH, penalty: 18 },
    { id: 'right-low', x: horizontalX.right, y: centerY + COUNTRY_LABEL_ROW_PITCH, penalty: 18 },
    { id: 'left-high', x: horizontalX.left, y: centerY - COUNTRY_LABEL_ROW_PITCH, penalty: 18 },
    { id: 'left-low', x: horizontalX.left, y: centerY + COUNTRY_LABEL_ROW_PITCH, penalty: 18 },
  ];

  const seen = new Set<string>();
  const candidates: FloatingCandidate[] = [];

  positions.forEach((position, positionIndex) => {
    const key = `${position.x.toFixed(2)}:${position.y.toFixed(2)}`;
    if (seen.has(key)) return;
    seen.add(key);

    const center = { x: position.x, y: position.y };
    const rect = getRect(center.x, center.y, footprint.labelWidth);
    if (!rectSitsWithinBounds(rect, visibleBounds)) return;
    if (coversSelectedDot(rect, allFootprints, scale)) return;

    const anchor = getNearestDot(footprint, center, scale);
    const leader = createLeaderPoints(anchor, center, footprint.labelWidth, scale);
    const layout: CountryLabelLayout = {
      name: footprint.name,
      anchor,
      offset: {
        x: center.x - anchor.x * scale,
        y: center.y - anchor.y * scale,
      },
      width: footprint.labelWidth,
      height: COUNTRY_LABEL_HEIGHT,
      rect,
      placement: 'floating',
      side: leader.side,
      leaderPoints: leader.points,
    };
    if (layoutConflicts(layout, occupied, scale)) return;

    const anchorScreen = { x: anchor.x * scale, y: anchor.y * scale };
    const absolutePoints = getAbsoluteLeaderPoints(layout, scale);
    const routeLength = absolutePoints.slice(1).reduce(
      (total, point, index) => total + distanceBetween(absolutePoints[index], point),
      0,
    );
    const movesOutward = Math.abs(center.x - mapCenterX) >= Math.abs(centerX - mapCenterX);
    const verticalDistance = Math.abs(center.y - anchorScreen.y);

    candidates.push({
      layout,
      score: routeLength + verticalDistance * 0.18 + position.penalty +
        (movesOutward ? 0 : 14) + positionIndex * 0.001,
    });
  });

  return candidates.sort((a, b) => a.score - b.score || a.layout.name.localeCompare(b.layout.name));
};

const getClusterBounds = (cluster: CountryFootprint[], scale: number) => ({
  left: Math.min(...cluster.map((footprint) => footprint.center.x * scale)),
  right: Math.max(...cluster.map((footprint) => footprint.center.x * scale)),
  top: Math.min(...cluster.map((footprint) => footprint.center.y * scale)),
  bottom: Math.max(...cluster.map((footprint) => footprint.center.y * scale)),
});

const createSpatialClusters = (
  footprints: CountryFootprint[],
  scale: number,
) => {
  let clusters = [...footprints]
    .sort((a, b) => a.center.y - b.center.y || a.center.x - b.center.x || a.name.localeCompare(b.name))
    .map((footprint) => [footprint]);

  while (true) {
    let bestPair: { first: number; second: number; score: number } | null = null;

    for (let first = 0; first < clusters.length; first += 1) {
      for (let second = first + 1; second < clusters.length; second += 1) {
        const combined = [...clusters[first], ...clusters[second]];
        const bounds = getClusterBounds(combined, scale);
        if (
          bounds.right - bounds.left > FLOATING_CLUSTER_WIDTH ||
          bounds.bottom - bounds.top > FLOATING_CLUSTER_HEIGHT
        ) continue;

        const firstCenter = {
          x: clusters[first].reduce((sum, footprint) => sum + footprint.center.x * scale, 0) /
            clusters[first].length,
          y: clusters[first].reduce((sum, footprint) => sum + footprint.center.y * scale, 0) /
            clusters[first].length,
        };
        const secondCenter = {
          x: clusters[second].reduce((sum, footprint) => sum + footprint.center.x * scale, 0) /
            clusters[second].length,
          y: clusters[second].reduce((sum, footprint) => sum + footprint.center.y * scale, 0) /
            clusters[second].length,
        };
        const score = distanceBetween(firstCenter, secondCenter);

        if (
          !bestPair ||
          score < bestPair.score ||
          (Math.abs(score - bestPair.score) < 0.001 && first < bestPair.first)
        ) bestPair = { first, second, score };
      }
    }

    if (!bestPair) break;
    const merged = [...clusters[bestPair.first], ...clusters[bestPair.second]]
      .sort((a, b) => a.name.localeCompare(b.name));
    clusters = clusters.filter((_, index) => index !== bestPair.first && index !== bestPair.second);
    clusters.push(merged);
  }

  return clusters.sort((a, b) => {
    const aBounds = getClusterBounds(a, scale);
    const bBounds = getClusterBounds(b, scale);
    return aBounds.left - bBounds.left || aBounds.top - bBounds.top || a[0].name.localeCompare(b[0].name);
  });
};

const sortClusterForFloating = (cluster: CountryFootprint[], scale: number) => {
  const bounds = getClusterBounds(cluster, scale);
  const center = { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 };

  return [...cluster].sort((a, b) => {
    const aPoint = { x: a.center.x * scale, y: a.center.y * scale };
    const bPoint = { x: b.center.x * scale, y: b.center.y * scale };
    const aNeighbors = cluster.filter((other) => (
      other !== a && distanceBetween(aPoint, { x: other.center.x * scale, y: other.center.y * scale }) < 92
    )).length;
    const bNeighbors = cluster.filter((other) => (
      other !== b && distanceBetween(bPoint, { x: other.center.x * scale, y: other.center.y * scale }) < 92
    )).length;

    return (
      aNeighbors - bNeighbors ||
      distanceBetween(bPoint, center) - distanceBetween(aPoint, center) ||
      b.labelWidth - a.labelWidth ||
      a.name.localeCompare(b.name)
    );
  });
};

const buildRowGrid = (bounds: CountryLabelPlacementBounds) => {
  const minY = bounds.top + COUNTRY_LABEL_HEIGHT / 2;
  const maxY = bounds.bottom - COUNTRY_LABEL_HEIGHT / 2;
  const rows: number[] = [];
  for (let y = minY; y <= maxY + 0.001; y += COUNTRY_LABEL_ROW_GAP) rows.push(y);
  if (rows.length === 0 || Math.abs(rows[rows.length - 1] - maxY) > 0.001) rows.push(maxY);
  return rows;
};

const allocateRailRows = (
  footprints: CountryFootprint[],
  centerXFor: (footprint: CountryFootprint) => number,
  bounds: CountryLabelPlacementBounds,
  occupied: CountryLabelLayout[],
  allFootprints: CountryFootprint[],
  scale: number,
  getRowPenalty?: (footprint: CountryFootprint, rowY: number, index: number) => number,
) => {
  const sorted = [...footprints].sort((a, b) => (
    a.center.y - b.center.y || a.center.x - b.center.x || a.name.localeCompare(b.name)
  ));
  const rows = buildRowGrid(bounds);
  const costs = sorted.map(() => rows.map(() => Number.POSITIVE_INFINITY));
  const previousRows = sorted.map(() => rows.map(() => -1));

  sorted.forEach((footprint, footprintIndex) => {
    rows.forEach((rowY, rowIndex) => {
      const rect = getRect(centerXFor(footprint), rowY, footprint.labelWidth);
      if (occupied.some((label) => countryLabelRectsOverlap(rect, label.rect))) return;
      if (coversSelectedDot(rect, allFootprints, scale)) return;
      const localCost = Math.abs(rowY - footprint.center.y * scale) +
        (getRowPenalty?.(footprint, rowY, footprintIndex) ?? 0);

      if (footprintIndex === 0) {
        costs[footprintIndex][rowIndex] = localCost;
        return;
      }

      let bestPrevious = -1;
      let bestCost = Number.POSITIVE_INFINITY;
      for (let candidateIndex = 0; candidateIndex < rowIndex; candidateIndex += 1) {
        if (rowY - rows[candidateIndex] < COUNTRY_LABEL_ROW_PITCH - 0.001) continue;
        if (costs[footprintIndex - 1][candidateIndex] < bestCost) {
          bestCost = costs[footprintIndex - 1][candidateIndex];
          bestPrevious = candidateIndex;
        }
      }

      if (bestPrevious >= 0) {
        costs[footprintIndex][rowIndex] = bestCost + localCost;
        previousRows[footprintIndex][rowIndex] = bestPrevious;
      }
    });
  });

  const lastCosts = costs[costs.length - 1] ?? [];
  let rowIndex = lastCosts.reduce(
    (best, cost, index) => (cost < (lastCosts[best] ?? Number.POSITIVE_INFINITY) ? index : best),
    0,
  );

  if (!Number.isFinite(lastCosts[rowIndex])) {
    const minimum = bounds.top + COUNTRY_LABEL_HEIGHT / 2;
    const maximum = bounds.bottom - COUNTRY_LABEL_HEIGHT / 2;
    const start = Math.max(
      minimum,
      Math.min(maximum - (sorted.length - 1) * COUNTRY_LABEL_ROW_PITCH, sorted[0].center.y * scale),
    );
    return {
      sorted,
      rows: sorted.map((_, index) => start + index * COUNTRY_LABEL_ROW_PITCH),
    };
  }

  const allocatedRows = Array(sorted.length).fill(0) as number[];
  for (let footprintIndex = sorted.length - 1; footprintIndex >= 0; footprintIndex -= 1) {
    allocatedRows[footprintIndex] = rows[rowIndex];
    rowIndex = previousRows[footprintIndex][rowIndex];
  }

  return { sorted, rows: allocatedRows };
};

const getRailRoute = (
  footprint: CountryFootprint,
  side: CountryLabelSide,
  rowY: number,
  alignedEdge: number,
  index: number,
  scale: number,
) => {
  const anchor = getSideAnchor(footprint, side);
  const anchorScreen = { x: anchor.x * scale, y: anchor.y * scale };
  const direction = side === 'left' ? -1 : 1;
  const start = {
    x: anchorScreen.x + direction * DOT_LEADER_GAP,
    y: anchorScreen.y,
  };
  const desiredLaneX = start.x + direction *
    (ROUTING_END_GAP + (index % 4) * ROUTING_LANE_GAP);
  const laneX = side === 'left'
    ? Math.max(alignedEdge, Math.min(start.x, desiredLaneX))
    : Math.min(alignedEdge, Math.max(start.x, desiredLaneX));

  return {
    anchor,
    anchorScreen,
    points: [
      start,
      { x: laneX, y: start.y },
      { x: laneX, y: rowY },
      { x: alignedEdge, y: rowY },
    ],
  };
};

const getRailScore = (
  layouts: CountryLabelLayout[],
  occupied: CountryLabelLayout[],
  scale: number,
) => {
  let score = 0;
  const allLayouts = [...occupied, ...layouts];

  layouts.forEach((layout) => {
    const points = getAbsoluteLeaderPoints(layout, scale);
    points.slice(1).forEach((point, index) => {
      score += distanceBetween(points[index], point);
      allLayouts.forEach((other) => {
        if (other.name !== layout.name && segmentIntersectsRect(points[index], point, other.rect)) {
          score += 1_000_000;
        }
      });
    });
  });

  for (let first = 0; first < allLayouts.length; first += 1) {
    for (let second = first + 1; second < allLayouts.length; second += 1) {
      if (countryLabelRectsOverlap(allLayouts[first].rect, allLayouts[second].rect)) score += 10_000_000;
      const firstPoints = getAbsoluteLeaderPoints(allLayouts[first], scale);
      const secondPoints = getAbsoluteLeaderPoints(allLayouts[second], scale);
      if (firstPoints.length > 1 && secondPoints.length > 1 && routesCross(firstPoints, secondPoints)) {
        score += 10_000;
      }
    }
  }

  return score;
};

const createRailForSide = (
  footprints: CountryFootprint[],
  side: CountryLabelSide,
  regionBounds: CountryLabelPlacementBounds,
  visibleBounds: CountryLabelPlacementBounds,
  occupied: CountryLabelLayout[],
  allFootprints: CountryFootprint[],
  scale: number,
): RailResult => {
  if (footprints.length === 0) return { layouts: [], score: 0 };

  const maxWidth = Math.max(...footprints.map((footprint) => footprint.labelWidth));
  const alignedEdge = side === 'left'
    ? Math.max(visibleBounds.left + maxWidth, regionBounds.left - RAIL_GUTTER)
    : Math.min(visibleBounds.right - maxWidth, regionBounds.right + RAIL_GUTTER);
  const centerXFor = (footprint: CountryFootprint) => side === 'left'
    ? alignedEdge - footprint.labelWidth / 2
    : alignedEdge + footprint.labelWidth / 2;
  const getRowPenalty = (footprint: CountryFootprint, rowY: number, index: number) => {
    const points = getRailRoute(footprint, side, rowY, alignedEdge, index, scale).points;
    let penalty = 0;
    occupied.forEach((label) => {
      if (routeIntersectsRect(points, label.rect)) penalty += 1_000_000;
      const otherPoints = getAbsoluteLeaderPoints(label, scale);
      if (otherPoints.length > 1 && routesCross(points, otherPoints)) penalty += 10_000;
    });
    return penalty;
  };
  const allocated = allocateRailRows(
    footprints,
    centerXFor,
    visibleBounds,
    occupied,
    allFootprints,
    scale,
    getRowPenalty,
  );

  const layouts = allocated.sorted.map((footprint, index) => {
    const center = { x: centerXFor(footprint), y: allocated.rows[index] };
    const route = getRailRoute(footprint, side, center.y, alignedEdge, index, scale);
    const { anchor, anchorScreen } = route;

    return {
      name: footprint.name,
      anchor,
      offset: {
        x: center.x - anchorScreen.x,
        y: center.y - anchorScreen.y,
      },
      width: footprint.labelWidth,
      height: COUNTRY_LABEL_HEIGHT,
      rect: getRect(center.x, center.y, footprint.labelWidth),
      placement: 'rail' as const,
      side,
      railIndex: index,
      leaderPoints: route.points.map((point) => ({
        x: point.x - anchorScreen.x,
        y: point.y - anchorScreen.y,
      })),
    };
  });

  return { layouts, score: getRailScore(layouts, occupied, scale) };
};

const getRequiredExtraHeight = (
  labelCount: number,
  bounds: CountryLabelPlacementBounds,
) => {
  if (labelCount <= 0) return 0;
  const requiredHeight = labelCount * COUNTRY_LABEL_HEIGHT +
    Math.max(0, labelCount - 1) * COUNTRY_LABEL_ROW_GAP;
  return Math.max(0, Math.ceil((requiredHeight - (bounds.bottom - bounds.top)) / COUNTRY_LABEL_ROW_PITCH) *
    COUNTRY_LABEL_ROW_PITCH);
};

const expandBoundsVertically = (
  bounds: CountryLabelPlacementBounds,
  extraHeight: number,
): CountryLabelPlacementBounds => ({
  ...bounds,
  top: bounds.top - extraHeight / 2,
  bottom: bounds.bottom + extraHeight / 2,
});

const createDenseRails = (
  footprints: CountryFootprint[],
  insideLayouts: CountryLabelLayout[],
  visibleBounds: CountryLabelPlacementBounds,
  scale: number,
) => {
  const sorted = [...footprints].sort((a, b) => (
    a.center.x - b.center.x || a.center.y - b.center.y || a.name.localeCompare(b.name)
  ));
  const splitIndex = Math.ceil(sorted.length / 2);
  const left = sorted.slice(0, splitIndex);
  const right = sorted.slice(splitIndex);
  const extraHeight = Math.max(
    getRequiredExtraHeight(left.length, visibleBounds),
    getRequiredExtraHeight(right.length, visibleBounds),
  );
  const effectiveBounds = expandBoundsVertically(visibleBounds, extraHeight);
  const regionBounds = getFootprintScreenBounds(footprints, scale);
  const leftResult = createRailForSide(
    left,
    'left',
    regionBounds,
    effectiveBounds,
    insideLayouts,
    footprints,
    scale,
  );
  const rightResult = createRailForSide(
    right,
    'right',
    regionBounds,
    effectiveBounds,
    [...insideLayouts, ...leftResult.layouts],
    footprints,
    scale,
  );

  return {
    layouts: [...leftResult.layouts, ...rightResult.layouts],
    extraHeight,
  };
};

const settleFloatingLayouts = (
  initialLayouts: CountryLabelLayout[],
  footprints: CountryFootprint[],
  visibleBounds: CountryLabelPlacementBounds,
  mapCenterX: number,
  scale: number,
) => {
  let layouts = [...initialLayouts];
  const footprintByName = new Map(footprints.map((footprint) => [footprint.name, footprint]));

  for (let iteration = 0; iteration < initialLayouts.length * 2; iteration += 1) {
    let floatingName: string | null = null;

    for (const label of layouts) {
      const points = getAbsoluteLeaderPoints(label, scale);
      if (points.length < 2) continue;

      for (const other of layouts) {
        if (other.name === label.name || !routeIntersectsRect(points, other.rect)) continue;
        if (other.placement === 'floating') {
          floatingName = other.name;
          break;
        }
        if (label.placement === 'floating') {
          floatingName = label.name;
          break;
        }
      }
      if (floatingName) break;
    }

    if (!floatingName) break;
    const footprint = footprintByName.get(floatingName);
    if (!footprint) break;

    const withoutFloating = layouts.filter((layout) => layout.name !== floatingName);
    const replacement = createFloatingCandidates(
      footprint,
      footprints,
      withoutFloating,
      visibleBounds,
      mapCenterX,
      scale,
    )[0];
    if (!replacement) break;
    layouts = [...withoutFloating, replacement.layout];
  }

  return layouts;
};

const createHybridLayouts = (
  clusters: CountryFootprint[][],
  allFootprints: CountryFootprint[],
  insideLayouts: CountryLabelLayout[],
  visibleBounds: CountryLabelPlacementBounds,
  mapCenterX: number,
  scale: number,
) => {
  const occupied = [...insideLayouts];
  const layouts: CountryLabelLayout[] = [];
  let maxRailCount = 0;

  clusters.forEach((cluster) => {
    const ordered = sortClusterForFloating(cluster, scale);
    let floatingFootprints = ordered.slice(0, MAX_FLOATING_PER_CLUSTER);
    let railFootprints = ordered.slice(MAX_FLOATING_PER_CLUSTER);

    for (let iteration = 0; iteration <= ordered.length; iteration += 1) {
      const regionBounds = getFootprintScreenBounds(cluster, scale);
      const left = createRailForSide(
        railFootprints,
        'left',
        regionBounds,
        visibleBounds,
        occupied,
        allFootprints,
        scale,
      );
      const right = createRailForSide(
        railFootprints,
        'right',
        regionBounds,
        visibleBounds,
        occupied,
        allFootprints,
        scale,
      );
      const chosenRail = left.score <= right.score ? left : right;
      const workingOccupied = [...occupied, ...chosenRail.layouts];
      const floatingLayouts: CountryLabelLayout[] = [];
      const failed: CountryFootprint[] = [];

      floatingFootprints.forEach((footprint) => {
        const candidate = createFloatingCandidates(
          footprint,
          allFootprints,
          workingOccupied,
          visibleBounds,
          mapCenterX,
          scale,
        )[0];

        if (!candidate) {
          failed.push(footprint);
          return;
        }

        workingOccupied.push(candidate.layout);
        floatingLayouts.push(candidate.layout);
      });

      if (failed.length > 0) {
        const failedNames = new Set(failed.map((footprint) => footprint.name));
        railFootprints = [...railFootprints, ...failed]
          .sort((a, b) => a.name.localeCompare(b.name));
        floatingFootprints = floatingFootprints.filter((footprint) => !failedNames.has(footprint.name));
        continue;
      }

      maxRailCount = Math.max(maxRailCount, railFootprints.length);
      occupied.push(...chosenRail.layouts, ...floatingLayouts);
      layouts.push(...chosenRail.layouts, ...floatingLayouts);
      break;
    }
  });

  const insideNames = new Set(insideLayouts.map((layout) => layout.name));
  const settledLayouts = settleFloatingLayouts(
    [...insideLayouts, ...layouts],
    allFootprints,
    visibleBounds,
    mapCenterX,
    scale,
  ).filter((layout) => !insideNames.has(layout.name));

  return { layouts: settledLayouts, maxRailCount };
};

const getLineCommand = (from: MapPoint, to: MapPoint) => {
  if (Math.abs(from.y - to.y) < 0.001) return `H ${to.x}`;
  if (Math.abs(from.x - to.x) < 0.001) return `V ${to.y}`;
  return `L ${to.x} ${to.y}`;
};

export const createRoundedOrthogonalPath = (
  points: MapPoint[],
  radius = COUNTRY_LABEL_CORNER_RADIUS,
) => {
  const compactPoints = points.filter((point, index) => (
    index === 0 || distanceBetween(point, points[index - 1]) > 0.001
  ));
  if (compactPoints.length === 0) return '';
  if (compactPoints.length === 1) return `M ${compactPoints[0].x} ${compactPoints[0].y}`;

  let path = `M ${compactPoints[0].x} ${compactPoints[0].y}`;
  let currentPoint = compactPoints[0];

  for (let index = 1; index < compactPoints.length - 1; index += 1) {
    const previous = compactPoints[index - 1];
    const corner = compactPoints[index];
    const next = compactPoints[index + 1];
    const incomingLength = distanceBetween(previous, corner);
    const outgoingLength = distanceBetween(corner, next);
    const cornerRadius = Math.min(radius, incomingLength / 2, outgoingLength / 2);

    if (cornerRadius <= 0.001) {
      path += ` ${getLineCommand(currentPoint, corner)}`;
      currentPoint = corner;
      continue;
    }

    const beforeCorner = {
      x: corner.x + ((previous.x - corner.x) / incomingLength) * cornerRadius,
      y: corner.y + ((previous.y - corner.y) / incomingLength) * cornerRadius,
    };
    const afterCorner = {
      x: corner.x + ((next.x - corner.x) / outgoingLength) * cornerRadius,
      y: corner.y + ((next.y - corner.y) / outgoingLength) * cornerRadius,
    };

    path += ` ${getLineCommand(currentPoint, beforeCorner)}`;
    path += ` Q ${corner.x} ${corner.y} ${afterCorner.x} ${afterCorner.y}`;
    currentPoint = afterCorner;
  }

  const lastPoint = compactPoints[compactPoints.length - 1];
  path += ` ${getLineCommand(currentPoint, lastPoint)}`;
  return path;
};

export const createCountryLabelComposition = (
  countryNames: string[],
  mappings: Record<string, number[]>,
  mapDots: MapPoint[],
  options: CountryLabelCompositionOptions,
): CountryLabelComposition => {
  const scale = Math.max(options.placementScale, 0.01);
  const viewportHeight = Math.max(options.viewportHeight, 1);
  const visibleBounds = options.placementBounds ?? getMapBounds(mapDots, scale);
  const uniqueNames = Array.from(new Set(countryNames)).sort((a, b) => a.localeCompare(b));
  const footprints = uniqueNames
    .map((name) => getCountryFootprint(name, mappings[name] ?? [], mapDots))
    .filter((footprint): footprint is CountryFootprint => Boolean(footprint));

  if (footprints.length === 0) {
    return {
      labels: [],
      artboardHeight: viewportHeight,
      verticalShift: 0,
      exportViewBox: { ...BASE_EXPORT_VIEWBOX },
    };
  }

  const insideLayouts: CountryLabelLayout[] = [];
  const outsideFootprints: CountryFootprint[] = [];
  const insideOrder = [...footprints].sort((a, b) => (
    b.dots.length - a.dots.length ||
    b.width * b.height - a.width * a.height ||
    a.name.localeCompare(b.name)
  ));

  insideOrder.forEach((footprint) => {
    const center = {
      x: footprint.interiorAnchor.x * scale,
      y: footprint.interiorAnchor.y * scale,
    };
    const rect = getRect(center.x, center.y, footprint.labelWidth);
    const canSitInside =
      footprint.dots.length >= MIN_INSIDE_DOT_COUNT &&
      footprint.width * scale >= footprint.labelWidth + INSIDE_PADDING &&
      footprint.height * scale >= COUNTRY_LABEL_HEIGHT + INSIDE_PADDING &&
      rectSitsWithinBounds(rect, visibleBounds) &&
      !insideLayouts.some((layout) => countryLabelRectsOverlap(rect, layout.rect));

    if (!canSitInside) {
      outsideFootprints.push(footprint);
      return;
    }

    insideLayouts.push({
      name: footprint.name,
      anchor: footprint.interiorAnchor,
      offset: { x: 0, y: 0 },
      width: footprint.labelWidth,
      height: COUNTRY_LABEL_HEIGHT,
      rect,
      placement: 'inside',
    });
  });

  let outsideLayouts: CountryLabelLayout[] = [];
  let extraHeight = 0;

  if (footprints.length >= DENSE_SELECTION_THRESHOLD) {
    const denseResult = createDenseRails(
      footprints,
      [],
      visibleBounds,
      scale,
    );
    insideLayouts.length = 0;
    outsideLayouts = denseResult.layouts;
    extraHeight = denseResult.extraHeight;
  } else if (outsideFootprints.length > 0) {
    const mapBounds = getMapBounds(mapDots, scale);
    const mapCenterX = (mapBounds.left + mapBounds.right) / 2;
    const clusters = createSpatialClusters(outsideFootprints, scale);
    const anticipatedRailCount = Math.max(
      0,
      ...clusters.map((cluster) => Math.max(0, cluster.length - MAX_FLOATING_PER_CLUSTER)),
    );
    extraHeight = getRequiredExtraHeight(anticipatedRailCount, visibleBounds);
    let hybridResult = createHybridLayouts(
      clusters,
      footprints,
      insideLayouts,
      expandBoundsVertically(visibleBounds, extraHeight),
      mapCenterX,
      scale,
    );
    const requiredExtraHeight = getRequiredExtraHeight(hybridResult.maxRailCount, visibleBounds);

    if (requiredExtraHeight > extraHeight) {
      extraHeight = requiredExtraHeight;
      hybridResult = createHybridLayouts(
        clusters,
        footprints,
        insideLayouts,
        expandBoundsVertically(visibleBounds, extraHeight),
        mapCenterX,
        scale,
      );
    }

    outsideLayouts = hybridResult.layouts;
  }

  const exportExtraHeight = Math.ceil((extraHeight / scale) / 2) * 2;

  return {
    labels: [...insideLayouts, ...outsideLayouts].sort((a, b) => a.name.localeCompare(b.name)),
    artboardHeight: viewportHeight + extraHeight,
    verticalShift: extraHeight / 2,
    exportViewBox: {
      ...BASE_EXPORT_VIEWBOX,
      y: BASE_EXPORT_VIEWBOX.y - exportExtraHeight / 2,
      height: BASE_EXPORT_VIEWBOX.height + exportExtraHeight,
    },
  };
};
