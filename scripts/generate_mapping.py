
import json
import re
import requests
import os
import sys

# ------------------------------------------------------------------
# SETUP & DEPENDENCIES
# ------------------------------------------------------------------
# This script requires 'requests' and 'shapely'.
# Run: pip install requests shapely

try:
    from shapely.geometry import Point, shape
    from shapely.prepared import prep
except ImportError:
    print("Error: 'shapely' library not found.")
    print("Please install it running: pip install shapely requests")
    sys.exit(1)

# ------------------------------------------------------------------
# CONFIGURATION
# ------------------------------------------------------------------
GEOJSON_URL = 'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson'

def get_project_root():
    """Resolves the project root directory assuming this script is in /scripts/"""
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def parse_geo_constants():
    """Parses projection constants from utils/geo.ts to ensure sync with frontend."""
    root = get_project_root()
    file_path = os.path.join(root, 'utils', 'geo.ts')
    
    # Defaults in case file parsing fails
    constants = {
        'X_SCALE': 7.26,
        'Y_SCALE': 9.10,
        'X_OFFSET': 1310,
        'Y_OFFSET': 930
    }

    if not os.path.exists(file_path):
        print(f"Warning: {file_path} not found. Using hardcoded defaults.")
        return constants
        
    print(f"Reading constants from {file_path}...")
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
        
    # Regex to find const NAME = VALUE;
    for key in constants.keys():
        match = re.search(fr'const\s+{key}\s*=\s*([\d\.]+);', content)
        if match:
            constants[key] = float(match.group(1))
            
    return constants

# Load constants globally for the pixel_to_geo function
GEO_CONSTANTS = parse_geo_constants()

def pixel_to_geo(x, y):
    """
    Inverse projection from Canvas Pixels to Lat/Lng.
    Uses parsed constants from utils/geo.ts
    """
    x_scale = GEO_CONSTANTS['X_SCALE']
    y_scale = GEO_CONSTANTS['Y_SCALE']
    x_offset = GEO_CONSTANTS['X_OFFSET']
    y_offset = GEO_CONSTANTS['Y_OFFSET']
    
    lng = (x - x_offset) / x_scale
    lat = (y_offset - y) / y_scale # Inverted Y logic
    return lat, lng

def parse_map_dots():
    """Parses MAP_DOTS from constants.tsx using regex."""
    root = get_project_root()
    file_path = os.path.join(root, 'constants.tsx')
    
    if not os.path.exists(file_path):
        print(f"Error: constants.tsx not found at {file_path}")
        sys.exit(1)

    print(f"Reading {file_path}...")
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Find the array content: export const MAP_DOTS: MapPoint[] = [ ... ];
    # Use non-greedy match to find the array content
    match = re.search(r'export const MAP_DOTS: MapPoint\[\]\s*=\s*\[(.*?)\];', content, re.DOTALL)
    if not match:
        # Fallback regex in case type annotation is missing
        match = re.search(r'export const MAP_DOTS\s*=\s*\[(.*?)\];', content, re.DOTALL)
        
    if not match:
        print("Error: Could not find MAP_DOTS array in constants.tsx")
        sys.exit(1)

    array_content = match.group(1)
    
    # Extract coordinates. Supports {x:123, y:456}
    dot_pattern = re.compile(r'\{\s*x\s*:\s*([\d\.-]+)\s*,\s*y\s*:\s*([\d\.-]+)\s*\}')
    
    dots = []
    for i, m in enumerate(dot_pattern.finditer(array_content)):
        dots.append({
            'index': i,
            'x': float(m.group(1)),
            'y': float(m.group(2))
        })
    
    print(f"Parsed {len(dots)} dots from constants.tsx")
    return dots

def fetch_geojson():
    """Downloads GeoJSON data."""
    print(f"Downloading GeoJSON from {GEOJSON_URL}...")
    try:
        resp = requests.get(GEOJSON_URL)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"Error downloading GeoJSON: {e}")
        sys.exit(1)

def main():
    print("--- Montran Map Showcase: Lookup Generator ---")
    
    # 1. Load Data
    dots = parse_map_dots()
    if not dots:
        print("No dots found.")
        return

    geo_data = fetch_geojson()

    # 2. Prepare Geometry
    print("Preparing country geometries...")
    countries = {}
    
    for feature in geo_data['features']:
        props = feature['properties']
        name = props.get('ADMIN') or props.get('name') or props.get('NAME')
        if not name:
            continue
        
        try:
            geom = shape(feature['geometry'])
            countries[name] = {
                'geom': geom,
                'prepared': prep(geom)
            }
        except Exception:
            continue

    print(f"Prepared {len(countries)} countries.")
    print("Performing spatial join (this may take a minute)...")

    # 3. Spatial Join
    mapping = {} 
    dots_matched = 0
    
    for dot in dots:
        lat, lng = pixel_to_geo(dot['x'], dot['y'])
        p = Point(lng, lat)
        
        for name, data in countries.items():
            if data['prepared'].contains(p):
                if name not in mapping:
                    mapping[name] = []
                mapping[name].append(dot['index'])
                dots_matched += 1
                break 
    
    print(f"Finished. Matched {dots_matched} out of {len(dots)} dots to countries.")

    # 4. Inject into utils/mappings.ts
    mappings_path = os.path.join(get_project_root(), 'utils', 'mappings.ts')
    
    print(f"Reading target file {mappings_path}...")
    if not os.path.exists(mappings_path):
        print(f"Error: {mappings_path} does not exist. Please ensure the project structure is correct.")
        sys.exit(1)
        
    with open(mappings_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Create the new dictionary content
    lines = []
    # Sort for deterministic output
    for country in sorted(mapping.keys()):
        indices = sorted(mapping[country])
        # formatting as "Country": [1, 2, 3],
        lines.append(f'  "{country}": {json.dumps(indices)},')
    
    # Construct the replacement block
    new_decl = "export const MANUAL_MAPPINGS: CountryDotMap = {\n" + "\n".join(lines) + "\n};"
    
    # Regex: replace everything inside export const MANUAL_MAPPINGS: CountryDotMap = { ... };
    # We use re.DOTALL so . matches newlines
    pattern = r'export const MANUAL_MAPPINGS: CountryDotMap\s*=\s*\{.*?\};'
    
    if not re.search(pattern, content, re.DOTALL):
        print("Error: Could not find 'export const MANUAL_MAPPINGS: CountryDotMap = { ... };' in mappings.ts")
        print("Please ensure utils/mappings.ts has the MANUAL_MAPPINGS export defined.")
        sys.exit(1)
        
    new_content = re.sub(pattern, new_decl, content, flags=re.DOTALL)
    
    print(f"Updating {mappings_path}...")
    with open(mappings_path, 'w', encoding='utf-8') as f:
        f.write(new_content)
        
    print(f"Successfully injected mappings for {len(mapping)} countries.")
    print("You can now build the frontend without runtime calculation.")

if __name__ == "__main__":
    main()
