/**
 * Typy dla `heic-decode` (pakiet bez wlasnych typow). Uzywamy wylacznie `all`: pozwala odczytac
 * wymiary PRZED dekodowaniem, wiec bomba dekompresyjna (obraz o gigantycznych wymiarach)
 * odpada, zanim alokujemy bufor RGBA.
 */
declare module "heic-decode" {
  type ObrazHeic = {
    width: number;
    height: number;
    decode: () => Promise<{ width: number; height: number; data: Uint8ClampedArray }>;
  };
  type ListaObrazow = ObrazHeic[] & { dispose: () => void };
  const decode: {
    (opcje: { buffer: Uint8Array }): Promise<{ width: number; height: number; data: Uint8ClampedArray }>;
    all(opcje: { buffer: Uint8Array }): Promise<ListaObrazow>;
  };
  export default decode;
}
