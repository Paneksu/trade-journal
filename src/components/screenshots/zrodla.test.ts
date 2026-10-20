import { describe, expect, it } from "vitest";

import { zrodlaZrzutu } from "./zrodla";

describe("zrodla obrazu zrzutu (srcset miniatura + pelny plik)", () => {
  it("szeroki zrzut: miniatura 560w i pelny plik w swojej szerokosci, sizes auto z zapasem", () => {
    const r = zrodlaZrzutu({ file: "9/a.webp", thumbnail: "9/a-mini.webp", width: 2706 }, "50vw");
    expect(r.src).toBe("/api/screenshots/9/a-mini.webp");
    expect(r.srcSet).toBe("/api/screenshots/9/a-mini.webp 560w, /api/screenshots/9/a.webp 2706w");
    expect(r.sizes).toBe("auto, 50vw");
  });

  it("bez miniatury albo bez szerokosci: sam pelny plik (ostry)", () => {
    expect(zrodlaZrzutu({ file: "9/a.webp", thumbnail: null, width: 2706 }, "50vw")).toEqual({ src: "/api/screenshots/9/a.webp" });
    expect(zrodlaZrzutu({ file: "9/a.webp", thumbnail: "9/a-mini.webp", width: null }, "50vw")).toEqual({ src: "/api/screenshots/9/a.webp" });
  });

  it("obraz nie szerszy niz miniatura: miniatura wystarcza", () => {
    expect(zrodlaZrzutu({ file: "9/a.webp", thumbnail: "9/a-mini.webp", width: 400 }, "50vw")).toEqual({ src: "/api/screenshots/9/a-mini.webp" });
  });
});
