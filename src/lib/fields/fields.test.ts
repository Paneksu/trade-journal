import { describe, expect, it } from "vitest";

import {
  cleanValues,
  fieldsForScope,
  fieldsSchema,
  formatValue,
  readFromForm,
  toKey,
  validateValues,
  type FieldDef,
} from "./fields";

function field(n: Partial<FieldDef> = {}): FieldDef {
  return {
    id: 1,
    key: "nastroj",
    label: "Nastroj",
    type: "select",
    options: [{ value: "spokoj" }, { value: "presja" }],
    min: null,
    max: null,
    unit: null,
    hint: null,
    required: false,
    inTable: true,
    inStats: true,
    scope: "both",
    sortOrder: 10,
    archived: false,
    ...n,
  };
}

describe("validateValues", () => {
  it("przepuszcza wartosc ze slownika", () => {
    expect(validateValues([field()], { nastroj: "spokoj" })).toEqual([]);
  });

  it("odrzuca wartosc spoza slownika", () => {
    const errors = validateValues([field()], { nastroj: "euforia" });
    expect(errors).toHaveLength(1);
    expect(errors[0].key).toBe("nastroj");
  });

  it("wymaga wypelnienia pola oznaczonego jako wymagane", () => {
    const errors = validateValues([field({ required: true })], {});
    expect(errors[0].message).toContain("wymagane");
  });

  it("puste pole nieobowiazkowe nie jest bledem", () => {
    expect(validateValues([field()], {})).toEqual([]);
  });

  it("pilnuje zakresu liczby", () => {
    const p = field({ key: "ryzyko", label: "Ryzyko", type: "number", min: "0", max: "5" });
    expect(validateValues([p], { ryzyko: 3 })).toEqual([]);
    expect(validateValues([p], { ryzyko: 9 })).toHaveLength(1);
  });

  it("pilnuje skali oceny", () => {
    const p = field({ key: "ocena", type: "rating", options: [] });
    expect(validateValues([p], { ocena: 5 })).toEqual([]);
    expect(validateValues([p], { ocena: 6 })).toHaveLength(1);
  });

  it("lista wielokrotnego wyboru odrzuca obca wartosc", () => {
    const p = field({ key: "bledy", type: "multiselect", options: [{ value: "za wczesnie" }] });
    expect(validateValues([p], { bledy: ["za wczesnie"] })).toEqual([]);
    expect(validateValues([p], { bledy: ["cokolwiek"] })).toHaveLength(1);
  });
});

describe("readFromForm", () => {
  it("zamienia tekst na liczbe i akceptuje przecinek dziesietny", () => {
    const data = new FormData();
    data.set("field__ryzyko", "1,5");
    const p = field({ key: "ryzyko", type: "number" });
    expect(readFromForm([p], data)).toEqual({ ryzyko: 1.5 });
  });

  it("zbiera wszystkie zaznaczenia listy wielokrotnej", () => {
    const data = new FormData();
    data.append("field__bledy", "za wczesnie");
    data.append("field__bledy", "za duzo");
    const p = field({ key: "bledy", type: "multiselect" });
    expect(readFromForm([p], data)).toEqual({ bledy: ["za wczesnie", "za duzo"] });
  });

  it("pole tak/nie ma trzy stany", () => {
    const p = field({ key: "plan", type: "bool" });

    const nie = new FormData();
    nie.set("field__plan", "false");
    expect(readFromForm([p], nie)).toEqual({ plan: false });

    const tak = new FormData();
    tak.set("field__plan", "true");
    expect(readFromForm([p], tak)).toEqual({ plan: true });

    const puste = new FormData();
    puste.set("field__plan", "");
    expect(readFromForm([p], puste)).toEqual({});
  });

  it("pomija puste pola tekstowe", () => {
    const data = new FormData();
    data.set("field__nastroj", "   ");
    expect(readFromForm([field()], data)).toEqual({});
  });
});

describe("fieldsSchema", () => {
  it("wycina klucze po polach, ktorych juz nie ma", () => {
    const result = fieldsSchema([field()]).parse({ nastroj: "spokoj", stare_pole: "cos" });
    expect(result).toEqual({ nastroj: "spokoj" });
  });
});

describe("cleanValues", () => {
  it("usuwa wartosci nieznanych i pustych pol", () => {
    expect(cleanValues([field()], { nastroj: "spokoj", inne: "x", puste: "" })).toEqual({
      nastroj: "spokoj",
    });
  });
});

describe("fieldsForScope", () => {
  it("do backtestu nie trafiaja pola przypisane tylko do dziennika", () => {
    const fields = [
      field({ id: 1, key: "a", scope: "trade" }),
      field({ id: 2, key: "b", scope: "backtest" }),
      field({ id: 3, key: "c", scope: "both" }),
    ];
    expect(fieldsForScope(fields, true).map((p) => p.key)).toEqual(["b", "c"]);
    expect(fieldsForScope(fields, false).map((p) => p.key)).toEqual(["a", "c"]);
  });

  it("pomija pola zarchiwizowane", () => {
    expect(fieldsForScope([field({ archived: true })], false)).toEqual([]);
  });
});

describe("toKey", () => {
  it("robi z polskiej nazwy bezpieczny klucz", () => {
    expect(toKey("Nastrój przed wejściem")).toBe("nastroj_przed_wejsciem");
    expect(toKey("Jakość  wejścia!")).toBe("jakosc_wejscia");
    expect(toKey("Łatwość")).toBe("latwosc");
  });
});

describe("formatValue", () => {
  it("pokazuje przelacznik po polsku", () => {
    expect(formatValue(field({ type: "bool" }), true)).toBe("tak");
    expect(formatValue(field({ type: "bool" }), false)).toBe("nie");
  });

  it("dokleja jednostke do liczby", () => {
    expect(formatValue(field({ type: "number", unit: "pkt" }), 12)).toBe("12 pkt");
  });

  it("brak wartosci pokazuje jako kreske", () => {
    expect(formatValue(field(), null)).toBe("—");
  });
});
