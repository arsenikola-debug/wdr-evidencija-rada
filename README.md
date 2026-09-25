# WDR web — Dnevna evidencija (React)

Prva proizvodna površina: **DAILY ENTRY**. Finansijsko odobrenje i BA dashboard
nisu implementirani i ne treba ih započinjati pre pregleda ovog toka.

Stack: Vite 5 + React 18 + TypeScript (strict) + React Router 6 + Vitest.
Bez state-management biblioteke i bez UI framework-a — grid je jedini složen
ekran i pisan je namerno bez posrednika.

---

## Ključno pravilo

**Obračun se ne reprodukuje u TypeScript-u.** Pregledač formatira brojeve
(`Intl.NumberFormat`), ali svaka stopa, iznos, alokacija po centru i rezultat
validacije dolaze iz PostgreSQL-a kroz `api.*` RPC-ove. Ne postoji nijedna
funkcija koja množi stopu i količinu na klijentu.

---

## Brzi start (bez baze)

```bash
cd web
cp .env.example .env.local     # VITE_WDR_API=mock je već podešeno
npm install
npm run dev                    # http://localhost:5173
```

Prijava u mock režimu: bilo koja e-adresa sa `@` i šifra od 4+ znaka
(predpopunjeno `operater@wdr.local` / `mock1234`).

Mock adapter reprodukuje ponašanje prave baze **prvog dana**: nijedno pravilo
obračuna nije konfigurisano, pa ekran pregleda vraća `MISSING_RULE` za svaku
novčanu liniju i `can_submit = false`. Da bi se videla i „kompletna" putanja:

```bash
VITE_WDR_MOCK_RATES=demo npm run dev
```

Te stope su DEMO vrednosti iz mock adaptera, obeležene su u zaglavlju aplikacije
i **nisu seed podaci**. Baza i dalje nema ni jedno finansijsko pravilo.

## Povezivanje na pravi Supabase projekat

```bash
# .env.local
VITE_WDR_API=supabase
VITE_SUPABASE_URL=https://<PROJECT-REF>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-public-key>
VITE_WDR_API_SCHEMA=api
```

Uslovi na strani baze:

1. Sve migracije (`0001`–`0016`) primenjene.
2. Dashboard → Project Settings → API → **Exposed schemas = `public, api`**.
   `app` se **ne** izlaže (`docs/API-SURFACE.md`).
3. Korisnik postoji u `auth.users`, ima red u `public.profiles`, dodeljenu rolu
   i red u `user_center_access` za svoj centar.
4. Administrator je otvorio `submission_periods` + `period_submissions` za taj
   centar, inače `/unos` prikazuje „Nema otvorenog perioda".

`SERVICE_ROLE_KEY` se ne koristi i ne sme se naći u ovom projektu — ima
`BYPASSRLS` i obesmislio bi svaku politiku.

---

## Komande

| Komanda | Šta radi |
|---|---|
| `npm run dev` | dev server na 5173 |
| `npm run build` | `tsc -b` + produkcijski build u `dist/` |
| `npm run preview` | serviranje `dist/` |
| `npm run typecheck` | samo type-check |
| `npm test` | Vitest (90 testova) |

---

## Struktura

```
web/
├─ index.html
├─ vite.config.ts            Vite + Vitest konfiguracija
├─ src/
│  ├─ main.tsx               bootstrap + BrowserRouter
│  ├─ App.tsx                rute i role-aware zaštita
│  ├─ styles.css             desktop-first CSS, sticky grid, stanja ćelija
│  ├─ lib/
│  │  ├─ api/
│  │  │  ├─ types.ts         TS tipovi SVIH RPC kontrakata (1:1 sa docs/RPC-CONTRACTS.md)
│  │  │  ├─ WdrApi.ts        interfejs — jedina granica koju komponente znaju
│  │  │  ├─ supabaseApi.ts   PostgREST adapter (api.* RPC + public tabele pod RLS)
│  │  │  ├─ mockApi.ts       in-memory adapter, ISTI interfejs
│  │  │  └─ index.ts         factory po VITE_WDR_API
│  │  └─ auth/AuthProvider.tsx   sesija, permisije, pristup centrima
│  ├─ features/grid/
│  │  ├─ model.ts            CellView, indeks ćelija, formatiranje datuma
│  │  ├─ cellState.ts        dirty/saving/saved/error mašina
│  │  ├─ completion.ts       očekivani dani i kompletnost (docs/GRID-UX.md)
│  │  ├─ selection.ts        anchor/focus pravougaonik, kretanje
│  │  ├─ bulk.ts             grupne akcije, kopiranje dana/nedelje
│  │  ├─ keyboard.ts         mapiranje tastera u akcije
│  │  ├─ errors.ts           kod baze → srpska poruka
│  │  ├─ useAutosave.ts      debounce + red čekanja
│  │  └─ useGrid.ts          orkestracija
│  ├─ components/            GridTable, GridToolbar, AssistanceDialog, Layout, Bits
│  └─ routes/                Login, Home, DailyEntry, Preview, MySubmissions, Notifications, RequireAuth
└─ tests/                    8 fajlova, 77 testova
```

### Zašto mock i Supabase imaju isti interfejs

`WdrApi` je jedini tip koji komponente uvoze. Prelazak sa mock-a na Supabase je
promena jedne env varijable — nijedna komponenta se ne dira. To je i uslov koji
je klijent postavio za razvojni mock.

---

## Rute

| Ruta | Ekran | Potrebna permisija |
|---|---|---|
| `/login` | prijava | — |
| `/` | početna, pregled centara i prečice | prijavljen |
| `/unos` | **Daily Entry grid** | `entry.view` |
| `/unos/pregled` | pregled pre slanja | `entry.view` |
| `/moje-prijave` | statusi perioda | `period.view_status` |
| `/finansije` | **red za odobrenje** (filteri, trajanje čekanja, rekapitulacija) | `finance.queue.view` |
| `/finansije/prijava` | detalj obračuna, `ODOBRI` / `VRATI NA ISPRAVKU` | `finance.queue.view` |
| `/dodatni-zahtevi` | **Moji dodatni zahtevi** + novi zahtev sa izračunatim predlogom | `adjustment.create` |
| `/finansije/dodatni-zahtevi` | red korekcija, `Odobri` / `Vrati na ispravku` / `Odbij` | `adjustment.approve` |
| `/administracija` | **Administracija**: centri, smene, statusi, vrste isplata, pravila naknada, prevoz, radni kalendar, korisnici | `centers.manage` |
| `/analitika` | **BA analitika** — KPI, trend, centri, struktura troška | `analytics.ba.view` |
| `/kontrolni-centar` | **Kontrolni centar** — odstupanja, nalazi, odluke | `controls.view` |
| `/analitika/dnevno` | dnevna serija po datumu rada | `analytics.ba.view` |
| `/analitika/zaposleni` | analitika zaposlenih (paginirano) | `analytics.ba.view` |
| `/analitika/prevoz` | prevoz po prevozniku i odgovornom licu | `analytics.ba.view` |
| `/zaposleni` | **Zaposleni** — lista sa pretragom i filterima | `employee.view` |
| `/zaposleni/novi` | vođeni unos novog zaposlenog sa proverom duplikata | `employee.create` |
| `/zaposleni/:id` | profil: istorija raspodela i prevoza, odobreni obračuni | `employee.view` |
| `/obavestenja` | obaveštenja | `notification.view_own` |

Provera permisije u `RequireAuth` odlučuje **samo šta se renderuje**. Baza
ponovo proverava sve na svakom pozivu — RLS i RPC provere su prava odbrana. Isto
važi i za navigaciju: link koji korisnik ne može da iskoristi se ne prikazuje, ali
to nije bezbednosna mera.

Ni na jednom ekranu — Finance ili dodatni zahtevi — **ne postoji polje za unos
iznosa**. Operater unosi poslovne činjenice (zaposleni, datum rada, vrsta isplate,
količina, smer, obrazloženje) i vidi izračunat predlog; iznos rezolvira baza iz
pravila važećeg na datum rada.

Na ekranu Administracije ponašanje obračuna se **bira iz kataloga koji server
pošalje** — UI ne hardkoduje listu i ne može da ponudi ponašanje koje engine ne
razume. `VITE_WDR_MOCK_ROLE=admin` otvara ekran bez baze (izmene pravila u mock
režimu su namerno onemogućene, jer bez baze nema versionisanja).

Na BA ekranima svi filteri (od, do, centar, zaposleni, sortiranje) su **ulaz u
RPC** — server agregira i sprovodi opseg; klijent ne filtrira globalni skup.
Grafikoni su CSS stupci, bez ijedne dodatne zavisnosti i bez eksternog BI servisa.
Svaki odgovor nosi `basis`, pa se ekonomski trošak (datum rada) ne meša sa
finansijskim tokom (datum odobrenja).

Na Finance ekranima **ne postoji polje za iznos**. Server to i saopštava
(`approval_mode = CONFIRMATION_ONLY`, `amount_editable = false`), a dugmad prate
`can_approve` / `can_return` iz odgovora servera, ne klijentsku procenu. Za razvoj
bez baze: `VITE_WDR_MOCK_ROLE=finance` prebacuje mock sesiju na rolu FINANCE.

---

## Tastatura

| Taster | Akcija |
|---|---|
| `↑ ↓ ← →` | kretanje |
| `Shift` + strelice | proširivanje selekcije |
| `Tab` / `Shift+Tab` | sledeća / prethodna ćelija (prelazi u sledeći red) |
| `Enter` / `Shift+Enter` | dole / gore |
| `1`–`9` | šablon smene po redu iz toolbar-a |
| `R` | rad, podrazumevana smena zaposlenog |
| `G` | godišnji odmor |
| `B` | bolovanje |
| `S` | slobodan dan |
| `N` | ne radi |
| `Delete` / `Backspace` | obriši izabrane ćelije |
| `Ctrl+D` | kopiraj prethodni dan |
| `Ctrl+Shift+D` | kopiraj prethodnu nedelju |
| `Ctrl+A` | izaberi sve |
| `Ctrl+←` / `Ctrl+↑` | izaberi red / kolonu |
| `Ctrl+S` | sačuvaj odmah |
| `Esc` | otkaži selekciju |
| `Space` | otvori unos ispomoći za fokusiranu ćeliju |

Slova su izabrana po srpskim rečima koje operateri već koriste (**g**odišnji,
**b**olovanje, **s**lobodan, **n**e radi, **r**ad).

---

## Autosave

Slanje ide isključivo kroz `api.rpc_submit_period`; ekran `/unos/pregled` prati
serverski `ready_to_submit` i ne izvodi tu odluku sam.

- Debounce **800 ms** posle poslednjeg pritiska.
- Red čekanja je `Map` po ćeliji: **last write wins**, pa `06-14` a onda `GO` u
  istoj ćeliji šalje jedan red, ne dva protivrečna.
- Poziva `api.rpc_bulk_upsert_work_entries` sa **`p_atomic = false`**, da jedna
  loša ćelija ne odbaci ostale operaterove izmene. Neuspele ćelije se vraćaju
  kao `ERROR` i ostaju vidljivo nesačuvane.
- Grupne akcije (kopiranje nedelje, `Ctrl+A` + status) idu kroz isti red, ali
  operater ih vidi kao jedan potez.
- Ako je ćelija promenjena **dok je upis bio u toku**, ne označava se kao
  sačuvana — inače bi noviji pritisci izgledali kao upisani i bili izgubljeni na
  sledećem flush-u. To je posebno testirano.
- `beforeunload` upozorava ako u redu ima nesačuvanih izmena.
- Posle uspešnog batch-a sledi tihi refresh: oblik ćelije (segmenti, sati,
  vlasništvo) uvek dolazi iz baze, nikada iz optimistične pretpostavke.

Optimistična izmena je namerno plitka — menja samo status i oznaku smene. Sati,
vlasništvo i broj grešaka se ne pogađaju.

---

## Stanja učitavanja i greške

- Spinner postoji **samo pri prvom učitavanju**. Posle toga grid ostaje na
  ekranu, a pomera se samo indikator čuvanja.
- `Nema otvorenog perioda` — administrator nije otvorio period.
- Zaključana prijava (`SUBMITTED`, `FINANCE_APPROVED`, `CLOSED`) → toolbar
  prikazuje 🔒 i sve akcije su onemogućene.
- `RETURNED` → žuti banner sa uputstvom.
- Greška po ćeliji → crveni okvir + tooltip sa srpskom porukom; nikada se ne
  prikazuje sirova poruka baze koja sadrži UUID.
- Neuspeh celog zahteva → ćelije se vraćaju u stanje greške, ne u „sačuvano".

---

## Ispomoć preko centara

`Space` ili „Unesi ispomoć…" otvara dijalog koji zove
`api.rpc_add_assistance_segment`. Operater ciljnog centra ne mora imati prava u
matičnom centru zaposlenog.

Polje za troškovni centar **namerno ne postoji**. Prebacivanje troška zahteva
permisiju `cost_center.override` (za MVP samo `SUPER_ADMIN_BA`), pa bi ponuda
tog izbora operateru bila zagarantovano odbijanje. Trošak podrazumevano nosi
centar u kome je rad izvršen; osnovna dnevna naknada se i dalje obračunava po
matičnom centru (odluka D-R5).

---

## Testovi

```bash
npm test
```

90 testova nad logikom koja može tiho da pokvari podatke:

| Fajl | Šta dokazuje |
|---|---|
| `cellState.test.ts` | ćelija izmenjena tokom upisa se NE označava kao sačuvana; per-red greške se mapiraju; neuspeh celog zahteva ne daje „sačuvano" |
| `completion.test.ts` | vikend ne mora da se popuni za 100%; `NOT_WORKING` se računa kao pregledano; slanje uvek odlučuje baza |
| `selection.test.ts` | pravougaonik selekcije, Shift proširivanje, Tab prelom reda, klamp na ivicama |
| `bulk.test.ts` | kopiranje dana/nedelje, preskakanje tuđih ćelija, nikad dupliranje segmenta ispomoći |
| `keyboard.test.ts` | mapiranje tastera, Cmd na macOS-u, ignorisanje nepoznatih tastera |
| `model.test.ts` | EMPTY nije greška, `WORK` bez smene je greška, tuđi dan je read-only |
| `autosave.test.ts` | last-write-wins po ćeliji, delete gazi prethodnu izmenu |
| `errors.test.ts` | nikada sirova poruka sa UUID-om operateru |
| `submitReadiness.test.ts` | nepregledan očekivani dan blokira slanje; `NOT_WORKING` je pregledano; izuzetak bez permisije odbijen; nepotvrđeno upozorenje blokira; zastareo fingerprint se ne prihvata; nerešeno pravilo blokira; grid se zaključava posle slanja |

Grid komponente nisu pokrivene DOM testovima — vrednost bi bila mala u odnosu na
cenu, a sva logika koja može da pokvari podatak je izvučena u čiste module koji
su testirani.

---

## Šta NIJE implementirano

| Stavka | Zašto |
|---|---|
| Finansijsko odobrenje (`rpc_finance_approve`) | MVP3, izričito izvan opsega |
| BA dashboard | kasnija faza |
| Uređivanje komponenti (prekovremeni, ispomoć) u gridu | kontrakt podržava, UI dolazi posle pregleda ovog toka |
| Uvoz legacy Excel-a | opciono, posle MVP6 |
