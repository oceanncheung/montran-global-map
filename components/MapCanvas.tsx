
import React, { useRef, useEffect, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { geoToPixel } from '../utils/geo';
import { OfficeLocation } from '../types';
import { MAP_DOTS, MONTRAN_OFFICES } from '../constants';
import { MANUAL_MAPPINGS } from '../utils/mappings';

interface MapCanvasProps {
  selectedOffices: OfficeLocation[];
  selectedCountries: string[];
}

const DEFAULT_ZOOM = 0.8;

const MapCanvas: React.FC<MapCanvasProps> = ({
  selectedOffices,
  selectedCountries
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const currentTransformRef = useRef<d3.ZoomTransform | null>(null);
  const defaultTransformRef = useRef<d3.ZoomTransform | null>(null);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [zoomScale, setZoomScale] = useState(DEFAULT_ZOOM);

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

  const snappedOfficeMarkers = useMemo(() => {
    const dotsWithIndices = MAP_DOTS.map((dot, index) => ({ ...dot, index }));
    const selectedCountries = Array.from(new Set(selectedOffices.map((office) => office.country)));

    return selectedCountries.map((country) => {
      const anchorOffice =
        MONTRAN_OFFICES.find((office) => office.country === country && office.markerAnchor) ??
        MONTRAN_OFFICES.find((office) => office.country === country) ??
        selectedOffices.find((office) => office.country === country);

      const target = geoToPixel(anchorOffice?.lat ?? 0, anchorOffice?.lng ?? 0);
      const countryDotIndices = MANUAL_MAPPINGS[country];
      const candidateDots = countryDotIndices?.length
        ? countryDotIndices
            .map((index) => ({ index, ...MAP_DOTS[index] }))
            .filter((dot) => Number.isFinite(dot.x) && Number.isFinite(dot.y))
        : dotsWithIndices;

      const chosenDot = candidateDots
        .map((dot) => ({
          ...dot,
          distance: Math.hypot(dot.x - target.x, dot.y - target.y),
        }))
        .sort((a, b) => a.distance - b.distance)[0];

      return {
        id: country,
        snappedX: chosenDot?.x ?? 0,
        snappedY: chosenDot?.y ?? 0,
      };
    });
  }, [selectedOffices]);

  const transformsMatch = (a: d3.ZoomTransform | null, b: d3.ZoomTransform | null) => {
    if (!a || !b) return false;

    return (
      Math.abs(a.x - b.x) < 0.01 &&
      Math.abs(a.y - b.y) < 0.01 &&
      Math.abs(a.k - b.k) < 0.001
    );
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

    const updateCentering = () => {
      if (!containerRef.current || !zoomRef.current) return;
      const { width, height } = containerRef.current.getBoundingClientRect();
      const initialScale = DEFAULT_ZOOM;
      
      const tx = (width - 2600 * initialScale) / 2;
      const ty = (height - 1450 * initialScale) / 2;
      const nextDefaultTransform = d3.zoomIdentity.translate(tx, ty).scale(initialScale);
      const shouldRecenter =
        !currentTransformRef.current ||
        transformsMatch(currentTransformRef.current, defaultTransformRef.current);

      defaultTransformRef.current = nextDefaultTransform;

      if (shouldRecenter) {
        svg.call(zoom.transform, nextDefaultTransform);
      }
    };

    updateCentering();
    window.addEventListener('resize', updateCentering);
    return () => window.removeEventListener('resize', updateCentering);
  }, []);

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
      const targetScale = DEFAULT_ZOOM;
      const tx = (width - 2600 * targetScale) / 2;
      const ty = (height - 1450 * targetScale) / 2;
      const resetTransform = d3.zoomIdentity.translate(tx, ty).scale(targetScale);

      defaultTransformRef.current = resetTransform;

      d3.select(svgRef.current)
        .transition()
        .duration(750)
        .ease(d3.easeCubicOut)
        .call(zoomRef.current.transform, resetTransform);
    }
  };

  const getCleanSVGClone = () => {
    if (!svgRef.current) return null;
    const clone = svgRef.current.cloneNode(true) as SVGSVGElement;
    const innerGroup = clone.querySelector('g');
    if (innerGroup) {
      innerGroup.removeAttribute('transform');
    }
    clone.setAttribute('width', '2600');
    clone.setAttribute('height', '1450');
    clone.setAttribute('viewBox', '0 0 2600 1450');
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
      const baseWidth = 2600;
      const baseHeight = 1450;
      canvas.width = baseWidth * scale;
      canvas.height = baseHeight * scale;
      
      if (ctx) {
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
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
      <div className="absolute bottom-6 right-6 z-40 flex items-center bg-white border border-slate-200 rounded-xl overflow-hidden transition-all duration-300">
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
          {(zoomScale / DEFAULT_ZOOM).toFixed(1)}x
        </button>
        <button 
          onClick={handleZoomIn}
          className="w-12 h-12 flex items-center justify-center text-slate-400 hover:text-slate-900 hover:bg-slate-50 transition-all text-xl font-light border-l border-slate-100"
          aria-label="Zoom In"
        >
          +
        </button>
      </div>

      <svg
        ref={svgRef}
        viewBox="0 0 2600 1450"
        className="w-full h-full map-container"
      >
        <g>
          <g id="grid-dots">
            {MAP_DOTS.map((dot, i) => {
              const isActive = activeDotIndices.has(i);
              return (
                <circle
                  key={`dot-${i}`}
                  cx={dot.x}
                  cy={dot.y}
                  r={6}
                  fill={isActive ? "#009681" : "#d5d4d4"}
                  opacity={isActive ? 1 : 0.8}
                  className="grid-dot"
                />
              );
            })}
          </g>
          <g id="offices">
            {snappedOfficeMarkers.map((office) => (
              <circle
                key={office.id}
                cx={office.snappedX}
                cy={office.snappedY}
                r={12} 
                fill="#f97316"
                style={{ stroke: 'none' }}
                className="transition-transform duration-300 transform-gpu"
              />
            ))}
          </g>
        </g>
      </svg>
    </div>
  );
};

export default MapCanvas;
