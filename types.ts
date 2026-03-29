
export enum SidebarTab {
  OFFICES = 'Offices',
  COUNTRIES = 'Countries'
}

export interface OfficeLocation {
  id: string;
  name: string;
  address: string;
  region: string;
  lat: number;
  lng: number;
}

export interface MapPoint {
  x: number;
  y: number;
}
