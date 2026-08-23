-- Kwota z rachunku brokera jako wynik trade'a (ADR-016). Do tej pory pole w
-- formularzu tylko wyliczalo cene wyjscia, a roznica miedzy kwota a siatka
-- tickow ginela przy zapisie - NQ ma tick 5 USD, wiec 116 USD zapisywalo sie
-- jako 117 USD. Teraz kwota, gdy podana, laduje w "pnl" i to ona idzie do
-- statystyk; ta kolumna trzyma slad, ze wynik pochodzi z rachunku.
-- Bez backfillu: stare trade'y maja NULL i zachowuja swoj wynik z tickow.

ALTER TABLE "trades" ADD COLUMN "broker_amount" bigint;
