
import React, { useRef, useEffect, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { geoToPixel } from '../utils/geo';
import { OfficeLocation } from '../types';
import { MAP_DOTS, MONTRAN_OFFICES } from '../constants';
import { MANUAL_MAPPINGS } from '../utils/mappings';

interface MapCanvasProps {
  selectedOffices: OfficeLocation[];
  selectedCountries: string[];
  isSidebarOpen: boolean;
  isGlobalGreen: boolean;
  onToggleGlobalGreen: (on: boolean) => void;
}

const MAP_CONTENT_CENTER_X = (83 + 2668) / 2;
const MAP_CONTENT_CENTER_Y = (71 + 1430) / 2;
const MAP_FIT_WIDTH = 2668 - 83 + 160;
const MAP_FIT_HEIGHT = 1430 - 71 + 160;

const SIDEBAR_WIDTH = 360;
const SIDEBAR_MARGIN = 24;
const SIDEBAR_GAP = 24;

const CONTENT_PADDING = 120;
const TOP_CLEARANCE = 120;
const BOTTOM_CLEARANCE = 72;

const DEFAULT_VIEW_FRAME = {
  open: {
    left: SIDEBAR_WIDTH + SIDEBAR_MARGIN + SIDEBAR_GAP,
    right: CONTENT_PADDING,
    top: TOP_CLEARANCE,
    bottom: BOTTOM_CLEARANCE,
  },
  closed: {
    left: CONTENT_PADDING,
    right: CONTENT_PADDING,
    top: TOP_CLEARANCE,
    bottom: BOTTOM_CLEARANCE,
  },
} as const;

const MapCanvas: React.FC<MapCanvasProps> = ({
  selectedOffices,
  selectedCountries,
  isSidebarOpen,
  isGlobalGreen,
  onToggleGlobalGreen,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const currentTransformRef = useRef<d3.ZoomTransform | null>(null);
  const defaultTransformRef = useRef<d3.ZoomTransform | null>(null);
  const hasInitializedDefaultRef = useRef(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [zoomScale, setZoomScale] = useState(1);
  const [defaultScale, setDefaultScale] = useState(1);

  // Derived set of indices to highlight based on sidebar selection
  const activeDotIndices = useMemo(() => {
    const indices = new Set<number>();
    selectedCountries.forEach(countryName => {
      const countryDots = MANUAL_MAPPINGS[countryName];
      if (countryDots) {
        countryDots.forEach(idx => indices.add(idx));
      }
    });
    return indices;
  }, [selectedCountries]);

  const allOfficeMarkers = useMemo(() => {
    const dotsWithIndices = MAP_DOTS.map((dot, index) => ({ ...dot, index }));
    const countries = Array.from(new Set(MONTRAN_OFFICES.map((o) => o.country)));

    return countries.map((country) => {
      const anchorOffice =
        MONTRAN_OFFICES.find((o) => o.country === country && o.markerAnchor) ??
        MONTRAN_OFFICES.find((o) => o.country === country);

      const anchoredDot =
        anchorOffice?.markerDotIndex !== undefined
          ? MAP_DOTS[anchorOffice.markerDotIndex]
          : null;

      if (anchoredDot) {
        return { id: country, snappedX: anchoredDot.x, snappedY: anchoredDot.y };
      }

      const target = geoToPixel(anchorOffice?.lat ?? 0, anchorOffice?.lng ?? 0);
      const countryDotIndices = MANUAL_MAPPINGS[country];
      const candidateDots = countryDotIndices?.length
        ? countryDotIndices
            .map((index) => ({ index, ...MAP_DOTS[index] }))
            .filter((dot) => Number.isFinite(dot.x) && Number.isFinite(dot.y))
        : dotsWithIndices;

      const chosenDot = candidateDots
        .map((dot) => ({ ...dot, distance: Math.hypot(dot.x - target.x, dot.y - target.y) }))
        .sort((a, b) => a.distance - b.distance)[0];

      return { id: country, snappedX: chosenDot?.x ?? 0, snappedY: chosenDot?.y ?? 0 };
    });
  }, []);

  const activeOfficeCountries = useMemo(() => {
    return new Set(selectedOffices.map((o) => o.country));
  }, [selectedOffices]);

  const transformsMatch = (a: d3.ZoomTransform | null, b: d3.ZoomTransform | null) => {
    if (!a || !b) return false;

    return (
      Math.abs(a.x - b.x) < 0.01 &&
      Math.abs(a.y - b.y) < 0.01 &&
      Math.abs(a.k - b.k) < 0.001
    );
  };

  const getDefaultTransform = (width: number, height: number) => {
    const frame = isSidebarOpen ? DEFAULT_VIEW_FRAME.open : DEFAULT_VIEW_FRAME.closed;
    const availableWidth = Math.max(width - frame.left - frame.right, 240);
    const availableHeight = Math.max(height - frame.top - frame.bottom, 240);
    const fittedScale = Math.min(availableWidth / MAP_FIT_WIDTH, availableHeight / MAP_FIT_HEIGHT);
    const tx = frame.left + availableWidth / 2 - MAP_CONTENT_CENTER_X * fittedScale;
    const ty = frame.top + availableHeight / 2 - MAP_CONTENT_CENTER_Y * fittedScale;

    return d3.zoomIdentity.translate(tx, ty).scale(fittedScale);
  };

  const applyTransform = (
    selection: d3.Selection<SVGSVGElement, unknown, null, undefined>,
    transform: d3.ZoomTransform,
    animate: boolean,
    duration = 650,
  ) => {
    if (!zoomRef.current) return;

    if (animate) {
      selection
        .transition()
        .duration(duration)
        .ease(d3.easeCubicInOut)
        .call(zoomRef.current.transform, transform);
      return;
    }

    selection.call(zoomRef.current.transform, transform);
  };

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;
    const svg = d3.select(svgRef.current);
    const g = svg.select('g');
    
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.4, 15])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
        currentTransformRef.current = event.transform;
        setZoomScale(event.transform.k);
      });

    svg.call(zoom);
    zoomRef.current = zoom;
  }, []);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || !zoomRef.current) return;
    const svg = d3.select(svgRef.current);

    const computeDefault = () => {
      const { width, height } = containerRef.current!.getBoundingClientRect();
      return getDefaultTransform(width, height);
    };

    const nextDefault = computeDefault();
    defaultTransformRef.current = nextDefault;
    setDefaultScale(nextDefault.k);
    applyTransform(svg, nextDefault, hasInitializedDefaultRef.current, 500);
    hasInitializedDefaultRef.current = true;

    const handleResize = () => {
      if (!containerRef.current || !zoomRef.current) return;
      const resizedDefault = computeDefault();
      const isAtDefault =
        !currentTransformRef.current ||
        transformsMatch(currentTransformRef.current, defaultTransformRef.current);

      defaultTransformRef.current = resizedDefault;
      setDefaultScale(resizedDefault.k);

      if (isAtDefault) {
        applyTransform(svg, resizedDefault, false);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isSidebarOpen]);

  const handleZoomIn = () => {
    if (svgRef.current && zoomRef.current) {
      d3.select(svgRef.current).transition().duration(250).call(zoomRef.current.scaleBy, 1.4);
    }
  };

  const handleZoomOut = () => {
    if (svgRef.current && zoomRef.current) {
      d3.select(svgRef.current).transition().duration(250).call(zoomRef.current.scaleBy, 0.7);
    }
  };

  const handleResetZoom = () => {
    if (svgRef.current && zoomRef.current && containerRef.current) {
      const { width, height } = containerRef.current.getBoundingClientRect();
      const resetTransform = getDefaultTransform(width, height);

      defaultTransformRef.current = resetTransform;
      setDefaultScale(resetTransform.k);

      applyTransform(d3.select(svgRef.current), resetTransform, true, 750);
    }
  };

  const getCleanSVGClone = () => {
    if (!svgRef.current) return null;
    const clone = svgRef.current.cloneNode(true) as SVGSVGElement;
    const innerGroup = clone.querySelector('g');
    if (innerGroup) {
      innerGroup.removeAttribute('transform');
    }
    clone.setAttribute('width', '2690');
    clone.setAttribute('height', '1460');
    clone.setAttribute('viewBox', '30 20 2690 1460');
    return clone;
  };

  const exportSVG = () => {
    const clone = getCleanSVGClone();
    if (!clone) return;
    const svgData = new XMLSerializer().serializeToString(clone);
    const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "montran-world-map.svg";
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportPNG = (scale: number) => {
    const clone = getCleanSVGClone();
    if (!clone) return;
    const svgData = new XMLSerializer().serializeToString(clone);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const img = new Image();
    const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    img.onload = () => {
      const baseWidth = 2690;
      const baseHeight = 1460;
      canvas.width = baseWidth * scale;
      canvas.height = baseHeight * scale;
      
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const pngUrl = canvas.toDataURL("image/png");
        const downloadLink = document.createElement("a");
        downloadLink.href = pngUrl;
        downloadLink.download = `montran-map-${scale}x.png`;
        downloadLink.click();
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  return (
    <div ref={containerRef} className="flex-1 relative bg-white overflow-hidden flex items-center justify-center">
      {/* Header UI */}
      <div className="absolute top-6 right-6 z-40">
        <div className="relative">
          <button 
            onClick={() => setIsExportOpen(!isExportOpen)}
            className={`bg-white border border-slate-200 px-6 h-[72px] rounded-xl flex items-center gap-3 hover:bg-slate-50 transition-all ${isExportOpen ? 'shadow-[0_15px_40px_rgba(0,0,0,0.08)]' : 'shadow-none'}`}
          >
            <span className="text-display-9 font-light text-slate-600">Export</span>
            <svg className={`w-4 h-4 transition-transform ${isExportOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"/></svg>
          </button>
          
          {isExportOpen && (
            <div className="absolute top-full right-0 mt-3 w-80 bg-white border border-slate-100 rounded-xl shadow-[0_15px_40px_rgba(0,0,0,0.08)] overflow-hidden animate-in fade-in slide-in-from-top-2">
              <button 
                onClick={() => { exportSVG(); setIsExportOpen(false); }} 
                className="w-full text-left px-6 py-5 text-display-9 text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-all border-b border-slate-50"
              >
                Download SVG
              </button>
              <div className="px-6 py-4 flex items-center justify-between border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors group">
                <span className="text-display-9 text-slate-600">Download PNG</span>
                <div className="flex gap-1">
                  {[1, 2, 4].map(scale => (
                    <button
                      key={scale}
                      onClick={() => { exportPNG(scale); setIsExportOpen(false); }}
                      className="text-[14px] text-slate-400 font-medium hover:text-slate-900 hover:bg-slate-100 transition-all px-3 py-1.5 rounded-lg border border-transparent hover:border-slate-200"
                    >
                      {scale}x
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer UI */}
      <div className="absolute bottom-6 right-6 z-40 flex items-center gap-3">
      <button
        onClick={() => onToggleGlobalGreen(!isGlobalGreen)}
        className={`h-12 px-4 flex items-center gap-2 rounded-xl border transition-all duration-200 ${
          isGlobalGreen
            ? 'bg-[#009681] border-[#009681] text-white shadow-sm'
            : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-slate-600'
        }`}
        title="Toggle all dots green"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      </button>
      <div className="flex items-center bg-white border border-slate-200 rounded-xl overflow-hidden transition-all duration-300">
        <button 
          onClick={handleZoomOut}
          className="w-12 h-12 flex items-center justify-center text-slate-400 hover:text-slate-900 hover:bg-slate-50 transition-all text-xl font-light border-r border-slate-100"
          aria-label="Zoom Out"
        >
          &minus;
        </button>
        <button 
          onClick={handleResetZoom}
          className="px-5 h-12 flex items-center justify-center text-[14px] font-medium text-slate-500 tabular-nums select-none min-w-[64px] hover:bg-slate-50 hover:text-slate-900 transition-colors cursor-pointer"
          title="Reset to 1x"
        >
          {(zoomScale / defaultScale).toFixed(1)}x
        </button>
        <button 
          onClick={handleZoomIn}
          className="w-12 h-12 flex items-center justify-center text-slate-400 hover:text-slate-900 hover:bg-slate-50 transition-all text-xl font-light border-l border-slate-100"
          aria-label="Zoom In"
        >
          +
        </button>
      </div>
      </div>

      <svg
        ref={svgRef}
        className="w-full h-full map-container"
      >
        <defs>
          <filter id="office-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="12" result="blur" />
            <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0.6 0 0 0 0  0 0 0 0 0  0 0 0 0.5 0" result="glow" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="office-glow-green" x="-800%" y="-800%" width="1700%" height="1700%">
            <feMorphology in="SourceGraphic" operator="dilate" radius="12" result="whiteSrc" />
            <feGaussianBlur in="whiteSrc" stdDeviation="28" result="whiteBlur" />
            <feColorMatrix in="whiteBlur" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.65 0" result="whiteGlow" />
            <feMorphology in="SourceGraphic" operator="dilate" radius="4" result="greenSrc" />
            <feGaussianBlur in="greenSrc" stdDeviation="8" result="greenBlur" />
            <feColorMatrix in="greenBlur" type="matrix" values="0 0 0 0 0.7  0 0 0 0 1  0 0 0 0 0.95  0 0 0 0.7 0" result="greenGlow" />
            <feMerge>
              <feMergeNode in="whiteGlow" />
              <feMergeNode in="greenGlow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g>
          <g id="grid-dots">
            {MAP_DOTS.map((dot, i) => {
              const isActive = isGlobalGreen || activeDotIndices.has(i);
              return (
                <circle
                  key={`dot-${i}`}
                  cx={dot.x}
                  cy={dot.y}
                  r={6}
                  fill={isActive ? "#009681" : "#d5d4d4"}
                  opacity={isActive ? 1 : 0.8}
                  className="grid-dot"
                  style={{ transition: 'fill 150ms ease, opacity 150ms ease' }}
                />
              );
            })}
          </g>
          <g id="offices">
            {allOfficeMarkers.map((office) => {
              const isVisible = activeOfficeCountries.has(office.id);
              const officeColor = isGlobalGreen ? '#0BEAC5' : '#f97316';
              const officeGlow = isGlobalGreen ? 'url(#office-glow-green)' : 'url(#office-glow)';
              return (
                <circle
                  key={office.id}
                  cx={office.snappedX}
                  cy={office.snappedY}
                  r={isVisible ? (isGlobalGreen ? 14.4 : 12) : 6}
                  fill={isVisible ? officeColor : '#d5d4d4'}
                  opacity={isVisible ? 1 : 0}
                  filter={isVisible ? officeGlow : 'none'}
                  style={{
                    stroke: 'none',
                    transition: isVisible
                      ? 'r 200ms ease-out, fill 150ms ease, opacity 100ms ease, filter 150ms ease'
                      : 'r 200ms ease-in, fill 150ms ease 50ms, opacity 150ms ease 100ms, filter 50ms ease',
                  }}
                  pointerEvents={isVisible ? 'auto' : 'none'}
                />
              );
            })}
          </g>
        </g>
      </svg>
    </div>
  );
};

export default MapCanvas;
