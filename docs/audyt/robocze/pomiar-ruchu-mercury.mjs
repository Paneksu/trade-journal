// Pomiar ruchu na demo Mercury (publiczne): transition/animation na wierszach, szufladzie, zakladkach.
import { chromium } from "@playwright/test";
const b = await chromium.launch({ executablePath: process.env.CHROMIUM });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto("https://demo.mercury.com/transactions", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(5000);
const opis = () => p.evaluate(() => {
  const out = {};
  const sel = ["tr", "[role=row]", "button", "a", "[role=tab]", "[role=dialog]", "aside"];
  for (const s of sel) {
    const set = new Set();
    for (const el of [...document.querySelectorAll(s)].slice(0, 60)) {
      const c = getComputedStyle(el);
      if (c.transitionDuration !== "0s" || c.animationName !== "none") set.add(`${c.transitionProperty} ${c.transitionDuration} ${c.transitionTimingFunction} | anim ${c.animationName} ${c.animationDuration}`);
    }
    out[s] = [...set].slice(0, 6);
  }
  return out;
});
console.log(JSON.stringify(await opis(), null, 1));
// klik w wiersz -> szuflada
const wiersz = p.locator("tbody tr, [role=row]").nth(3);
await wiersz.click({ timeout: 5000 }).catch((e) => console.log("klik:", e.message.slice(0, 80)));
const probki = [];
for (let i = 0; i < 6; i++) {
  probki.push(await p.evaluate(() => {
    const d = document.querySelector("[role=dialog], aside, [data-state=open]");
    if (!d) return null;
    const c = getComputedStyle(d); const r = d.getBoundingClientRect();
    return { tag: d.tagName, x: Math.round(r.x), op: c.opacity, tr: c.transform, anim: c.animationName + " " + c.animationDuration + " " + c.animationTimingFunction, trn: c.transitionProperty + " " + c.transitionDuration + " " + c.transitionTimingFunction };
  }));
  await p.waitForTimeout(60);
}
console.log(JSON.stringify(probki, null, 1));
console.log(JSON.stringify(await p.evaluate(() => document.getAnimations().map((a) => ({ n: a.animationName || a.transitionProperty, d: a.effect?.getTiming().duration, e: a.effect?.getTiming().easing }))), null, 1));
await b.close();
