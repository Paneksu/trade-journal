# Spis playlisty mentora: PB Trading Theory Series

Faza 4b, STOP 1. Sam spis, nic nie pobrane ani nie transkrybowane. Stan na 14.10.2026, źródło: `python -m yt_dlp --flat-playlist -J` (PRZETESTOWANE).

- Playlista: **PB TRADING THEORY SERIES** (https://www.youtube.com/playlist?list=PLVekzd813DFAB_ZFpIQHSXkdhou3Yxl-_)
- Kanał: **PB Trading** (wszystkie filmy z tego samego kanału)
- Liczba filmów: **24**
- Łączny czas: **10:51:52** (39112 s, średnio 27:09 na film; najkrótszy 11:12, najdłuższy 1:08:23)

Kolejność jak na playliście. Sądząc po samych tytułach (WYWNIOSKOWANE), sporo odcinków to nastawienie i psychika (np. 3, 5, 7, 12, 14, 16), a technika ICT jest w 4, 6, 8, 11, 13, 15, 17, 18, 19, 21, 23.

| nr | ID | tytuł | długość | napisy |
|---|---|---|---|---|
| 1 | 4ft3bah5B4A | How I Achieved A 94% Win Rate (NEW STRATEGY) | 1:08:23 | tylko automatyczne: en-orig (ASR), pl i inne auto-tłumaczone |
| 2 | ctCabW_3hwc | Backtesting My 70% Win Rate Strategy | 35:20 |  |
| 3 | UjfHucsJhFQ | you are scared to change | 15:44 |  |
| 4 | DjR1Do8qEis | How To Trade NEWS: PB Theory | 36:31 |  |
| 5 | n0ylmte1Fc0 | WORK IN SILENCE: PB Theory | 16:19 |  |
| 6 | ldk75nOYOrI | The FASTEST Setup: PB Theory | 21:45 |  |
| 7 | jk3kXFSOjDI | Be Yourself. Don't Compare: PB Theory | 14:56 |  |
| 8 | 9J5FkRyKtT0 | REACT, Don't PREDICT Market: PB Theory | 31:52 |  |
| 9 | V9TZfY2Okn0 | How To Journal: PB Theory | 18:55 |  |
| 10 | Uj6yXhPqTIg | How To Handle Losses: PB Theory | 15:00 |  |
| 11 | 75PiRQjxpQI | How To Set CONDITIONS: PB Theory | 21:52 |  |
| 12 | Na-rJyMP6cg | Be Proud Of Yourself: PB Theory | 11:12 | tylko automatyczne: en-orig (ASR), pl i inne auto-tłumaczone |
| 13 | FfFt0L-NyDI | Mastering Inverse Fair Value Gaps: PB Theory | 26:47 |  |
| 14 | 01nfxVrUUMg | Taking A Break From Trading: PB Theory | 16:49 |  |
| 15 | AApR1hq6QQA | How I Use SMT: PB Theory | 39:51 |  |
| 16 | kadjhG_Zwog | Do It For Yourself: PB Theory | 15:19 |  |
| 17 | 9v86nWvCjiQ | The ONLY Way to Find A+ Setups: PB Theory | 38:02 | tylko automatyczne: en-orig (ASR), pl i inne auto-tłumaczone |
| 18 | Lk__ieM8CoQ | Risk Management: PB Theory | 27:25 |  |
| 19 | IfQ-38IED04 | Market Liquidity: PB Theory | 44:13 |  |
| 20 | potaGzMlLn4 | How To Master Day Trading (EP. 5: Winning Systems) | 14:36 |  |
| 21 | izEssD26q0Q | Inverse Fair Value Gaps: PB Theory | 44:09 |  |
| 22 | yndmOH6Cwl8 | Everything Is Probability: PB Theory | 20:51 |  |
| 23 | UlErFycqm4c | Fair Value Gaps: PB Theory | 28:04 |  |
| 24 | WGCHek-rSNY | The Truth About Trading: PB Theory | 27:57 |  |

## Napisy (sprawdzone 3 z 24)

Sprawdzone `--list-subs --skip-download` dla filmów 12 (krótki), 17 (średni) i 1 (najdłuższy), PRZETESTOWANE:

- **Napisów ręcznych brak** we wszystkich trzech ("has no subtitles").
- **Automatyczne są**: `en-orig` (oryginalne rozpoznawanie mowy YouTube, po angielsku) oraz ok. 150 auto-tłumaczeń, w tym `en` i `pl`. Tłumaczenie `pl` powstaje maszynowo z `en-orig`, więc źródłem do transkrypcji powinno być `en-orig`.
- Pozostałych 21 filmów nie sprawdzano. WYWNIOSKOWANE: ten sam kanał i ten sam układ we wszystkich trzech próbkach, więc pozostałe najpewniej też mają tylko napisy automatyczne.
- yt-dlp ostrzega o braku środowiska JavaScript (deno). Na listę napisów to nie wpłynęło, ale przy pobieraniu audio pod whisper może brakować części formatów.

## Szacunek czasu transkrypcji

- **Napisy automatyczne (`--write-auto-subs --sub-langs en-orig --skip-download`)**: Szacunek: kilka sekund na film, łącznie ok. 2 do 5 minut na 24 filmy z przerwami między żądaniami, żeby nie dostać 429. Jakość: ASR YouTube, bez interpunkcji, terminy ICT (FVG, SMT, IFVG) mogą być przekręcone.
- **Whisper lokalnie** (wzór z mozg-treningowy: faster-whisper, CPU, int8, model small.en): czas zależy od długości, a tu jest 10:51:52 nagrań. Szacunek: przy 3 do 6 razy szybciej niż czas rzeczywisty to ok. 2 do 4 godzin samej transkrypcji, plus pobranie audio (ok. 0,5 GB w mp3, kilka do kilkunastu minut). Większy model (medium/large) da lepsze terminy, ale na CPU będzie kilka razy wolniejszy, wtedy raczej 8 godzin i więcej.
- Rozsądna kolejność: najpierw napisy `en-orig` dla wszystkich (szybko), whisper tylko dla odcinków technicznych, w których napisy okażą się słabe.
