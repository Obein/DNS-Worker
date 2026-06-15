export interface DestinationItem {
  country_code: string;
  country: string;
  count: number;
}

export interface CountryMapData {
  count: number;
  name: string;
  countryCode: string;
}

export interface HoveredCountry {
  name: string;
  code: string;
  count: number;
  flag: string;
  x: number;
  y: number;
}
