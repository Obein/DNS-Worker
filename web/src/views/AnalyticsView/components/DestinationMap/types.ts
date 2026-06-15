export interface DestinationItem {
  dest_geoip: string;
  count: number;
}

export interface CountryMapData {
  count: number;
  name: string;
  countryCode: string;
  isps: { name: string; count: number }[];
}

export interface HoveredCountry {
  name: string;
  code: string;
  count: number;
  flag: string;
  x: number;
  y: number;
  isps?: { name: string; count: number }[];
}
