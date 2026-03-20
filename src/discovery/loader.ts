import { readFileSync } from "fs";
import { join } from "path";

export interface Endpoint {
  method: string;
  path: string;
  description: string;
  payment: {
    intent?: string;
    amount?: string;
    decimals?: number;
  };
}

export interface Service {
  id: string;
  name: string;
  service_url: string;
  description: string;
  categories: string[];
  tags: string[];
  endpoints: Endpoint[];
}

// Resolve relative to this file — works with both tsx and compiled JS
const servicesPath = join(__dirname, "services.json");

export function loadServices(): Service[] {
  const raw = readFileSync(servicesPath, "utf-8");
  const services: Service[] = JSON.parse(raw);
  return services;
}
