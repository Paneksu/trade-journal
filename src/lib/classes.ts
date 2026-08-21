import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Laczy klasy i rozstrzyga konflikty Tailwinda (ostatnia wygrywa). */
export function cx(...classes: ClassValue[]): string {
  return twMerge(clsx(classes));
}
