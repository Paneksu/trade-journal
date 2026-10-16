import { SzkieletStrony } from "@/components/layout/szkielet-strony";

/* Szkielet zamiast pustki przy wczytywaniu (runda r2). Tylko na ekranach do czytania: na ekranach z formularzami
   strumieniowanie pokazywało pola przed hydratacją, a wpis przed hydratacją przepadał (e2e 16.10.2026). */
export default SzkieletStrony;
