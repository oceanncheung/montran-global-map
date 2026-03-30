
export enum SidebarTab {
  OFFICES = 'Offices',
  COUNTRIES = 'Region'
}

export interface OfficeLocation {
  id: string;
  name: string;
  address: string;
  region: string;
  country: string;
  markerAnchor?: boolean;
  markerDotIndex?: number;
  lat: number;
  lng: number;
}

export interface MapPoint {
  x: number;
  y: number;
}
